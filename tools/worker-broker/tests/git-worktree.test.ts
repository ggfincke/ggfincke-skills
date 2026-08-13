// tools/worker-broker/tests/git-worktree.test.ts
// prove final-tree snapshots include Git-visible changes without mutating the index

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  captureWorktreeBaseline,
  diffWorktreeFromTree,
  snapshotWorktree,
} from '../src/git-worktree.js'
import { runStdoutToFile } from '../src/process-runner.js'
import { git, initializeTestRepo } from './helpers.js'

test('snapshot captures rename, deletion, untracked, binary, and mode changes', async () =>
{
  const repo = await initializeTestRepo()
  const evidenceRoot = await mkdtemp(
    path.join(os.tmpdir(), 'worker-broker-evidence-')
  )
  const applyWorktree = path.join(evidenceRoot, 'apply-worktree')
  try
  {
    await writeFile(path.join(repo, 'old.txt'), 'same content\n')
    await writeFile(path.join(repo, 'deleted.txt'), 'remove me\n')
    await writeFile(
      path.join(repo, 'binary-😀.bin'),
      randomBytes(2 * 1024 * 1024)
    )
    await writeFile(path.join(repo, 'script.sh'), '#!/bin/sh\nexit 0\n', {
      mode: 0o644,
    })
    await git(repo, 'add', '.')
    await git(repo, 'commit', '-qm', 'add files')
    const baseSha = (await git(repo, 'rev-parse', 'HEAD')).trim()
    const finalBinary = randomBytes(2 * 1024 * 1024)
    await rename(path.join(repo, 'old.txt'), path.join(repo, 'renamed-😀.txt'))
    await rm(path.join(repo, 'deleted.txt'))
    await writeFile(path.join(repo, 'untracked.txt'), 'new\n')
    await writeFile(path.join(repo, 'binary-😀.bin'), finalBinary)
    await chmod(path.join(repo, 'script.sh'), 0o755)

    // keep a conflicting real-index edit so the snapshot must use only its
    // private immutable-base index and leave the caller's state byte-identical
    await writeFile(path.join(repo, 'README.md'), 'real index edit\n')
    await git(repo, 'add', 'README.md')
    await writeFile(path.join(repo, 'README.md'), 'fixture\n')
    const indexBefore = await readFile(path.join(repo, '.git', 'index'))
    const statusBefore = await git(
      repo,
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all'
    )

    const patchPath = path.join(evidenceRoot, 'snapshot.patch')
    const snapshot = await snapshotWorktree(repo, baseSha, patchPath)
    assert.deepEqual(snapshot.changed_files, [
      'binary-😀.bin',
      'deleted.txt',
      'old.txt',
      'renamed-😀.txt',
      'script.sh',
      'untracked.txt',
    ])
    assert.equal(snapshot.head_sha, baseSha)
    assert.ok(snapshot.changes.some((change) => change.status.startsWith('R')))
    const patch = await readFile(patchPath, 'utf8')
    assert.match(patch, /GIT binary patch/u)
    assert.match(patch, /new file mode 100644/u)
    assert.match(patch, /old mode 100644/u)
    assert.match(patch, /new mode 100755/u)
    assert.equal((await stat(patchPath)).mode & 0o777, 0o600)
    assert.deepEqual(await readdir(evidenceRoot), ['snapshot.patch'])
    assert.deepEqual(
      await readFile(path.join(repo, '.git', 'index')),
      indexBefore
    )
    assert.equal(
      await git(
        repo,
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all'
      ),
      statusBefore
    )

    await git(repo, 'worktree', 'add', '--detach', applyWorktree, baseSha)
    await git(applyWorktree, 'apply', '--check', patchPath)
    await git(applyWorktree, 'apply', patchPath)
    assert.deepEqual(
      await readFile(path.join(applyWorktree, 'binary-😀.bin')),
      finalBinary
    )
    assert.equal(
      await readFile(path.join(applyWorktree, 'renamed-😀.txt'), 'utf8'),
      'same content\n'
    )
    assert.equal(
      await readFile(path.join(applyWorktree, 'untracked.txt'), 'utf8'),
      'new\n'
    )
    assert.equal(
      (await stat(path.join(applyWorktree, 'script.sh'))).mode & 0o777,
      0o755
    )
    await assert.rejects(
      readFile(path.join(applyWorktree, 'old.txt')),
      /ENOENT/u
    )
    await assert.rejects(
      readFile(path.join(applyWorktree, 'deleted.txt')),
      /ENOENT/u
    )
  }
  finally
  {
    await git(repo, 'worktree', 'remove', '--force', applyWorktree).catch(
      () =>
      {}
    )
    await rm(evidenceRoot, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('empty snapshot atomically replaces stale evidence with a private file', async () =>
{
  const repo = await initializeTestRepo()
  const evidenceRoot = await mkdtemp(
    path.join(os.tmpdir(), 'worker-broker-evidence-')
  )
  const patchPath = path.join(evidenceRoot, 'snapshot.patch')
  try
  {
    const baseSha = (await git(repo, 'rev-parse', 'HEAD')).trim()
    const indexBefore = await readFile(path.join(repo, '.git', 'index'))
    const statusBefore = await git(repo, 'status', '--porcelain=v1', '-z')
    await writeFile(patchPath, 'stale evidence\n', { mode: 0o644 })

    const snapshot = await snapshotWorktree(repo, baseSha, patchPath)

    assert.equal(snapshot.head_sha, baseSha)
    assert.deepEqual(snapshot.changes, [])
    assert.deepEqual(snapshot.changed_files, [])
    assert.equal((await stat(patchPath)).size, 0)
    assert.equal((await stat(patchPath)).mode & 0o777, 0o600)
    assert.deepEqual(await readdir(evidenceRoot), ['snapshot.patch'])
    assert.deepEqual(
      await readFile(path.join(repo, '.git', 'index')),
      indexBefore
    )
    assert.equal(
      await git(repo, 'status', '--porcelain=v1', '-z'),
      statusBefore
    )
  }
  finally
  {
    await rm(evidenceRoot, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('snapshot rejects an incomplete valid patch and preserves prior evidence', async () =>
{
  const repo = await initializeTestRepo()
  const evidenceRoot = await mkdtemp(
    path.join(os.tmpdir(), 'worker-broker-evidence-')
  )
  const patchPath = path.join(evidenceRoot, 'snapshot.patch')
  try
  {
    await writeFile(path.join(repo, 'first.txt'), 'base first\n')
    await writeFile(path.join(repo, 'second.txt'), 'base second\n')
    await git(repo, 'add', '.')
    await git(repo, 'commit', '-qm', 'add patch truncation fixtures')
    const baseSha = (await git(repo, 'rev-parse', 'HEAD')).trim()
    await writeFile(path.join(repo, 'first.txt'), 'final first\n')
    await writeFile(path.join(repo, 'second.txt'), 'final second\n')
    await writeFile(patchPath, 'prior complete evidence\n', { mode: 0o600 })
    const indexBefore = await readFile(path.join(repo, '.git', 'index'))
    const statusBefore = await git(repo, 'status', '--porcelain=v1', '-z')

    await assert.rejects(
      snapshotWorktree(
        repo,
        baseSha,
        patchPath,
        [],
        async (command, args, cwd, stdoutPath, env) =>
        {
          assert.equal(command, 'git')
          await runStdoutToFile(
            command,
            [...args, 'first.txt'],
            cwd,
            stdoutPath,
            env
          )
        }
      ),
      /streamed patch reconstructed tree .* expected captured final tree/u
    )
    assert.equal(await readFile(patchPath, 'utf8'), 'prior complete evidence\n')
    assert.equal((await stat(patchPath)).mode & 0o777, 0o600)
    assert.deepEqual(await readdir(evidenceRoot), ['snapshot.patch'])
    assert.deepEqual(
      await readFile(path.join(repo, '.git', 'index')),
      indexBefore
    )
    assert.equal(
      await git(repo, 'status', '--porcelain=v1', '-z'),
      statusBefore
    )
  }
  finally
  {
    await rm(evidenceRoot, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('post-setup baseline expands untracked directories and keeps its patch base-applicable', async () =>
{
  const repo = await initializeTestRepo()
  const applyRoot = await mkdtemp(
    path.join(os.tmpdir(), 'worker-broker-apply-')
  )
  const applyWorktree = path.join(applyRoot, 'worktree')
  try
  {
    const baseSha = (await git(repo, 'rev-parse', 'HEAD')).trim()
    const indexBefore = await readFile(path.join(repo, '.git', 'index'))
    const generated = path.join(repo, 'generated')
    const setupFile = path.join(generated, '😀.txt')
    await mkdir(generated)
    await writeFile(setupFile, 'setup\n')

    const baseline = await captureWorktreeBaseline(repo, baseSha)
    assert.deepEqual(baseline.changed_files, ['generated/😀.txt'])

    await writeFile(setupFile, 'worker\n')
    await writeFile(path.join(generated, 'sibling.txt'), 'sibling\n')
    const attribution = await diffWorktreeFromTree(repo, baseline.tree_sha)
    assert.deepEqual(attribution.changed_files, [
      'generated/sibling.txt',
      'generated/😀.txt',
    ])

    const patchPath = path.join(repo, 'attributed.patch')
    const snapshot = await snapshotWorktree(repo, baseSha, patchPath, [
      'generated/😀.txt',
    ])
    assert.deepEqual(snapshot.changed_files, ['generated/sibling.txt'])

    await git(repo, 'worktree', 'add', '--detach', applyWorktree, baseSha)
    await git(applyWorktree, 'apply', '--check', patchPath)
    await git(applyWorktree, 'apply', patchPath)
    assert.equal(
      await readFile(
        path.join(applyWorktree, 'generated', 'sibling.txt'),
        'utf8'
      ),
      'sibling\n'
    )
    await assert.rejects(
      readFile(path.join(applyWorktree, 'generated', '😀.txt'), 'utf8'),
      /ENOENT/u
    )
    assert.deepEqual(
      await readFile(path.join(repo, '.git', 'index')),
      indexBefore
    )
  }
  finally
  {
    await git(repo, 'worktree', 'remove', '--force', applyWorktree).catch(
      () =>
      {}
    )
    await rm(applyRoot, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('snapshot excludes hundreds of setup files via a pathspec file', async () =>
{
  const repo = await initializeTestRepo()
  const evidenceRoot = await mkdtemp(
    path.join(os.tmpdir(), 'worker-broker-evidence-')
  )
  try
  {
    const baseSha = (await git(repo, 'rev-parse', 'HEAD')).trim()
    const setupDir = path.join(repo, 'setup')
    await mkdir(setupDir)
    const setupPaths = Array.from(
      { length: 300 },
      (_, index) => `setup/f-${String(index).padStart(3, '0')}.txt`
    )
    await Promise.all(
      setupPaths.map(async (relative, index) =>
      {
        await writeFile(path.join(repo, relative), `setup ${index}\n`)
      })
    )
    await writeFile(path.join(repo, 'worker.txt'), 'from worker\n')

    const patchPath = path.join(evidenceRoot, 'snapshot.patch')
    const snapshot = await snapshotWorktree(
      repo,
      baseSha,
      patchPath,
      setupPaths
    )
    assert.deepEqual(snapshot.changed_files, ['worker.txt'])
    const patch = await readFile(patchPath, 'utf8')
    assert.match(patch, /worker\.txt/u)
    assert.doesNotMatch(patch, /setup\/f-/u)
  }
  finally
  {
    await rm(evidenceRoot, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})
