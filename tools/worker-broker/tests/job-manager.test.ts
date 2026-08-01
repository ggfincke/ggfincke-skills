// tools/worker-broker/tests/job-manager.test.ts
// exercise rejection, serialized overlap, & cancellation through the real job lifecycle

import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type {
  BrokerConfig,
  ProviderOutcome,
  ProviderRunContext,
  WorkerProvider,
} from '../src/contracts.js'
import { resolveBaseSha } from '../src/git-worktree.js'
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
    context.on_activity?.({ kind: 'action', status: 'started' })
    return await new Promise<ProviderOutcome>((resolve) =>
    {
      const finish = (): void =>
      {
        context.on_activity?.({ kind: 'action', status: 'completed' })
        resolve(SUCCESS)
      }
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
      claude_binary: 'claude',
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

test('queued edit jobs preserve FIFO fairness across overlapping scopes', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    const provider = new ControlledProvider()
    const manager = new JobManager(config, [provider])
    const first = await manager.start({
      provider: 'codex',
      mode: 'edit',
      repo,
      task: 'first scope',
      allowed_paths: ['src/first'],
    })
    await waitUntil(() => provider.started.includes(first.job_id))
    const second = await manager.start({
      provider: 'codex',
      mode: 'edit',
      repo,
      task: 'bridging scope',
      allowed_paths: ['src/first', 'src/second'],
    })
    const third = await manager.start({
      provider: 'codex',
      mode: 'edit',
      repo,
      task: 'later second scope',
      allowed_paths: ['src/second'],
    })
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.deepEqual(provider.started, [first.job_id])

    provider.release(first.job_id)
    await waitUntil(() => provider.started.includes(second.job_id))
    assert.deepEqual(provider.started, [first.job_id, second.job_id])
    provider.release(second.job_id)
    await waitUntil(() => provider.started.includes(third.job_id))
    provider.release(third.job_id)
    assert.equal(
      (await manager.waitForTerminal(third.job_id)).status,
      'completed'
    )
  })
})

test('dependencies wait for completion and reject after a failed dependency', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    const manager = new JobManager(config, [new OutOfScopeProvider()])
    const dependency = await manager.start({
      provider: 'codex',
      mode: 'edit',
      repo,
      task: 'fail dependency',
      allowed_paths: ['src'],
    })
    const dependent = await manager.start({
      provider: 'codex',
      mode: 'read',
      repo,
      task: 'wait on dependency',
      allowed_paths: [],
      depends_on: [dependency.job_id],
    })
    const finished = await manager.waitForTerminal(dependent.job_id)
    assert.equal(finished.status, 'rejected')
    assert.equal(
      finished.result?.error,
      `dependency ${dependency.job_id} ended rejected`
    )
    await assert.rejects(
      manager.start({
        provider: 'codex',
        mode: 'read',
        repo,
        task: 'unknown dependency',
        allowed_paths: [],
        depends_on: ['missing-job'],
      }),
      /unknown dependency job/
    )
  })
})

test('initialization restores a persisted queued job to the scheduler', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    const seed = new JobManager(config, [])
    const jobId = 'persisted-queued-job'
    await seed.store.write({
      job_id: jobId,
      status: 'queued',
      request: {
        provider: 'codex',
        mode: 'read',
        repo,
        base_ref: 'HEAD',
        task: 'resume queued work',
        allowed_paths: [],
        acceptance_criteria: [],
        setup_commands: [],
        verification_commands: [],
        depends_on: [],
        allow_nested_agents: false,
      },
      base_sha: await resolveBaseSha(repo, 'HEAD'),
      created_at: new Date().toISOString(),
    })

    const provider = new ControlledProvider()
    const manager = new JobManager(config, [provider])
    await manager.initialize()
    await waitUntil(() => provider.started.includes(jobId))
    provider.release(jobId)
    assert.equal((await manager.waitForTerminal(jobId)).status, 'completed')
  })
})

test('restart reconciliation closes interrupted activity before finalizing', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    const seed = new JobManager(config, [])
    const jobId = 'persisted-running-job'
    await seed.store.write({
      job_id: jobId,
      status: 'running',
      request: {
        provider: 'codex',
        mode: 'read',
        repo,
        base_ref: 'HEAD',
        task: 'recover interrupted work',
        allowed_paths: [],
        acceptance_criteria: [],
        setup_commands: [],
        verification_commands: [],
        depends_on: [],
        allow_nested_agents: false,
      },
      base_sha: await resolveBaseSha(repo, 'HEAD'),
      // the single automatic requeue is already spent, so reconciliation
      // takes the terminal-failure path this test observes
      restart_requeues: 1,
      created_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
    })
    await writeFile(
      path.join(config.state_dir, 'jobs', jobId, 'activity.jsonl'),
      [
        JSON.stringify({
          schema_version: 1,
          sequence: 1,
          recorded_at: new Date().toISOString(),
          kind: 'phase',
          phase: 'working',
          status: 'started',
        }),
        JSON.stringify({
          schema_version: 1,
          sequence: 2,
          recorded_at: new Date().toISOString(),
          kind: 'action',
          status: 'started',
        }),
      ].join('\n') + '\n'
    )

    const manager = new JobManager(config, [])
    await manager.initialize()
    const finished = await manager.get(jobId)
    assert.equal(finished.status, 'failed')
    const records = (
      await readFile(
        path.join(config.state_dir, 'jobs', jobId, 'activity.jsonl'),
        'utf8'
      )
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    assert.deepEqual(
      records
        .slice(2)
        .map((record) => [record.kind, record.phase, record.status]),
      [
        ['action', undefined, 'failed'],
        ['phase', 'working', 'failed'],
        ['phase', 'finalizing', 'started'],
        ['phase', 'finalizing', 'completed'],
      ]
    )
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
    const activity = await readFile(
      path.join(config.state_dir, 'jobs', started.job_id, 'activity.jsonl'),
      'utf8'
    )
    assert.equal(activity.includes('"kind":"action","status":"failed"'), true)
  })
})

test('activity is persisted incrementally before provider completion', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    const provider = new ControlledProvider()
    const manager = new JobManager(config, [provider])
    const started = await manager.start({
      provider: 'codex',
      mode: 'read',
      repo,
      task: 'report live activity',
      allowed_paths: [],
    })
    await waitUntil(() => provider.started.includes(started.job_id))
    const activityPath = path.join(
      config.state_dir,
      'jobs',
      started.job_id,
      'activity.jsonl'
    )
    await waitUntil(async () =>
      (await readFile(activityPath, 'utf8')).includes('"phase":"working"')
    )
    const liveActivity = await readFile(activityPath, 'utf8')
    assert.equal(liveActivity.includes('"status":"started"'), true)
    assert.equal((await manager.get(started.job_id)).status, 'running')

    provider.release(started.job_id)
    await manager.waitForTerminal(started.job_id)
    const records = (await readFile(activityPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    assert.deepEqual(
      records.map((record) => record.sequence),
      records.map((_, index) => index + 1)
    )
    assert.equal(
      records.some(
        (record) =>
          record.kind === 'phase' &&
          record.phase === 'finalizing' &&
          record.status === 'completed'
      ),
      true
    )
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
