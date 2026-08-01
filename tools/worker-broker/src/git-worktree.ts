// tools/worker-broker/src/git-worktree.ts
// create immutable-base worktrees & derive authoritative final-tree patches

import { randomUUID } from 'node:crypto'
import { mkdtemp, rename, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { secureDirectory, writePrivateFile } from './artifact.js'
import type { ChangedPath, GitSnapshot, WorkerMode } from './contracts.js'
import { runCaptured } from './process-runner.js'

async function git(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<string>
{
  return await runCaptured('git', args, cwd, env)
}

export async function resolveRepository(repo: string): Promise<string>
{
  if (!path.isAbsolute(repo))
    throw new Error(`repo must be an absolute path: ${repo}`)
  return (await git(repo, ['rev-parse', '--show-toplevel'])).trim()
}

export async function resolveBaseSha(
  repo: string,
  baseRef: string
): Promise<string>
{
  return (
    await git(repo, ['rev-parse', '--verify', `${baseRef}^{commit}`])
  ).trim()
}

interface CreatedWorktree
{
  path: string
  branch?: string
}

export async function createWorktree(
  repo: string,
  worktreePath: string,
  baseSha: string,
  mode: WorkerMode,
  jobId: string
): Promise<CreatedWorktree>
{
  await secureDirectory(path.dirname(worktreePath))
  await secureDirectory(worktreePath)
  if (mode === 'read')
  {
    await git(repo, ['worktree', 'add', '--detach', worktreePath, baseSha])
    return { path: worktreePath }
  }

  // -B resets a branch an interrupted earlier attempt at this job id left
  // behind; without it the stale ref blocks every retry of that job
  const branch = `agent/${jobId}`
  await git(repo, ['worktree', 'add', '-B', branch, worktreePath, baseSha])
  return { path: worktreePath, branch }
}

// remove a job worktree & its branch so the same job id can be re-prepared;
// a branch that survives deletion surfaces later as a createWorktree failure
export async function removeWorktree(
  repo: string,
  worktreePath: string,
  branch?: string
): Promise<void>
{
  try
  {
    await git(repo, ['worktree', 'remove', '--force', worktreePath])
  }
  catch
  {
    await rm(worktreePath, { recursive: true, force: true })
    await git(repo, ['worktree', 'prune'])
  }
  if (branch !== undefined)
  {
    await git(repo, ['branch', '-D', branch]).catch(() =>
    {})
  }
}

function parseNameStatus(output: string): ChangedPath[]
{
  const tokens = output.split('\0')
  if (tokens.at(-1) === '') tokens.pop()

  const changes: ChangedPath[] = []
  for (let index = 0; index < tokens.length;)
  {
    const status = tokens[index++]
    if (status === undefined || status === '') break
    const pathCount = status.startsWith('R') || status.startsWith('C') ? 2 : 1
    const paths = tokens.slice(index, index + pathCount)
    if (paths.length !== pathCount)
    {
      throw new Error(`unexpected git --name-status output after ${status}`)
    }
    changes.push({ status, paths })
    index += pathCount
  }
  return changes
}

async function writePatchAtomically(
  patchPath: string,
  patch: string
): Promise<void>
{
  const temporary = `${patchPath}.${process.pid}.${randomUUID()}.tmp`
  try
  {
    await writePrivateFile(temporary, patch)
    await rename(temporary, patchPath)
  }
  finally
  {
    await rm(temporary, { force: true })
  }
}

export async function snapshotWorktree(
  worktree: string,
  baseSha: string,
  patchPath: string
): Promise<GitSnapshot>
{
  const tempDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'worker-broker-index-')
  )
  const indexPath = path.join(tempDirectory, 'index')
  const env = { ...process.env, GIT_INDEX_FILE: indexPath }

  try
  {
    await git(worktree, ['read-tree', baseSha], env)
    await git(worktree, ['add', '-A', '--', '.'], env)
    const [patch, nameStatus, headSha] = await Promise.all([
      git(
        worktree,
        [
          'diff',
          '--cached',
          '--binary',
          '--full-index',
          '--no-ext-diff',
          '--find-renames',
          baseSha,
          '--',
        ],
        env
      ),
      git(
        worktree,
        [
          'diff',
          '--cached',
          '--name-status',
          '-z',
          '--find-renames',
          baseSha,
          '--',
        ],
        env
      ),
      git(worktree, ['rev-parse', 'HEAD']),
    ])
    await writePatchAtomically(patchPath, patch)

    const changes = parseNameStatus(nameStatus)
    return {
      head_sha: headSha.trim(),
      changes,
      changed_files: [
        ...new Set(changes.flatMap((change) => change.paths)),
      ].sort(),
      patch_path: patchPath,
    }
  }
  finally
  {
    await rm(tempDirectory, { recursive: true, force: true })
  }
}
