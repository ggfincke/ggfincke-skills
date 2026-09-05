// tools/worker-broker/src/worker-summary.ts
// project full job records into bounded lifecycle and assignment summaries

import { z } from 'zod'
import {
  CAPABILITY_NAMES,
  FAILURE_CLASSES,
  PROVIDER_NAMES,
  REASONING_EFFORTS,
  WORKER_MODES,
  WORKER_STATUSES,
  type WorkerJob,
  type WorkerSummary,
} from './contracts.js'

const TASK_PREVIEW_CODE_POINTS = 160
const ERROR_PREVIEW_CODE_POINTS = 240

function preview(value: string, maxCodePoints: number): string
{
  const kept: string[] = []
  for (const codePoint of value)
  {
    if (kept.length === maxCodePoints) return `${kept.join('')}…`
    kept.push(codePoint)
  }
  return value
}

function boundedPreview(maxCodePoints: number): z.ZodString
{
  return z.string().refine(
    (value) =>
    {
      let count = 0
      for (const _codePoint of value)
      {
        count += 1
        if (count > maxCodePoints + 1) return false
      }
      return true
    },
    `preview must contain at most ${maxCodePoints + 1} code points`
  )
}

export const WorkerSummarySchema = z
  .object({
    capability_evidence: z
      .array(
        z
          .object({
            capability: z.enum(CAPABILITY_NAMES),
            scope: z.string(),
            status: z.enum(['enforced', 'unsupported', 'unverified']),
            layer: z.enum(['instructions', 'detection', 'prevention']),
            evidence: z.string(),
          })
          .strict()
      )
      .optional(),
    job_id: z.string(),
    status: z.enum(WORKER_STATUSES),
    provider: z.enum(PROVIDER_NAMES),
    mode: z.enum(WORKER_MODES),
    task_preview: boundedPreview(TASK_PREVIEW_CODE_POINTS),
    task_bytes: z.number().int().nonnegative(),
    repo: z.string(),
    allowed_paths: z.array(z.string()),
    base_sha: z.string(),
    stage: z.string().optional(),
    workflow: z.string().optional(),
    run: z.string().optional(),
    depends_on: z.array(z.string()),
    model: z.string().optional(),
    effort: z.enum(REASONING_EFFORTS).optional(),
    branch: z.string().optional(),
    worktree: z.string().optional(),
    created_at: z.string(),
    started_at: z.string().optional(),
    completed_at: z.string().optional(),
    elapsed_ms: z.number().int().nonnegative().optional(),
    changed_file_count: z.number().int().nonnegative(),
    scope_violation_count: z.number().int().nonnegative(),
    failure_class: z.enum(FAILURE_CLASSES).optional(),
    error_preview: boundedPreview(ERROR_PREVIEW_CODE_POINTS).optional(),
    error_bytes: z.number().int().nonnegative().optional(),
  })
  .strict()

export function summarizeWorkerJob(job: WorkerJob): WorkerSummary
{
  const result = job.result
  const summary: WorkerSummary = {
    job_id: job.job_id,
    status: job.status,
    provider: job.request.provider,
    mode: job.request.mode,
    task_preview: preview(job.request.task, TASK_PREVIEW_CODE_POINTS),
    task_bytes: Buffer.byteLength(job.request.task, 'utf8'),
    repo: job.request.repo,
    allowed_paths: [...job.request.allowed_paths],
    base_sha: job.base_sha,
    depends_on: [...(job.request.depends_on ?? [])],
    created_at: job.created_at,
    changed_file_count: result?.changed_files.length ?? 0,
    scope_violation_count: result?.scope_violations.length ?? 0,
  }
  if (job.request.stage !== undefined) summary.stage = job.request.stage
  if (job.capability_evidence !== undefined)
    summary.capability_evidence = structuredClone(job.capability_evidence)
  if (job.request.workflow !== undefined)
    summary.workflow = job.request.workflow
  if (job.request.run !== undefined) summary.run = job.request.run
  if (job.request.model !== undefined) summary.model = job.request.model
  if (job.request.effort !== undefined) summary.effort = job.request.effort
  if (job.branch !== undefined) summary.branch = job.branch
  if (job.worktree !== undefined) summary.worktree = job.worktree
  if (job.started_at !== undefined) summary.started_at = job.started_at
  if (job.completed_at !== undefined) summary.completed_at = job.completed_at
  if (result?.elapsed_ms !== undefined) summary.elapsed_ms = result.elapsed_ms
  if (result?.failure_class !== undefined)
    summary.failure_class = result.failure_class
  if (result?.error !== undefined)
  {
    summary.error_preview = preview(result.error, ERROR_PREVIEW_CODE_POINTS)
    summary.error_bytes = Buffer.byteLength(result.error, 'utf8')
  }
  return summary
}
