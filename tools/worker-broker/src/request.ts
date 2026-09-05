// tools/worker-broker/src/request.ts
// validate external assignments & reduce them to one deterministic broker contract

import path from 'node:path'
import { z } from 'zod'
import {
  CAPABILITY_NAMES,
  PROVIDER_NAMES,
  REASONING_EFFORTS,
  WORKER_MODES,
  type NormalizedVerificationCommand,
  type NormalizedWorkerRequest,
  type StartWorkerRequest,
  type VerificationInput,
} from './contracts.js'
import { errorMessage } from './errors.js'
import { normalizeAllowedPaths } from './path-scope.js'

export const MAX_VERIFICATION_TIMEOUT_SECONDS = 86_400

const VerificationSchema = z.union([
  z.string().min(1),
  z
    .object({
      command: z.string().min(1),
      timeout_seconds: z
        .number()
        .int()
        .positive()
        .max(MAX_VERIFICATION_TIMEOUT_SECONDS)
        .optional(),
    })
    .strict(),
])

export const StartWorkerRequestSchema = z
  .object({
    provider: z.enum(PROVIDER_NAMES),
    mode: z.enum(WORKER_MODES),
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
    effort: z.enum(REASONING_EFFORTS).optional(),
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
    required_capabilities: z.array(z.enum(CAPABILITY_NAMES)).optional(),
  })
  .strict()
  .superRefine((request, context) =>
  {
    if (
      request.allow_nested_agents === true &&
      request.required_capabilities?.some((capability) =>
        ['native_no_nesting', 'no_nested_agents'].includes(capability)
      )
    )
    {
      context.addIssue({
        code: 'custom',
        path: ['required_capabilities'],
        message: 'a no-nesting requirement conflicts with allow_nested_agents',
      })
    }
    if (request.provider === 'cursor' && request.effort !== undefined)
    {
      context.addIssue({
        code: 'custom',
        path: ['effort'],
        message:
          'Cursor reasoning effort must be encoded in the model identifier',
      })
    }
    if (request.provider === 'coral' && request.effort !== undefined)
    {
      context.addIssue({
        code: 'custom',
        path: ['effort'],
        message: 'Coral does not support the broker effort override',
      })
    }
    if (request.provider === 'coral' && request.allow_nested_agents === true)
    {
      context.addIssue({
        code: 'custom',
        path: ['allow_nested_agents'],
        message: 'Coral headless workers do not support nested agents',
      })
    }
  })

export class RequestValidationError extends Error
{
  constructor(message: string)
  {
    super(message)
    this.name = 'RequestValidationError'
  }
}

function requestValidationError(error: unknown): RequestValidationError
{
  if (error instanceof RequestValidationError) return error
  return new RequestValidationError(errorMessage(error))
}

export function parseStartWorkerRequest(value: unknown): StartWorkerRequest
{
  try
  {
    return StartWorkerRequestSchema.parse(value)
  }
  catch (error)
  {
    throw requestValidationError(error)
  }
}

const DEFAULT_VERIFICATION_TIMEOUT_SECONDS = 600

function requireNonEmpty(value: string, field: string): string
{
  const trimmed = value.trim()
  if (trimmed === '') throw new Error(`${field} must be non-empty`)
  return trimmed
}

function normalizeStringList(
  values: readonly string[] | undefined,
  field: string
): string[]
{
  return (values ?? []).map((value) => requireNonEmpty(value, field))
}

function normalizeVerification(
  input: VerificationInput
): NormalizedVerificationCommand
{
  if (typeof input === 'string')
  {
    return {
      command: requireNonEmpty(input, 'verification command'),
      timeout_seconds: DEFAULT_VERIFICATION_TIMEOUT_SECONDS,
    }
  }

  const timeout = input.timeout_seconds ?? DEFAULT_VERIFICATION_TIMEOUT_SECONDS
  if (
    !Number.isInteger(timeout) ||
    timeout <= 0 ||
    timeout > MAX_VERIFICATION_TIMEOUT_SECONDS
  )
  {
    throw new Error(
      'verification timeout_seconds must be an integer from 1 through 86400'
    )
  }
  return {
    command: requireNonEmpty(input.command, 'verification command'),
    timeout_seconds: timeout,
  }
}

function normalizeParsedRequest(
  request: StartWorkerRequest
): NormalizedWorkerRequest
{
  const allowedPaths = normalizeAllowedPaths(request.allowed_paths)
  if (request.mode === 'edit' && allowedPaths.length === 0)
  {
    throw new Error('edit workers require at least one allowed path prefix')
  }
  const repo = requireNonEmpty(request.repo, 'repo')
  if (!path.isAbsolute(repo))
  {
    throw new Error(`repo must be an absolute path: ${repo}`)
  }
  const normalized: NormalizedWorkerRequest = {
    provider: request.provider,
    mode: request.mode,
    repo,
    base_ref: requireNonEmpty(request.base_ref ?? 'HEAD', 'base_ref'),
    task: requireNonEmpty(request.task, 'task'),
    allowed_paths: allowedPaths,
    acceptance_criteria: normalizeStringList(
      request.acceptance_criteria,
      'acceptance criterion'
    ),
    setup_commands: (request.setup_commands ?? []).map(normalizeVerification),
    verification_commands: (request.verification_commands ?? []).map(
      normalizeVerification
    ),
    depends_on: normalizeStringList(request.depends_on, 'dependency job id'),
    allow_nested_agents: request.allow_nested_agents ?? false,
  }
  if (request.model !== undefined)
    normalized.model = requireNonEmpty(request.model, 'model')
  if (request.effort !== undefined) normalized.effort = request.effort
  if (request.stage !== undefined)
    normalized.stage = requireNonEmpty(request.stage, 'stage')
  if (request.workflow !== undefined)
    normalized.workflow = requireNonEmpty(request.workflow, 'workflow')
  if (request.run !== undefined)
    normalized.run = requireNonEmpty(request.run, 'run')
  if (request.required_capabilities !== undefined)
    normalized.required_capabilities = [
      ...new Set(request.required_capabilities),
    ]
  return normalized
}

export function normalizeRequest(value: unknown): NormalizedWorkerRequest
{
  try
  {
    return normalizeParsedRequest(parseStartWorkerRequest(value))
  }
  catch (error)
  {
    throw requestValidationError(error)
  }
}
