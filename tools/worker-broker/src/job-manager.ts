// tools/worker-broker/src/job-manager.ts
// schedule isolated jobs, compute evidence, reject drift, & retain terminal state

import { EventEmitter } from 'node:events'
import { capabilityEvidence, requireCapabilities } from './capabilities.js'
import { CreateRunSchema, RunStore, type WorkerRun } from './run-store.js'
import {
  installedLocalModels,
  localEndpoint,
  readPowerState,
  requireLocalPower,
  type PowerState,
} from './local-policy.js'
import { discoverTargets, agyReadiness } from './targets.js'
import { randomUUID } from 'node:crypto'
import { randomBytes } from 'node:crypto'
import { access, rename } from 'node:fs/promises'
import path from 'node:path'
import { ActivityWriter } from './activity.js'
import {
  isTerminalWorkerStatus,
  workerEventLogFileName,
  type ActivityPhase,
  type BrokerConfig,
  type EditSerializationConflict,
  type FailureClass,
  type NormalizedVerificationCommand,
  type ProcessIdentity,
  type ProviderOutcome,
  type TerminalWorkerStatus,
  type VerificationResult,
  type WorkerAdmission,
  type WorkerJob,
  type WorkerProvider,
  type WorkerResult,
  type WorkerSummary,
} from './contracts.js'
import {
  captureWorktreeBaseline,
  createWorktree,
  diffWorktreeFromTree,
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
  runProcess,
  terminateOwnedProcessGroup,
  UnconfirmedProcessGroupExitError,
} from './process-runner.js'
import { normalizeRequest } from './request.js'
import { summarizeWorkerJob } from './worker-summary.js'

export interface JobProgress
{
  phase?: ActivityPhase
  last_message?: string
  last_message_at?: string
}

/** Git evidence separated into post-setup attribution and base-relative output. */
interface AttributedSnapshot
{
  snapshot: Awaited<ReturnType<typeof snapshotWorktree>>
  setup_mutations: string[]
  attribution_violations: string[]
  attribution_error?: string
}

// identical suffix on the four setup-attribution salvage failures
const SETUP_ATTRIBUTION_SALVAGE_SUFFIX =
  '; change.patch contains the full base-to-final delta including setup effects and is salvage evidence only'

class ProcessOwnershipError extends Error
{
  constructor(message: string)
  {
    super(message)
    this.name = 'ProcessOwnershipError'
  }
}

class ProcessOwnershipClearError extends ProcessOwnershipError
{
  constructor(message: string)
  {
    super(message)
    this.name = 'ProcessOwnershipClearError'
  }
}

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
  private readonly terminalTransitions = new Map<string, Promise<void>>()
  private readonly worktreeOperations = new Map<string, Promise<void>>()
  private readonly providers: Map<string, WorkerProvider>
  private readonly events = new EventEmitter()
  private initialization: Promise<void> | undefined
  private admissionTail: Promise<void> = Promise.resolve()
  private scheduling = false
  private shuttingDown = false
  private readonly runs: RunStore
  private powerTimer: NodeJS.Timeout | undefined
  private checkingPower = false

  async createRun(input: unknown): Promise<WorkerRun>
  {
    await this.initialize()
    if (this.shuttingDown) throw new Error('worker broker is shutting down')
    const request = CreateRunSchema.parse(input)
    const targets: WorkerRun['targets'] = []
    for (const target of request.targets)
    {
      if (
        ['coral', 'agy'].includes(target.provider) &&
        target.modes.some((mode) => mode !== 'read')
      )
        throw new Error('local and Antigravity workers are read-only')
      const model =
        target.model ?? this.config[`default_${target.provider}_model`]
      if (!model)
        throw new Error(`an explicit model is required for ${target.provider}`)
      const binding: WorkerRun['targets'][number] = { ...target, model }
      if (target.provider === 'coral')
      {
        binding.endpoint = localEndpoint(
          this.config.coral_host ?? 'http://127.0.0.1:11434'
        )
        if (!(await this.policy.models(binding.endpoint)).includes(model))
          throw new Error(`installed local model unavailable: ${model}`)
        requireLocalPower(await this.policy.power(), request.allow_battery)
      }
      if (target.provider === 'agy')
      {
        const reason = await agyReadiness(this.config, request.repo)
        if (reason) throw new Error(reason)
      }
      targets.push(binding)
    }
    const now = Date.now()
    const run: WorkerRun = {
      schema_version: 1,
      id: randomUUID(),
      repo: await resolveRepository(request.repo),
      targets,
      max_assignments: request.max_assignments,
      allow_battery: request.allow_battery,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + 12 * 60 * 60 * 1000).toISOString(),
    }
    await this.runs.write(run)
    return run
  }

  async listTargets(): Promise<Awaited<ReturnType<typeof discoverTargets>>>
  {
    return await discoverTargets(this.config)
  }

  async runDetails(id: string): Promise<{
    contract: WorkerRun
    spent: number
    remaining: number
    power: PowerState
  }>
  {
    const contract = await this.runs.read(id)
    const spent = (await this.store.listSummaries()).filter(
      (job) => job.run === id
    ).length
    return {
      contract,
      spent,
      remaining: Math.max(0, contract.max_assignments - spent),
      power: await this.policy.power(),
    }
  }

  async closeRun(id: string, cancelActive = false): Promise<WorkerRun>
  {
    await this.initialize()
    const closing = this.admissionTail.then(async () =>
    {
      const run = await this.runs.read(id)
      const active = [...this.jobs.values()].filter(
        (job) => job.request.run === id && !isTerminalWorkerStatus(job.status)
      )
      if (active.length && !cancelActive)
        throw new Error('run still has outstanding workers')
      run.closed_at ??= new Date().toISOString()
      await this.runs.write(run)
      if (cancelActive)
        await Promise.all(
          active.map((job) =>
            this.cancel(job.job_id, 'run closed and cancelled')
          )
        )
      return run
    })
    this.admissionTail = closing.then(
      () => undefined,
      () => undefined
    )
    return await closing
  }

  private async checkRun(job: WorkerJob, admission = false): Promise<void>
  {
    if (!job.request.run)
      throw new Error('create_run is required before start_worker')
    const run = await this.runs.read(job.request.run)
    if (run.closed_at || Date.parse(run.expires_at) <= Date.now())
      throw new Error('run is closed or expired')
    if (
      run.repo !== job.request.repo &&
      run.repo !== (await resolveRepository(job.request.repo))
    )
      throw new Error('repository is outside the run scope')
    job.request.repo = run.repo
    const candidates = run.targets.filter(
      (target) =>
        target.provider === job.request.provider &&
        target.modes.includes(job.request.mode) &&
        (job.request.model === undefined || target.model === job.request.model)
    )
    if (candidates.length !== 1)
      throw new Error(
        'provider, model, or mode is outside the run scope or ambiguous'
      )
    const target = candidates[0]!
    job.request.model = target.model
    if (target.provider === 'coral')
    {
      if (!target.endpoint) throw new Error('local run has no pinned endpoint')
      job.request.local_endpoint = target.endpoint
      requireLocalPower(await this.policy.power(), run.allow_battery)
      if (!(await this.policy.models(target.endpoint)).includes(target.model))
        throw new Error('installed local model unavailable')
    }
    if (target.provider === 'agy')
    {
      const reason = await agyReadiness(
        this.config,
        job.worktree ?? job.request.repo
      )
      if (reason) throw new Error(reason)
    }
    if (target.provider === 'coral')
      requireLocalPower(await this.policy.power(), run.allow_battery)
    const current = await this.runs.read(run.id)
    if (current.closed_at || Date.parse(current.expires_at) <= Date.now())
      throw new Error('run is closed or expired')
    if (admission)
    {
      const spent = (await this.store.listSummaries()).filter(
        (summary) => summary.run === run.id
      ).length
      if (spent >= run.max_assignments)
        throw new Error('run assignment budget exhausted')
    }
  }

  async enforceLocalPower(): Promise<void>
  {
    if (this.checkingPower || this.shuttingDown) return
    this.checkingPower = true
    try
    {
      const active = [...this.jobs.values()].filter(
        (job) =>
          job.request.provider === 'coral' &&
          !isTerminalWorkerStatus(job.status)
      )
      if (!active.length) return
      const power = await this.policy.power()
      for (const job of active)
      {
        try
        {
          const run = await this.runs.read(job.request.run ?? '')
          requireLocalPower(power, run.allow_battery)
        }
        catch (error)
        {
          await this.cancel(job.job_id, errorMessage(error))
        }
      }
    }
    finally
    {
      this.checkingPower = false
    }
  }

  constructor(
    private readonly config: BrokerConfig,
    providers: readonly WorkerProvider[],
    private readonly policy: {
      power: () => Promise<PowerState>
      models: (endpoint: string) => Promise<string[]>
    } = { power: readPowerState, models: installedLocalModels }
  )
  {
    this.store = new JobStore(config.state_dir)
    this.runs = new RunStore(config.state_dir)
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
    this.powerTimer = setInterval(() =>
    {
      void this.enforceLocalPower().catch(() => undefined)
    }, 5000)
    this.powerTimer.unref()
    const interruptedSummaries = (await this.store.listSummaries())
      .filter((summary) => !isTerminalWorkerStatus(summary.status))
      .sort((left, right) => left.created_at.localeCompare(right.created_at))
    const interrupted = await Promise.all(
      interruptedSummaries.map(
        async (summary) => await this.store.read(summary.job_id)
      )
    )
    for (const job of interrupted) this.jobs.set(job.job_id, job)
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
    const hasProcessId = job.process_id !== undefined
    const hasProcessToken = job.process_token !== undefined
    if (job.status === 'queued' && !hasProcessId && !hasProcessToken)
    {
      try
      {
        await this.checkRun(job)
      }
      catch (error)
      {
        await this.finish(
          job,
          this.baseResult(job, 'rejected', errorMessage(error), 'broker_fault')
        )
        return
      }
      const currentAttempt = job.restart_requeues ?? 0
      await this.preserveInterruptedEventLog(
        job,
        currentAttempt > 0 ? currentAttempt - 1 : currentAttempt
      )
      return
    }
    if (hasProcessId !== hasProcessToken)
    {
      throw new UnconfirmedProcessGroupExitError(
        job.process_id ?? -1,
        'the persisted process identity is incomplete; durable ownership was retained and no worktree snapshot was taken'
      )
    }
    if (job.process_id !== undefined && job.process_token !== undefined)
    {
      const identity: ProcessIdentity = {
        pid: job.process_id,
        token: job.process_token,
      }
      await terminateOwnedProcessGroup(identity)
      delete job.process_id
      delete job.process_token
      try
      {
        await this.store.write(job)
      }
      catch (error)
      {
        job.process_id = identity.pid
        job.process_token = identity.token
        throw new Error(
          `process group ${identity.pid} exited, but durable ownership could not be cleared; ownership was retained and no worktree snapshot was taken: ${errorMessage(error)}`
        )
      }
    }
    await this.preserveInterruptedEventLog(job, job.restart_requeues ?? 0)
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
    let recoveryError: unknown
    try
    {
      interruptedSnapshot = await this.snapshotInterruptedWorktree(job)
    }
    catch (error)
    {
      recoveryError ??= error
    }
    const interruptedWorktreeIsClean =
      interruptedSnapshot !== undefined &&
      interruptedSnapshot.changed_files.length === 0
    // one automatic recovery is safe only when no interrupted edits exist;
    // otherwise the durable patch is the sole authoritative salvage evidence
    if (
      recoveryError === undefined &&
      priorStatus === 'running' &&
      interruptedWorktreeIsClean &&
      (job.restart_requeues ?? 0) < 1 &&
      job.request.provider !== 'coral' &&
      (await this.checkRun(job).then(
        () => true,
        () => false
      ))
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
    const interruptedChangesMessage =
      interruptedSnapshot !== undefined &&
      interruptedSnapshot.changed_files.length > 0
        ? `${message}; automatic retry was suppressed to preserve the interrupted change.patch as salvage evidence`
        : message
    const failureMessage =
      recoveryError === undefined
        ? interruptedChangesMessage
        : `${interruptedChangesMessage}; reconciliation failed: ${errorMessage(recoveryError)}`
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
  }

  private async preserveInterruptedEventLog(
    job: WorkerJob,
    attempt: number
  ): Promise<void>
  {
    if (job.request.provider !== 'codex') return
    const legacyPath = this.artifact(job, 'events.jsonl')
    const currentPath = this.artifact(
      job,
      workerEventLogFileName('codex', attempt)
    )
    try
    {
      await access(currentPath)
      return
    }
    catch (error)
    {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    try
    {
      await rename(legacyPath, currentPath)
    }
    catch (error)
    {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
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
      this.artifact(job, 'change.patch')
    )
  }

  private async snapshotWithSetupAttribution(
    job: WorkerJob,
    worktree: string
  ): Promise<AttributedSnapshot>
  {
    const snapshotFullDelta = async () =>
      await snapshotWorktree(
        worktree,
        job.base_sha,
        this.artifact(job, 'change.patch')
      )
    const setupPaths = job.setup_paths ?? []
    if (setupPaths.length === 0)
    {
      return {
        snapshot: await snapshotFullDelta(),
        setup_mutations: [],
        attribution_violations: [],
      }
    }

    if (job.setup_tree_sha === undefined)
    {
      return {
        snapshot: await snapshotFullDelta(),
        setup_mutations: [],
        attribution_violations: [],
        attribution_error: 'the persisted post-setup tree is unavailable',
      }
    }

    let attribution: Awaited<ReturnType<typeof diffWorktreeFromTree>>
    try
    {
      attribution = await diffWorktreeFromTree(worktree, job.setup_tree_sha)
    }
    catch (error)
    {
      return {
        snapshot: await snapshotFullDelta(),
        setup_mutations: [],
        attribution_violations: [],
        attribution_error: `the post-setup tree could not be read: ${errorMessage(error)}`,
      }
    }

    const setupMutations = [
      ...new Set(
        attribution.changes
          .filter((change) => scopesOverlap(change.paths, setupPaths))
          .flatMap((change) => change.paths)
      ),
    ].sort()
    return {
      snapshot: await snapshotWorktree(
        worktree,
        job.base_sha,
        this.artifact(job, 'change.patch'),
        setupMutations.length === 0 ? setupPaths : []
      ),
      setup_mutations: setupMutations,
      attribution_violations: scopeViolations(
        attribution.changed_files,
        job.request.allowed_paths
      ),
    }
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
    delete job.process_token
    delete job.started_at
    delete job.setup_paths
    delete job.setup_tree_sha
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

  // serialize the durable-write -> visible-admission boundary so conflicts
  // never name a job whose initial record can still fail
  private async admit(job: WorkerJob): Promise<WorkerAdmission>
  {
    const admission = this.admissionTail.then(async () =>
    {
      if (this.shuttingDown) throw new Error('worker broker is shutting down')
      await this.checkRun(job, true)
      await this.store.write(job)
      const serializesBehind = this.editSerializationConflicts(job)
      this.jobs.set(job.job_id, job)
      void this.schedule()
      return structuredClone({
        job: summarizeWorkerJob(job),
        serializes_behind: serializesBehind,
      })
    })
    this.admissionTail = admission.then(
      () => undefined,
      () => undefined
    )
    return await admission
  }

  async start(request: unknown): Promise<WorkerAdmission>
  {
    if (this.shuttingDown) throw new Error('worker broker is shutting down')
    const normalized = normalizeRequest(request)
    const capabilities = requireCapabilities(normalized)
    await this.initialize()
    normalized.repo = await resolveRepository(normalized.repo)
    await Promise.all(
      normalized.depends_on.map(async (jobId) =>
      {
        try
        {
          await this.getSummary(jobId)
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
      capability_evidence: capabilities,
      job_id: jobId,
      status: 'queued',
      request: normalized,
      base_sha: baseSha,
      created_at: new Date().toISOString(),
    }
    return await this.admit(job)
  }

  async get(jobId: string): Promise<WorkerJob>
  {
    await this.initialize()
    const job = this.jobs.get(jobId) ?? (await this.store.read(jobId))
    return structuredClone(job)
  }

  async getSummary(jobId: string): Promise<WorkerSummary>
  {
    await this.initialize()
    const active = this.jobs.get(jobId)
    return structuredClone(
      active === undefined
        ? await this.store.readSummary(jobId)
        : summarizeWorkerJob(active)
    )
  }

  async list(): Promise<WorkerSummary[]>
  {
    await this.initialize()
    const activeJobs = [...this.jobs.values()]
    const summaries = new Map(
      (
        await this.store.listSummaries(
          new Set(activeJobs.map((job) => job.job_id))
        )
      ).map((summary) => [summary.job_id, summary])
    )
    for (const job of activeJobs)
    {
      summaries.set(job.job_id, summarizeWorkerJob(job))
    }
    return [...summaries.values()]
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map((summary) => structuredClone(summary))
  }

  // phase & newest prose for a job still in flight, read only from the writer
  // this process already owns: activity() memoizes and finish() drops the entry
  // (see finish), so constructing one here would re-open activity.jsonl for a
  // job that is already done
  async progress(jobId: string): Promise<JobProgress>
  {
    const summary = await this.getSummary(jobId)
    if (isTerminalWorkerStatus(summary.status)) return {}
    const writer = this.activities.get(jobId)
    if (writer === undefined) return {}
    const progress: JobProgress = {}
    const phase = await writer.currentOpenPhase()
    if (phase !== undefined) progress.phase = phase
    const latest = await writer.latestMessage()
    if (latest !== undefined)
    {
      progress.last_message = latest.summary
      if (latest.recorded_at !== undefined)
      {
        progress.last_message_at = latest.recorded_at
      }
    }
    return progress
  }

  async cancel(
    jobId: string,
    reason = 'job cancelled by request'
  ): Promise<WorkerSummary>
  {
    await this.initialize()
    const job = this.jobs.get(jobId)
    if (job === undefined)
    {
      try
      {
        const persisted = await this.store.readSummary(jobId)
        if (isTerminalWorkerStatus(persisted.status))
          return structuredClone(persisted)
      }
      catch (error)
      {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      throw new Error(`job is not active in this broker process: ${jobId}`)
    }
    if (job.status === 'queued')
    {
      await this.finish(job, this.baseResult(job, 'cancelled', reason))
      return structuredClone(summarizeWorkerJob(job))
    }

    job.cancellation_reason = reason
    this.controllers.get(jobId)?.abort(new Error(reason))
    return structuredClone(summarizeWorkerJob(job))
  }

  // signal lets a caller that lost a timeout race drop its listener; without it
  // every timed-out wait leaked one 'terminal:<id>' listener per pending job
  async waitForTerminal(
    jobId: string,
    signal?: AbortSignal
  ): Promise<WorkerSummary>
  {
    await this.initialize()
    // fall back to the store so a persisted job reports status instead of
    // throwing once it has been evicted from the in-memory map
    const current = this.jobs.get(jobId)
    const currentSummary =
      current === undefined
        ? await this.store.readSummary(jobId)
        : summarizeWorkerJob(current)
    if (isTerminalWorkerStatus(currentSummary.status))
      return structuredClone(currentSummary)

    return await new Promise<WorkerSummary>((resolve) =>
    {
      const eventName = `terminal:${jobId}`
      const onTerminal = (summary: WorkerSummary): void =>
      {
        signal?.removeEventListener('abort', onAbort)
        resolve(structuredClone(summary))
      }
      const onAbort = (): void =>
      {
        this.events.off(eventName, onTerminal)
        const active = this.jobs.get(jobId)
        resolve(
          structuredClone(
            active === undefined ? currentSummary : summarizeWorkerJob(active)
          )
        )
      }
      this.events.once(eventName, onTerminal)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  async shutdown(): Promise<void>
  {
    if (this.shuttingDown) return
    await this.initialize()
    this.shuttingDown = true
    clearInterval(this.powerTimer)
    const active = [...this.jobs.values()].filter(
      (job) => !isTerminalWorkerStatus(job.status)
    )
    const waits = active.map((job) => this.waitForTerminal(job.job_id))
    await Promise.all(active.map((job) => this.cancel(job.job_id)))
    await Promise.all(waits)
  }

  private editSerializationConflicts(
    job: WorkerJob
  ): EditSerializationConflict[]
  {
    if (job.request.mode !== 'edit') return []
    // existing active edits are earlier because admission inserts afterward
    const conflicts: EditSerializationConflict[] = []
    for (const other of this.jobs.values())
    {
      if (
        isTerminalWorkerStatus(other.status) ||
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
    if (
      job.request.provider === 'coral' &&
      [...this.jobs.values()].some(
        (other) =>
          other.status === 'running' && other.request.provider === 'coral'
      )
    )
      return false
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
      const dependency = await this.getSummary(jobId)
      if (!isTerminalWorkerStatus(dependency.status)) return 'waiting'
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
        if (job.status !== 'queued' || this.terminalTransitions.has(job.job_id))
          continue
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
        if (this.terminalTransitions.has(job.job_id)) continue
        if (!this.canRun(job)) continue
        try
        {
          await this.checkRun(job)
        }
        catch (error)
        {
          await this.finish(
            job,
            this.baseResult(job, 'rejected', errorMessage(error))
          )
          continue
        }
        if (job.status !== 'queued' || this.terminalTransitions.has(job.job_id))
          continue
        const controller = new AbortController()
        this.controllers.set(job.job_id, controller)
        job.status = 'running'
        job.started_at = new Date().toISOString()
        try
        {
          await this.store.write(job)
        }
        catch (error)
        {
          if (this.controllers.get(job.job_id) === controller)
          {
            this.controllers.delete(job.job_id)
          }
          job.status = 'queued'
          delete job.started_at
          await this.finish(
            job,
            this.baseResult(
              job,
              'failed',
              `failed to persist running state: ${errorMessage(error)}`,
              classifyFailure('broker')
            )
          )
          continue
        }
        if (controller.signal.aborted)
        {
          try
          {
            await this.finish(
              job,
              this.baseResult(
                job,
                'cancelled',
                'job cancelled before execution started'
              )
            )
          }
          finally
          {
            if (this.controllers.get(job.job_id) === controller)
            {
              this.controllers.delete(job.job_id)
            }
          }
          continue
        }
        void this.execute(job, controller).catch((error: unknown) =>
        {
          // unconfirmed ownership is process-fatal: only a fresh daemon may
          // verify the durable supervisor identity and resume reconciliation
          setImmediate(() =>
          {
            process.stderr.write(
              `worker-broker process-ownership fail-stop: ${errorMessage(error)}\n`
            )
            process.exit(1)
          })
        })
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

  private async recordProcessStarted(
    job: WorkerJob,
    identity: ProcessIdentity
  ): Promise<void>
  {
    if (job.process_id !== undefined || job.process_token !== undefined)
    {
      throw new ProcessOwnershipError(
        `job ${job.job_id} already owns process group ${job.process_id ?? 'with an incomplete identity'}`
      )
    }
    job.process_id = identity.pid
    job.process_token = identity.token
    try
    {
      await this.store.write(job)
    }
    catch (error)
    {
      if (
        job.process_id === identity.pid &&
        job.process_token === identity.token
      )
      {
        delete job.process_id
        delete job.process_token
      }
      throw new ProcessOwnershipError(
        `failed to persist process group ${identity.pid} ownership: ${errorMessage(error)}`
      )
    }
  }

  private async recordProcessFinished(
    job: WorkerJob,
    identity: ProcessIdentity
  ): Promise<void>
  {
    if (job.process_id === undefined && job.process_token === undefined) return
    if (
      job.process_id !== identity.pid ||
      job.process_token !== identity.token
    )
    {
      throw new ProcessOwnershipError(
        `job ${job.job_id} does not own process group ${identity.pid} with the matching supervisor token`
      )
    }
    delete job.process_id
    delete job.process_token
    try
    {
      await this.store.write(job)
    }
    catch (error)
    {
      throw new ProcessOwnershipClearError(
        `failed to clear process group ${identity.pid} ownership: ${errorMessage(error)}`
      )
    }
  }

  private async execute(
    job: WorkerJob,
    controller: AbortController
  ): Promise<void>
  {
    let providerOutcome: ProviderOutcome | undefined
    let providerError: string | undefined
    let activePhase: ActivityPhase | undefined
    let unexpectedFailureClass: FailureClass = classifyFailure('broker')
    let processExitUnconfirmed = false

    try
    {
      activePhase = 'preparing'
      job.capability_evidence = requireCapabilities(job.request)
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
      const setupBaseline = await captureWorktreeBaseline(
        created.path,
        job.base_sha
      )
      job.setup_paths = setupBaseline.changed_files
      job.setup_tree_sha = setupBaseline.tree_sha
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
        await this.checkRun(job)
        controller.signal.throwIfAborted()
        providerOutcome = await provider.run({
          job_id: job.job_id,
          provider_attempt: job.restart_requeues ?? 0,
          request: job.request,
          worktree: created.path,
          job_dir: this.store.jobDir(job.job_id),
          prompt_path: this.artifact(job, 'prompt.md'),
          event_log_path: this.artifact(
            job,
            workerEventLogFileName(
              job.request.provider,
              job.restart_requeues ?? 0
            )
          ),
          stderr_path: this.artifact(job, 'provider.stderr.log'),
          model_result_path: this.artifact(job, 'model-result.json'),
          signal: controller.signal,
          on_process_started: async (identity) =>
          {
            await this.recordProcessStarted(job, identity)
          },
          on_process_finished: async (identity) =>
          {
            await this.recordProcessFinished(job, identity)
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
        if (
          error instanceof ProcessOwnershipError ||
          error instanceof UnconfirmedProcessGroupExitError
        )
        {
          throw error
        }
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
      const providerEvidence = await this.snapshotWithSetupAttribution(
        job,
        created.path
      )
      const providerSnapshot = providerEvidence.snapshot
      if (providerEvidence.attribution_error !== undefined)
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
            `${providerEvidence.attribution_error}${SETUP_ATTRIBUTION_SALVAGE_SUFFIX}`,
            classifyFailure('broker')
          )
        )
        return
      }
      if (providerEvidence.setup_mutations.length > 0)
      {
        await this.phase(job, 'verifying', 'failed')
        activePhase = undefined
        const attributionError = `worker changed setup-attributed paths: ${providerEvidence.setup_mutations.join(', ')}`
        await this.finish(
          job,
          this.resultFromEvidence(
            job,
            'rejected',
            providerOutcome,
            providerSnapshot,
            [],
            providerEvidence.attribution_violations,
            `${attributionError}${SETUP_ATTRIBUTION_SALVAGE_SUFFIX}`,
            classifyFailure('scope')
          )
        )
        return
      }
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
      const finalEvidence = await this.snapshotWithSetupAttribution(
        job,
        created.path
      )
      const finalSnapshot = finalEvidence.snapshot
      if (finalEvidence.attribution_error !== undefined)
      {
        await this.phase(job, 'verifying', 'failed')
        activePhase = undefined
        await this.finish(
          job,
          this.resultFromEvidence(
            job,
            'failed',
            providerOutcome,
            finalSnapshot,
            verification,
            [],
            `${finalEvidence.attribution_error}${SETUP_ATTRIBUTION_SALVAGE_SUFFIX}`,
            classifyFailure('broker')
          )
        )
        return
      }
      if (finalEvidence.setup_mutations.length > 0)
      {
        await this.phase(job, 'verifying', 'failed')
        activePhase = undefined
        const attributionError = `verification changed setup-attributed paths: ${finalEvidence.setup_mutations.join(', ')}`
        await this.finish(
          job,
          this.resultFromEvidence(
            job,
            'rejected',
            providerOutcome,
            finalSnapshot,
            verification,
            finalEvidence.attribution_violations,
            `${attributionError}${SETUP_ATTRIBUTION_SALVAGE_SUFFIX}`,
            classifyFailure('scope')
          )
        )
        return
      }
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
      const status: TerminalWorkerStatus =
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
      if (error instanceof UnconfirmedProcessGroupExitError)
      {
        processExitUnconfirmed = true
        throw error
      }
      if (activePhase !== undefined)
      {
        await this.phase(job, activePhase, 'failed').catch(() =>
        {})
      }
      if (error instanceof ProcessOwnershipClearError)
      {
        await this.finishAfterProcessClearFailure(job, error)
        return
      }
      await this.finish(
        job,
        this.baseResult(
          job,
          'failed',
          errorMessage(error),
          error instanceof ProcessOwnershipError
            ? classifyFailure('broker')
            : unexpectedFailureClass
        )
      )
    }
    finally
    {
      if (this.controllers.get(job.job_id) === controller)
      {
        this.controllers.delete(job.job_id)
      }
      if (!processExitUnconfirmed) void this.schedule()
    }
  }

  private async finishAfterProcessClearFailure(
    job: WorkerJob,
    error: ProcessOwnershipClearError
  ): Promise<void>
  {
    const salvageMessage = `${error.message}; process-group exit was confirmed, but phase attribution did not complete, so change.patch is the full base-to-current delta and salvage evidence only`
    if (job.worktree === undefined)
    {
      await this.finish(
        job,
        this.baseResult(
          job,
          'failed',
          salvageMessage,
          classifyFailure('broker')
        )
      )
      return
    }
    let snapshot: Awaited<ReturnType<typeof snapshotWorktree>>
    try
    {
      snapshot = await snapshotWorktree(
        job.worktree,
        job.base_sha,
        this.artifact(job, 'change.patch')
      )
    }
    catch (snapshotError)
    {
      await this.finish(
        job,
        this.baseResult(
          job,
          'failed',
          `${salvageMessage}; worktree salvage snapshot failed: ${errorMessage(snapshotError)}`,
          classifyFailure('broker')
        )
      )
      return
    }
    await this.finish(
      job,
      this.resultFromEvidence(
        job,
        'failed',
        undefined,
        snapshot,
        [],
        [],
        salvageMessage,
        classifyFailure('broker')
      )
    )
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
        on_process_started: async (identity) =>
        {
          await this.recordProcessStarted(job, identity)
        },
        on_process_finished: async (identity) =>
        {
          await this.recordProcessFinished(job, identity)
        },
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
    status: TerminalWorkerStatus,
    error?: string,
    failureClass?: FailureClass
  ): WorkerResult
  {
    const result: WorkerResult = {
      capability_evidence:
        job.capability_evidence ?? capabilityEvidence(job.request),
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
      event_log_path: this.artifact(
        job,
        workerEventLogFileName(job.request.provider, job.restart_requeues ?? 0)
      ),
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
    status: TerminalWorkerStatus,
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
    if (job.cancellation_reason)
    {
      result.status = 'cancelled'
      result.error = job.cancellation_reason
    }
    const existing = this.terminalTransitions.get(job.job_id)
    if (existing !== undefined)
    {
      await existing
      return
    }
    const transition = this.commitTerminal(job, result)
    this.terminalTransitions.set(job.job_id, transition)
    try
    {
      await transition
    }
    finally
    {
      if (this.terminalTransitions.get(job.job_id) === transition)
      {
        this.terminalTransitions.delete(job.job_id)
      }
    }
  }

  private async commitTerminal(
    job: WorkerJob,
    result: WorkerResult
  ): Promise<void>
  {
    await this.phase(job, 'finalizing', 'started')
    const setup = this.setupResults.get(job.job_id)
    if (setup !== undefined) result.setup = setup
    const completedAt = new Date().toISOString()
    result.completed_at = completedAt
    if (job.started_at !== undefined)
    {
      result.elapsed_ms = Date.parse(completedAt) - Date.parse(job.started_at)
    }
    const terminal: WorkerJob = {
      ...job,
      status: result.status,
      completed_at: completedAt,
      result,
    }
    delete terminal.process_id
    delete terminal.process_token
    await this.store.write(terminal)

    job.status = terminal.status
    job.completed_at = completedAt
    job.result = result
    delete job.process_id
    delete job.process_token
    this.setupResults.delete(job.job_id)
    await this.phase(job, 'finalizing', 'completed')
    this.activities.delete(job.job_id)
    const summary = summarizeWorkerJob(terminal)
    this.jobs.delete(job.job_id)
    this.events.emit(`terminal:${job.job_id}`, summary)
  }
}
