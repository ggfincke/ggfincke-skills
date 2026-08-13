// tools/worker-broker/src/mcp-server.ts
// expose daemon-backed broker lifecycle, orchestration, waits, & artifacts

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  TERMINAL_WORKER_STATUSES,
  WORKER_STATUSES,
  type WorkerStatus,
} from './contracts.js'
import type {
  DaemonClient,
  DaemonErrorShape,
  ListWorkersParams,
  PendingWorker,
  WaitForWorkersParams,
} from './daemon/protocol.js'
import { errorMessage } from './errors.js'
import { JOB_ID_MAX_LENGTH, JOB_ID_PATTERN } from './job-store.js'
import { parseStartWorkerRequest, StartWorkerRequestSchema } from './request.js'
import { summarizeWorkerJob } from './worker-summary.js'

const WorkerStatusSchema = z.enum(WORKER_STATUSES)
const JobIdSchema = z.string().regex(JOB_ID_PATTERN).max(JOB_ID_MAX_LENGTH)
const TERMINAL_STATUSES = new Set<WorkerStatus>(TERMINAL_WORKER_STATUSES)

// accumulate whole code points so a byte budget never splits one mid-sequence
export function clipToBytes(value: string, maxBytes: number): string
{
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value
  const ellipsis = '…'
  const ellipsisBytes = Buffer.byteLength(ellipsis, 'utf8')
  if (maxBytes < ellipsisBytes) return ''
  const contentBudget = maxBytes - ellipsisBytes
  let used = 0
  const kept: string[] = []
  for (const character of value)
  {
    const size = Buffer.byteLength(character, 'utf8')
    if (used + size > contentBudget) break
    used += size
    kept.push(character)
  }
  return `${kept.join('')}${ellipsis}`
}

// the text channel is what a lead reads first, so it carries progress too
function pendingLine(entry: PendingWorker): string
{
  const seconds = Math.round(entry.elapsed_ms / 1_000)
  return `${entry.job_id} ${entry.phase ?? '-'} ${seconds}s — ${entry.last_message ?? 'no message'}`
}

function success(value: Record<string, unknown>, message: string)
{
  return {
    content: [{ type: 'text' as const, text: message }],
    structuredContent: value,
  }
}

function daemonError(error: unknown): DaemonErrorShape | undefined
{
  if (typeof error !== 'object' || error === null || !('message' in error))
  {
    return undefined
  }
  const candidate = error as { code?: unknown; message: unknown }
  if (typeof candidate.message !== 'string') return undefined
  if (typeof candidate.code === 'string')
  {
    return {
      message: candidate.message,
      code: candidate.code as NonNullable<DaemonErrorShape['code']>,
    }
  }
  return {
    message: candidate.message,
  }
}

function failure(
  error: unknown,
  messages: Partial<Record<NonNullable<DaemonErrorShape['code']>, string>> = {}
)
{
  const shape = daemonError(error)
  const message =
    shape?.code === undefined
      ? errorMessage(error)
      : (messages[shape.code] ?? shape.message)
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  }
}

export function createWorkerBrokerServer(client: DaemonClient): McpServer
{
  const server = new McpServer(
    { name: 'worker-broker', version: '0.1.0' },
    {
      instructions:
        'Delegate bounded repository work. Treat broker-computed Git and verification evidence as authoritative.',
    }
  )

  server.registerTool(
    'start_worker',
    {
      title: 'Start worker',
      description:
        'Start one bounded native worker in an isolated Git worktree and return immediately.',
      inputSchema: StartWorkerRequestSchema,
    },
    async (input) =>
    {
      try
      {
        const admission = await client.call(
          'start_worker',
          parseStartWorkerRequest(input)
        )
        const job = admission.worker
        const serializesBehind = admission.serializes_behind
        const overlapPaths = [
          ...new Set(
            serializesBehind.flatMap((conflict) => conflict.overlapping_paths)
          ),
        ].sort()
        return success(
          { worker: job, serializes_behind: serializesBehind },
          serializesBehind.length === 0
            ? `started worker ${job.job_id}`
            : `started worker ${job.job_id}; it will serialize behind ${serializesBehind.length} active edit job(s) via shared path(s): ${overlapPaths.join(', ')} — narrow allowed_paths if this wave should run in parallel`
        )
      }
      catch (error)
      {
        return failure(error, {
          draining: 'worker broker is shutting down',
        })
      }
    }
  )

  server.registerTool(
    'list_workers',
    {
      title: 'List workers',
      description:
        'List persisted worker jobs, optionally filtered by status, run, and workflow.',
      inputSchema: {
        status: WorkerStatusSchema.optional(),
        run: z.string().min(1).optional(),
        workflow: z.string().min(1).optional(),
      },
    },
    async ({ status, run, workflow }) =>
    {
      try
      {
        const params: ListWorkersParams = {}
        if (status !== undefined) params.status = status
        if (run !== undefined) params.run = run
        if (workflow !== undefined) params.workflow = workflow
        const workers = await client.call('list_workers', params)
        return success({ workers }, `${workers.length} worker job(s)`)
      }
      catch (error)
      {
        return failure(error)
      }
    }
  )

  server.registerTool(
    'get_run_status',
    {
      title: 'Get run status',
      description: 'Roll up worker lifecycle state for one orchestration run.',
      inputSchema: { run: z.string().min(1) },
    },
    async ({ run }) =>
    {
      try
      {
        const result = await client.call('get_run_status', { run })
        const jobCount = Object.values(result.totals).reduce(
          (total, count) => total + count,
          0
        )
        return success(
          result as unknown as Record<string, unknown>,
          `${run}: ${jobCount} worker job(s)`
        )
      }
      catch (error)
      {
        return failure(error)
      }
    }
  )

  server.registerTool(
    'wait_for_workers',
    {
      title: 'Wait for workers',
      description:
        'Bounded liveness probe for a wave that just launched. NOT a completion channel — for waves longer than the timeout, run `worker-broker wait --run <run> --json` as a background shell command and let its exit wake you. Never re-call this tool with an unchanged pending set.',
      inputSchema: z
        .object({
          run: z.string().min(1).optional(),
          job_ids: z.array(JobIdSchema).optional(),
          timeout_seconds: z.number().int().positive().max(900).default(300),
        })
        .refine(
          (input) =>
            input.run !== undefined ||
            (input.job_ids !== undefined && input.job_ids.length > 0),
          { message: 'run or job_ids is required' }
        ),
    },
    async ({ run, job_ids: jobIds, timeout_seconds: timeoutSeconds }) =>
    {
      try
      {
        const params: WaitForWorkersParams = {
          timeout_seconds: timeoutSeconds,
        }
        if (run !== undefined) params.run = run
        if (jobIds !== undefined) params.job_ids = jobIds
        const result = await client.call('wait_for_workers', params)
        const pending = result.pending
        return success(
          {
            timed_out: result.timed_out,
            pending,
            jobs: result.workers.filter((job) =>
              TERMINAL_STATUSES.has(job.status)
            ),
          },
          result.timed_out
            ? `timed out; ${pending.length} pending: ${pending
                .slice(0, 3)
                .map(pendingLine)
                .join('; ')}`
            : `${result.workers.length} worker(s) terminal`
        )
      }
      catch (error)
      {
        return failure(error)
      }
    }
  )

  server.registerTool(
    'get_worker_artifact',
    {
      title: 'Get worker artifact',
      description:
        'Read one bounded worker artifact as UTF-8 text. activity with tail: true, max_bytes: 2000 is the cheap liveness read for a running job.',
      inputSchema: {
        job_id: JobIdSchema,
        artifact: z.enum([
          'prompt',
          'events',
          'stderr',
          'patch',
          'model_result',
          'verification',
          'activity',
        ]),
        max_bytes: z.number().int().positive().max(262_144).default(65_536),
        tail: z.boolean().default(false),
      },
    },
    async ({ job_id: jobId, artifact, max_bytes: maxBytes, tail }) =>
    {
      try
      {
        const result = await client.call('get_worker_artifact', {
          job_id: jobId,
          artifact,
          max_bytes: maxBytes,
          tail,
        })
        return success(
          result as unknown as Record<string, unknown>,
          `${jobId}: ${artifact} (${result.byte_length} bytes)`
        )
      }
      catch (error)
      {
        return failure(error)
      }
    }
  )

  server.registerTool(
    'get_worker_status',
    {
      title: 'Get worker status',
      description:
        'Get current lifecycle and assignment metadata for one worker job.',
      inputSchema: { job_id: JobIdSchema },
    },
    async ({ job_id: jobId }) =>
    {
      try
      {
        const job = await client.call('get_worker_status', { job_id: jobId })
        return success({ worker: job }, `${job.job_id}: ${job.status}`)
      }
      catch (error)
      {
        return failure(error)
      }
    }
  )

  server.registerTool(
    'get_worker_result',
    {
      title: 'Get worker result',
      description:
        'Get broker-computed Git, process, and verification evidence for a terminal worker job.',
      inputSchema: {
        job_id: JobIdSchema,
        summary_max_bytes: z
          .number()
          .int()
          .positive()
          .max(65_536)
          .default(4_000),
      },
    },
    async ({ job_id: jobId, summary_max_bytes: summaryMaxBytes }) =>
    {
      try
      {
        const job = await client.call('get_worker_result', { job_id: jobId })
        if (job.result === undefined)
        {
          return failure(
            new Error(
              `worker ${job.job_id} is ${job.status}; no terminal result yet`
            )
          )
        }
        // only the model's prose is capped; the computed evidence (changed
        // files, changes, verification, setup, scope violations) stays whole
        // because that is what the lead has to act on
        const summary = job.result.summary
        const summaryBytes = Buffer.byteLength(summary ?? '', 'utf8')
        const truncated = summaryBytes > summaryMaxBytes
        const result =
          truncated && summary !== undefined
            ? { ...job.result, summary: clipToBytes(summary, summaryMaxBytes) }
            : job.result
        return success(
          {
            worker: summarizeWorkerJob(job),
            result: result as unknown as Record<string, unknown>,
            summary_truncated: truncated,
            summary_byte_length: summaryBytes,
          },
          `${job.job_id}: ${job.status}; ${job.result.changed_files.length} changed file(s)${
            truncated
              ? '; full summary via get_worker_artifact({job_id, artifact: "model_result"})'
              : ''
          }`
        )
      }
      catch (error)
      {
        return failure(error)
      }
    }
  )

  server.registerTool(
    'cancel_worker',
    {
      title: 'Cancel worker',
      description:
        'Cancel a queued or running worker and retain its terminal audit state.',
      inputSchema: { job_id: JobIdSchema },
    },
    async ({ job_id: jobId }) =>
    {
      try
      {
        const job = await client.call('cancel_worker', { job_id: jobId })
        return success(
          { worker: job },
          job.status === 'running'
            ? `cancellation requested for ${job.job_id}`
            : `${job.job_id}: ${job.status}`
        )
      }
      catch (error)
      {
        return failure(error, {
          unknown_job: `job is not active in this broker process: ${jobId}`,
        })
      }
    }
  )

  return server
}
