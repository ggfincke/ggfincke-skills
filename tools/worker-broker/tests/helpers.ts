// tools/worker-broker/tests/helpers.ts
// build isolated Git fixtures & bounded async assertions for broker tests

import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' })
  return stdout
}

export async function initializeTestRepo(): Promise<string> {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'worker-broker-repo-'))
  await git(repo, 'init', '-q')
  await git(repo, 'config', 'user.name', 'Worker Broker Tests')
  await git(repo, 'config', 'user.email', 'worker-broker@example.invalid')
  await writeFile(path.join(repo, 'README.md'), 'fixture\n')
  await git(repo, 'add', 'README.md')
  await git(repo, 'commit', '-qm', 'fixture')
  return repo
}

export async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for test condition')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
