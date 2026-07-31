// tools/worker-broker/src/mcp-server.ts
// expose broker lifecycle, orchestration rollups, waits, & durable artifacts

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type {
  StartWorkerRequest,
  WorkerJob,
  WorkerStatus,
} from './contracts.js'
import { errorMessage } from './errors.js'
import { JobManager } from './job-manager.js'

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
    depends_on: z.array(z.string().min(1)).optional(),
    allow_nested_agents: z.boolean().optional(),
  })
  .strict()

interface JobSummary
{
  job_id: string
  status: WorkerStatus
  provider: string
  mode: string
  task: string
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

function summarize(job: WorkerJob): JobSummary
{
  const summary: JobSummary = {
    job_id: job.job_id,
    status: job.status,
    provider: job.request.provider,
    mode: job.request.mode,
    task: job.request.task,
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

function success(value: Record<string, unknown>, message: string)
{
  return {
    content: [{ type: 'text' as const, text: message }],
    structuredContent: value,
  }
}

function failure(error: unknown)
{
  const message = errorMessage(error)
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  }
}

export function createWorkerBrokerServer(manager: JobManager): McpServer
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
        const job = await manager.start(input as StartWorkerRequest)
        return success(
          { worker: summarize(job) },
          `started worker ${job.job_id}`
        )
      }
      catch (error)
      {
        return failure(error)
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
        const jobs = await manager.list()
        const workers = jobs
          .filter((job) => status === undefined || job.status === status)
          .filter((job) => run === undefined || job.request.run === run)
          .filter(
            (job) => workflow === undefined || job.request.workflow === workflow
          )
          .map(summarize)
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
        const jobs = (await manager.list()).filter(
          (job) => job.request.run === run
        )
        const statuses: WorkerStatus[] = [
          'queued',
          'running',
          'completed',
          'failed',
          'rejected',
          'cancelled',
        ]
        const totals = Object.fromEntries(
          statuses.map((status) => [
            status,
            jobs.filter((job) => job.status === status).length,
          ])
        )
        const stageNames = [
          ...new Set(jobs.map((job) => job.request.stage ?? null)),
        ]
        const stages = stageNames.map((stage) =>
        {
          const stageJobs = jobs.filter(
            (job) => (job.request.stage ?? null) === stage
          )
          return {
            stage,
            ...Object.fromEntries(
              statuses.map((status) => [
                status,
                stageJobs.filter((job) => job.status === status).length,
              ])
            ),
            job_ids: stageJobs.map((job) => job.job_id),
          }
        })
        return success(
          {
            run,
            workflows: [
              ...new Set(
                jobs
                  .map((job) => job.request.workflow)
                  .filter((value): value is string => value !== undefined)
              ),
            ],
            totals,
            stages,
          },
          `${run}: ${jobs.length} worker job(s)`
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
        'Wait until all selected workers are terminal or the timeout expires.',
      inputSchema: z
        .object({
          run: z.string().min(1).optional(),
          job_ids: z.array(z.string().min(1)).optional(),
          timeout_seconds: z.number().int().positive().max(300).default(60),
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
        const allJobs = await manager.list()
        const selectedIds = new Set(jobIds ?? [])
        if (run !== undefined)
        {
          for (const job of allJobs)
          {
            if (job.request.run === run) selectedIds.add(job.job_id)
          }
        }
        const selected = await Promise.all(
          [...selectedIds].map(async (jobId) => await manager.get(jobId))
        )
        const pending = selected.filter(
          (job) => !TERMINAL_STATUSES.has(job.status)
        )
        let timedOut = false
        if (pending.length > 0)
        {
          let timer: NodeJS.Timeout | undefined
          const timeout = new Promise<'timeout'>((resolve) =>
          {
            timer = setTimeout(() => resolve('timeout'), timeoutSeconds * 1_000)
          })
          const outcome = await Promise.race([
            Promise.all(
              pending.map(
                async (job) => await manager.waitForTerminal(job.job_id)
              )
            ),
            timeout,
          ])
          if (timer !== undefined) clearTimeout(timer)
          timedOut = outcome === 'timeout'
        }
        const current = await Promise.all(
          [...selectedIds].map(async (jobId) => await manager.get(jobId))
        )
        const pendingJobIds = current
          .filter((job) => !TERMINAL_STATUSES.has(job.status))
          .map((job) => job.job_id)
        return success(
          {
            timed_out: timedOut,
            pending_job_ids: pendingJobIds,
            jobs: current
              .filter((job) => TERMINAL_STATUSES.has(job.status))
              .map(summarize),
          },
          timedOut
            ? `timed out with ${pendingJobIds.length} pending worker(s)`
            : `${current.length} worker(s) terminal`
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
      description: 'Read one bounded worker artifact as UTF-8 text.',
      inputSchema: {
        job_id: z.string().min(1),
        artifact: z.enum([
          'prompt',
          'events',
          'stderr',
          'patch',
          'model_result',
          'verification',
        ]),
        max_bytes: z.number().int().positive().max(262_144).default(65_536),
        tail: z.boolean().default(false),
      },
    },
    async ({ job_id: jobId, artifact, max_bytes: maxBytes, tail }) =>
    {
      try
      {
        const job = await manager.get(jobId)
        if (
          ['patch', 'model_result', 'verification'].includes(artifact) &&
          !TERMINAL_STATUSES.has(job.status)
        )
        {
          throw new Error(`artifact ${artifact} requires a terminal worker job`)
        }
        let bytes: Buffer
        if (artifact === 'verification')
        {
          bytes = Buffer.from(
            `${JSON.stringify(job.result?.verification ?? [], null, 2)}\n`
          )
        }
        else
        {
          const names = {
            prompt: 'prompt.md',
            events: 'events.jsonl',
            stderr: 'provider.stderr.log',
            patch: 'change.patch',
            model_result: 'model-result.json',
          } as const
          bytes = await readFile(
            path.join(manager.store.jobDir(jobId), names[artifact])
          )
        }
        const truncated = bytes.length > maxBytes
        const contentBytes = truncated
          ? tail
            ? bytes.subarray(bytes.length - maxBytes)
            : bytes.subarray(0, maxBytes)
          : bytes
        return success(
          {
            job_id: jobId,
            artifact,
            content: contentBytes.toString('utf8'),
            byte_length: bytes.length,
            truncated,
          },
          `${jobId}: ${artifact} (${bytes.length} bytes)`
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
        const job = await manager.get(jobId)
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
      inputSchema: { job_id: z.string().min(1) },
    },
    async ({ job_id: jobId }) =>
    {
      try
      {
        const job = await manager.get(jobId)
        if (job.result === undefined)
        {
          return failure(
            new Error(
              `worker ${job.job_id} is ${job.status}; no terminal result yet`
            )
          )
        }
        return success(
          {
            worker: summarize(job),
            result: job.result as unknown as Record<string, unknown>,
          },
          `${job.job_id}: ${job.status}; ${job.result.changed_files.length} changed file(s)`
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
        const job = await manager.cancel(jobId)
        return success(
          { worker: summarize(job) },
          job.status === 'running'
            ? `cancellation requested for ${job.job_id}`
            : `${job.job_id}: ${job.status}`
        )
      }
      catch (error)
      {
        return failure(error)
      }
    }
  )

  return server
}
