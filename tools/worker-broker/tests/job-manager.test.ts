// tools/worker-broker/tests/job-manager.test.ts
// exercise broker lifecycle, Git evidence, serialization, & cancellation

import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type {
  BrokerConfig,
  ProcessIdentity,
  ProviderOutcome,
  ProviderRunContext,
  StartWorkerRequest,
  WorkerAdmission,
  WorkerJob,
  WorkerProvider,
  WorkerSummary,
} from '../src/contracts.js'
import { createWorktree, resolveBaseSha } from '../src/git-worktree.js'
import { JobManager } from '../src/job-manager.js'
import {
  processGroupExists,
  runProcess,
  terminateProcessGroup,
  UnconfirmedProcessGroupExitError,
} from '../src/process-runner.js'
import { git, initializeTestRepo, waitUntil } from './helpers.js'

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

const CONTROLLED_PROCESS_SCRIPT = [
  "const { existsSync, writeFileSync } = require('node:fs')",
  'const [marker, release] = process.argv.slice(1)',
  'writeFileSync(marker, String(process.pid))',
  'const timer = setInterval(() => {',
  'if (!existsSync(release)) return',
  'clearInterval(timer)',
  '}, 10)',
].join(';')

function shellQuote(value: string): string
{
  return `'${value.replaceAll("'", "'\\''")}'`
}

function controlledProcessCommand(marker: string, release: string): string
{
  return [process.execPath, '-e', CONTROLLED_PROCESS_SCRIPT, marker, release]
    .map(shellQuote)
    .join(' ')
}

async function pathExists(target: string): Promise<boolean>
{
  try
  {
    await access(target)
    return true
  }
  catch
  {
    return false
  }
}

async function startControlledProcess(
  directory: string,
  label: string
): Promise<{
  identity: ProcessIdentity
  release_path: string
  running: Promise<void>
}>
{
  const markerPath = path.join(directory, `${label}.started`)
  const releasePath = path.join(directory, `${label}.release`)
  let resolveIdentity = (_identity: ProcessIdentity): void => undefined
  const identityPromise = new Promise<ProcessIdentity>((resolve) =>
  {
    resolveIdentity = resolve
  })
  const running = runProcess({
    command: process.execPath,
    args: ['-e', CONTROLLED_PROCESS_SCRIPT, markerPath, releasePath],
    cwd: directory,
    stdout_path: path.join(directory, `${label}.stdout.log`),
    stderr_path: path.join(directory, `${label}.stderr.log`),
    on_process_started: (identity) => resolveIdentity(identity),
  })
  const settled = running.then(
    () => undefined,
    () => undefined
  )
  const identity = await identityPromise
  await waitUntil(async () => await pathExists(markerPath))
  return { identity, release_path: releasePath, running: settled }
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
  readonly eventLogPaths = new Map<string, string>()
  private readonly releases = new Map<string, () => void>()

  async run(context: ProviderRunContext): Promise<ProviderOutcome>
  {
    this.started.push(context.job_id)
    this.eventLogPaths.set(context.job_id, context.event_log_path)
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

async function startJob(
  manager: JobManager,
  request: StartWorkerRequest
): Promise<WorkerSummary>
{
  return (await manager.start(request)).job
}

async function waitForFullJob(
  manager: JobManager,
  jobId: string
): Promise<WorkerJob>
{
  await manager.waitForTerminal(jobId)
  return await manager.get(jobId)
}

test('job manager rejects final changes outside the assignment', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    const manager = new JobManager(config, [new OutOfScopeProvider()])
    const started = await startJob(manager, {
      provider: 'codex',
      mode: 'edit',
      repo,
      task: 'write within src',
      allowed_paths: ['src'],
    })
    const finished = await waitForFullJob(manager, started.job_id)
    assert.equal(finished.status, 'rejected')
    assert.deepEqual(finished.result?.scope_violations, ['outside.txt'])
    assert.deepEqual(finished.result?.changed_files, ['outside.txt'])
    const patchPath = finished.result?.patch_path
    assert.ok(patchPath)
    assert.match(await readFile(patchPath, 'utf8'), /outside\.txt/u)
  })
})

test('terminal manager hot paths use summaries while explicit result reads stay full', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    const provider = new ControlledProvider()
    const manager = new JobManager(config, [provider])
    const started = await startJob(manager, {
      provider: 'codex',
      mode: 'read',
      repo,
      task: 'evict terminal full state',
      allowed_paths: [],
    })
    await waitUntil(() => provider.started.includes(started.job_id))
    const read = manager.store.read.bind(manager.store)
    manager.store.read = async () =>
    {
      throw new Error('explicit full record read')
    }
    try
    {
      assert.equal((await manager.getSummary(started.job_id)).status, 'running')
      assert.ok(
        (await manager.list()).some((job) => job.job_id === started.job_id)
      )
    }
    finally
    {
      manager.store.read = read
    }
    provider.release(started.job_id)
    const terminal = await manager.waitForTerminal(started.job_id)
    assert.equal(terminal.status, 'completed')

    manager.store.read = async () =>
    {
      throw new Error('explicit full record read')
    }
    try
    {
      assert.equal(
        (await manager.getSummary(started.job_id)).status,
        'completed'
      )
      assert.ok(
        (await manager.list()).some((job) => job.job_id === started.job_id)
      )
      assert.equal((await manager.cancel(started.job_id)).status, 'completed')
      await assert.rejects(
        manager.get(started.job_id),
        /explicit full record read/u
      )
    }
    finally
    {
      manager.store.read = read
    }
  })
})

test('terminal state stays unpublished until its authoritative write commits', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    const provider = new ControlledProvider()
    const manager = new JobManager(config, [provider])
    const started = await startJob(manager, {
      provider: 'codex',
      mode: 'read',
      repo,
      task: 'commit terminal state before publishing it',
      allowed_paths: [],
      setup_commands: ['true'],
    })
    await waitUntil(() => provider.started.includes(started.job_id))

    const write = manager.store.write.bind(manager.store)
    let releaseTerminalWrite = (): void => undefined
    let markTerminalWriteEntered = (): void => undefined
    const terminalWriteGate = new Promise<void>((resolve) =>
    {
      releaseTerminalWrite = resolve
    })
    const terminalWriteEntered = new Promise<void>((resolve) =>
    {
      markTerminalWriteEntered = resolve
    })
    manager.store.write = async (job) =>
    {
      if (job.status === 'completed')
      {
        markTerminalWriteEntered()
        await terminalWriteGate
        throw new Error('injected terminal write failure')
      }
      await write(job)
    }
    try
    {
      provider.release(started.job_id)
      await terminalWriteEntered
      assert.equal((await manager.getSummary(started.job_id)).status, 'running')
      const persisted = JSON.parse(
        await readFile(manager.store.jobPath(started.job_id), 'utf8')
      ) as { status: string }
      assert.equal(persisted.status, 'running')

      const waiting = manager.waitForTerminal(started.job_id)
      releaseTerminalWrite()
      const terminal = await waiting
      assert.equal(terminal.status, 'failed')
      assert.equal(terminal.error_preview, 'injected terminal write failure')
      assert.equal(
        JSON.parse(
          await readFile(manager.store.jobPath(started.job_id), 'utf8')
        ).status,
        'failed'
      )
      assert.equal((await manager.get(started.job_id)).result?.setup.length, 1)
    }
    finally
    {
      releaseTerminalWrite()
      manager.store.write = write
    }
  })
})

test('setup-created out-of-scope paths stay out of worker evidence', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    let manager: JobManager
    manager = new JobManager(config, [
      {
        name: 'codex',
        run: async (context) =>
        {
          assert.deepEqual(
            (await manager.store.read(context.job_id)).setup_paths,
            ['setup-link']
          )
          return SUCCESS
        },
      },
    ])
    const started = await startJob(manager, {
      provider: 'codex',
      mode: 'edit',
      repo,
      task: 'use setup-provided dependencies',
      allowed_paths: ['src'],
      setup_commands: ['ln -s README.md setup-link'],
    })
    const finished = await waitForFullJob(manager, started.job_id)
    assert.equal(finished.status, 'completed')
    assert.deepEqual(finished.setup_paths, ['setup-link'])
    assert.deepEqual(finished.result?.scope_violations, [])
    assert.deepEqual(finished.result?.changed_files, [])
    assert.deepEqual(finished.result?.changes, [])
    const patchPath = finished.result?.patch_path
    assert.ok(patchPath)
    assert.equal(await readFile(patchPath, 'utf8'), '')
  })
})

test('a later setup-path mutation is rejected with a base-applicable salvage patch', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    const manager = new JobManager(config, [
      {
        name: 'codex',
        run: async (context) =>
        {
          await writeFile(
            path.join(context.worktree, 'generated', '😀.txt'),
            'worker\n'
          )
          await writeFile(
            path.join(context.worktree, 'generated', 'sibling.txt'),
            'sibling\n'
          )
          return SUCCESS
        },
      },
    ])
    const started = await startJob(manager, {
      provider: 'codex',
      mode: 'edit',
      repo,
      task: 'change one generated sibling',
      allowed_paths: ['generated/sibling.txt'],
      setup_commands: ['mkdir -p generated && echo setup > generated/😀.txt'],
    })
    const finished = await waitForFullJob(manager, started.job_id)
    assert.equal(finished.status, 'rejected')
    assert.deepEqual(finished.setup_paths, ['generated/😀.txt'])
    assert.match(finished.setup_tree_sha ?? '', /^[0-9a-f]{40,64}$/u)
    assert.equal(finished.result?.failure_class, 'scope')
    assert.deepEqual(finished.result?.scope_violations, ['generated/😀.txt'])
    assert.deepEqual(finished.result?.changed_files, [
      'generated/sibling.txt',
      'generated/😀.txt',
    ])
    assert.match(finished.result?.error ?? '', /salvage evidence only/u)

    const patchPath = finished.result?.patch_path
    assert.ok(patchPath)
    const applyRoot = await mkdtemp(
      path.join(os.tmpdir(), 'worker-broker-apply-')
    )
    const applyWorktree = path.join(applyRoot, 'worktree')
    try
    {
      await git(
        repo,
        'worktree',
        'add',
        '--detach',
        applyWorktree,
        finished.base_sha
      )
      await git(applyWorktree, 'apply', '--check', patchPath)
      await git(applyWorktree, 'apply', patchPath)
      assert.equal(
        await readFile(path.join(applyWorktree, 'generated', '😀.txt'), 'utf8'),
        'worker\n'
      )
      assert.equal(
        await readFile(
          path.join(applyWorktree, 'generated', 'sibling.txt'),
          'utf8'
        ),
        'sibling\n'
      )
    }
    finally
    {
      await git(repo, 'worktree', 'remove', '--force', applyWorktree).catch(
        () =>
        {}
      )
      await rm(applyRoot, { recursive: true, force: true })
    }
  })
})

test('a missing post-setup tree fails as broker evidence loss with a full patch', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    let manager: JobManager
    manager = new JobManager(config, [
      {
        name: 'codex',
        run: async (context) =>
        {
          const persisted = await manager.store.read(context.job_id)
          const treeSha = persisted.setup_tree_sha
          assert.ok(treeSha)
          const commonDirectory = (
            await git(context.worktree, 'rev-parse', '--git-common-dir')
          ).trim()
          const objectDirectory = path.isAbsolute(commonDirectory)
            ? commonDirectory
            : path.resolve(context.worktree, commonDirectory)
          await rm(
            path.join(
              objectDirectory,
              'objects',
              treeSha.slice(0, 2),
              treeSha.slice(2)
            )
          )
          await writeFile(path.join(context.worktree, 'result.txt'), 'worker\n')
          return SUCCESS
        },
      },
    ])
    const started = await startJob(manager, {
      provider: 'codex',
      mode: 'edit',
      repo,
      task: 'preserve evidence when setup attribution is unavailable',
      allowed_paths: ['result.txt'],
      setup_commands: ['echo setup > setup.txt'],
    })
    const finished = await waitForFullJob(manager, started.job_id)
    assert.equal(finished.status, 'failed')
    assert.equal(finished.result?.failure_class, 'broker_fault')
    assert.deepEqual(finished.result?.scope_violations, [])
    assert.deepEqual(finished.result?.changed_files, [
      'result.txt',
      'setup.txt',
    ])
    assert.match(
      finished.result?.error ?? '',
      /post-setup tree could not be read.*salvage evidence only/u
    )
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
    const started = await startJob(manager, {
      provider: 'codex',
      mode: 'edit',
      repo,
      task: 'verify without scope drift',
      allowed_paths: ['src'],
      verification_commands: ['printf drift > outside.txt'],
    })
    const finished = await waitForFullJob(manager, started.job_id)
    assert.equal(finished.status, 'rejected')
    assert.deepEqual(finished.result?.scope_violations, ['outside.txt'])
    assert.deepEqual(finished.result?.changed_files, ['outside.txt'])
    assert.equal(finished.result?.verification[0]?.exit_code, 0)
  })
})

test('failed concurrent admission stays invisible and preserves FIFO conflicts', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    const provider = new ControlledProvider()
    const manager = new JobManager(config, [provider])
    const writeJob = manager.store.write.bind(manager.store)
    let failedWriteClaimed = false
    let failedJobId: string | undefined
    let markWriteEntered = (): void => undefined
    let releaseWrite = (): void => undefined
    const writeEntered = new Promise<void>((resolve) =>
    {
      markWriteEntered = resolve
    })
    const writeGate = new Promise<void>((resolve) =>
    {
      releaseWrite = resolve
    })
    manager.store.write = async (job) =>
    {
      if (
        !failedWriteClaimed &&
        job.request.task === 'failed admission must not remain queued'
      )
      {
        failedWriteClaimed = true
        failedJobId = job.job_id
        markWriteEntered()
        await writeGate
        throw new Error('injected admission write failure')
      }
      await writeJob(job)
    }
    let failedStart: Promise<WorkerAdmission> | undefined
    let firstStart: Promise<WorkerAdmission> | undefined
    let firstAdmission: WorkerAdmission | undefined
    try
    {
      failedStart = manager.start({
        provider: 'codex',
        mode: 'edit',
        repo,
        task: 'failed admission must not remain queued',
        allowed_paths: ['src/auth'],
      })
      await writeEntered
      assert.ok(failedJobId)
      firstStart = manager.start({
        provider: 'codex',
        mode: 'edit',
        repo,
        task: 'first auth change',
        allowed_paths: ['src/auth'],
      })
      await assert.rejects(
        manager.get(failedJobId),
        (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
      )
      assert.deepEqual(provider.started, [])
      releaseWrite()
      await assert.rejects(failedStart, /injected admission write failure/u)
      firstAdmission = await firstStart
    }
    finally
    {
      releaseWrite()
      manager.store.write = writeJob
      await failedStart?.catch(() => undefined)
      await firstStart?.catch(() => undefined)
    }

    assert.ok(firstAdmission)
    assert.deepEqual(firstAdmission.serializes_behind, [])
    const first = firstAdmission.job
    assert.deepEqual(
      (await manager.list()).map((job) => job.job_id),
      [first.job_id]
    )
    await waitUntil(() => provider.started.includes(first.job_id))
    const earlier = await manager.start({
      provider: 'codex',
      mode: 'edit',
      repo,
      task: 'second auth change',
      allowed_paths: ['src/auth/session.ts'],
    })
    const later = await manager.start({
      provider: 'codex',
      mode: 'edit',
      repo,
      task: 'third auth change',
      allowed_paths: ['src/auth/session.ts'],
    })
    assert.deepEqual(earlier.serializes_behind, [
      {
        job_id: first.job_id,
        overlapping_paths: ['src/auth/session.ts'],
      },
    ])
    assert.deepEqual(later.serializes_behind, [
      {
        job_id: first.job_id,
        overlapping_paths: ['src/auth/session.ts'],
      },
      {
        job_id: earlier.job.job_id,
        overlapping_paths: ['src/auth/session.ts'],
      },
    ])
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.deepEqual(provider.started, [first.job_id])

    assert.equal((await manager.cancel(earlier.job.job_id)).status, 'cancelled')
    assert.equal((await manager.cancel(later.job.job_id)).status, 'cancelled')
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
    const first = await startJob(manager, {
      provider: 'codex',
      mode: 'edit',
      repo,
      task: 'first scope',
      allowed_paths: ['src/first'],
    })
    await waitUntil(() => provider.started.includes(first.job_id))
    const second = await startJob(manager, {
      provider: 'codex',
      mode: 'edit',
      repo,
      task: 'bridging scope',
      allowed_paths: ['src/first', 'src/second'],
    })
    const third = await startJob(manager, {
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
    const dependency = await startJob(manager, {
      provider: 'codex',
      mode: 'edit',
      repo,
      task: 'fail dependency',
      allowed_paths: ['src'],
    })
    const dependent = await startJob(manager, {
      provider: 'codex',
      mode: 'read',
      repo,
      task: 'wait on dependency',
      allowed_paths: [],
      depends_on: [dependency.job_id],
    })
    const finished = await waitForFullJob(manager, dependent.job_id)
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

test('a job record written before setup_commands existed still runs', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    const seed = new JobManager(config, [])
    const jobId = 'legacy-queued-job'
    const legacyRequest = {
      provider: 'codex',
      mode: 'read',
      repo,
      base_ref: 'HEAD',
      task: 'resume work queued by an older broker',
      allowed_paths: [],
      acceptance_criteria: [],
      verification_commands: [],
      depends_on: [],
      allow_nested_agents: false,
    }
    await seed.store.write({
      job_id: jobId,
      status: 'queued',
      // a record persisted before the setup_commands field shipped
      request: legacyRequest as unknown as WorkerJob['request'],
      base_sha: await resolveBaseSha(repo, 'HEAD'),
      created_at: new Date().toISOString(),
    })

    const provider = new ControlledProvider()
    const manager = new JobManager(config, [provider])
    await manager.initialize()
    await waitUntil(() => provider.started.includes(jobId))
    provider.release(jobId)
    const finished = await waitForFullJob(manager, jobId)
    assert.equal(finished.status, 'completed')
    assert.deepEqual(finished.result?.setup, [])
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
      restart_requeues: 1,
      created_at: new Date().toISOString(),
    })
    await writeFile(
      path.join(seed.store.jobDir(jobId), 'events.jsonl'),
      '{"type":"legacy-attempt-zero"}\n'
    )

    const provider = new ControlledProvider()
    const manager = new JobManager(config, [provider])
    await manager.initialize()
    await waitUntil(() => provider.started.includes(jobId))
    assert.equal(
      path.basename(provider.eventLogPaths.get(jobId) ?? ''),
      'events.attempt-1.jsonl'
    )
    assert.equal(
      await readFile(
        path.join(seed.store.jobDir(jobId), 'events.attempt-0.jsonl'),
        'utf8'
      ),
      '{"type":"legacy-attempt-zero"}\n'
    )
    assert.equal(
      await pathExists(path.join(seed.store.jobDir(jobId), 'events.jsonl')),
      false
    )
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

test('restart requeues clean work once but terminalizes dirty salvage', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    const cleanProcess = await startControlledProcess(
      config.state_dir,
      'restart-clean'
    )
    const dirtyProcess = await startControlledProcess(
      config.state_dir,
      'restart-dirty'
    )
    const cleanIdentity = cleanProcess.identity
    const dirtyIdentity = dirtyProcess.identity
    let manager: JobManager | undefined
    try
    {
      assert.equal(processGroupExists(cleanIdentity.pid), true)
      assert.equal(processGroupExists(dirtyIdentity.pid), true)
      const seed = new JobManager(config, [])
      const baseSha = await resolveBaseSha(repo, 'HEAD')
      const request = {
        provider: 'codex' as const,
        mode: 'read' as const,
        repo,
        base_ref: 'HEAD',
        allowed_paths: [],
        acceptance_criteria: [],
        setup_commands: [],
        verification_commands: [],
        depends_on: [],
        allow_nested_agents: false,
      }
      const cleanJobId = 'persisted-clean-process-job'
      const dirtyJobId = 'persisted-dirty-process-job'
      const cleanWorktree = await createWorktree(
        repo,
        seed.store.worktreePath(cleanJobId),
        baseSha,
        'read',
        cleanJobId
      )
      const dirtyWorktree = await createWorktree(
        repo,
        seed.store.worktreePath(dirtyJobId),
        baseSha,
        'read',
        dirtyJobId
      )
      await writeFile(
        path.join(dirtyWorktree.path, 'interrupted.txt'),
        'salvage me\n'
      )
      await seed.store.write({
        job_id: cleanJobId,
        status: 'running',
        request: {
          ...request,
          task: 'requeue clean interrupted work',
        },
        base_sha: baseSha,
        worktree: cleanWorktree.path,
        process_id: cleanIdentity.pid,
        process_token: cleanIdentity.token,
        created_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
      })
      await seed.store.write({
        job_id: dirtyJobId,
        status: 'running',
        request: {
          ...request,
          task: 'preserve dirty interrupted work',
        },
        base_sha: baseSha,
        worktree: dirtyWorktree.path,
        process_id: dirtyIdentity.pid,
        process_token: dirtyIdentity.token,
        created_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
      })
      await writeFile(
        path.join(seed.store.jobDir(dirtyJobId), 'events.jsonl'),
        '{"type":"legacy-interrupted-event"}\n'
      )

      const provider = new ControlledProvider()
      manager = new JobManager(config, [provider])
      await manager.initialize()
      await Promise.all([cleanProcess.running, dirtyProcess.running])
      assert.equal(processGroupExists(cleanIdentity.pid), false)
      assert.equal(processGroupExists(dirtyIdentity.pid), false)
      await waitUntil(() => provider.started.includes(cleanJobId))

      const requeued = await manager.get(cleanJobId)
      assert.equal(requeued.status, 'running')
      assert.equal(requeued.restart_requeues, 1)
      assert.equal(requeued.process_id, undefined)
      assert.equal(requeued.process_token, undefined)
      assert.equal(
        path.basename(provider.eventLogPaths.get(cleanJobId) ?? ''),
        'events.attempt-1.jsonl'
      )
      const dirty = await manager.get(dirtyJobId)
      assert.equal(dirty.status, 'failed')
      assert.equal(dirty.process_id, undefined)
      assert.equal(dirty.process_token, undefined)
      assert.equal(dirty.result?.failure_class, 'broker_fault')
      assert.deepEqual(dirty.result?.changed_files, ['interrupted.txt'])
      assert.equal(
        path.basename(dirty.result?.event_log_path ?? ''),
        'events.attempt-0.jsonl'
      )
      assert.equal(
        await readFile(dirty.result?.event_log_path ?? '', 'utf8'),
        '{"type":"legacy-interrupted-event"}\n'
      )
      assert.match(
        dirty.result?.error ?? '',
        /automatic retry was suppressed.*change\.patch/u
      )
      assert.equal(provider.started.includes(dirtyJobId), false)
      assert.ok(dirty.result?.patch_path)
      assert.match(
        await readFile(dirty.result.patch_path, 'utf8'),
        /interrupted\.txt/u
      )
      await git(repo, 'apply', '--check', dirty.result.patch_path)

      await manager.cancel(cleanJobId)
      const cleanTerminal = await waitForFullJob(manager, cleanJobId)
      assert.equal(cleanTerminal.status, 'cancelled')
      assert.equal(
        path.basename(cleanTerminal.result?.event_log_path ?? ''),
        'events.attempt-1.jsonl'
      )
      await manager.shutdown()
    }
    finally
    {
      await Promise.all(
        [cleanProcess.release_path, dirtyProcess.release_path].map(
          async (release) => await writeFile(release, '').catch(() => undefined)
        )
      )
      await manager?.shutdown().catch(() => undefined)
      await terminateProcessGroup(cleanIdentity.pid).catch(() => undefined)
      await terminateProcessGroup(dirtyIdentity.pid).catch(() => undefined)
      await Promise.all([
        cleanProcess.running.catch(() => undefined),
        dirtyProcess.running.catch(() => undefined),
      ])
    }
  })
})

test('restart fail-stops before snapshot when group exit is unconfirmed', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    const seed = new JobManager(config, [])
    const jobId = 'persisted-invalid-process-group-job'
    const baseSha = await resolveBaseSha(repo, 'HEAD')
    const worktree = await createWorktree(
      repo,
      seed.store.worktreePath(jobId),
      baseSha,
      'read',
      jobId
    )
    await writeFile(path.join(worktree.path, 'still-live.txt'), 'unstable\n')
    await seed.store.write({
      job_id: jobId,
      status: 'running',
      request: {
        provider: 'codex',
        mode: 'read',
        repo,
        base_ref: 'HEAD',
        task: 'do not snapshot an unowned live worktree',
        allowed_paths: [],
        acceptance_criteria: [],
        setup_commands: [],
        verification_commands: [],
        depends_on: [],
        allow_nested_agents: false,
      },
      base_sha: baseSha,
      worktree: worktree.path,
      process_id: 1,
      created_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
    })

    const manager = new JobManager(config, [])
    await assert.rejects(
      manager.initialize(),
      (error: unknown) =>
        error instanceof AggregateError &&
        error.errors.some((cause: unknown) =>
          /durable ownership was retained and no worktree snapshot was taken/u.test(
            String(cause)
          )
        )
    )
    const persisted = await seed.store.read(jobId)
    assert.equal(persisted.status, 'running')
    assert.equal(persisted.process_id, 1)
    await assert.rejects(
      access(path.join(seed.store.jobDir(jobId), 'change.patch')),
      (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
    )
  })
})

test('restart fail-stops before snapshot when durable PID clear fails', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    const interrupted = await startControlledProcess(
      config.state_dir,
      'restart-clear-failure'
    )
    const seed = new JobManager(config, [])
    const jobId = 'persisted-process-clear-failure-job'
    const baseSha = await resolveBaseSha(repo, 'HEAD')
    const worktree = await createWorktree(
      repo,
      seed.store.worktreePath(jobId),
      baseSha,
      'read',
      jobId
    )
    await seed.store.write({
      job_id: jobId,
      status: 'running',
      request: {
        provider: 'codex',
        mode: 'read',
        repo,
        base_ref: 'HEAD',
        task: 'retain ownership when restart clear fails',
        allowed_paths: [],
        acceptance_criteria: [],
        setup_commands: [],
        verification_commands: [],
        depends_on: [],
        allow_nested_agents: false,
      },
      base_sha: baseSha,
      worktree: worktree.path,
      process_id: interrupted.identity.pid,
      process_token: interrupted.identity.token,
      created_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
    })

    const manager = new JobManager(config, [])
    const write = manager.store.write.bind(manager.store)
    let clearFailed = false
    manager.store.write = async (job) =>
    {
      if (
        !clearFailed &&
        job.job_id === jobId &&
        job.process_id === undefined &&
        job.process_token === undefined
      )
      {
        clearFailed = true
        throw new Error('injected restart ownership-clear failure')
      }
      await write(job)
    }
    try
    {
      await assert.rejects(
        manager.initialize(),
        (error: unknown) =>
          error instanceof AggregateError &&
          error.errors.some((cause: unknown) =>
            /durable ownership could not be cleared.*ownership was retained and no worktree snapshot was taken.*injected restart ownership-clear failure/u.test(
              String(cause)
            )
          )
      )
      await interrupted.running
      assert.equal(clearFailed, true)
      const persisted = await seed.store.read(jobId)
      assert.equal(persisted.status, 'running')
      assert.equal(persisted.process_id, interrupted.identity.pid)
      assert.equal(persisted.process_token, interrupted.identity.token)
      assert.equal(processGroupExists(interrupted.identity.pid), false)
      await assert.rejects(
        access(path.join(seed.store.jobDir(jobId), 'change.patch')),
        (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
      )
    }
    finally
    {
      await writeFile(interrupted.release_path, '').catch(() => undefined)
      manager.store.write = write
      await terminateProcessGroup(interrupted.identity.pid).catch(
        () => undefined
      )
      await interrupted.running.catch(() => undefined)
    }
  })
})

test('running-write failure and gated cancellation never start execution', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    const provider = new ControlledProvider()
    const manager = new JobManager(config, [provider])
    const write = manager.store.write.bind(manager.store)
    let runningFailureInjected = false
    let markCancelledWriteEntered = (): void => undefined
    let releaseCancelledWrite = (): void => undefined
    const cancelledWriteEntered = new Promise<void>((resolve) =>
    {
      markCancelledWriteEntered = resolve
    })
    const cancelledWriteGate = new Promise<void>((resolve) =>
    {
      releaseCancelledWrite = resolve
    })
    manager.store.write = async (job) =>
    {
      if (
        !runningFailureInjected &&
        job.status === 'running' &&
        job.request.task === 'fail before execution starts'
      )
      {
        runningFailureInjected = true
        throw new Error('injected running write failure')
      }
      if (
        job.status === 'running' &&
        job.request.task === 'cancel during running write'
      )
      {
        markCancelledWriteEntered()
        await cancelledWriteGate
      }
      await write(job)
    }
    try
    {
      const failed = await startJob(manager, {
        provider: 'codex',
        mode: 'read',
        repo,
        task: 'fail before execution starts',
        allowed_paths: [],
      })
      const failedTerminal = await waitForFullJob(manager, failed.job_id)
      assert.equal(failedTerminal.status, 'failed')
      assert.equal(failedTerminal.result?.failure_class, 'broker_fault')
      assert.match(
        failedTerminal.result?.error ?? '',
        /failed to persist running state: injected running write failure/u
      )
      assert.equal(
        await pathExists(manager.store.worktreePath(failed.job_id)),
        false
      )

      const cancelled = await startJob(manager, {
        provider: 'codex',
        mode: 'read',
        repo,
        task: 'cancel during running write',
        allowed_paths: [],
      })
      await cancelledWriteEntered
      assert.equal((await manager.cancel(cancelled.job_id)).status, 'running')
      assert.equal(
        await pathExists(manager.store.worktreePath(cancelled.job_id)),
        false
      )
      releaseCancelledWrite()
      const cancelledTerminal = await waitForFullJob(manager, cancelled.job_id)
      assert.equal(cancelledTerminal.status, 'cancelled')
      assert.equal(cancelledTerminal.worktree, undefined)
      assert.deepEqual(provider.started, [])
    }
    finally
    {
      releaseCancelledWrite()
      manager.store.write = write
      await manager.shutdown().catch(() => undefined)
    }
  })
})

test('a running job reaches cancelled after its provider observes abort', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    const provider = new ControlledProvider()
    const manager = new JobManager(config, [provider])
    const started = await startJob(manager, {
      provider: 'codex',
      mode: 'edit',
      repo,
      task: 'cancel active work',
      allowed_paths: ['src'],
    })
    await waitUntil(() => provider.started.includes(started.job_id))
    await manager.cancel(started.job_id)
    const finished = await waitForFullJob(manager, started.job_id)
    assert.equal(finished.status, 'cancelled')
    assert.equal(finished.result?.process_signal, 'SIGTERM')
    const activity = await readFile(
      path.join(config.state_dir, 'jobs', started.job_id, 'activity.jsonl'),
      'utf8'
    )
    assert.equal(activity.includes('"kind":"action","status":"failed"'), true)
  })
})

test('setup, provider, and verification persist exact live process ownership', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    const setupMarker = path.join(config.state_dir, 'setup.started')
    const setupRelease = path.join(config.state_dir, 'setup.release')
    const providerMarker = path.join(config.state_dir, 'provider.started')
    const providerRelease = path.join(config.state_dir, 'provider.release')
    const verificationMarker = path.join(
      config.state_dir,
      'verification.started'
    )
    const verificationRelease = path.join(
      config.state_dir,
      'verification.release'
    )
    const processIds: number[] = []
    const manager = new JobManager(config, [
      {
        name: 'codex',
        run: async (context) =>
        {
          const result = await runProcess({
            command: process.execPath,
            args: [
              '-e',
              CONTROLLED_PROCESS_SCRIPT,
              providerMarker,
              providerRelease,
            ],
            cwd: context.worktree,
            stdout_path: context.event_log_path,
            stderr_path: context.stderr_path,
            signal: context.signal,
            on_process_started: context.on_process_started,
            on_process_finished: context.on_process_finished,
          })
          return {
            exit_code: result.exit_code,
            signal: result.signal,
          }
        },
      },
    ])
    let jobId: string | undefined
    try
    {
      const started = await startJob(manager, {
        provider: 'codex',
        mode: 'read',
        repo,
        task: 'track every subprocess phase',
        allowed_paths: [],
        setup_commands: [controlledProcessCommand(setupMarker, setupRelease)],
        verification_commands: [
          controlledProcessCommand(verificationMarker, verificationRelease),
        ],
      })
      jobId = started.job_id

      await waitUntil(async () => await pathExists(setupMarker))
      const setupProcessId = (await manager.store.read(jobId)).process_id
      assert.ok(setupProcessId)
      processIds.push(setupProcessId)
      assert.equal(processGroupExists(setupProcessId), true)
      await writeFile(setupRelease, '')

      await waitUntil(async () => await pathExists(providerMarker))
      assert.equal(processGroupExists(setupProcessId), false)
      const providerProcessId = (await manager.store.read(jobId)).process_id
      assert.ok(providerProcessId)
      processIds.push(providerProcessId)
      assert.equal(processGroupExists(providerProcessId), true)
      await writeFile(providerRelease, '')

      await waitUntil(async () => await pathExists(verificationMarker))
      assert.equal(processGroupExists(providerProcessId), false)
      const verificationProcessId = (await manager.store.read(jobId)).process_id
      assert.ok(verificationProcessId)
      processIds.push(verificationProcessId)
      assert.equal(processGroupExists(verificationProcessId), true)
      await writeFile(verificationRelease, '')

      const terminal = await waitForFullJob(manager, jobId)
      assert.equal(terminal.status, 'completed')
      assert.equal(terminal.process_id, undefined)
      assert.equal(terminal.result?.setup.length, 1)
      assert.equal(terminal.result?.verification.length, 1)
      for (const processId of processIds)
      {
        assert.equal(processGroupExists(processId), false)
      }
    }
    finally
    {
      await Promise.all(
        [setupRelease, providerRelease, verificationRelease].map(
          async (release) => await writeFile(release, '').catch(() => undefined)
        )
      )
      if (jobId !== undefined)
        await manager.cancel(jobId).catch(() => undefined)
      await manager.shutdown().catch(() => undefined)
      await Promise.all(
        processIds.map(
          async (processId) =>
            await terminateProcessGroup(processId).catch(() => undefined)
        )
      )
    }
  })
})

test('process ownership write failures stop the phase and fail PID-free', async () =>
{
  for (const failurePoint of ['start', 'clear'] as const)
  {
    await withJobManagerFixture(async ({ config, repo }) =>
    {
      const provider = new ControlledProvider()
      const manager = new JobManager(config, [provider])
      const write = manager.store.write.bind(manager.store)
      let processId: number | undefined
      let failureInjected = false
      manager.store.write = async (job) =>
      {
        if (
          !failureInjected &&
          job.status === 'running' &&
          job.process_id !== undefined
        )
        {
          processId = job.process_id
          if (failurePoint === 'start')
          {
            failureInjected = true
            throw new Error('injected process-start write failure')
          }
          await write(job)
          return
        }
        if (
          !failureInjected &&
          failurePoint === 'clear' &&
          processId !== undefined &&
          job.status === 'running' &&
          job.process_id === undefined
        )
        {
          failureInjected = true
          throw new Error('injected process-clear write failure')
        }
        await write(job)
      }
      try
      {
        const started = await startJob(manager, {
          provider: 'codex',
          mode: 'read',
          repo,
          task: `fail process ownership ${failurePoint}`,
          allowed_paths: [],
          setup_commands: ['true'],
        })
        const terminal = await waitForFullJob(manager, started.job_id)
        assert.equal(failureInjected, true)
        assert.equal(terminal.status, 'failed')
        assert.equal(terminal.process_id, undefined)
        assert.equal(terminal.result?.failure_class, 'broker_fault')
        assert.match(
          terminal.result?.error ?? '',
          new RegExp(`failed to (persist|clear) process group`, 'u')
        )
        assert.deepEqual(provider.started, [])
        assert.equal(
          (await manager.store.read(started.job_id)).process_id,
          undefined
        )
        assert.ok(processId)
        assert.equal(processGroupExists(processId), false)
      }
      finally
      {
        manager.store.write = write
        await manager.shutdown().catch(() => undefined)
        if (processId !== undefined)
        {
          await terminateProcessGroup(processId).catch(() => undefined)
        }
      }
    })
  }
})

test('provider process-clear failure remains a PID-free broker fault', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    const providerMarker = path.join(config.state_dir, 'provider-fault.started')
    const providerRelease = path.join(
      config.state_dir,
      'provider-fault.release'
    )
    const manager = new JobManager(config, [
      {
        name: 'codex',
        run: async (context) =>
        {
          const result = await runProcess({
            command: process.execPath,
            args: [
              '-e',
              `${CONTROLLED_PROCESS_SCRIPT};writeFileSync('provider-clear-salvage.txt', 'salvage\\n')`,
              providerMarker,
              providerRelease,
            ],
            cwd: context.worktree,
            stdout_path: context.event_log_path,
            stderr_path: context.stderr_path,
            signal: context.signal,
            on_process_started: context.on_process_started,
            on_process_finished: context.on_process_finished,
          })
          return {
            exit_code: result.exit_code,
            signal: result.signal,
          }
        },
      },
    ])
    const write = manager.store.write.bind(manager.store)
    let processId: number | undefined
    let ownershipPersisted = false
    let failureInjected = false
    let jobId: string | undefined
    manager.store.write = async (job) =>
    {
      if (
        job.request.task === 'fail provider process clear' &&
        job.status === 'running' &&
        job.process_id !== undefined
      )
      {
        processId = job.process_id
        await write(job)
        ownershipPersisted = true
        return
      }
      if (
        !failureInjected &&
        ownershipPersisted &&
        job.request.task === 'fail provider process clear' &&
        job.status === 'running' &&
        job.process_id === undefined
      )
      {
        failureInjected = true
        throw new Error('injected provider process-clear write failure')
      }
      await write(job)
    }
    try
    {
      const started = await startJob(manager, {
        provider: 'codex',
        mode: 'read',
        repo,
        task: 'fail provider process clear',
        allowed_paths: [],
      })
      jobId = started.job_id
      await waitUntil(async () => await pathExists(providerMarker))
      assert.ok(processId)
      assert.equal((await manager.store.read(jobId)).process_id, processId)
      assert.equal(processGroupExists(processId), true)

      await writeFile(providerRelease, '')
      const terminal = await waitForFullJob(manager, jobId)
      assert.equal(failureInjected, true)
      assert.equal(terminal.status, 'failed')
      assert.equal(terminal.process_id, undefined)
      assert.equal(terminal.result?.failure_class, 'broker_fault')
      assert.match(
        terminal.result?.error ?? '',
        new RegExp(
          `failed to clear process group ${processId} ownership: injected provider process-clear write failure;.*salvage evidence only`,
          'u'
        )
      )
      assert.deepEqual(terminal.result?.changed_files, [
        'provider-clear-salvage.txt',
      ])
      assert.ok(terminal.result?.patch_path)
      assert.match(
        await readFile(terminal.result.patch_path, 'utf8'),
        /provider-clear-salvage\.txt/u
      )
      await git(repo, 'apply', '--check', terminal.result.patch_path)
      assert.equal((await manager.store.read(jobId)).process_id, undefined)
      assert.equal((await manager.store.read(jobId)).process_token, undefined)
      assert.equal(processGroupExists(processId), false)
    }
    finally
    {
      await writeFile(providerRelease, '').catch(() => undefined)
      manager.store.write = write
      if (jobId !== undefined)
        await manager.cancel(jobId).catch(() => undefined)
      await manager.shutdown().catch(() => undefined)
      if (processId !== undefined)
      {
        await terminateProcessGroup(processId).catch(() => undefined)
      }
    }
  })
})

test('active phases propagate unconfirmed group exit without terminalizing', async () =>
{
  for (const phase of ['setup', 'provider', 'verification'] as const)
  {
    await withJobManagerFixture(async ({ config, repo }) =>
    {
      const manager = new JobManager(config, [
        {
          name: 'codex',
          run: async (context) =>
          {
            if (phase !== 'provider') return SUCCESS
            const result = await runProcess({
              command: process.execPath,
              args: [
                '-e',
                "require('node:fs').writeFileSync('during-provider.txt', 'unsafe\\n')",
              ],
              cwd: context.worktree,
              stdout_path: context.event_log_path,
              stderr_path: context.stderr_path,
              signal: context.signal,
              on_process_started: context.on_process_started,
              on_process_finished: context.on_process_finished,
            })
            return { exit_code: result.exit_code, signal: result.signal }
          },
        },
      ])
      const jobId = `unconfirmed-${phase}-group-exit`
      const job: WorkerJob = {
        job_id: jobId,
        status: 'running',
        request: {
          provider: 'codex',
          mode: 'read',
          repo,
          base_ref: 'HEAD',
          task: `fail-stop during ${phase}`,
          allowed_paths: [],
          acceptance_criteria: [],
          setup_commands:
            phase === 'setup'
              ? [
                  {
                    command: 'printf unsafe > during-setup.txt',
                    timeout_seconds: 30,
                  },
                ]
              : [],
          verification_commands:
            phase === 'verification'
              ? [
                  {
                    command: 'printf unsafe > during-verification.txt',
                    timeout_seconds: 30,
                  },
                ]
              : [],
          depends_on: [],
          allow_nested_agents: false,
        },
        base_sha: await resolveBaseSha(repo, 'HEAD'),
        created_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
      }
      await manager.store.write(job)
      const write = manager.store.write.bind(manager.store)
      let identity: ProcessIdentity | undefined
      manager.store.write = async (current) =>
      {
        if (
          current.job_id === jobId &&
          current.process_id !== undefined &&
          current.process_token !== undefined
        )
        {
          identity = {
            pid: current.process_id,
            token: current.process_token,
          }
        }
        await write(current)
      }
      const originalKill = process.kill
      process.kill = ((processId, signal) =>
      {
        if (
          identity !== undefined &&
          processId === -identity.pid &&
          signal === 'SIGTERM'
        )
        {
          const error = new Error(
            `injected ${phase} process-group uncertainty`
          ) as NodeJS.ErrnoException
          error.code = 'EPERM'
          throw error
        }
        return originalKill(processId, signal)
      }) as typeof process.kill
      try
      {
        const execute = (
          manager as unknown as {
            execute(
              activeJob: WorkerJob,
              controller: AbortController
            ): Promise<void>
          }
        ).execute.bind(manager)
        await assert.rejects(
          execute(job, new AbortController()),
          (error: unknown) =>
            error instanceof UnconfirmedProcessGroupExitError &&
            error.message.includes(
              `injected ${phase} process-group uncertainty`
            )
        )
      }
      finally
      {
        process.kill = originalKill
        manager.store.write = write
      }

      assert.ok(identity)
      assert.equal(processGroupExists(identity.pid), false)
      const persisted = await manager.store.read(jobId)
      assert.equal(persisted.status, 'running')
      assert.equal(persisted.process_id, identity.pid)
      assert.equal(persisted.process_token, identity.token)
      assert.equal(persisted.result, undefined)
      const patchPath = path.join(manager.store.jobDir(jobId), 'change.patch')
      if (phase === 'verification')
      {
        assert.doesNotMatch(
          await readFile(patchPath, 'utf8'),
          /during-verification/u
        )
      }
      else
      {
        await assert.rejects(
          access(patchPath),
          (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
        )
      }
      const activity = await readFile(
        path.join(manager.store.jobDir(jobId), 'activity.jsonl'),
        'utf8'
      )
      assert.equal(activity.includes('"phase":"finalizing"'), false)
    })
  }
})

test('activity is persisted incrementally before provider completion', async () =>
{
  await withJobManagerFixture(async ({ config, repo }) =>
  {
    const provider = new ControlledProvider()
    const manager = new JobManager(config, [provider])
    const started = await startJob(manager, {
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
    const started = await startJob(manager, {
      provider: 'codex',
      mode: 'edit',
      repo,
      task: 'start despite parent dirt',
      allowed_paths: ['src'],
    })
    assert.ok(started.job_id)
    const finished = await waitForFullJob(manager, started.job_id)
    assert.equal(finished.status, 'completed')
    const worktree = finished.worktree
    assert.ok(worktree)
    await access(path.join(worktree, 'README.md'))
    await assert.rejects(access(path.join(worktree, dirtyName)))
  })
})
