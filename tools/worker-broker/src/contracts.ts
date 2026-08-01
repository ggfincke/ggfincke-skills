// tools/worker-broker/src/contracts.ts
// define broker requests, lifecycle state, provider outcomes, & computed results

type ProviderName = 'codex' | 'cursor' | 'coral' | 'claude'
export type WorkerMode = 'read' | 'edit'
export type WorkerStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'rejected' | 'cancelled'

type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'

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
  timeout_seconds?: number
}

export type VerificationInput = string | VerificationCommandInput

export interface StartWorkerRequest
{
  provider: ProviderName
  mode: WorkerMode
  repo: string
  base_ref?: string
  task: string
  allowed_paths: string[]
  acceptance_criteria?: string[]
  verification_commands?: VerificationInput[]
  model?: string
  effort?: ReasoningEffort
  stage?: string
  workflow?: string
  run?: string
  depends_on?: string[]
  allow_nested_agents?: boolean
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
  verification_commands: NormalizedVerificationCommand[]
  model?: string
  effort?: ReasoningEffort
  stage?: string
  workflow?: string
  run?: string
  depends_on: string[]
  allow_nested_agents: boolean
}

export interface ModelWorkerResult
{
  summary: string
  assumptions: string[]
  risks: string[]
  follow_ups: string[]
}

export interface ProviderRunContext
{
  job_id: string
  request: NormalizedWorkerRequest
  worktree: string
  job_dir: string
  prompt_path: string
  event_log_path: string
  stderr_path: string
  model_result_path: string
  signal: AbortSignal
  on_process_started: (pid: number) => void | Promise<void>
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
  job_id: string
  status: WorkerStatus
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
  created_at: string
  started_at?: string
  completed_at?: string
  elapsed_ms?: number
}

export interface WorkerJob
{
  job_id: string
  status: WorkerStatus
  request: NormalizedWorkerRequest
  base_sha: string
  branch?: string
  worktree?: string
  process_id?: number
  created_at: string
  started_at?: string
  completed_at?: string
  result?: WorkerResult
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
