// tools/worker-broker/src/job-manager.ts
// schedule isolated jobs, compute evidence, reject drift, & retain terminal state

import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import type {
  BrokerConfig,
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
  resolveBaseSha,
  resolveRepository,
  snapshotWorktree,
} from './git-worktree.js'
import { errorMessage } from './errors.js'
import { JobStore } from './job-store.js'
import { scopesOverlap, scopeViolations } from './path-scope.js'
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

export class JobManager
{
  readonly store: JobStore
  private readonly jobs = new Map<string, WorkerJob>()
  private readonly controllers = new Map<string, AbortController>()
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
  }

  private async initializeOnce(): Promise<void>
  {
    await this.store.initialize()
    const interrupted = (await this.store.list()).filter(
      (job) => !TERMINAL_STATUSES.has(job.status)
    )
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
    await this.finish(
      job,
      this.baseResult(
        job,
        'failed',
        cleanupError === undefined
          ? message
          : `${message}; process cleanup failed: ${errorMessage(cleanupError)}`
      )
    )
    if (cleanupError !== undefined) throw cleanupError
  }

  async start(request: StartWorkerRequest): Promise<WorkerJob>
  {
    if (this.shuttingDown) throw new Error('worker broker is shutting down')
    await this.initialize()
    const normalized = normalizeRequest(request)
    normalized.repo = await resolveRepository(normalized.repo)
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

  private canRun(job: WorkerJob): boolean
  {
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

  private async schedule(): Promise<void>
  {
    if (this.scheduling || this.shuttingDown) return
    this.scheduling = true
    try
    {
      for (const job of this.jobs.values())
      {
        if (job.status !== 'queued' || !this.canRun(job)) continue
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

  private async execute(job: WorkerJob): Promise<void>
  {
    const controller = new AbortController()
    this.controllers.set(job.job_id, controller)
    let providerOutcome: ProviderOutcome | undefined
    let providerError: string | undefined

    try
    {
      const created = await createWorktree(
        job.request.repo,
        this.store.worktreePath(job.job_id),
        job.base_sha,
        job.request.mode,
        job.job_id
      )
      job.worktree = created.path
      if (created.branch !== undefined) job.branch = created.branch
      await this.store.write(job)

      const provider = this.providers.get(job.request.provider)
      if (provider === undefined)
        throw new Error(`provider is not configured: ${job.request.provider}`)
      try
      {
        providerOutcome = await provider.run({
          job_id: job.job_id,
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
        })
      }
      catch (error)
      {
        providerError = errorMessage(error)
      }

      const providerSnapshot = await snapshotWorktree(
        created.path,
        job.base_sha,
        this.artifact(job, 'change.patch')
      )
      const providerViolations = scopeViolations(
        providerSnapshot.changed_files,
        job.request.allowed_paths
      )

      if (providerViolations.length > 0)
      {
        await this.finish(
          job,
          this.resultFromEvidence(
            job,
            'rejected',
            providerOutcome,
            providerSnapshot,
            [],
            providerViolations,
            `worker changed paths outside its assignment: ${providerViolations.join(', ')}`
          )
        )
        return
      }
      if (controller.signal.aborted)
      {
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
        await this.finish(
          job,
          this.resultFromEvidence(
            job,
            'failed',
            providerOutcome,
            providerSnapshot,
            [],
            [],
            providerError
          )
        )
        return
      }
      if (providerOutcome?.exit_code !== 0)
      {
        await this.finish(
          job,
          this.resultFromEvidence(
            job,
            'failed',
            providerOutcome,
            providerSnapshot,
            [],
            [],
            `provider exited with ${providerOutcome?.signal ?? providerOutcome?.exit_code ?? 'unknown status'}`
          )
        )
        return
      }

      const verification = await this.runVerification(job, controller.signal)
      const finalSnapshot = await snapshotWorktree(
        created.path,
        job.base_sha,
        this.artifact(job, 'change.patch')
      )
      const finalViolations = scopeViolations(
        finalSnapshot.changed_files,
        job.request.allowed_paths
      )
      if (finalViolations.length > 0)
      {
        await this.finish(
          job,
          this.resultFromEvidence(
            job,
            'rejected',
            providerOutcome,
            finalSnapshot,
            verification,
            finalViolations,
            `verification changed paths outside the assignment: ${finalViolations.join(', ')}`
          )
        )
        return
      }
      if (controller.signal.aborted)
      {
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
            : failedVerification.timed_out
              ? `verification timed out: ${failedVerification.command}`
              : `verification failed: ${failedVerification.command}`
        )
      )
    }
    catch (error)
    {
      await this.finish(
        job,
        this.baseResult(job, 'failed', errorMessage(error))
      )
    }
    finally
    {
      this.controllers.delete(job.job_id)
      void this.schedule()
    }
  }

  private async runVerification(
    job: WorkerJob,
    signal: AbortSignal
  ): Promise<VerificationResult[]>
  {
    if (job.worktree === undefined)
      throw new Error('cannot verify a job without a worktree')
    const results: VerificationResult[] = []
    for (const [
      index,
      verification,
    ] of job.request.verification_commands.entries())
    {
      const stdoutPath = this.artifact(
        job,
        `verification-${index + 1}.stdout.log`
      )
      const stderrPath = this.artifact(
        job,
        `verification-${index + 1}.stderr.log`
      )
      const result = await runProcess({
        command: '/bin/zsh',
        args: ['-lc', verification.command],
        cwd: job.worktree,
        stdout_path: stdoutPath,
        stderr_path: stderrPath,
        signal,
        timeout_ms: verification.timeout_seconds * 1_000,
      })
      results.push({
        command: verification.command,
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
    error?: string
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
      verification: [],
      scope_violations: [],
      event_log_path: this.artifact(job, 'events.jsonl'),
      stderr_path: this.artifact(job, 'provider.stderr.log'),
      model_result_path: this.artifact(job, 'model-result.json'),
      created_at: job.created_at,
    }
    if (job.started_at !== undefined) result.started_at = job.started_at
    if (job.worktree !== undefined) result.worktree = job.worktree
    if (job.branch !== undefined) result.branch = job.branch
    if (error !== undefined) result.error = error
    return result
  }

  private resultFromEvidence(
    job: WorkerJob,
    status: WorkerStatus,
    provider: ProviderOutcome | undefined,
    snapshot: Awaited<ReturnType<typeof snapshotWorktree>>,
    verification: VerificationResult[],
    violations: string[],
    error?: string
  ): WorkerResult
  {
    const result = this.baseResult(job, status, error)
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
    this.events.emit(`terminal:${job.job_id}`, job)
  }
}
