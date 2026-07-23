// tools/worker-broker/src/request.ts
// validate external assignments & reduce them to one deterministic broker contract

import type {
  NormalizedVerificationCommand,
  NormalizedWorkerRequest,
  StartWorkerRequest,
  VerificationInput,
} from './contracts.js'
import { normalizeAllowedPaths } from './path-scope.js'

const DEFAULT_VERIFICATION_TIMEOUT_SECONDS = 600

function requireNonEmpty(value: string, field: string): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new Error(`${field} must be non-empty`)
  return trimmed
}

function normalizeStringList(values: readonly string[] | undefined, field: string): string[] {
  return (values ?? []).map((value) => requireNonEmpty(value, field))
}

function normalizeVerification(input: VerificationInput): NormalizedVerificationCommand {
  if (typeof input === 'string') {
    return {
      command: requireNonEmpty(input, 'verification command'),
      timeout_seconds: DEFAULT_VERIFICATION_TIMEOUT_SECONDS,
    }
  }

  const timeout = input.timeout_seconds ?? DEFAULT_VERIFICATION_TIMEOUT_SECONDS
  if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 86_400) {
    throw new Error('verification timeout_seconds must be an integer from 1 through 86400')
  }
  return {
    command: requireNonEmpty(input.command, 'verification command'),
    timeout_seconds: timeout,
  }
}

export function normalizeRequest(request: StartWorkerRequest): NormalizedWorkerRequest {
  if (
    request.provider !== 'codex' &&
    request.provider !== 'cursor' &&
    request.provider !== 'coral'
  ) {
    throw new Error(`unsupported provider: ${request.provider}`)
  }
  if (request.mode !== 'read' && request.mode !== 'edit') {
    throw new Error(`unsupported worker mode: ${String(request.mode)}`)
  }

  const allowedPaths = normalizeAllowedPaths(request.allowed_paths)
  if (request.mode === 'edit' && allowedPaths.length === 0) {
    throw new Error('edit workers require at least one allowed path prefix')
  }
  if (request.provider === 'cursor' && request.effort !== undefined) {
    throw new Error('Cursor reasoning effort must be encoded in the model identifier')
  }
  if (request.provider === 'coral' && request.effort !== undefined) {
    throw new Error('Coral does not support the broker effort override')
  }
  if (request.provider === 'coral' && request.allow_nested_agents === true) {
    throw new Error('Coral headless workers do not support nested agents')
  }

  const normalized: NormalizedWorkerRequest = {
    provider: request.provider,
    mode: request.mode,
    repo: requireNonEmpty(request.repo, 'repo'),
    base_ref: requireNonEmpty(request.base_ref ?? 'HEAD', 'base_ref'),
    task: requireNonEmpty(request.task, 'task'),
    allowed_paths: allowedPaths,
    acceptance_criteria: normalizeStringList(
      request.acceptance_criteria,
      'acceptance criterion',
    ),
    verification_commands: (request.verification_commands ?? []).map(normalizeVerification),
    allow_nested_agents: request.allow_nested_agents ?? false,
  }
  if (request.model !== undefined) normalized.model = requireNonEmpty(request.model, 'model')
  if (request.effort !== undefined) normalized.effort = request.effort
  return normalized
}
