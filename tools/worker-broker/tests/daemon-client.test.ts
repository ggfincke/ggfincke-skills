// tools/worker-broker/tests/daemon-client.test.ts
// verify daemon client framing, multiplexing, failures, & build reconciliation

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { BrokerConfig } from '../src/contracts.js'
import { connectDaemon, ensureDaemonClient } from '../src/daemon/client.js'
import {
  DAEMON_PROTOCOL_VERSION,
  STATE_SCHEMA_VERSION,
  daemonSocketPath,
  readBuildId,
  type DaemonIdentity,
} from '../src/daemon/protocol.js'

interface FakeRequest
{
  id: number
  method: string
  params: unknown
}

interface FakeDaemon
{
  server: Server
  close(): Promise<void>
}

type FakeHandler = (
  request: FakeRequest,
  socket: Socket
) => void | Promise<void>

function brokerConfig(stateDir: string): BrokerConfig
{
  return {
    state_dir: stateDir,
    codex_binary: 'codex',
    cursor_binary: 'cursor-agent',
    coral_binary: 'coral',
    claude_binary: 'claude',
  }
}

function identity(stateDir: string, buildId = readBuildId()): DaemonIdentity
{
  return {
    pid: process.pid,
    build_id: buildId,
    protocol_version: DAEMON_PROTOCOL_VERSION,
    state_schema_version: STATE_SCHEMA_VERSION,
    started_at: new Date(0).toISOString(),
    socket_path: daemonSocketPath(stateDir),
    state_dir: stateDir,
  }
}

function reply(socket: Socket, request: FakeRequest, result: unknown): void
{
  socket.write(`${JSON.stringify({ id: request.id, ok: true, result })}\n`)
}

function reject(
  socket: Socket,
  request: FakeRequest,
  message: string,
  code: string
): void
{
  socket.write(
    `${JSON.stringify({
      id: request.id,
      ok: false,
      error: { message, code },
    })}\n`
  )
}

async function startFakeDaemon(
  stateDir: string,
  handler: FakeHandler
): Promise<FakeDaemon>
{
  const sockets = new Set<Socket>()
  const server = createServer((socket) =>
  {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    let buffer = ''
    socket.on('data', (chunk: Buffer) =>
    {
      buffer += chunk.toString('utf8')
      while (true)
      {
        const newline = buffer.indexOf('\n')
        if (newline === -1) return
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line.length === 0) continue
        const request = JSON.parse(line) as FakeRequest
        void handler(request, socket)
      }
    })
  })

  await new Promise<void>((resolve, rejectListen) =>
  {
    server.once('error', rejectListen)
    server.listen(daemonSocketPath(stateDir), () =>
    {
      server.off('error', rejectListen)
      resolve()
    })
  })

  return {
    server,
    async close(): Promise<void>
    {
      for (const socket of sockets) socket.destroy()
      if (!server.listening) return
      await new Promise<void>((resolve, rejectClose) =>
      {
        server.close((error) =>
        {
          if (error === undefined) resolve()
          else rejectClose(error)
        })
      })
    },
  }
}

test('handshake succeeds and protocol rejection preserves its code', async () =>
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'broker-client-'))
  let helloParams: unknown
  const currentIdentity = identity(stateDir)
  const daemon = await startFakeDaemon(stateDir, (request, socket) =>
  {
    helloParams = request.params
    reply(socket, request, currentIdentity)
  })

  try
  {
    const client = await connectDaemon(brokerConfig(stateDir))
    assert.deepEqual(helloParams, {
      protocol_version: DAEMON_PROTOCOL_VERSION,
      build_id: readBuildId(),
    })
    assert.deepEqual(client.identity(), currentIdentity)
    await client.close()
    await client.close()
  }
  finally
  {
    await daemon.close()
    await rm(stateDir, { recursive: true, force: true })
  }

  const rejectedStateDir = await mkdtemp(
    path.join(os.tmpdir(), 'broker-client-reject-')
  )
  const rejectedDaemon = await startFakeDaemon(
    rejectedStateDir,
    (request, socket) =>
      reject(socket, request, 'unsupported protocol', 'protocol_mismatch')
  )
  try
  {
    await assert.rejects(
      connectDaemon(brokerConfig(rejectedStateDir)),
      (error: Error & { code?: string }) =>
      {
        assert.equal(error.message, 'unsupported protocol')
        assert.equal(error.code, 'protocol_mismatch')
        return true
      }
    )
  }
  finally
  {
    await rejectedDaemon.close()
    await rm(rejectedStateDir, { recursive: true, force: true })
  }
})

test('request ids multiplex out-of-order responses independently', async () =>
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'broker-client-ids-'))
  const currentIdentity = identity(stateDir)
  let waitingRequest: FakeRequest | undefined
  let waitingSocket: Socket | undefined
  const daemon = await startFakeDaemon(stateDir, (request, socket) =>
  {
    if (request.method === 'hello')
    {
      reply(socket, request, currentIdentity)
      return
    }
    if (request.method === 'wait_for_workers')
    {
      waitingRequest = request
      waitingSocket = socket
      return
    }
    assert.equal(request.method, 'daemon_status')
    reply(socket, request, {
      identity: currentIdentity,
      active_jobs: [],
      queued_jobs: [],
      draining: false,
    })
    assert.ok(waitingRequest)
    assert.ok(waitingSocket)
    reply(waitingSocket, waitingRequest, { timed_out: false, workers: [] })
  })

  try
  {
    const client = await connectDaemon(brokerConfig(stateDir))
    const completionOrder: string[] = []
    const wait = client
      .call('wait_for_workers', { timeout_seconds: 5 })
      .then((result) =>
      {
        completionOrder.push('wait')
        return result
      })
    const status = client.call('daemon_status', {}).then((result) =>
    {
      completionOrder.push('status')
      return result
    })

    assert.equal((await status).identity.build_id, readBuildId())
    assert.deepEqual(await wait, { timed_out: false, workers: [] })
    assert.deepEqual(completionOrder, ['status', 'wait'])
    await client.close()
  }
  finally
  {
    await daemon.close()
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('daemon error frames surface as coded Error instances', async () =>
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'broker-client-error-'))
  const daemon = await startFakeDaemon(stateDir, (request, socket) =>
  {
    if (request.method === 'hello') reply(socket, request, identity(stateDir))
    else reject(socket, request, 'missing worker', 'unknown_job')
  })

  try
  {
    const client = await connectDaemon(brokerConfig(stateDir))
    await assert.rejects(
      client.call('get_worker_status', { job_id: 'missing' }),
      (error: Error & { code?: string }) =>
      {
        assert.ok(error instanceof Error)
        assert.equal(error.message, 'missing worker')
        assert.equal(error.code, 'unknown_job')
        return true
      }
    )
    await client.close()
  }
  finally
  {
    await daemon.close()
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('socket drop rejects every pending request', async () =>
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'broker-client-drop-'))
  const daemon = await startFakeDaemon(stateDir, (request, socket) =>
  {
    if (request.method === 'hello')
    {
      reply(socket, request, identity(stateDir))
      return
    }
    socket.destroy()
  })

  try
  {
    const client = await connectDaemon(brokerConfig(stateDir))
    const first = client.call('wait_for_workers', { timeout_seconds: 5 })
    const second = client.call('daemon_status', {})
    const results = await Promise.allSettled([first, second])
    for (const result of results)
    {
      assert.equal(result.status, 'rejected')
      assert.match(
        String((result as PromiseRejectedResult).reason),
        /daemon socket (closed|error)/
      )
    }
    await client.close()
  }
  finally
  {
    await daemon.close()
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('ensureDaemonClient drains an idle stale daemon and reconnects', async () =>
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'broker-client-drain-'))
  const freshStateDir = await mkdtemp(
    path.join(os.tmpdir(), 'broker-client-fresh-')
  )
  const staleIdentity = identity(stateDir, 'stale-build')
  const freshIdentity = identity(freshStateDir)
  const config = brokerConfig(stateDir)
  let staleDaemon: FakeDaemon
  let shutdownRequested = false
  const freshDaemon = await startFakeDaemon(
    freshStateDir,
    (request, socket) =>
    {
      assert.equal(request.method, 'hello')
      reply(socket, request, freshIdentity)
    }
  )

  staleDaemon = await startFakeDaemon(stateDir, (request, socket) =>
  {
    if (request.method === 'hello')
    {
      reply(socket, request, staleIdentity)
      return
    }
    if (request.method === 'daemon_status')
    {
      reply(socket, request, {
        identity: staleIdentity,
        active_jobs: [],
        queued_jobs: [],
        draining: false,
      })
      return
    }
    assert.equal(request.method, 'shutdown')
    assert.deepEqual(request.params, { when_idle: true })
    shutdownRequested = true
    config.state_dir = freshStateDir
    reply(socket, request, {
      identity: staleIdentity,
      active_jobs: [],
      queued_jobs: [],
      draining: true,
    })
    staleDaemon.server.close()
  })

  try
  {
    const client = await ensureDaemonClient(config)
    assert.equal(shutdownRequested, true)
    assert.equal(client.identity().build_id, readBuildId())
    await client.close()
  }
  finally
  {
    await staleDaemon.close()
    await freshDaemon.close()
    await rm(stateDir, { recursive: true, force: true })
    await rm(freshStateDir, { recursive: true, force: true })
  }
})

test('ensureDaemonClient refuses to stop a busy stale daemon', async () =>
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'broker-client-busy-'))
  const staleIdentity = identity(stateDir, 'stale-build')
  let shutdownRequested = false
  const daemon = await startFakeDaemon(stateDir, (request, socket) =>
  {
    if (request.method === 'hello')
    {
      reply(socket, request, staleIdentity)
      return
    }
    if (request.method === 'daemon_status')
    {
      reply(socket, request, {
        identity: staleIdentity,
        active_jobs: ['job-active'],
        queued_jobs: ['job-queued'],
        draining: false,
      })
      return
    }
    shutdownRequested = true
  })

  try
  {
    await assert.rejects(
      ensureDaemonClient(brokerConfig(stateDir)),
      (error: Error & { code?: string }) =>
      {
        assert.equal(error.code, 'build_mismatch')
        assert.match(error.message, /job-active/)
        assert.match(error.message, /job-queued/)
        return true
      }
    )
    assert.equal(shutdownRequested, false)
  }
  finally
  {
    await daemon.close()
    await rm(stateDir, { recursive: true, force: true })
  }
})
