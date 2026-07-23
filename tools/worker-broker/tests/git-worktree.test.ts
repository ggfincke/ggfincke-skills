// tools/worker-broker/tests/git-worktree.test.ts
// prove final-tree snapshots include Git-visible changes without mutating the index

import assert from 'node:assert/strict'
import { chmod, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { snapshotWorktree } from '../src/git-worktree.js'
import { git, initializeTestRepo } from './helpers.js'

test('snapshot captures rename, deletion, untracked, binary, and mode changes', async () =>
{
  const repo = await initializeTestRepo()
  try
  {
    await writeFile(path.join(repo, 'old.txt'), 'same content\n')
    await writeFile(path.join(repo, 'deleted.txt'), 'remove me\n')
    await writeFile(path.join(repo, 'binary.bin'), Buffer.from([0, 1, 2]))
    await writeFile(path.join(repo, 'script.sh'), '#!/bin/sh\nexit 0\n', {
      mode: 0o644,
    })
    await git(repo, 'add', '.')
    await git(repo, 'commit', '-qm', 'add files')
    const baseSha = (await git(repo, 'rev-parse', 'HEAD')).trim()
    const indexBefore = await readFile(path.join(repo, '.git', 'index'))

    await rename(path.join(repo, 'old.txt'), path.join(repo, 'new.txt'))
    await rm(path.join(repo, 'deleted.txt'))
    await writeFile(path.join(repo, 'untracked.txt'), 'new\n')
    await writeFile(path.join(repo, 'binary.bin'), Buffer.from([0, 4, 2]))
    await chmod(path.join(repo, 'script.sh'), 0o755)

    const patchPath = path.join(repo, 'snapshot.patch')
    const snapshot = await snapshotWorktree(repo, baseSha, patchPath)
    assert.deepEqual(snapshot.changed_files, [
      'binary.bin',
      'deleted.txt',
      'new.txt',
      'old.txt',
      'script.sh',
      'untracked.txt',
    ])
    assert.ok(snapshot.changes.some((change) => change.status.startsWith('R')))
    const patch = await readFile(patchPath, 'utf8')
    assert.match(patch, /GIT binary patch/u)
    assert.match(patch, /new file mode 100644/u)
    assert.match(patch, /old mode 100644/u)
    assert.match(patch, /new mode 100755/u)
    assert.deepEqual(
      await readFile(path.join(repo, '.git', 'index')),
      indexBefore
    )
  }
  finally
  {
    await rm(repo, { recursive: true, force: true })
  }
})
