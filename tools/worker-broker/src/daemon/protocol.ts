// tools/worker-broker/src/daemon/protocol.ts
// pin the daemon wire contract: versions, identity, frames, methods, & the client surface

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  StartWorkerRequest,
  WorkerJob,
  WorkerStatus,
} from '../contracts.js'

// bump only on incompatible wire changes; a mismatched hello is rejected outright
export const DAEMON_PROTOCOL_VERSION = 1

// stamped onto persisted job records; the daemon refuses state dirs stamped newer than itself
export const STATE_SCHEMA_VERSION = 1

export const DAEMON_SOCKET_NAME = 'daemon.sock'
export const DAEMON_IDENTITY_NAME = 'daemon.json'

export function daemonSocketPath(stateDirectory: string): string
{
  return path.join(stateDirectory, DAEMON_SOCKET_NAME)
}

export function daemonIdentityPath(stateDirectory: string): string
{
  return path.join(stateDirectory, DAEMON_IDENTITY_NAME)
}

// dist/build-id.json is emitted by the build script; source checkouts read as 'dev'
export function readBuildId(): string
{
  try
  {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const raw = fs.readFileSync(
      path.join(here, '..', '..', 'build-id.json'),
      'utf8'
    )
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'build_id' in parsed &&
      typeof (parsed as { build_id: unknown }).build_id === 'string'
    )
    {
      return (parsed as { build_id: string }).build_id
    }
  }
  catch
  {
    // fall through to dev marker
  }
  return 'dev'
}

/**
 * Durable identity of the live daemon, written next to its socket and
 * returned from every successful hello.
 */
export interface DaemonIdentity
{
  pid: number
  build_id: string
  protocol_version: number
  state_schema_version: number
  started_at: string
  socket_path: string
  state_dir: string
}

export interface DaemonHelloParams
{
  protocol_version: number
  build_id: string
}

export interface DaemonStatusResult
{
  identity: DaemonIdentity
  active_jobs: string[]
  queued_jobs: string[]
  draining: boolean
}

export interface ShutdownParams
{
  // when_idle drains: stop admitting starts, exit once no job is active
  when_idle: boolean
}

export interface WaitForWorkersParams
{
  job_ids?: string[]
  run?: string
  timeout_seconds?: number
}

/**
 * One still-running worker at the moment a wait returned, so a timed-out wait
 * carries real progress instead of a bare id.
 */
export interface PendingWorker
{
  job_id: string
  status: WorkerStatus
  stage?: string
  phase?: string
  elapsed_ms: number
  last_message?: string
}

export interface WaitForWorkersResult
{
  timed_out: boolean
  workers: WorkerJob[]
  // optional so a client built against an older daemon still parses the frame
  pending?: PendingWorker[]
}

export interface RunStatusParams
{
  run: string
}

export interface RunStatusStage
{
  stage: string
  queued: number
  running: number
  completed: number
  failed: number
  rejected: number
  cancelled: number
  job_ids: string[]
}

export interface RunStatusResult
{
  run: string
  workflows: string[]
  totals: Record<WorkerStatus, number>
  stages: RunStatusStage[]
}

export interface ArtifactParams
{
  job_id: string
  // activity is the only name readable before the job is terminal
  artifact:
    | 'prompt'
    | 'events'
    | 'stderr'
    | 'patch'
    | 'model_result'
    | 'verification'
    | 'activity'
  max_bytes?: number
  tail?: boolean
}

export interface ArtifactResult
{
  job_id: string
  artifact: ArtifactParams['artifact']
  content: string
  truncated: boolean
  byte_length: number
}

export interface EditSerializationConflict
{
  job_id: string
  overlapping_paths: string[]
}

export interface ListWorkersParams
{
  status?: WorkerStatus
  run?: string
  workflow?: string
}

export interface JobIdParams
{
  job_id: string
}

/**
 * Every request the daemon serves. Methods map 1:1 onto the single JobManager
 * (plus daemon lifecycle); the MCP server and CLI are thin adapters over this.
 */
export interface DaemonMethods
{
  hello: { params: DaemonHelloParams; result: DaemonIdentity }
  daemon_status: { params: Record<string, never>; result: DaemonStatusResult }
  shutdown: { params: ShutdownParams; result: DaemonStatusResult }
  start_worker: { params: StartWorkerRequest; result: WorkerJob }
  edit_serialization: {
    params: JobIdParams
    result: EditSerializationConflict[]
  }
  list_workers: { params: ListWorkersParams; result: WorkerJob[] }
  get_worker_status: { params: JobIdParams; result: WorkerJob }
  get_worker_result: { params: JobIdParams; result: WorkerJob }
  get_worker_artifact: { params: ArtifactParams; result: ArtifactResult }
  get_run_status: { params: RunStatusParams; result: RunStatusResult }
  wait_for_workers: {
    params: WaitForWorkersParams
    result: WaitForWorkersResult
  }
  cancel_worker: { params: JobIdParams; result: WorkerJob }
}

export type DaemonMethod = keyof DaemonMethods

// frames travel as one JSON object per line over the unix socket, multiplexed by id;
// concurrent requests on one connection are answered in completion order
export interface DaemonRequestFrame<M extends DaemonMethod = DaemonMethod>
{
  id: number
  method: M
  params: DaemonMethods[M]['params']
}

export interface DaemonErrorShape
{
  message: string
  // stable codes clients can branch on; anything else is an internal failure
  code?:
    | 'protocol_mismatch'
    | 'build_mismatch'
    | 'draining'
    | 'unknown_job'
    | 'invalid_request'
}

export type DaemonResponseFrame =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: DaemonErrorShape }

/**
 * Typed client surface over one daemon connection. Implementations own
 * connect-or-spawn, the hello handshake, and build-mismatch handling.
 */
export interface DaemonClient
{
  identity(): DaemonIdentity
  call<M extends DaemonMethod>(
    method: M,
    params: DaemonMethods[M]['params']
  ): Promise<DaemonMethods[M]['result']>
  close(): Promise<void>
}
