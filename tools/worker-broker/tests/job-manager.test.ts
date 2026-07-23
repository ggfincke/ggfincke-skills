// tools/worker-broker/tests/job-manager.test.ts
// exercise rejection, serialized overlap, & cancellation through the real job lifecycle

import assert from 'node:assert/strict'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type {
  BrokerConfig,
  ProviderOutcome,
  ProviderRunContext,
  WorkerProvider,
} from '../src/contracts.js'
import { JobManager } from '../src/job-manager.js'
import { initializeTestRepo, waitUntil } from './helpers.js'

const SUCCESS: ProviderOutcome = {
  exit_code: 0,
  signal: null,
  model_result: {
    summary: 'fixture worker completed',
    assumptions: [],
    risks: [],
    follow_ups: [],
  },
}

class OutOfScopeProvider implements WorkerProvider
{
  readonly name = 'codex' as const

  async run(context: ProviderRunContext): Promise<ProviderOutcome>
  {
    await writeFile(path.join(context.worktree, 'outside.txt'), 'not allowed\n')
    return SUCCESS
  }
}

class ControlledProvider implements WorkerProvider
{
  readonly name = 'codex' as const
  readonly started: string[] = []
  private readonly releases = new Map<string, () => void>()

  async run(context: ProviderRunContext): Promise<ProviderOutcome>
  {
    this.started.push(context.job_id)
    return await new Promise<ProviderOutcome>((resolve) =>
    {
      const finish = (): void => resolve(SUCCESS)
      this.releases.set(context.job_id, finish)
      context.signal.addEventListener(
        'abort',
        () => resolve({ exit_code: null, signal: 'SIGTERM' }),
        { once: true }
      )
    })
  }

  release(jobId: string): void
  {
    const release = this.releases.get(jobId)
    if (release === undefined) throw new Error(`job has not started: ${jobId}`)
    release()
  }
}

async function fixtureConfig(): Promise<{
  config: BrokerConfig
  stateDir: string
}>
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'worker-broker-state-'))
  return {
    config: {
      state_dir: stateDir,
      codex_binary: 'codex',
      cursor_binary: 'cursor-agent',
      coral_binary: 'coral',
    },
    stateDir,
  }
}

async function withJobManagerFixture(
  run: (fixture: { config: BrokerConfig; repo: string }) => Promise<void>
): Promise<void>
{
  const repo = await initializeTestRepo()
  const { config, stateDir } = await fixtureConfig()
  try
  {
    await run({ config, repo })
  }
  finally
  {
    await rm(repo, { recursive: true, force: true })
    await rm(stateDir, { recursive: true, force: true })
  }
}

test('job manager rejects final changes outside the assignment', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    const manager = new JobManager(config, [new OutOfScopeProvider()])
    const started = await manager.start({
      provider: 'codex',
      mode: 'edit',
      repo,
      task: 'write within src',
      allowed_paths: ['src'],
    })
    const finished = await manager.waitForTerminal(started.job_id)
    assert.equal(finished.status, 'rejected')
    assert.deepEqual(finished.result?.scope_violations, ['outside.txt'])
    assert.ok(finished.result?.patch_path)
  })
})

test('verification mutations are included in final scope enforcement', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    const manager = new JobManager(config, [
      {
        name: 'codex',
        run: async () => SUCCESS,
      },
    ])
    const started = await manager.start({
      provider: 'codex',
      mode: 'edit',
      repo,
      task: 'verify without scope drift',
      allowed_paths: ['src'],
      verification_commands: ['printf drift > outside.txt'],
    })
    const finished = await manager.waitForTerminal(started.job_id)
    assert.equal(finished.status, 'rejected')
    assert.deepEqual(finished.result?.scope_violations, ['outside.txt'])
    assert.deepEqual(finished.result?.changed_files, ['outside.txt'])
    assert.equal(finished.result?.verification[0]?.exit_code, 0)
  })
})

test('overlapping edit jobs serialize and a queued job cancels without starting', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    const provider = new ControlledProvider()
    const manager = new JobManager(config, [provider])
    const first = await manager.start({
      provider: 'codex',
      mode: 'edit',
      repo,
      task: 'first auth change',
      allowed_paths: ['src/auth'],
    })
    await waitUntil(() => provider.started.includes(first.job_id))
    const second = await manager.start({
      provider: 'codex',
      mode: 'edit',
      repo,
      task: 'second auth change',
      allowed_paths: ['src/auth/session.ts'],
    })
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.deepEqual(provider.started, [first.job_id])

    const cancelled = await manager.cancel(second.job_id)
    assert.equal(cancelled.status, 'cancelled')
    provider.release(first.job_id)
    assert.equal(
      (await manager.waitForTerminal(first.job_id)).status,
      'completed'
    )
    assert.deepEqual(provider.started, [first.job_id])
  })
})

test('a running job reaches cancelled after its provider observes abort', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    const provider = new ControlledProvider()
    const manager = new JobManager(config, [provider])
    const started = await manager.start({
      provider: 'codex',
      mode: 'edit',
      repo,
      task: 'cancel active work',
      allowed_paths: ['src'],
    })
    await waitUntil(() => provider.started.includes(started.job_id))
    await manager.cancel(started.job_id)
    const finished = await manager.waitForTerminal(started.job_id)
    assert.equal(finished.status, 'cancelled')
    assert.equal(finished.result?.process_signal, 'SIGTERM')
  })
})

test('dirty parent checkout does not block start and stays out of the worktree', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    const dirtyName = 'parent-only-dirty.txt'
    await writeFile(path.join(repo, dirtyName), 'parent wip\n')
    const manager = new JobManager(config, [
      {
        name: 'codex',
        run: async () => SUCCESS,
      },
    ])
    const started = await manager.start({
      provider: 'codex',
      mode: 'edit',
      repo,
      task: 'start despite parent dirt',
      allowed_paths: ['src'],
    })
    assert.ok(started.job_id)
    const finished = await manager.waitForTerminal(started.job_id)
    assert.equal(finished.status, 'completed')
    const worktree = finished.worktree
    assert.ok(worktree)
    await access(path.join(worktree, 'README.md'))
    await assert.rejects(access(path.join(worktree, dirtyName)))
  })
})
