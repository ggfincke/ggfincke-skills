// tools/worker-broker/src/wait-command.ts
// block until a selected worker set is terminal & report the outcome once

import { isTerminalWorkerStatus, type WorkerSummary } from './contracts.js'
import type {
  DaemonClient,
  PendingWorker,
  WaitForWorkersResult,
} from './daemon/protocol.js'

// long enough that a normal wave produces at most a handful of progress lines
const MAX_LINE_MESSAGE_CHARACTERS = 120

export interface WaitSelector
{
  run?: string
  job_ids?: string[]
}

export interface WaitOutcome
{
  selected: number
  completed: number
  failed: number
  rejected: number
  cancelled: number
  pending: 0
  timed_out: false
  // false whenever terminality was never observed; the caller maps that to a
  // distinct exit code so a dead daemon is never read as a finished wave
  observed: boolean
}

export interface WaitSink
{
  line(text: string): void
}

export interface WaitOptions
{
  json: boolean
  pollSeconds: number
}

function clip(text: string, limit: number): string
{
  const characters = [...text]
  if (characters.length <= limit) return text
  return `${characters.slice(0, limit).join('')}…`
}

function pendingLine(entry: PendingWorker): string
{
  const seconds = Math.round(entry.elapsed_ms / 1_000)
  const message =
    entry.last_message === undefined
      ? '-'
      : clip(entry.last_message, MAX_LINE_MESSAGE_CHARACTERS)
  return `${entry.job_id} ${entry.stage ?? '-'} ${entry.phase ?? '-'} ${seconds}s ${message}`
}

function terminalLine(job: WorkerSummary): string
{
  return `${job.job_id} ${job.status} ${job.elapsed_ms ?? 0}ms ${job.changed_file_count} files ${job.failure_class ?? '-'}`
}

function terminalCounts(jobs: WorkerSummary[]): Omit<WaitOutcome, 'observed'>
{
  return {
    selected: jobs.length,
    completed: jobs.filter((job) => job.status === 'completed').length,
    failed: jobs.filter((job) => job.status === 'failed').length,
    rejected: jobs.filter((job) => job.status === 'rejected').length,
    cancelled: jobs.filter((job) => job.status === 'cancelled').length,
    pending: 0,
    timed_out: false,
  }
}

function terminalJson(selector: WaitSelector, outcome: WaitOutcome): string
{
  const payload: Record<string, unknown> = {}
  if (selector.run !== undefined) payload.run = selector.run
  payload.selected = outcome.selected
  payload.completed = outcome.completed
  payload.failed = outcome.failed
  payload.rejected = outcome.rejected
  payload.cancelled = outcome.cancelled
  payload.pending = outcome.pending
  payload.timed_out = outcome.timed_out
  return JSON.stringify(payload)
}

function terminalWorkers(
  selectedIds: readonly string[],
  result: WaitForWorkersResult
): WorkerSummary[]
{
  if (result.timed_out) throw new Error('worker wait response was not terminal')
  if (result.pending.length !== 0)
    throw new Error('terminal worker wait response still contains pending jobs')

  const expected = new Set(selectedIds)
  const seen = new Set<string>()
  for (const worker of result.workers)
  {
    if (!expected.has(worker.job_id))
      throw new Error(
        `terminal worker wait returned unexpected job ${worker.job_id}`
      )
    if (seen.has(worker.job_id))
      throw new Error(
        `terminal worker wait returned duplicate job ${worker.job_id}`
      )
    if (!isTerminalWorkerStatus(worker.status))
      throw new Error(
        `terminal worker wait returned nonterminal job ${worker.job_id}`
      )
    seen.add(worker.job_id)
  }
  const missing = selectedIds.find((jobId) => !seen.has(jobId))
  if (missing !== undefined)
    throw new Error(`terminal worker wait omitted selected job ${missing}`)
  return result.workers
}

// resolved once up front: a run that matches nothing must be reported as a
// failure to observe, never as a wave that finished instantly
async function resolveSelection(
  client: DaemonClient,
  selector: WaitSelector
): Promise<string[]>
{
  const resolved = new Set(selector.job_ids ?? [])
  if (selector.run !== undefined)
  {
    const workers = await client.call('list_workers', { run: selector.run })
    for (const job of workers) resolved.add(job.job_id)
  }
  return [...resolved]
}

// block until every selected worker is terminal, emitting one progress line per
// pending worker on each intermediate return; the process exit, not stdout, is
// the completion signal a detached caller waits on
export async function waitForSelection(
  client: DaemonClient,
  selector: WaitSelector,
  sink: WaitSink,
  options: WaitOptions
): Promise<WaitOutcome>
{
  const jobIds = await resolveSelection(client, selector)
  if (jobIds.length === 0)
  {
    return {
      selected: 0,
      completed: 0,
      failed: 0,
      rejected: 0,
      cancelled: 0,
      pending: 0,
      timed_out: false,
      observed: false,
    }
  }
  while (true)
  {
    const result = await client.call('wait_for_workers', {
      job_ids: jobIds,
      timeout_seconds: options.pollSeconds,
    })
    if (!result.timed_out)
    {
      const jobs = terminalWorkers(jobIds, result)
      const outcome: WaitOutcome = {
        ...terminalCounts(jobs),
        observed: true,
      }
      if (options.json) sink.line(terminalJson(selector, outcome))
      else for (const job of jobs) sink.line(terminalLine(job))
      return outcome
    }
    // the loop exists because the daemon clamps each blocking call at
    // MAX_WAIT_SECONDS; an unbounded wait is assembled from bounded ones
    if (!options.json)
    {
      for (const entry of result.pending) sink.line(pendingLine(entry))
    }
  }
}

// shared by `run --request` so the CLI keeps exactly one blocking wait loop
export async function waitForOneTerminal(
  client: DaemonClient,
  jobId: string,
  pollSeconds: number
): Promise<WorkerSummary>
{
  while (true)
  {
    const waited = await client.call('wait_for_workers', {
      job_ids: [jobId],
      timeout_seconds: pollSeconds,
    })
    if (waited.timed_out) continue
    return terminalWorkers([jobId], waited)[0] as WorkerSummary
  }
}
