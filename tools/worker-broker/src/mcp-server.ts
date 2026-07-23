// tools/worker-broker/src/mcp-server.ts
// expose the broker lifecycle through five compact stdio MCP tools

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
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
    provider: z.enum(['codex', 'cursor', 'coral']),
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
    created_at: job.created_at,
  }
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
        'List persisted worker jobs, optionally filtered by lifecycle status.',
      inputSchema: { status: WorkerStatusSchema.optional() },
    },
    async ({ status }) =>
    {
      try
      {
        const jobs = await manager.list()
        const workers = jobs
          .filter((job) => status === undefined || job.status === status)
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
