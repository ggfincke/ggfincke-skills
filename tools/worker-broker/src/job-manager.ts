// tools/worker-broker/src/job-manager.ts
// schedule isolated jobs, compute evidence, reject drift, & retain terminal state

import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { ActivityWriter } from './activity.js'
import type {
  ActivityPhase,
  BrokerConfig,
  FailureClass,
  NormalizedVerificationCommand,
  ProviderOutcome,
  StartWorkerRequest,
  VerificationResult,
  WorkerJob,
  WorkerProvider,
  WorkerResult,
  WorkerStatus,
} from './contracts.js'
import {
  createWorktree,
  listWorktreeStatusPaths,
  removeWorktree,
  resolveBaseSha,
  resolveRepository,
  snapshotWorktree,
} from './git-worktree.js'
import { errorMessage } from './errors.js'
import { JobStore } from './job-store.js'
import {
  overlappingPaths,
  scopesOverlap,
  scopeViolations,
} from './path-scope.js'
import {
  processGroupExists,
  runProcess,
  terminateProcessGroup,
} from './process-runner.js'
import { normalizeRequest } from './request.js'

const TERMINAL_STATUSES = new Set<WorkerStatus>([
  'completed',
  'failed',
  'rejected',
  'cancelled',
])

export type FailureSite =
  'setup' | 'provider' | 'restart' | 'scope' | 'verification' | 'broker'

export function classifyFailure(
  site: FailureSite,
  result?: Pick<VerificationResult, 'exit_code' | 'timed_out'>
): FailureClass
{
  switch (site)
  {
    case 'setup':
      return 'environment'
    case 'provider':
      return 'model'
    case 'restart':
    case 'broker':
      return 'broker_fault'
    case 'scope':
      return 'scope'
    case 'verification':
      return result?.exit_code === 126 || result?.exit_code === 127
        ? 'environment'
        : 'verification'
  }
}

function taskSlug(task: string): string
{
  const slug = task
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 36)
  return slug === '' ? 'worker' : slug
}

function createJobId(task: string): string
{
  return `${taskSlug(task)}-${randomBytes(4).toString('hex')}`
}

function verificationFailed(
  result: Pick<VerificationResult, 'exit_code' | 'timed_out'>
): boolean
{
  return result.timed_out || result.exit_code !== 0
}

// exit 126/127 means the command itself could not run: an environment
// defect, not evidence against the worker's change
function commandFailureMessage(
  label: 'setup' | 'verification',
  result: VerificationResult
): string
{
  if (result.timed_out) return `${label} timed out: ${result.command}`
  const environmentFailure =
    result.exit_code === 126 || result.exit_code === 127
  if (label === 'setup')
  {
    return environmentFailure
      ? `setup environment failure (exit ${result.exit_code}: command not found or not executable): ${result.command}; the provider was not started`
      : `setup failed: ${result.command}; the provider was not started`
  }
  return environmentFailure
    ? `verification environment failure (exit ${result.exit_code}: command not found or not executable): ${result.command} — the worker's patch is preserved at change.patch; fix the worktree environment (setup_commands) instead of re-running the worker`
    : `verification failed: ${result.command}`
}

export class JobManager
{
  readonly store: JobStore
  private readonly jobs = new Map<string, WorkerJob>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly activities = new Map<string, ActivityWriter>()
  private readonly setupResults = new Map<string, VerificationResult[]>()
  private readonly worktreeOperations = new Map<string, Promise<void>>()
  private readonly providers: Map<string, WorkerProvider>
  private readonly events = new EventEmitter()
  private initialization: Promise<void> | undefined
  private scheduling = false
  private shuttingDown = false

  constructor(config: BrokerConfig, providers: readonly WorkerProvider[])
  {
    this.store = new JobStore(config.state_dir)
    this.providers = new Map(
      providers.map((provider) => [provider.name, provider])
    )
  }

  async initialize(): Promise<void>
  {
    this.initialization ??= this.initializeOnce()
    await this.initialization
    void this.schedule()
  }

  private async initializeOnce(): Promise<void>
  {
    await this.store.initialize()
    const interrupted = (await this.store.list())
      .filter((job) => !TERMINAL_STATUSES.has(job.status))
      .sort((left, right) => left.created_at.localeCompare(right.created_at))
    const reconciliations = await Promise.allSettled(
      interrupted.map(async (job) => await this.reconcileInterrupted(job))
    )
    const failures = reconciliations
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected'
      )
      .map((result) => result.reason)
    if (failures.length > 0)
    {
      throw new AggregateError(
        failures,
        'failed to reconcile interrupted worker jobs'
      )
    }
  }

  private async reconcileInterrupted(job: WorkerJob): Promise<void>
  {
    // a live process group means a sibling broker instance still owns this
    // job; reconcile only genuinely orphaned work
    if (job.process_id !== undefined && processGroupExists(job.process_id))
    {
      return
    }
    this.jobs.set(job.job_id, job)
    if (job.status === 'queued' && job.process_id === undefined) return
    let cleanupError: unknown
    if (job.process_id !== undefined)
    {
      try
      {
        await terminateProcessGroup(job.process_id)
      }
      catch (error)
      {
        cleanupError = error
      }
    }
    const priorStatus = job.status
    const message = `broker restarted before the job reached a terminal state (previous status: ${priorStatus})`
    const activity = this.activity(job)
    await activity.failPendingActions().catch(() =>
    {})
    const interruptedPhase = await activity
      .currentOpenPhase()
      .catch(() => undefined)
    if (interruptedPhase !== undefined)
    {
      await this.phase(job, interruptedPhase, 'failed')
    }
    let interruptedSnapshot:
      Awaited<ReturnType<typeof snapshotWorktree>> | undefined
    let recoveryError = cleanupError
    try
    {
      interruptedSnapshot = await this.snapshotInterruptedWorktree(job)
    }
    catch (error)
    {
      recoveryError ??= error
    }
    // one automatic recovery re-runs the same assignment after preserving
    // whatever the restart-orphaned worker left in its worktree
    if (
      recoveryError === undefined &&
      priorStatus === 'running' &&
      (job.restart_requeues ?? 0) < 1
    )
    {
      try
      {
        await this.requeueInterrupted(job)
        return
      }
      catch (error)
      {
        recoveryError = error
      }
    }
    const failureMessage =
      recoveryError === undefined
        ? message
        : `${message}; reconciliation failed: ${errorMessage(recoveryError)}`
    await this.finish(
      job,
      interruptedSnapshot === undefined
        ? this.baseResult(
            job,
            'failed',
            failureMessage,
            classifyFailure('restart')
          )
        : this.resultFromEvidence(
            job,
            'failed',
            undefined,
            interruptedSnapshot,
            [],
            [],
            failureMessage,
            classifyFailure('restart')
          )
    )
    if (cleanupError !== undefined) throw cleanupError
  }

  private async snapshotInterruptedWorktree(
    job: WorkerJob
  ): Promise<Awaited<ReturnType<typeof snapshotWorktree>> | undefined>
  {
    const worktreePath = this.store.worktreePath(job.job_id)
    try
    {
      await access(path.join(worktreePath, '.git'))
    }
    catch (error)
    {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    return await snapshotWorktree(
      worktreePath,
      job.base_sha,
      this.artifact(job, 'change.patch'),
      job.setup_paths
    )
  }

  private async requeueInterrupted(job: WorkerJob): Promise<void>
  {
    // clean up by deterministic identity, not by what the record happens to
    // record: a crash between worktree creation and the next write leaves a
    // worktree or branch the job never learned about
    await this.runWorktreeOperation(
      job.request.repo,
      async () =>
        await removeWorktree(
          job.request.repo,
          this.store.worktreePath(job.job_id),
          job.request.mode === 'edit' ? `agent/${job.job_id}` : undefined
        )
    )
    delete job.worktree
    delete job.branch
    delete job.process_id
    delete job.started_at
    delete job.setup_paths
    job.restart_requeues = (job.restart_requeues ?? 0) + 1
    job.status = 'queued'
    await this.store.write(job)
    await this.activity(job)
      .append({
        kind: 'message',
        summary: 'requeued after a broker restart interrupted the worker',
      })
      .catch(() =>
      {})
  }

  async start(request: StartWorkerRequest): Promise<WorkerJob>
  {
    if (this.shuttingDown) throw new Error('worker broker is shutting down')
    await this.initialize()
    const normalized = normalizeRequest(request)
    normalized.repo = await resolveRepository(normalized.repo)
    await Promise.all(
      normalized.depends_on.map(async (jobId) =>
      {
        try
        {
          await this.get(jobId)
        }
        catch
        {
          throw new Error(`unknown dependency job: ${jobId}`)
        }
      })
    )
    const baseSha = await resolveBaseSha(normalized.repo, normalized.base_ref)
    const jobId = createJobId(normalized.task)
    const job: WorkerJob = {
      job_id: jobId,
      status: 'queued',
      request: normalized,
      base_sha: baseSha,
      created_at: new Date().toISOString(),
    }
    this.jobs.set(jobId, job)
    await this.store.write(job)
    void this.schedule()
    return structuredClone(job)
  }

  async get(jobId: string): Promise<WorkerJob>
  {
    await this.initialize()
    const job = this.jobs.get(jobId) ?? (await this.store.read(jobId))
    return structuredClone(job)
  }

  async list(): Promise<WorkerJob[]>
  {
    await this.initialize()
    const persisted = await this.store.list()
    return persisted.map((job) =>
      structuredClone(this.jobs.get(job.job_id) ?? job)
    )
  }

  async cancel(jobId: string): Promise<WorkerJob>
  {
    await this.initialize()
    const job = this.jobs.get(jobId)
    if (job === undefined)
      throw new Error(`job is not active in this broker process: ${jobId}`)
    if (TERMINAL_STATUSES.has(job.status)) return structuredClone(job)

    if (job.status === 'queued')
    {
      await this.finish(
        job,
        this.baseResult(job, 'cancelled', 'job cancelled while queued')
      )
      return structuredClone(job)
    }

    this.controllers.get(jobId)?.abort()
    return structuredClone(job)
  }

  async waitForTerminal(jobId: string): Promise<WorkerJob>
  {
    await this.initialize()
    const current = this.jobs.get(jobId)
    if (current === undefined) throw new Error(`unknown active job: ${jobId}`)
    if (TERMINAL_STATUSES.has(current.status)) return structuredClone(current)

    return await new Promise<WorkerJob>((resolve) =>
    {
      const eventName = `terminal:${jobId}`
      this.events.once(eventName, (job: WorkerJob) =>
        resolve(structuredClone(job))
      )
    })
  }

  async shutdown(): Promise<void>
  {
    if (this.shuttingDown) return
    await this.initialize()
    this.shuttingDown = true
    const active = [...this.jobs.values()].filter(
      (job) => !TERMINAL_STATUSES.has(job.status)
    )
    const waits = active.map((job) => this.waitForTerminal(job.job_id))
    await Promise.all(active.map((job) => this.cancel(job.job_id)))
    await Promise.all(waits)
  }

  // which active edit jobs a job will serialize behind, and via which paths;
  // used to make scoping mistakes visible in the start_worker response
  editSerialization(
    jobId: string
  ): { job_id: string; overlapping_paths: string[] }[]
  {
    const job = this.jobs.get(jobId)
    if (job === undefined || job.request.mode !== 'edit') return []
    const conflicts: { job_id: string; overlapping_paths: string[] }[] = []
    for (const other of this.jobs.values())
    {
      if (
        other.job_id === job.job_id ||
        TERMINAL_STATUSES.has(other.status) ||
        other.request.mode !== 'edit' ||
        other.request.repo !== job.request.repo ||
        !scopesOverlap(other.request.allowed_paths, job.request.allowed_paths)
      )
      {
        continue
      }
      conflicts.push({
        job_id: other.job_id,
        overlapping_paths: overlappingPaths(
          other.request.allowed_paths,
          job.request.allowed_paths
        ),
      })
    }
    return conflicts
  }

  private earlierConflictingEditIsQueued(job: WorkerJob): boolean
  {
    if (job.request.mode !== 'edit') return false
    for (const queued of this.jobs.values())
    {
      if (queued.job_id === job.job_id) break
      if (
        queued.status === 'queued' &&
        queued.request.mode === 'edit' &&
        queued.request.repo === job.request.repo &&
        scopesOverlap(queued.request.allowed_paths, job.request.allowed_paths)
      )
      {
        return true
      }
    }
    return false
  }

  private canRun(job: WorkerJob): boolean
  {
    if (this.earlierConflictingEditIsQueued(job)) return false
    if (job.request.mode === 'read') return true
    for (const running of this.jobs.values())
    {
      if (
        running.status === 'running' &&
        running.request.mode === 'edit' &&
        running.request.repo === job.request.repo &&
        scopesOverlap(running.request.allowed_paths, job.request.allowed_paths)
      )
      {
        return false
      }
    }
    return true
  }

  private async dependencyFailure(job: WorkerJob): Promise<string | undefined>
  {
    for (const jobId of job.request.depends_on ?? [])
    {
      const dependency = await this.get(jobId)
      if (!TERMINAL_STATUSES.has(dependency.status)) return 'waiting'
      if (dependency.status !== 'completed')
      {
        return `dependency ${jobId} ended ${dependency.status}`
      }
    }
    return undefined
  }

  private async schedule(): Promise<void>
  {
    if (this.scheduling || this.shuttingDown) return
    this.scheduling = true
    try
    {
      for (const job of this.jobs.values())
      {
        if (job.status !== 'queued') continue
        const dependency = await this.dependencyFailure(job)
        if (dependency === 'waiting') continue
        if (dependency !== undefined)
        {
          await this.finish(
            job,
            this.baseResult(
              job,
              'rejected',
              dependency,
              classifyFailure('broker')
            )
          )
          continue
        }
        if (!this.canRun(job)) continue
        job.status = 'running'
        job.started_at = new Date().toISOString()
        await this.store.write(job)
        void this.execute(job)
      }
    }
    finally
    {
      this.scheduling = false
    }
  }

  private artifact(job: WorkerJob, name: string): string
  {
    return path.join(this.store.jobDir(job.job_id), name)
  }

  private activity(job: WorkerJob): ActivityWriter
  {
    let writer = this.activities.get(job.job_id)
    if (writer === undefined)
    {
      writer = new ActivityWriter(this.artifact(job, 'activity.jsonl'))
      this.activities.set(job.job_id, writer)
    }
    return writer
  }

  private async phase(
    job: WorkerJob,
    phase: ActivityPhase,
    status: 'started' | 'completed' | 'failed'
  ): Promise<void>
  {
    await this.activity(job)
      .append({ kind: 'phase', phase, status })
      .catch(() =>
      {})
  }

  private async runWorktreeOperation<T>(
    repo: string,
    operation: () => Promise<T>
  ): Promise<T>
  {
    const previous = this.worktreeOperations.get(repo) ?? Promise.resolve()
    const result = previous.then(operation, operation)
    const tail = result.then(
      () => undefined,
      () => undefined
    )
    this.worktreeOperations.set(repo, tail)
    try
    {
      return await result
    }
    finally
    {
      if (this.worktreeOperations.get(repo) === tail)
      {
        this.worktreeOperations.delete(repo)
      }
    }
  }

  private async execute(job: WorkerJob): Promise<void>
  {
    const controller = new AbortController()
    this.controllers.set(job.job_id, controller)
    let providerOutcome: ProviderOutcome | undefined
    let providerError: string | undefined
    let activePhase: ActivityPhase | undefined
    let unexpectedFailureClass: FailureClass = classifyFailure('broker')

    try
    {
      activePhase = 'preparing'
      await this.phase(job, 'preparing', 'started')
      unexpectedFailureClass = classifyFailure('setup')
      const created = await this.runWorktreeOperation(
        job.request.repo,
        async () =>
          await createWorktree(
            job.request.repo,
            this.store.worktreePath(job.job_id),
            job.base_sha,
            job.request.mode,
            job.job_id
          )
      )
      job.worktree = created.path
      if (created.branch !== undefined) job.branch = created.branch
      unexpectedFailureClass = classifyFailure('broker')
      await this.store.write(job)

      // environment preparation runs before the provider so a broken
      // worktree fails in seconds instead of after a full model run
      unexpectedFailureClass = classifyFailure('setup')
      const setupResults = await this.runCommands(
        job,
        job.request.setup_commands,
        'setup',
        controller.signal
      )
      this.setupResults.set(job.job_id, setupResults)
      if (controller.signal.aborted)
      {
        await this.phase(job, 'preparing', 'failed')
        activePhase = undefined
        await this.finish(
          job,
          this.baseResult(job, 'cancelled', 'job cancelled during setup')
        )
        return
      }
      const failedSetup = setupResults.find(verificationFailed)
      if (failedSetup !== undefined)
      {
        await this.phase(job, 'preparing', 'failed')
        activePhase = undefined
        unexpectedFailureClass = classifyFailure('broker')
        const setupSnapshot = await snapshotWorktree(
          created.path,
          job.base_sha,
          this.artifact(job, 'change.patch')
        )
        await this.finish(
          job,
          this.resultFromEvidence(
            job,
            'failed',
            undefined,
            setupSnapshot,
            [],
            [],
            commandFailureMessage('setup', failedSetup),
            classifyFailure('setup', failedSetup)
          )
        )
        return
      }
      unexpectedFailureClass = classifyFailure('broker')
      // paths visible after setup remain setup-attributed wholesale;
      // assignments must not overlap their own setup effects
      job.setup_paths = await listWorktreeStatusPaths(created.path)
      await this.store.write(job)
      await this.phase(job, 'preparing', 'completed')
      activePhase = undefined

      const provider = this.providers.get(job.request.provider)
      if (provider === undefined)
        throw new Error(`provider is not configured: ${job.request.provider}`)
      activePhase = 'working'
      await this.phase(job, activePhase, 'started')
      try
      {
        providerOutcome = await provider.run({
          job_id: job.job_id,
          provider_attempt: job.restart_requeues ?? 0,
          request: job.request,
          worktree: created.path,
          job_dir: this.store.jobDir(job.job_id),
          prompt_path: this.artifact(job, 'prompt.md'),
          event_log_path: this.artifact(job, 'events.jsonl'),
          stderr_path: this.artifact(job, 'provider.stderr.log'),
          model_result_path: this.artifact(job, 'model-result.json'),
          signal: controller.signal,
          on_process_started: async (pid) =>
          {
            job.process_id = pid
            await this.store.write(job)
          },
          on_activity: (activity) =>
          {
            void this.activity(job)
              .append(activity)
              .catch(() =>
              {})
          },
        })
      }
      catch (error)
      {
        providerError = errorMessage(error)
      }
      await this.activity(job)
        .failPendingActions()
        .catch(() =>
        {})
      await this.phase(
        job,
        'working',
        providerError === undefined && providerOutcome?.exit_code === 0
          ? 'completed'
          : 'failed'
      )
      activePhase = undefined

      activePhase = 'verifying'
      await this.phase(job, activePhase, 'started')

      unexpectedFailureClass = classifyFailure('broker')
      const providerSnapshot = await snapshotWorktree(
        created.path,
        job.base_sha,
        this.artifact(job, 'change.patch'),
        job.setup_paths
      )
      const providerViolations = scopeViolations(
        providerSnapshot.changed_files,
        job.request.allowed_paths
      )

      if (providerViolations.length > 0)
      {
        await this.phase(job, 'verifying', 'failed')
        activePhase = undefined
        await this.finish(
          job,
          this.resultFromEvidence(
            job,
            'rejected',
            providerOutcome,
            providerSnapshot,
            [],
            providerViolations,
            `worker changed paths outside its assignment: ${providerViolations.join(', ')}`,
            classifyFailure('scope')
          )
        )
        return
      }
      if (controller.signal.aborted)
      {
        await this.phase(job, 'verifying', 'failed')
        activePhase = undefined
        await this.finish(
          job,
          this.resultFromEvidence(
            job,
            'cancelled',
            providerOutcome,
            providerSnapshot,
            [],
            [],
            'job cancelled'
          )
        )
        return
      }
      if (providerError !== undefined)
      {
        await this.phase(job, 'verifying', 'failed')
        activePhase = undefined
        await this.finish(
          job,
          this.resultFromEvidence(
            job,
            'failed',
            providerOutcome,
            providerSnapshot,
            [],
            [],
            providerError,
            classifyFailure('provider')
          )
        )
        return
      }
      if (providerOutcome?.exit_code !== 0)
      {
        await this.phase(job, 'verifying', 'failed')
        activePhase = undefined
        await this.finish(
          job,
          this.resultFromEvidence(
            job,
            'failed',
            providerOutcome,
            providerSnapshot,
            [],
            [],
            `provider exited with ${providerOutcome?.signal ?? providerOutcome?.exit_code ?? 'unknown status'}`,
            classifyFailure('provider')
          )
        )
        return
      }

      unexpectedFailureClass = classifyFailure('verification')
      const verification = await this.runCommands(
        job,
        job.request.verification_commands,
        'verification',
        controller.signal
      )
      unexpectedFailureClass = classifyFailure('broker')
      const finalSnapshot = await snapshotWorktree(
        created.path,
        job.base_sha,
        this.artifact(job, 'change.patch'),
        job.setup_paths
      )
      const finalViolations = scopeViolations(
        finalSnapshot.changed_files,
        job.request.allowed_paths
      )
      if (finalViolations.length > 0)
      {
        await this.phase(job, 'verifying', 'failed')
        activePhase = undefined
        await this.finish(
          job,
          this.resultFromEvidence(
            job,
            'rejected',
            providerOutcome,
            finalSnapshot,
            verification,
            finalViolations,
            `verification changed paths outside the assignment: ${finalViolations.join(', ')}`,
            classifyFailure('scope')
          )
        )
        return
      }
      if (controller.signal.aborted)
      {
        await this.phase(job, 'verifying', 'failed')
        activePhase = undefined
        await this.finish(
          job,
          this.resultFromEvidence(
            job,
            'cancelled',
            providerOutcome,
            finalSnapshot,
            verification,
            [],
            'job cancelled during verification'
          )
        )
        return
      }
      const failedVerification = verification.find(verificationFailed)
      const status: WorkerStatus =
        failedVerification === undefined ? 'completed' : 'failed'
      await this.phase(
        job,
        'verifying',
        failedVerification === undefined ? 'completed' : 'failed'
      )
      activePhase = undefined
      await this.finish(
        job,
        this.resultFromEvidence(
          job,
          status,
          providerOutcome,
          finalSnapshot,
          verification,
          [],
          failedVerification === undefined
            ? undefined
            : commandFailureMessage('verification', failedVerification),
          failedVerification === undefined
            ? undefined
            : classifyFailure('verification', failedVerification)
        )
      )
    }
    catch (error)
    {
      if (activePhase !== undefined)
      {
        await this.phase(job, activePhase, 'failed').catch(() =>
        {})
      }
      await this.finish(
        job,
        this.baseResult(
          job,
          'failed',
          errorMessage(error),
          unexpectedFailureClass
        )
      )
    }
    finally
    {
      this.controllers.delete(job.job_id)
      void this.schedule()
    }
  }

  private async runCommands(
    job: WorkerJob,
    commands: readonly NormalizedVerificationCommand[],
    label: 'setup' | 'verification',
    signal: AbortSignal
  ): Promise<VerificationResult[]>
  {
    if (job.worktree === undefined)
      throw new Error(`cannot run ${label} commands without a worktree`)
    // resolve worktree-local tool shims first, like npm run scripts do
    const environment = {
      ...process.env,
      PATH: [
        path.join(job.worktree, 'node_modules', '.bin'),
        process.env.PATH ?? '',
      ].join(path.delimiter),
    }
    const results: VerificationResult[] = []
    for (const [index, command] of commands.entries())
    {
      const stdoutPath = this.artifact(job, `${label}-${index + 1}.stdout.log`)
      const stderrPath = this.artifact(job, `${label}-${index + 1}.stderr.log`)
      const result = await runProcess({
        command: '/bin/sh',
        args: ['-lc', command.command],
        cwd: job.worktree,
        env: environment,
        stdout_path: stdoutPath,
        stderr_path: stderrPath,
        signal,
        timeout_ms: command.timeout_seconds * 1_000,
      })
      results.push({
        command: command.command,
        exit_code: result.exit_code,
        signal: result.signal,
        timed_out: result.timed_out,
        stdout_path: stdoutPath,
        stderr_path: stderrPath,
        elapsed_ms: result.elapsed_ms,
      })
      if (verificationFailed(result) || signal.aborted) break
    }
    return results
  }

  private baseResult(
    job: WorkerJob,
    status: WorkerStatus,
    error?: string,
    failureClass?: FailureClass
  ): WorkerResult
  {
    const result: WorkerResult = {
      job_id: job.job_id,
      status,
      provider: job.request.provider,
      mode: job.request.mode,
      repo: job.request.repo,
      base_ref: job.request.base_ref,
      base_sha: job.base_sha,
      assumptions: [],
      risks: [],
      follow_ups: [],
      changed_files: [],
      changes: [],
      setup: [],
      verification: [],
      scope_violations: [],
      event_log_path: this.artifact(job, 'events.jsonl'),
      stderr_path: this.artifact(job, 'provider.stderr.log'),
      model_result_path: this.artifact(job, 'model-result.json'),
      created_at: job.created_at,
    }
    if (job.request.stage !== undefined) result.stage = job.request.stage
    if (job.request.workflow !== undefined)
      result.workflow = job.request.workflow
    if (job.request.run !== undefined) result.run = job.request.run
    if (job.request.model !== undefined) result.model = job.request.model
    if (job.request.effort !== undefined) result.effort = job.request.effort
    if (job.started_at !== undefined) result.started_at = job.started_at
    if (job.worktree !== undefined) result.worktree = job.worktree
    if (job.branch !== undefined) result.branch = job.branch
    if (error !== undefined) result.error = error
    if (failureClass !== undefined) result.failure_class = failureClass
    return result
  }

  private resultFromEvidence(
    job: WorkerJob,
    status: WorkerStatus,
    provider: ProviderOutcome | undefined,
    snapshot: Awaited<ReturnType<typeof snapshotWorktree>>,
    verification: VerificationResult[],
    violations: string[],
    error?: string,
    failureClass?: FailureClass
  ): WorkerResult
  {
    const result = this.baseResult(job, status, error, failureClass)
    result.head_sha = snapshot.head_sha
    result.patch_path = snapshot.patch_path
    result.changed_files = snapshot.changed_files
    result.changes = snapshot.changes
    result.verification = verification
    result.scope_violations = violations
    if (provider !== undefined)
    {
      result.process_exit_code = provider.exit_code
      result.process_signal = provider.signal
      if (provider.effective_model !== undefined)
        result.effective_model = provider.effective_model
      if (provider.worker_session_id !== undefined)
      {
        result.worker_session_id = provider.worker_session_id
      }
      if (provider.model_result !== undefined)
      {
        result.summary = provider.model_result.summary
        result.assumptions = provider.model_result.assumptions
        result.risks = provider.model_result.risks
        result.follow_ups = provider.model_result.follow_ups
      }
    }
    return result
  }

  private async finish(job: WorkerJob, result: WorkerResult): Promise<void>
  {
    await this.phase(job, 'finalizing', 'started')
    const setup = this.setupResults.get(job.job_id)
    if (setup !== undefined) result.setup = setup
    this.setupResults.delete(job.job_id)
    const completedAt = new Date().toISOString()
    job.status = result.status
    job.completed_at = completedAt
    result.completed_at = completedAt
    if (job.started_at !== undefined)
    {
      result.elapsed_ms = Date.parse(completedAt) - Date.parse(job.started_at)
    }
    job.result = result
    await this.store.write(job)
    await this.phase(job, 'finalizing', 'completed')
    this.activities.delete(job.job_id)
    this.events.emit(`terminal:${job.job_id}`, job)
  }
}
