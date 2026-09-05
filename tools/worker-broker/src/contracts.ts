// tools/worker-broker/src/contracts.ts
// define broker requests, lifecycle state, provider outcomes, & computed results

export const PROVIDER_NAMES = ['codex', 'cursor', 'coral', 'claude'] as const
export const WORKER_MODES = ['read', 'edit'] as const
export const TERMINAL_WORKER_STATUSES = [
  'completed',
  'failed',
  'rejected',
  'cancelled',
] as const
export const WORKER_STATUSES = [
  'queued',
  'running',
  ...TERMINAL_WORKER_STATUSES,
] as const
export const FAILURE_CLASSES = [
  'environment',
  'model',
  'broker_fault',
  'scope',
  'verification',
] as const
export const REASONING_EFFORTS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
] as const

export type ProviderName = (typeof PROVIDER_NAMES)[number]
export type WorkerMode = (typeof WORKER_MODES)[number]
export const CAPABILITY_NAMES = [
  'native_no_nesting',
  'no_nested_agents',
  'filesystem_read_only',
  'filesystem_workspace_only',
  'network_disabled',
] as const
export type CapabilityName = (typeof CAPABILITY_NAMES)[number]

/** Broker evidence for a precisely scoped runtime restriction. */
export interface CapabilityEvidence
{
  capability: CapabilityName
  scope: string
  status: 'enforced' | 'unsupported' | 'unverified'
  layer: 'instructions' | 'detection' | 'prevention'
  evidence: string
}
export type WorkerStatus = (typeof WORKER_STATUSES)[number]
export type TerminalWorkerStatus = (typeof TERMINAL_WORKER_STATUSES)[number]

export function isTerminalWorkerStatus(status: string): boolean
{
  return (TERMINAL_WORKER_STATUSES as readonly string[]).includes(status)
}

const CODEX_EVENT_LOG_PATTERN = /^events\.attempt-(0|[1-9]\d*)\.jsonl$/u

export function workerEventLogFileName(
  provider: ProviderName,
  attempt: number
): string
{
  if (provider !== 'codex') return 'events.jsonl'
  if (!Number.isSafeInteger(attempt) || attempt < 0)
  {
    throw new Error(`invalid Codex provider attempt: ${attempt}`)
  }
  return `events.attempt-${attempt}.jsonl`
}

export function codexEventLogAttempt(fileName: string): number | undefined
{
  const match = CODEX_EVENT_LOG_PATTERN.exec(fileName)
  if (match === null) return undefined
  const attempt = Number(match[1])
  return Number.isSafeInteger(attempt) ? attempt : undefined
}

// why a terminal job failed, so clients can tell salvageable work from lost work:
// environment = setup/toolchain defect (exit 126/127, setup failure) — patch usually intact;
// model = provider process/output defect; broker_fault = broker restart/state/ownership;
// scope = allowed-path or setup-attribution violation; verification = genuine nonzero verification
export type FailureClass = (typeof FAILURE_CLASSES)[number]
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]

export type ActivityPhase = 'preparing' | 'working' | 'verifying' | 'finalizing'
export type ActivityStatus = 'started' | 'completed' | 'failed'
export type ActivityInput =
  | { kind: 'phase'; phase: ActivityPhase; status: ActivityStatus }
  | { kind: 'message'; summary: string }
  | { kind: 'action'; status: ActivityStatus }

export type ActivityRecord =
  | {
      schema_version: 1
      sequence: number
      recorded_at: string
      kind: 'phase'
      phase: ActivityPhase
      status: ActivityStatus
    }
  | {
      schema_version: 1
      sequence: number
      recorded_at: string
      kind: 'message'
      summary: string
    }
  | {
      schema_version: 1
      sequence: number
      recorded_at: string
      kind: 'action'
      status: ActivityStatus
    }

interface VerificationCommandInput
{
  command: string
  timeout_seconds?: number | undefined
}

export type VerificationInput = string | VerificationCommandInput

export interface StartWorkerRequest
{
  provider: ProviderName
  mode: WorkerMode
  repo: string
  base_ref?: string | undefined
  task: string
  allowed_paths: string[]
  acceptance_criteria?: string[] | undefined
  setup_commands?: VerificationInput[] | undefined
  verification_commands?: VerificationInput[] | undefined
  model?: string | undefined
  effort?: ReasoningEffort | undefined
  stage?: string | undefined
  workflow?: string | undefined
  run?: string | undefined
  depends_on?: string[] | undefined
  allow_nested_agents?: boolean | undefined
  required_capabilities?: CapabilityName[] | undefined
}

export interface NormalizedVerificationCommand
{
  command: string
  timeout_seconds: number
}

export interface NormalizedWorkerRequest
{
  provider: ProviderName
  mode: WorkerMode
  repo: string
  base_ref: string
  task: string
  allowed_paths: string[]
  acceptance_criteria: string[]
  setup_commands: NormalizedVerificationCommand[]
  verification_commands: NormalizedVerificationCommand[]
  model?: string
  effort?: ReasoningEffort
  stage?: string
  workflow?: string
  run?: string
  depends_on: string[]
  allow_nested_agents: boolean
  required_capabilities?: CapabilityName[]
}

export interface ModelWorkerResult
{
  summary: string
  assumptions: string[]
  risks: string[]
  follow_ups: string[]
}

/** Durable identity for one broker-owned detached process-group supervisor. */
export interface ProcessIdentity
{
  pid: number
  token: string
}

export interface ProviderRunContext
{
  job_id: string
  provider_attempt?: number
  request: NormalizedWorkerRequest
  worktree: string
  job_dir: string
  prompt_path: string
  event_log_path: string
  stderr_path: string
  model_result_path: string
  signal: AbortSignal
  on_process_started: (identity: ProcessIdentity) => void | Promise<void>
  on_process_finished: (identity: ProcessIdentity) => void | Promise<void>
  on_activity?: (activity: ActivityInput) => void
}

export interface ProviderOutcome
{
  exit_code: number | null
  signal: NodeJS.Signals | null
  worker_session_id?: string
  model_result?: ModelWorkerResult
  effective_model?: string
}

export interface WorkerProvider
{
  readonly name: ProviderName
  run(context: ProviderRunContext): Promise<ProviderOutcome>
}

export interface ChangedPath
{
  status: string
  paths: string[]
}

export interface GitSnapshot
{
  head_sha: string
  changes: ChangedPath[]
  changed_files: string[]
  patch_path: string
}

export interface VerificationResult
{
  command: string
  exit_code: number | null
  signal: NodeJS.Signals | null
  timed_out: boolean
  stdout_path: string
  stderr_path: string
  elapsed_ms: number
}

export interface WorkerResult
{
  capability_evidence?: CapabilityEvidence[]
  job_id: string
  status: TerminalWorkerStatus
  provider: ProviderName
  mode: WorkerMode
  repo: string
  base_ref: string
  base_sha: string
  stage?: string
  workflow?: string
  run?: string
  model?: string
  effort?: ReasoningEffort
  effective_model?: string
  head_sha?: string
  worktree?: string
  branch?: string
  summary?: string
  assumptions: string[]
  risks: string[]
  follow_ups: string[]
  changed_files: string[]
  changes: ChangedPath[]
  setup: VerificationResult[]
  verification: VerificationResult[]
  scope_violations: string[]
  patch_path?: string
  event_log_path: string
  stderr_path: string
  model_result_path: string
  worker_session_id?: string
  process_exit_code?: number | null
  process_signal?: NodeJS.Signals | null
  error?: string
  failure_class?: FailureClass
  created_at: string
  started_at?: string
  completed_at?: string
  elapsed_ms?: number
}

export interface WorkerJob
{
  capability_evidence?: CapabilityEvidence[]
  job_id: string
  status: WorkerStatus
  request: NormalizedWorkerRequest
  base_sha: string
  setup_paths?: string[]
  setup_tree_sha?: string
  branch?: string
  worktree?: string
  process_id?: number
  process_token?: string
  restart_requeues?: number
  created_at: string
  started_at?: string
  completed_at?: string
  result?: WorkerResult
}

/** Bounded lifecycle and assignment projection for routine broker reads. */
export interface WorkerSummary
{
  capability_evidence?: CapabilityEvidence[] | undefined
  job_id: string
  status: WorkerStatus
  provider: ProviderName
  mode: WorkerMode
  task_preview: string
  task_bytes: number
  repo: string
  allowed_paths: string[]
  base_sha: string
  stage?: string | undefined
  workflow?: string | undefined
  run?: string | undefined
  depends_on: string[]
  model?: string | undefined
  effort?: ReasoningEffort | undefined
  branch?: string | undefined
  worktree?: string | undefined
  created_at: string
  started_at?: string | undefined
  completed_at?: string | undefined
  elapsed_ms?: number | undefined
  changed_file_count: number
  scope_violation_count: number
  failure_class?: FailureClass | undefined
  error_preview?: string | undefined
  error_bytes?: number | undefined
}

/** One earlier edit admission that this job must serialize behind. */
export interface EditSerializationConflict
{
  job_id: string
  overlapping_paths: string[]
}

/** Durable manager admission plus scheduling metadata captured at that instant. */
export interface WorkerAdmission
{
  job: WorkerSummary
  serializes_behind: EditSerializationConflict[]
}

export interface BrokerConfig
{
  state_dir: string
  codex_binary: string
  cursor_binary: string
  coral_binary: string
  claude_binary: string
  default_codex_model?: string
  default_cursor_model?: string
  default_coral_model?: string
  default_claude_model?: string
  coral_host?: string
}
