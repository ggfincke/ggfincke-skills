// tools/worker-broker/tests/daemon-core.test.ts
// exercise daemon locking, handshake, shutdown, schema, & failure taxonomy

import assert from 'node:assert/strict'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { createConnection, type Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { BrokerConfig, WorkerJob } from '../src/contracts.js'
import { startDaemon } from '../src/daemon/daemon.js'
import {
  DAEMON_PROTOCOL_VERSION,
  STATE_SCHEMA_VERSION,
  daemonIdentityPath,
  daemonSocketPath,
  type DaemonRequestFrame,
  type DaemonResponseFrame,
} from '../src/daemon/protocol.js'
import { classifyFailure } from '../src/job-manager.js'
import { JobStore } from '../src/job-store.js'
import { waitUntil } from './helpers.js'

function fixtureConfig(stateDir: string): BrokerConfig
{
  return {
    state_dir: stateDir,
    codex_binary: 'codex',
    cursor_binary: 'cursor-agent',
    coral_binary: 'coral',
    claude_binary: 'claude',
  }
}

async function connect(socketPath: string): Promise<Socket>
{
  const socket = createConnection(socketPath)
  await new Promise<void>((resolve, reject) =>
  {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  return socket
}

async function exchange(
  socket: Socket,
  frames: DaemonRequestFrame[]
): Promise<DaemonResponseFrame[]>
{
  return await new Promise<DaemonResponseFrame[]>((resolve, reject) =>
  {
    let buffer = ''
    const responses: DaemonResponseFrame[] = []
    const cleanup = (): void =>
    {
      socket.off('data', onData)
      socket.off('error', onError)
      socket.off('close', onClose)
    }
    const onData = (chunk: Buffer): void =>
    {
      buffer += chunk.toString('utf8')
      while (true)
      {
        const newline = buffer.indexOf('\n')
        if (newline < 0) break
        responses.push(
          JSON.parse(buffer.slice(0, newline)) as DaemonResponseFrame
        )
        buffer = buffer.slice(newline + 1)
        if (responses.length === frames.length)
        {
          cleanup()
          resolve(responses)
          return
        }
      }
    }
    const onError = (error: Error): void =>
    {
      cleanup()
      reject(error)
    }
    const onClose = (): void =>
    {
      cleanup()
      reject(new Error('daemon connection closed before all responses arrived'))
    }
    socket.on('data', onData)
    socket.once('error', onError)
    socket.once('close', onClose)
    socket.write(`${frames.map((frame) => JSON.stringify(frame)).join('\n')}\n`)
  })
}

function hello(
  id = 1,
  protocolVersion = DAEMON_PROTOCOL_VERSION
): DaemonRequestFrame
{
  return {
    id,
    method: 'hello',
    params: { protocol_version: protocolVersion, build_id: 'test-build' },
  }
}

async function missing(filePath: string): Promise<boolean>
{
  try
  {
    await access(filePath)
    return false
  }
  catch (error)
  {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
    throw error
  }
}

test('daemon answers hello and status over its unix socket', async () =>
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'broker-daemon-'))
  const daemon = await startDaemon(fixtureConfig(stateDir))
  const socket = await connect(daemonSocketPath(stateDir))
  try
  {
    const responses = await exchange(socket, [
      hello(),
      { id: 2, method: 'daemon_status', params: {} },
    ])
    assert.equal(responses[0]?.ok, true)
    const identity = responses[0]?.ok
      ? (responses[0].result as Record<string, unknown>)
      : undefined
    assert.equal(identity?.protocol_version, DAEMON_PROTOCOL_VERSION)
    assert.equal(identity?.state_schema_version, STATE_SCHEMA_VERSION)
    assert.equal(identity?.state_dir, stateDir)
    assert.equal(responses[1]?.ok, true)
    const status = responses[1]?.ok
      ? (responses[1].result as Record<string, unknown>)
      : undefined
    assert.deepEqual(status?.active_jobs, [])
    assert.deepEqual(status?.queued_jobs, [])
    assert.equal(status?.draining, false)
  }
  finally
  {
    socket.destroy()
    await daemon.close()
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('daemon rejects a mismatched protocol during hello', async () =>
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'broker-daemon-'))
  const daemon = await startDaemon(fixtureConfig(stateDir))
  const socket = await connect(daemonSocketPath(stateDir))
  try
  {
    const [response] = await exchange(socket, [
      hello(1, DAEMON_PROTOCOL_VERSION + 1),
    ])
    assert.equal(response?.ok, false)
    if (response?.ok === false)
    {
      assert.equal(response.error.code, 'protocol_mismatch')
    }
  }
  finally
  {
    socket.destroy()
    await daemon.close()
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('daemon reclaims a stale socket file', async () =>
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'broker-daemon-'))
  const socketPath = daemonSocketPath(stateDir)
  await writeFile(socketPath, 'stale\n')
  const daemon = await startDaemon(fixtureConfig(stateDir))
  try
  {
    const socket = await connect(socketPath)
    const [response] = await exchange(socket, [hello()])
    assert.equal(response?.ok, true)
    socket.destroy()
  }
  finally
  {
    await daemon.close()
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('idle draining shutdown removes the socket and identity', async () =>
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'broker-daemon-'))
  const socketPath = daemonSocketPath(stateDir)
  const identityPath = daemonIdentityPath(stateDir)
  const daemon = await startDaemon(fixtureConfig(stateDir))
  const socket = await connect(socketPath)
  try
  {
    await exchange(socket, [hello()])
    const [response] = await exchange(socket, [
      { id: 2, method: 'shutdown', params: { when_idle: true } },
    ])
    assert.equal(response?.ok, true)
    const status = response?.ok
      ? (response.result as Record<string, unknown>)
      : undefined
    assert.equal(status?.draining, true)
    await waitUntil(
      async () => (await missing(socketPath)) && (await missing(identityPath))
    )
  }
  finally
  {
    socket.destroy()
    await daemon.close()
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('job store stamps records and rejects a newer schema version', async () =>
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'broker-store-'))
  const store = new JobStore(stateDir)
  const jobId = 'schema-fixture'
  const job: WorkerJob = {
    job_id: jobId,
    status: 'queued',
    request: {
      provider: 'codex',
      mode: 'read',
      repo: '/tmp/repo',
      base_ref: 'HEAD',
      task: 'schema fixture',
      allowed_paths: [],
      acceptance_criteria: [],
      setup_commands: [],
      verification_commands: [],
      depends_on: [],
      allow_nested_agents: false,
    },
    base_sha: 'abc123',
    created_at: new Date().toISOString(),
  }
  try
  {
    await store.write(job)
    const persisted = JSON.parse(
      await readFile(store.jobPath(jobId), 'utf8')
    ) as Record<string, unknown>
    assert.equal(persisted.state_schema_version, STATE_SCHEMA_VERSION)
    await mkdir(store.jobDir(jobId), { recursive: true })
    await writeFile(
      store.jobPath(jobId),
      `${JSON.stringify({ ...job, state_schema_version: STATE_SCHEMA_VERSION + 1 })}\n`
    )
    await assert.rejects(
      store.read(jobId),
      /state schema version 2.*supports only version 1/
    )
  }
  finally
  {
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('failure classifier covers every broker failure taxonomy class', () =>
{
  assert.equal(classifyFailure('setup'), 'environment')
  assert.equal(classifyFailure('provider'), 'model')
  assert.equal(classifyFailure('restart'), 'broker_fault')
  assert.equal(classifyFailure('broker'), 'broker_fault')
  assert.equal(classifyFailure('scope'), 'scope')
  assert.equal(
    classifyFailure('verification', { exit_code: 126, timed_out: false }),
    'environment'
  )
  assert.equal(
    classifyFailure('verification', { exit_code: 1, timed_out: false }),
    'verification'
  )
  assert.equal(
    classifyFailure('verification', { exit_code: null, timed_out: true }),
    'verification'
  )
})
