// tools/worker-broker/tests/daemon-core.test.ts
// exercise daemon locking, handshake, shutdown, schema, & failure taxonomy

import assert from 'node:assert/strict'
import {
  access,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
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
  daemonIdentityPath,
  daemonSocketPath,
  type DaemonRequestFrame,
  type DaemonResponseFrame,
} from '../src/daemon/protocol.js'
import { STATE_SCHEMA_VERSION } from '../src/job-store.js'
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
    assert.equal(DAEMON_PROTOCOL_VERSION, 3)
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

test('daemon rejects a result read before the worker is terminal', async () =>
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'broker-daemon-'))
  const jobId = 'queued-result-fixture'
  const store = new JobStore(stateDir)
  await store.write({
    job_id: jobId,
    status: 'queued',
    request: {
      provider: 'codex',
      mode: 'read',
      repo: '/tmp/repo',
      base_ref: 'HEAD',
      task: 'remain queued while result access is checked',
      allowed_paths: [],
      acceptance_criteria: [],
      setup_commands: [],
      verification_commands: [],
      depends_on: [jobId],
      allow_nested_agents: false,
    },
    base_sha: 'base-sha',
    created_at: new Date().toISOString(),
  })
  const daemon = await startDaemon(fixtureConfig(stateDir))
  const socket = await connect(daemonSocketPath(stateDir))
  try
  {
    await exchange(socket, [hello()])
    const [result] = await exchange(socket, [
      {
        id: 2,
        method: 'get_worker_result',
        params: { job_id: jobId },
      },
    ])
    assert.equal(result?.ok, false)
    if (result?.ok === false)
    {
      assert.equal(result.error.code, 'invalid_request')
      assert.match(result.error.message, /no terminal result yet/u)
    }
  }
  finally
  {
    socket.destroy()
    await daemon.close()
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('daemon range reads a sparse artifact without corrupting UTF-8 edges', async () =>
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'broker-daemon-'))
  const jobId = 'sparse-artifact-fixture'
  const byteLength = 96 * 1024 * 1024
  const store = new JobStore(stateDir)
  await store.write({
    job_id: jobId,
    status: 'queued',
    request: {
      provider: 'codex',
      mode: 'read',
      repo: '/tmp/repo',
      base_ref: 'HEAD',
      task: 'remain queued while sparse artifact excerpts are checked',
      allowed_paths: [],
      acceptance_criteria: [],
      setup_commands: [],
      verification_commands: [],
      depends_on: [jobId],
      allow_nested_agents: false,
    },
    base_sha: 'base-sha',
    created_at: new Date().toISOString(),
  })
  const artifact = await open(
    path.join(store.jobDir(jobId), 'activity.jsonl'),
    'w',
    0o600
  )
  try
  {
    const head = Buffer.from('A😀')
    const tail = Buffer.from('😀Z')
    await artifact.write(head, 0, head.length, 0)
    await artifact.write(tail, 0, tail.length, byteLength - tail.length)
  }
  finally
  {
    await artifact.close()
  }

  const daemon = await startDaemon(fixtureConfig(stateDir))
  const socket = await connect(daemonSocketPath(stateDir))
  try
  {
    await exchange(socket, [hello()])
    const responses = await exchange(socket, [
      {
        id: 2,
        method: 'get_worker_artifact',
        params: { job_id: jobId, artifact: 'activity', max_bytes: 4 },
      },
      {
        id: 3,
        method: 'get_worker_artifact',
        params: {
          job_id: jobId,
          artifact: 'activity',
          max_bytes: 4,
          tail: true,
        },
      },
    ])
    for (const response of responses) assert.equal(response.ok, true)
    const responsesById = new Map(
      responses.map((response) => [response.id, response])
    )
    const headResponse = responsesById.get(2)
    const tailResponse = responsesById.get(3)
    const head = headResponse?.ok
      ? (headResponse.result as Record<string, unknown>)
      : undefined
    const tail = tailResponse?.ok
      ? (tailResponse.result as Record<string, unknown>)
      : undefined
    assert.deepEqual(head, {
      job_id: jobId,
      artifact: 'activity',
      content: 'A',
      truncated: true,
      byte_length: byteLength,
    })
    assert.deepEqual(tail, {
      job_id: jobId,
      artifact: 'activity',
      content: 'Z',
      truncated: true,
      byte_length: byteLength,
    })
    assert.doesNotMatch(String(head?.content), /�/u)
    assert.doesNotMatch(String(tail?.content), /�/u)
  }
  finally
  {
    socket.destroy()
    await daemon.close()
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('daemon classifies assignment validation without masking repo failure', async () =>
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'broker-daemon-'))
  const daemon = await startDaemon(fixtureConfig(stateDir))
  const socket = await connect(daemonSocketPath(stateDir))
  try
  {
    await exchange(socket, [hello()])
    const invalidAssignments: Array<{
      params: Record<string, unknown>
      message: RegExp
    }> = [
      {
        params: {
          provider: 'codex',
          mode: 'read',
          repo: '/repo',
          task: 'malformed assignment',
          allowed_paths: [],
          allow_nested_agents: 'yes',
        },
        message: /expected boolean/iu,
      },
      {
        params: {
          provider: 'codex',
          mode: 'edit',
          repo: '/repo',
          task: 'empty edit scope',
          allowed_paths: [],
        },
        message: /edit workers require at least one allowed path prefix/iu,
      },
      {
        params: {
          provider: 'codex',
          mode: 'edit',
          repo: '/repo',
          task: 'traversal edit scope',
          allowed_paths: ['../outside'],
        },
        message: /allowed path is not normalized/iu,
      },
    ]
    let requestId = 2
    for (const assignment of invalidAssignments)
    {
      const [rejected] = await exchange(socket, [
        {
          id: requestId,
          method: 'start_worker',
          params: assignment.params,
        } as unknown as DaemonRequestFrame,
      ])
      requestId += 1
      assert.equal(rejected?.ok, false)
      if (rejected?.ok === false)
      {
        assert.equal(rejected.error.code, 'invalid_request')
        assert.match(rejected.error.message, assignment.message)
      }
    }

    const [operational] = await exchange(socket, [
      {
        id: requestId,
        method: 'start_worker',
        params: {
          provider: 'codex',
          mode: 'read',
          repo: path.join(stateDir, 'missing-repo'),
          task: 'valid assignment for a missing repository',
          allowed_paths: [],
        },
      },
    ])
    requestId += 1
    assert.equal(operational?.ok, false)
    if (operational?.ok === false)
    {
      assert.equal(operational.error.code, undefined)
      assert.match(operational.error.message, /spawn git ENOENT/u)
    }
    const [listed] = await exchange(socket, [
      { id: requestId, method: 'list_workers', params: {} },
    ])
    assert.equal(listed?.ok, true)
    if (listed?.ok === true) assert.deepEqual(listed.result, [])
  }
  finally
  {
    socket.destroy()
    await daemon.close()
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('protocol 3 daemon rejects a protocol 2 hello', async () =>
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'broker-daemon-'))
  const daemon = await startDaemon(fixtureConfig(stateDir))
  const socket = await connect(daemonSocketPath(stateDir))
  try
  {
    const [response] = await exchange(socket, [hello(1, 2)])
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

test('job store normalizes old state only in memory and never rewrites records', async () =>
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'broker-store-'))
  const store = new JobStore(stateDir)
  const current: WorkerJob = {
    job_id: 'current-schema-fixture',
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
    await store.write(current)
    const persisted = JSON.parse(
      await readFile(store.jobPath(current.job_id), 'utf8')
    ) as Record<string, unknown>
    assert.equal(persisted.state_schema_version, STATE_SCHEMA_VERSION)

    const old = structuredClone(current) as WorkerJob
    old.job_id = 'old-schema-fixture'
    const oldRequest = old.request as Partial<WorkerJob['request']>
    delete oldRequest.acceptance_criteria
    delete oldRequest.setup_commands
    delete oldRequest.verification_commands
    delete oldRequest.depends_on
    await mkdir(store.jobDir(old.job_id), { recursive: true })
    await writeFile(store.jobPath(old.job_id), `${JSON.stringify(old)}\n`)

    const newer = structuredClone(current)
    newer.job_id = 'newer-schema-fixture'
    await mkdir(store.jobDir(newer.job_id), { recursive: true })
    await writeFile(
      store.jobPath(newer.job_id),
      `${JSON.stringify({
        ...newer,
        state_schema_version: STATE_SCHEMA_VERSION + 1,
      })}\n`
    )

    for (const jobId of [current.job_id, old.job_id, newer.job_id])
    {
      const file = store.jobPath(jobId)
      const beforeBytes = await readFile(file)
      const beforeStat = await stat(file, { bigint: true })
      if (jobId === newer.job_id)
      {
        await assert.rejects(
          store.read(jobId),
          /state schema version 2.*supports only version 1/
        )
      }
      else
      {
        const read = await store.read(jobId)
        assert.deepEqual(read.request.acceptance_criteria, [])
        assert.deepEqual(read.request.setup_commands, [])
        assert.deepEqual(read.request.verification_commands, [])
        assert.deepEqual(read.request.depends_on, [])
      }
      const afterStat = await stat(file, { bigint: true })
      assert.deepEqual(await readFile(file), beforeBytes)
      assert.equal(afterStat.mtimeNs, beforeStat.mtimeNs)
      assert.equal(afterStat.size, beforeStat.size)
      assert.equal(afterStat.ino, beforeStat.ino)
    }
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
