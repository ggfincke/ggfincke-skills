// tools/worker-broker/src/daemon/daemon.ts
// own broker state in one unix-socket daemon & serve the pinned JSONL protocol

import { readFile, rm } from 'node:fs/promises'
import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { secureDirectory, writePrivateFile } from '../artifact.js'
import { defaultBrokerConfig } from '../config.js'
import type {
  BrokerConfig,
  StartWorkerRequest,
  WorkerJob,
  WorkerStatus,
} from '../contracts.js'
import { errorMessage } from '../errors.js'
import { JobManager } from '../job-manager.js'
import { ClaudeProvider } from '../providers/claude.js'
import { CodexProvider } from '../providers/codex.js'
import { CoralProvider } from '../providers/coral.js'
import { CursorProvider } from '../providers/cursor.js'
import {
  DAEMON_PROTOCOL_VERSION,
  STATE_SCHEMA_VERSION,
  daemonIdentityPath,
  daemonSocketPath,
  readBuildId,
  type ArtifactParams,
  type ArtifactResult,
  type DaemonErrorShape,
  type DaemonIdentity,
  type DaemonMethod,
  type DaemonRequestFrame,
  type DaemonResponseFrame,
  type DaemonStatusResult,
  type PendingWorker,
  type RunStatusResult,
  type WaitForWorkersResult,
} from './protocol.js'

const TERMINAL_STATUSES = new Set<WorkerStatus>([
  'completed',
  'failed',
  'rejected',
  'cancelled',
])
const WORKER_STATUSES: WorkerStatus[] = [
  'queued',
  'running',
  'completed',
  'failed',
  'rejected',
  'cancelled',
]
const DAEMON_METHODS = new Set<DaemonMethod>([
  'hello',
  'daemon_status',
  'shutdown',
  'start_worker',
  'edit_serialization',
  'list_workers',
  'get_worker_status',
  'get_worker_result',
  'get_worker_artifact',
  'get_run_status',
  'wait_for_workers',
  'cancel_worker',
])
const ARTIFACT_NAMES: ArtifactParams['artifact'][] = [
  'prompt',
  'events',
  'stderr',
  'patch',
  'model_result',
  'verification',
  'activity',
]
const DEFAULT_ARTIFACT_BYTES = 65_536
const MAX_ARTIFACT_BYTES = 262_144
const DEFAULT_WAIT_SECONDS = 60
// matches the MCP schema max exactly, so a model-facing wait is never silently
// re-clamped to a shorter timeout than the one it asked for
const MAX_WAIT_SECONDS = 900

type HandshakeState = 'pending' | 'processing' | 'complete' | 'rejected'

interface DaemonConnection
{
  socket: Socket
  buffer: string
  handshake: HandshakeState
  pending: DaemonRequestFrame[]
}

class DaemonRequestError extends Error
{
  readonly code: NonNullable<DaemonErrorShape['code']>

  constructor(
    message: string,
    code: NonNullable<DaemonErrorShape['code']> = 'invalid_request'
  )
  {
    super(message)
    this.name = 'DaemonRequestError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown>
{
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requestError(message: string): never
{
  throw new DaemonRequestError(message)
}

function requireString(params: Record<string, unknown>, name: string): string
{
  const value = params[name]
  if (typeof value !== 'string' || value.trim() === '')
  {
    requestError(`${name} must be a non-empty string`)
  }
  return value
}

function responseError(error: unknown): DaemonErrorShape
{
  const result: DaemonErrorShape = { message: errorMessage(error) }
  if (error instanceof DaemonRequestError) result.code = error.code
  return result
}

function writeResponse(socket: Socket, response: DaemonResponseFrame): void
{
  if (!socket.destroyed && socket.writable)
  {
    socket.write(`${JSON.stringify(response)}\n`)
  }
}

function rejectHandshake(
  connection: DaemonConnection,
  id: number,
  error: DaemonErrorShape
): void
{
  connection.handshake = 'rejected'
  connection.pending.length = 0
  if (!connection.socket.destroyed)
  {
    connection.socket.end(
      `${JSON.stringify({ id, ok: false, error } satisfies DaemonResponseFrame)}\n`
    )
  }
}

function listen(server: Server, socketPath: string): Promise<void>
{
  return new Promise<void>((resolve, reject) =>
  {
    const cleanup = (): void =>
    {
      server.off('error', onError)
      server.off('listening', onListening)
    }
    const onError = (error: Error): void =>
    {
      cleanup()
      reject(error)
    }
    const onListening = (): void =>
    {
      cleanup()
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(socketPath)
  })
}

function probeSocket(socketPath: string): Promise<boolean>
{
  return new Promise<boolean>((resolve, reject) =>
  {
    const socket = createConnection(socketPath)
    socket.once('connect', () =>
    {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', (error: NodeJS.ErrnoException) =>
    {
      socket.destroy()
      if (
        error.code === 'ECONNREFUSED' ||
        error.code === 'ENOENT' ||
        error.code === 'ENOTSOCK'
      )
      {
        resolve(false)
        return
      }
      reject(error)
    })
  })
}

async function bindSocket(
  socketPath: string,
  onConnection: (socket: Socket) => void
): Promise<Server>
{
  while (true)
  {
    const server = createServer(onConnection)
    try
    {
      await listen(server, socketPath)
      return server
    }
    catch (error)
    {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
      if (await probeSocket(socketPath))
      {
        throw new Error(
          `another worker-broker daemon owns this state directory: ${socketPath}`
        )
      }
      await rm(socketPath, { force: true })
    }
  }
}

async function closeServer(
  server: Server,
  connections: ReadonlySet<Socket>
): Promise<void>
{
  const closed = new Promise<void>((resolve, reject) =>
  {
    server.close((error) =>
    {
      if (error === undefined) resolve()
      else reject(error)
    })
  })
  for (const socket of connections) socket.destroySoon()
  await closed
}

function parseFrame(line: string): DaemonRequestFrame
{
  let value: unknown
  try
  {
    value = JSON.parse(line)
  }
  catch
  {
    throw new DaemonRequestError('request frame must be valid JSON')
  }
  if (!isRecord(value)) requestError('request frame must be an object')
  if (!Number.isInteger(value.id)) requestError('request id must be an integer')
  if (
    typeof value.method !== 'string' ||
    !DAEMON_METHODS.has(value.method as DaemonMethod)
  )
  {
    requestError(`unknown daemon method: ${String(value.method)}`)
  }
  if (!isRecord(value.params)) requestError('request params must be an object')
  return value as unknown as DaemonRequestFrame
}

async function knownJob(
  manager: JobManager,
  jobId: string
): Promise<WorkerJob>
{
  try
  {
    return await manager.get(jobId)
  }
  catch (error)
  {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
    {
      throw new DaemonRequestError(
        `unknown worker job: ${jobId}`,
        'unknown_job'
      )
    }
    throw error
  }
}

async function listWorkers(
  manager: JobManager,
  params: Record<string, unknown>
): Promise<WorkerJob[]>
{
  const status = params.status
  const run = params.run
  const workflow = params.workflow
  if (
    status !== undefined &&
    (typeof status !== 'string' ||
      !WORKER_STATUSES.includes(status as WorkerStatus))
  )
  {
    requestError(`unsupported worker status: ${String(status)}`)
  }
  if (run !== undefined && typeof run !== 'string')
  {
    requestError('run must be a string')
  }
  if (workflow !== undefined && typeof workflow !== 'string')
  {
    requestError('workflow must be a string')
  }
  return (await manager.list())
    .filter((job) => status === undefined || job.status === status)
    .filter((job) => run === undefined || job.request.run === run)
    .filter(
      (job) => workflow === undefined || job.request.workflow === workflow
    )
}

async function runStatus(
  manager: JobManager,
  run: string
): Promise<RunStatusResult>
{
  const jobs = (await manager.list()).filter((job) => job.request.run === run)
  const totals = Object.fromEntries(
    WORKER_STATUSES.map((status) => [
      status,
      jobs.filter((job) => job.status === status).length,
    ])
  ) as Record<WorkerStatus, number>
  const stageNames = [...new Set(jobs.map((job) => job.request.stage ?? ''))]
  const stages = stageNames.map((stage) =>
  {
    const stageJobs = jobs.filter((job) => (job.request.stage ?? '') === stage)
    const counts = Object.fromEntries(
      WORKER_STATUSES.map((status) => [
        status,
        stageJobs.filter((job) => job.status === status).length,
      ])
    ) as Record<WorkerStatus, number>
    return {
      stage,
      ...counts,
      job_ids: stageJobs.map((job) => job.job_id),
    }
  })
  return {
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
  }
}

async function workerArtifact(
  manager: JobManager,
  params: Record<string, unknown>
): Promise<ArtifactResult>
{
  const jobId = requireString(params, 'job_id')
  const artifact = params.artifact
  if (
    typeof artifact !== 'string' ||
    !ARTIFACT_NAMES.includes(artifact as ArtifactParams['artifact'])
  )
  {
    requestError(`unsupported worker artifact: ${String(artifact)}`)
  }
  const requestedBytes = params.max_bytes ?? DEFAULT_ARTIFACT_BYTES
  if (
    typeof requestedBytes !== 'number' ||
    !Number.isInteger(requestedBytes) ||
    requestedBytes <= 0
  )
  {
    requestError('max_bytes must be a positive integer')
  }
  if (params.tail !== undefined && typeof params.tail !== 'boolean')
  {
    requestError('tail must be a boolean')
  }
  const artifactName = artifact as ArtifactParams['artifact']
  const maxBytes = Math.min(requestedBytes, MAX_ARTIFACT_BYTES)
  const tail = params.tail ?? false
  const job = await knownJob(manager, jobId)
  if (
    ['patch', 'model_result', 'verification'].includes(artifactName) &&
    !TERMINAL_STATUSES.has(job.status)
  )
  {
    requestError(`artifact ${artifactName} requires a terminal worker job`)
  }

  let bytes: Buffer
  if (artifactName === 'verification')
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
      activity: 'activity.jsonl',
    } as const
    bytes = await readFile(
      path.join(manager.store.jobDir(jobId), names[artifactName])
    )
  }
  const truncated = bytes.length > maxBytes
  const content = truncated
    ? tail
      ? bytes.subarray(bytes.length - maxBytes)
      : bytes.subarray(0, maxBytes)
    : bytes
  return {
    job_id: jobId,
    artifact: artifactName,
    content: content.toString('utf8'),
    truncated,
    byte_length: bytes.length,
  }
}

function waitSeconds(params: Record<string, unknown>): number
{
  const value = params.timeout_seconds ?? DEFAULT_WAIT_SECONDS
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)
  {
    requestError('timeout_seconds must be a positive integer')
  }
  return Math.min(value, MAX_WAIT_SECONDS)
}

// bounded because the whole point of the wait payload is token economy; a wave
// of twenty workers must not return twenty kilobytes of prose
const MAX_PENDING_MESSAGE_CHARACTERS = 200

async function pendingWorker(
  manager: JobManager,
  job: WorkerJob
): Promise<PendingWorker>
{
  const progress = await manager.progress(job.job_id)
  const entry: PendingWorker = {
    job_id: job.job_id,
    status: job.status,
    elapsed_ms: Date.now() - Date.parse(job.started_at ?? job.created_at),
  }
  if (job.request.stage !== undefined) entry.stage = job.request.stage
  if (progress.phase !== undefined) entry.phase = progress.phase
  if (progress.last_message !== undefined)
  {
    entry.last_message = [...progress.last_message]
      .slice(0, MAX_PENDING_MESSAGE_CHARACTERS)
      .join('')
  }
  return entry
}

async function waitForWorkers(
  manager: JobManager,
  params: Record<string, unknown>
): Promise<WaitForWorkersResult>
{
  const run = params.run
  const jobIds = params.job_ids
  if (run !== undefined && (typeof run !== 'string' || run.trim() === ''))
  {
    requestError('run must be a non-empty string')
  }
  if (
    jobIds !== undefined &&
    (!Array.isArray(jobIds) ||
      jobIds.some((jobId) => typeof jobId !== 'string' || jobId.trim() === ''))
  )
  {
    requestError('job_ids must contain non-empty strings')
  }
  if (run === undefined && (!Array.isArray(jobIds) || jobIds.length === 0))
  {
    requestError('run or job_ids is required')
  }

  const selectedIds = new Set(jobIds as string[] | undefined)
  if (run !== undefined)
  {
    for (const job of await manager.list())
    {
      if (job.request.run === run) selectedIds.add(job.job_id)
    }
  }
  const selected = await Promise.all(
    [...selectedIds].map(async (jobId) => await knownJob(manager, jobId))
  )
  // validated before the early-exit branch so a malformed timeout is still
  // rejected when nothing happens to be pending
  const timeoutSeconds = waitSeconds(params)
  const pending = selected.filter((job) => !TERMINAL_STATUSES.has(job.status))
  let timedOut = false
  if (pending.length > 0)
  {
    let timer: NodeJS.Timeout | undefined
    const aborter = new AbortController()
    const timeout = new Promise<true>((resolve) =>
    {
      timer = setTimeout(() => resolve(true), timeoutSeconds * 1_000)
    })
    timedOut = await Promise.race([
      Promise.all(
        pending.map(
          async (job) =>
            await manager.waitForTerminal(job.job_id, aborter.signal)
        )
      ).then(() => false as const),
      timeout,
    ])
    if (timer !== undefined) clearTimeout(timer)
    // the losing branch of the race keeps one 'terminal:<id>' listener per
    // pending job alive forever unless it is told to stop waiting
    aborter.abort()
  }
  const workers = await Promise.all(
    [...selectedIds].map(async (jobId) => await knownJob(manager, jobId))
  )
  // derived from the post-race read, so a worker that finished during the wait
  // is never reported as pending
  const pendingWorkers = await Promise.all(
    workers
      .filter((job) => !TERMINAL_STATUSES.has(job.status))
      .map(async (job) => await pendingWorker(manager, job))
  )
  return {
    timed_out: timedOut,
    workers,
    pending: pendingWorkers,
  }
}

export async function startDaemon(
  config: BrokerConfig
): Promise<{ close(): Promise<void> }>
{
  await secureDirectory(config.state_dir)
  const socketPath = daemonSocketPath(config.state_dir)
  const identityPath = daemonIdentityPath(config.state_dir)
  const identity: DaemonIdentity = {
    pid: process.pid,
    build_id: readBuildId(),
    protocol_version: DAEMON_PROTOCOL_VERSION,
    state_schema_version: STATE_SCHEMA_VERSION,
    started_at: new Date().toISOString(),
    socket_path: socketPath,
    state_dir: config.state_dir,
  }
  const manager = new JobManager(config, [
    new CodexProvider(config),
    new ClaudeProvider(config),
    new CursorProvider(config),
    new CoralProvider(config),
  ])
  const connections = new Set<Socket>()
  let server: Server
  let draining = false
  let closePromise: Promise<void> | undefined
  let drainPromise: Promise<void> | undefined
  let lifecycleTail = Promise.resolve()
  let markReady = (): void => undefined
  const ready = new Promise<void>((resolve) =>
  {
    markReady = resolve
  })

  const status = async (): Promise<DaemonStatusResult> =>
  {
    const jobs = await manager.list()
    return {
      identity,
      active_jobs: jobs
        .filter((job) => job.status === 'running')
        .map((job) => job.job_id),
      queued_jobs: jobs
        .filter((job) => job.status === 'queued')
        .map((job) => job.job_id),
      draining,
    }
  }

  const lifecycle = async <T>(operation: () => Promise<T>): Promise<T> =>
  {
    const result = lifecycleTail.then(operation, operation)
    lifecycleTail = result.then(
      () => undefined,
      () => undefined
    )
    return await result
  }

  const close = (): Promise<void> =>
  {
    closePromise ??= (async () =>
    {
      draining = true
      let closeError: unknown
      try
      {
        await lifecycle(async () => await manager.shutdown())
      }
      catch (error)
      {
        closeError = error
      }
      try
      {
        await closeServer(server, connections)
      }
      catch (error)
      {
        closeError ??= error
      }
      try
      {
        await Promise.all([
          rm(socketPath, { force: true }),
          rm(identityPath, { force: true }),
        ])
      }
      catch (error)
      {
        closeError ??= error
      }
      process.off('SIGINT', signalHandler)
      process.off('SIGTERM', signalHandler)
      if (closeError !== undefined) throw closeError
    })()
    return closePromise
  }

  const beginDrain = (): void =>
  {
    drainPromise ??= (async () =>
    {
      while (true)
      {
        const current = await status()
        const pending = [...current.active_jobs, ...current.queued_jobs]
        if (pending.length === 0)
        {
          setTimeout(() => void close(), 0)
          return
        }
        await Promise.race(
          pending.map(async (jobId) => await manager.waitForTerminal(jobId))
        )
      }
    })().catch((error: unknown) =>
    {
      process.stderr.write(`daemon drain failed: ${errorMessage(error)}\n`)
      void close()
    })
  }

  const dispatch = async (
    frame: DaemonRequestFrame,
    params: Record<string, unknown>
  ): Promise<unknown> =>
  {
    switch (frame.method)
    {
      case 'hello':
        requestError('hello is only valid as the first request frame')
      case 'daemon_status':
        return await status()
      case 'shutdown':
        return await lifecycle(async () =>
        {
          if (typeof params.when_idle !== 'boolean')
          {
            requestError('when_idle must be a boolean')
          }
          if (params.when_idle)
          {
            draining = true
            const result = await status()
            beginDrain()
            return result
          }
          const current = await status()
          const active = [...current.active_jobs, ...current.queued_jobs]
          if (active.length > 0)
          {
            requestError(
              `cannot shut down while worker jobs are active: ${active.join(', ')}`
            )
          }
          draining = true
          const result = await status()
          beginDrain()
          return result
        })
      case 'start_worker':
        return await lifecycle(async () =>
        {
          if (draining)
          {
            throw new DaemonRequestError(
              'worker-broker daemon is draining and cannot start new workers',
              'draining'
            )
          }
          return await manager.start(params as unknown as StartWorkerRequest)
        })
      case 'edit_serialization':
        return manager.editSerialization(requireString(params, 'job_id'))
      case 'list_workers':
        return await listWorkers(manager, params)
      case 'get_worker_status':
      case 'get_worker_result':
        return await knownJob(manager, requireString(params, 'job_id'))
      case 'get_worker_artifact':
        return await workerArtifact(manager, params)
      case 'get_run_status':
        return await runStatus(manager, requireString(params, 'run'))
      case 'wait_for_workers':
        return await waitForWorkers(manager, params)
      case 'cancel_worker':
      {
        const jobId = requireString(params, 'job_id')
        await knownJob(manager, jobId)
        return await manager.cancel(jobId)
      }
      default:
      {
        const method: never = frame.method
        return method
      }
    }
  }

  const handleRequest = async (
    connection: DaemonConnection,
    frame: DaemonRequestFrame
  ): Promise<void> =>
  {
    try
    {
      const result = await dispatch(
        frame,
        frame.params as Record<string, unknown>
      )
      writeResponse(connection.socket, { id: frame.id, ok: true, result })
    }
    catch (error)
    {
      writeResponse(connection.socket, {
        id: frame.id,
        ok: false,
        error: responseError(error),
      })
    }
  }

  const handleHello = async (
    connection: DaemonConnection,
    frame: DaemonRequestFrame
  ): Promise<void> =>
  {
    if (frame.method !== 'hello')
    {
      rejectHandshake(connection, frame.id, {
        message: 'hello must be the first request frame',
        code: 'invalid_request',
      })
      return
    }
    const params = frame.params as Record<string, unknown>
    if (
      typeof params.protocol_version !== 'number' ||
      params.protocol_version !== DAEMON_PROTOCOL_VERSION
    )
    {
      rejectHandshake(connection, frame.id, {
        message: `daemon protocol mismatch: client ${String(params.protocol_version)}, daemon ${DAEMON_PROTOCOL_VERSION}`,
        code: 'protocol_mismatch',
      })
      return
    }
    if (typeof params.build_id !== 'string')
    {
      rejectHandshake(connection, frame.id, {
        message: 'hello build_id must be a string',
        code: 'invalid_request',
      })
      return
    }
    await ready
    if (connection.handshake === 'rejected') return
    connection.handshake = 'complete'
    writeResponse(connection.socket, {
      id: frame.id,
      ok: true,
      result: identity,
    })
    for (const pending of connection.pending.splice(0))
    {
      void handleRequest(connection, pending)
    }
  }

  const accept = (socket: Socket): void =>
  {
    connections.add(socket)
    const connection: DaemonConnection = {
      socket,
      buffer: '',
      handshake: 'pending',
      pending: [],
    }
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) =>
    {
      connection.buffer += chunk
      while (true)
      {
        const newline = connection.buffer.indexOf('\n')
        if (newline < 0) break
        const line = connection.buffer.slice(0, newline)
        connection.buffer = connection.buffer.slice(newline + 1)
        let frame: DaemonRequestFrame
        try
        {
          frame = parseFrame(line)
        }
        catch (error)
        {
          if (connection.handshake !== 'complete')
          {
            rejectHandshake(connection, -1, responseError(error))
          }
          else
          {
            writeResponse(socket, {
              id: -1,
              ok: false,
              error: responseError(error),
            })
          }
          continue
        }
        if (connection.handshake === 'pending')
        {
          connection.handshake = 'processing'
          void handleHello(connection, frame)
        }
        else if (connection.handshake === 'processing')
        {
          connection.pending.push(frame)
        }
        else if (connection.handshake === 'complete')
        {
          void handleRequest(connection, frame)
        }
      }
    })
    socket.once('close', () => connections.delete(socket))
    socket.on('error', () => undefined)
  }

  const signalHandler = (): void =>
  {
    void close().catch((error: unknown) =>
    {
      process.stderr.write(`${errorMessage(error)}\n`)
      process.exitCode = 1
    })
  }

  server = await bindSocket(socketPath, accept)
  try
  {
    await writePrivateFile(
      identityPath,
      `${JSON.stringify(identity, null, 2)}\n`
    )
    await manager.initialize()
    markReady()
  }
  catch (error)
  {
    await closeServer(server, connections).catch(() => undefined)
    await Promise.all([
      rm(socketPath, { force: true }),
      rm(identityPath, { force: true }),
    ])
    throw error
  }

  process.once('SIGINT', signalHandler)
  process.once('SIGTERM', signalHandler)
  return { close }
}

async function main(): Promise<void>
{
  await startDaemon(defaultBrokerConfig())
}

const entryPath = process.argv[1]
if (
  entryPath !== undefined &&
  path.resolve(entryPath) === fileURLToPath(import.meta.url)
)
{
  main().catch((error: unknown) =>
  {
    process.stderr.write(`${errorMessage(error)}\n`)
    process.exitCode = 1
  })
}
