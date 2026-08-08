// tools/worker-broker/src/mcp-server.ts
// expose daemon-backed broker lifecycle, orchestration, waits, & artifacts

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type {
  StartWorkerRequest,
  WorkerJob,
  WorkerStatus,
} from './contracts.js'
import type {
  DaemonClient,
  DaemonErrorShape,
  ListWorkersParams,
  PendingWorker,
  WaitForWorkersParams,
} from './daemon/protocol.js'
import { errorMessage } from './errors.js'

const WorkerStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'rejected',
  'cancelled',
])
const TERMINAL_STATUSES = new Set<WorkerStatus>([
  'completed',
  'failed',
  'rejected',
  'cancelled',
])

const VerificationSchema = z.union([
  z.string().min(1),
  z
    .object({
      command: z.string().min(1),
      timeout_seconds: z.number().int().positive().max(86_400).optional(),
    })
    .strict(),
])

const StartWorkerSchema = z
  .object({
    provider: z.enum(['codex', 'cursor', 'coral', 'claude']),
    mode: z.enum(['read', 'edit']),
    repo: z.string().min(1),
    base_ref: z.string().min(1).optional(),
    task: z.string().min(1),
    allowed_paths: z.array(z.string()),
    acceptance_criteria: z.array(z.string()).optional(),
    setup_commands: z
      .array(VerificationSchema)
      .describe(
        'environment preparation commands run in the worktree before the provider starts; a failure ends the job before any model work'
      )
      .optional(),
    verification_commands: z.array(VerificationSchema).optional(),
    model: z.string().min(1).optional(),
    effort: z
      .enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
      .optional(),
    stage: z
      .string()
      .min(1)
      .describe('orchestration stage identifier, metadata only')
      .optional(),
    workflow: z
      .string()
      .min(1)
      .describe('workflow template identifier, metadata only')
      .optional(),
    run: z
      .string()
      .min(1)
      .describe('orchestration run identifier, metadata only')
      .optional(),
    depends_on: z
      .array(z.string().min(1))
      .describe(
        'job ids that must reach completed before this job leaves the queue; a failed dependency rejects this job. Declare later phases up front with depends_on instead of holding the sequence in the lead and polling between waves.'
      )
      .optional(),
    allow_nested_agents: z.boolean().optional(),
  })
  .strict()

interface JobSummary
{
  job_id: string
  status: WorkerStatus
  provider: string
  mode: string
  task_preview: string
  task_bytes: number
  repo: string
  allowed_paths: string[]
  base_sha: string
  stage?: string
  workflow?: string
  run?: string
  depends_on: string[]
  model?: string
  effort?: string
  branch?: string
  worktree?: string
  created_at: string
  started_at?: string
  completed_at?: string
}

// the lead authored this prompt; echo a locator, not the text. every summary
// carried the full task before, so one wave of long prompts replayed hundreds of
// kilobytes of the lead's own words back into its context on every list or wait.
// nothing is lost: get_worker_artifact({artifact:'prompt'}) still has all of it.
const TASK_PREVIEW_CHARACTERS = 160

function preview(task: string): string
{
  const characters = [...task]
  if (characters.length <= TASK_PREVIEW_CHARACTERS) return task
  return `${characters.slice(0, TASK_PREVIEW_CHARACTERS).join('')}…`
}

function summarize(job: WorkerJob): JobSummary
{
  const summary: JobSummary = {
    job_id: job.job_id,
    status: job.status,
    provider: job.request.provider,
    mode: job.request.mode,
    task_preview: preview(job.request.task),
    task_bytes: Buffer.byteLength(job.request.task, 'utf8'),
    repo: job.request.repo,
    allowed_paths: job.request.allowed_paths,
    base_sha: job.base_sha,
    depends_on: job.request.depends_on ?? [],
    created_at: job.created_at,
  }
  if (job.request.stage !== undefined) summary.stage = job.request.stage
  if (job.request.workflow !== undefined)
    summary.workflow = job.request.workflow
  if (job.request.run !== undefined) summary.run = job.request.run
  if (job.request.model !== undefined) summary.model = job.request.model
  if (job.request.effort !== undefined) summary.effort = job.request.effort
  if (job.branch !== undefined) summary.branch = job.branch
  if (job.worktree !== undefined) summary.worktree = job.worktree
  if (job.started_at !== undefined) summary.started_at = job.started_at
  if (job.completed_at !== undefined) summary.completed_at = job.completed_at
  return summary
}

// accumulate whole code points so a byte budget never splits one mid-sequence
function clipToBytes(value: string, maxBytes: number): string
{
  let used = 0
  const kept: string[] = []
  for (const character of value)
  {
    const size = Buffer.byteLength(character, 'utf8')
    if (used + size > maxBytes) break
    used += size
    kept.push(character)
  }
  return `${kept.join('')}…`
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
      inputSchema: StartWorkerSchema,
    },
    async (input) =>
    {
      try
      {
        const job = await client.call(
          'start_worker',
          input as StartWorkerRequest
        )
        const serializesBehind = await client.call('edit_serialization', {
          job_id: job.job_id,
        })
        const overlapPaths = [
          ...new Set(
            serializesBehind.flatMap((conflict) => conflict.overlapping_paths)
          ),
        ].sort()
        return success(
          { worker: summarize(job), serializes_behind: serializesBehind },
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
        const workers = (await client.call('list_workers', params)).map(
          summarize
        )
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
          job_ids: z.array(z.string().min(1)).optional(),
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
        // defaulted so this still reads against a daemon built before pending
        const pending = result.pending ?? []
        return success(
          {
            timed_out: result.timed_out,
            pending,
            jobs: result.workers
              .filter((job) => TERMINAL_STATUSES.has(job.status))
              .map(summarize),
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
        job_id: z.string().min(1),
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
      inputSchema: { job_id: z.string().min(1) },
    },
    async ({ job_id: jobId }) =>
    {
      try
      {
        const job = await client.call('get_worker_status', { job_id: jobId })
        return success(
          { worker: summarize(job) },
          `${job.job_id}: ${job.status}`
        )
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
        job_id: z.string().min(1),
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
            worker: summarize(job),
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
      inputSchema: { job_id: z.string().min(1) },
    },
    async ({ job_id: jobId }) =>
    {
      try
      {
        const job = await client.call('cancel_worker', { job_id: jobId })
        return success(
          { worker: summarize(job) },
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
