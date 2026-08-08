// tools/worker-broker/src/wait-command.ts
// block until a selected worker set is terminal & report the outcome once

import type { WorkerJob, WorkerStatus } from './contracts.js'
import type { DaemonClient, PendingWorker } from './daemon/protocol.js'

const TERMINAL_STATUSES = new Set<WorkerStatus>([
  'completed',
  'failed',
  'rejected',
  'cancelled',
])

// long enough that a normal wave produces at most a handful of progress lines
const MAX_LINE_MESSAGE_CHARACTERS = 120

export interface WaitSelector
{
  run?: string
  job_ids?: string[]
}

export interface WaitOutcome
{
  completed: number
  failed: number
  // false whenever terminality was never observed; the caller maps that to a
  // distinct exit code so a dead daemon is never read as a finished wave
  observed: boolean
  jobs: WorkerJob[]
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

function terminalLine(job: WorkerJob): string
{
  const changed = job.result?.changed_files.length ?? 0
  return `${job.job_id} ${job.status} ${job.result?.elapsed_ms ?? 0}ms ${changed} files ${job.result?.failure_class ?? '-'}`
}

function terminalJson(selector: WaitSelector, jobs: WorkerJob[]): string
{
  const payload: Record<string, unknown> = {}
  if (selector.run !== undefined) payload.run = selector.run
  payload.completed = jobs.filter((job) => job.status === 'completed').length
  payload.failed = jobs.filter((job) => job.status !== 'completed').length
  payload.jobs = jobs.map((job) => ({
    job_id: job.job_id,
    status: job.status,
    elapsed_ms: job.result?.elapsed_ms ?? null,
    changed_files: job.result?.changed_files ?? [],
    failure_class: job.result?.failure_class ?? null,
  }))
  return JSON.stringify(payload)
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
    return { completed: 0, failed: 0, observed: false, jobs: [] }
  }
  while (true)
  {
    const result = await client.call('wait_for_workers', {
      job_ids: jobIds,
      timeout_seconds: options.pollSeconds,
    })
    if (!result.timed_out)
    {
      const jobs = result.workers
      if (options.json) sink.line(terminalJson(selector, jobs))
      else for (const job of jobs) sink.line(terminalLine(job))
      return {
        completed: jobs.filter((job) => job.status === 'completed').length,
        failed: jobs.filter((job) => job.status !== 'completed').length,
        observed: true,
        jobs,
      }
    }
    // the loop exists because the daemon clamps each blocking call at
    // MAX_WAIT_SECONDS; an unbounded wait is assembled from bounded ones
    if (!options.json)
    {
      for (const entry of result.pending ?? []) sink.line(pendingLine(entry))
    }
  }
}

// shared by `run --request` so the CLI keeps exactly one blocking wait loop
export async function waitForOneTerminal(
  client: DaemonClient,
  jobId: string,
  pollSeconds: number
): Promise<WorkerJob>
{
  while (true)
  {
    const waited = await client.call('wait_for_workers', {
      job_ids: [jobId],
      timeout_seconds: pollSeconds,
    })
    const job = waited.workers.find((worker) => worker.job_id === jobId)
    if (job !== undefined && TERMINAL_STATUSES.has(job.status)) return job
  }
}
