// tools/worker-broker/src/daemon/client.ts
// connect to, multiplex calls over, & reconcile the worker-broker daemon

import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { createConnection, type Socket } from 'node:net'
import { fileURLToPath } from 'node:url'
import type { BrokerConfig } from '../contracts.js'
import {
  DAEMON_PROTOCOL_VERSION,
  daemonSocketPath,
  readBuildId,
  type DaemonClient,
  type DaemonErrorShape,
  type DaemonIdentity,
  type DaemonMethod,
  type DaemonMethods,
  type DaemonResponseFrame,
} from './protocol.js'

export interface ConnectOptions
{
  // spawn a daemon from this client's dist when none is listening
  spawn?: boolean
}

interface PendingCall
{
  resolve(value: unknown): void
  reject(error: Error): void
}

class SocketConnectError extends Error
{
  constructor(socketPath: string, cause: unknown)
  {
    super(
      `failed to connect to daemon socket ${socketPath}: ${errorMessage(cause)}`
    )
    this.name = 'SocketConnectError'
    this.cause = cause
  }
}

class DaemonTransportError extends Error
{
  constructor(message: string, cause?: unknown)
  {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'DaemonTransportError'
  }
}

class SocketDaemonClient implements DaemonClient
{
  private readonly pending = new Map<number, PendingCall>()
  private buffer = ''
  private closed = false
  private nextRequestId = 1
  private daemonIdentity: DaemonIdentity | undefined

  constructor(private readonly socket: Socket)
  {
    socket.on('data', (chunk: Buffer) => this.receive(chunk))
    socket.on('error', (error) =>
      this.fail(
        new DaemonTransportError(`daemon socket error: ${error.message}`, error)
      )
    )
    socket.on('close', () =>
      this.fail(
        new DaemonTransportError(
          'daemon socket closed while requests were pending'
        )
      )
    )
  }

  identity(): DaemonIdentity
  {
    if (this.daemonIdentity === undefined)
    {
      throw new Error('daemon handshake has not completed')
    }
    return this.daemonIdentity
  }

  async handshake(): Promise<void>
  {
    this.daemonIdentity = await this.call('hello', {
      protocol_version: DAEMON_PROTOCOL_VERSION,
      build_id: readBuildId(),
    })
  }

  call<M extends DaemonMethod>(
    method: M,
    params: DaemonMethods[M]['params']
  ): Promise<DaemonMethods[M]['result']>
  {
    if (this.closed)
    {
      return Promise.reject(new Error('daemon client is closed'))
    }

    const id = this.nextRequestId
    this.nextRequestId += 1

    return new Promise<DaemonMethods[M]['result']>((resolve, reject) =>
    {
      this.pending.set(id, {
        resolve: (value) => resolve(value as DaemonMethods[M]['result']),
        reject,
      })
      const frame = `${JSON.stringify({ id, method, params })}\n`
      this.socket.write(frame, (error) =>
      {
        if (error === null || error === undefined) return
        const pending = this.pending.get(id)
        if (pending === undefined) return
        this.pending.delete(id)
        pending.reject(
          new DaemonTransportError(
            `failed to write daemon request ${id}: ${error.message}`,
            error
          )
        )
      })
    })
  }

  async close(): Promise<void>
  {
    if (this.closed) return
    this.closed = true
    this.rejectPending(new Error('daemon client closed'))
    if (this.socket.destroyed) return

    await new Promise<void>((resolve) =>
    {
      this.socket.once('close', resolve)
      this.socket.destroy()
    })
  }

  private receive(chunk: Buffer): void
  {
    this.buffer += chunk.toString('utf8')
    while (true)
    {
      const newline = this.buffer.indexOf('\n')
      if (newline === -1) return
      const line = this.buffer.slice(0, newline).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newline + 1)
      if (line.length === 0) continue

      let frame: unknown
      try
      {
        frame = JSON.parse(line)
      }
      catch (error)
      {
        this.fail(
          new Error(`daemon sent invalid JSON: ${errorMessage(error)}`, {
            cause: error,
          })
        )
        this.socket.destroy()
        return
      }

      if (!isResponseFrame(frame))
      {
        this.fail(new Error('daemon sent an invalid response frame'))
        this.socket.destroy()
        return
      }
      this.resolveFrame(frame)
    }
  }

  private resolveFrame(frame: DaemonResponseFrame): void
  {
    const pending = this.pending.get(frame.id)
    if (pending === undefined) return
    this.pending.delete(frame.id)
    if (frame.ok)
    {
      pending.resolve(frame.result)
      return
    }

    const error = new Error(frame.error.message) as Error & {
      code?: DaemonErrorShape['code']
    }
    if (frame.error.code !== undefined) error.code = frame.error.code
    pending.reject(error)
  }

  private fail(error: Error): void
  {
    if (this.closed) return
    this.closed = true
    this.rejectPending(error)
  }

  private rejectPending(error: Error): void
  {
    const pendingCalls = [...this.pending.values()]
    this.pending.clear()
    for (const pending of pendingCalls) pending.reject(error)
  }
}

function errorMessage(error: unknown): string
{
  return error instanceof Error ? error.message : String(error)
}

function isResponseFrame(value: unknown): value is DaemonResponseFrame
{
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (!Number.isInteger(candidate.id) || typeof candidate.ok !== 'boolean')
  {
    return false
  }
  if (candidate.ok) return 'result' in candidate
  if (typeof candidate.error !== 'object' || candidate.error === null)
  {
    return false
  }
  return (
    typeof (candidate.error as Record<string, unknown>).message === 'string'
  )
}

async function openClient(socketPath: string): Promise<SocketDaemonClient>
{
  return new Promise<SocketDaemonClient>((resolve, reject) =>
  {
    const socket = createConnection(socketPath)
    const onError = (error: Error): void =>
    {
      socket.destroy()
      reject(new SocketConnectError(socketPath, error))
    }
    socket.once('error', onError)
    socket.once('connect', () =>
    {
      socket.off('error', onError)
      resolve(new SocketDaemonClient(socket))
    })
  })
}

async function connectAndHandshake(
  socketPath: string,
  timeoutMilliseconds = 5_000
): Promise<DaemonClient>
{
  const client = await openClient(socketPath)
  let timeout: NodeJS.Timeout | undefined
  try
  {
    await Promise.race([
      client.handshake(),
      new Promise<never>((_resolve, reject) =>
      {
        timeout = setTimeout(
          () =>
            reject(
              new DaemonTransportError(
                `daemon handshake timed out after ${timeoutMilliseconds}ms`
              )
            ),
          timeoutMilliseconds
        )
      }),
    ])
    return client
  }
  catch (error)
  {
    await client.close()
    throw error
  }
  finally
  {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

function daemonEnvironment(config: BrokerConfig): NodeJS.ProcessEnv
{
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    WORKER_BROKER_HOME: config.state_dir,
    WORKER_BROKER_CODEX_BINARY: config.codex_binary,
    WORKER_BROKER_CURSOR_BINARY: config.cursor_binary,
    WORKER_BROKER_CORAL_BINARY: config.coral_binary,
    WORKER_BROKER_CLAUDE_BINARY: config.claude_binary,
  }
  if (config.default_codex_model !== undefined)
  {
    environment.WORKER_BROKER_CODEX_MODEL = config.default_codex_model
  }
  if (config.default_cursor_model !== undefined)
  {
    environment.WORKER_BROKER_CURSOR_MODEL = config.default_cursor_model
  }
  if (config.default_coral_model !== undefined)
  {
    environment.WORKER_BROKER_CORAL_MODEL = config.default_coral_model
  }
  if (config.default_claude_model !== undefined)
  {
    environment.WORKER_BROKER_CLAUDE_MODEL = config.default_claude_model
  }
  if (config.coral_host !== undefined)
  {
    environment.WORKER_BROKER_CORAL_HOST = config.coral_host
  }
  return environment
}

async function spawnDaemon(config: BrokerConfig): Promise<void>
{
  const daemonPath = fileURLToPath(new URL('./daemon.js', import.meta.url))
  await new Promise<void>((resolve, reject) =>
  {
    const child = spawn(process.execPath, [daemonPath], {
      detached: true,
      env: daemonEnvironment(config),
      stdio: 'ignore',
    })
    child.once('error', (error) =>
      reject(
        new Error(`failed to spawn daemon: ${error.message}`, { cause: error })
      )
    )
    child.once('spawn', () =>
    {
      child.unref()
      resolve()
    })
  })
}

function delay(milliseconds: number): Promise<void>
{
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForSocketRemoval(socketPath: string): Promise<void>
{
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline)
  {
    try
    {
      await access(socketPath)
    }
    catch
    {
      return
    }
    await delay(50)
  }
}

function buildMismatchError(message: string): Error & { code: string }
{
  const error = new Error(message) as Error & { code: string }
  error.code = 'build_mismatch'
  return error
}

function isConnectionFailure(error: unknown): boolean
{
  return (
    error instanceof SocketConnectError || error instanceof DaemonTransportError
  )
}

// * pinned entry point: frontends compile against this signature
export async function connectDaemon(
  config: BrokerConfig,
  options: ConnectOptions = {}
): Promise<DaemonClient>
{
  const socketPath = daemonSocketPath(config.state_dir)
  try
  {
    return await connectAndHandshake(socketPath)
  }
  catch (error)
  {
    if (!isConnectionFailure(error) || options.spawn !== true)
    {
      throw error
    }
  }

  await spawnDaemon(config)
  const deadline = Date.now() + 5_000
  let lastError: unknown
  while (Date.now() < deadline)
  {
    await delay(250)
    try
    {
      return await connectAndHandshake(
        socketPath,
        Math.max(1, deadline - Date.now())
      )
    }
    catch (error)
    {
      if (!isConnectionFailure(error)) throw error
      lastError = error
    }
  }

  throw new Error(
    `daemon did not become ready at ${socketPath} within 5 seconds: ${errorMessage(lastError)}`,
    { cause: lastError }
  )
}

// spawn when needed and reconcile a build mismatch by draining an idle stale daemon
export async function ensureDaemonClient(
  config: BrokerConfig
): Promise<DaemonClient>
{
  const expectedBuildId = readBuildId()
  const socketPath = daemonSocketPath(config.state_dir)
  let client = await connectDaemon(config, { spawn: true })

  for (let restartAttempt = 0; restartAttempt <= 3; restartAttempt += 1)
  {
    const identity = client.identity()
    if (identity.build_id === expectedBuildId) return client

    const status = await client.call('daemon_status', {})
    const busyJobs = [...status.active_jobs, ...status.queued_jobs]
    if (busyJobs.length > 0)
    {
      await client.close()
      throw buildMismatchError(
        `daemon build ${identity.build_id} differs from client build ${expectedBuildId}; active or queued jobs: ${busyJobs.join(', ')}`
      )
    }

    if (restartAttempt === 3)
    {
      await client.close()
      throw buildMismatchError(
        `daemon build remained ${identity.build_id} after 3 restart attempts; expected ${expectedBuildId}`
      )
    }

    await client.call('shutdown', { when_idle: true })
    await client.close()
    await waitForSocketRemoval(socketPath)
    client = await connectDaemon(config, { spawn: true })
  }

  throw new Error('unreachable daemon restart state')
}
