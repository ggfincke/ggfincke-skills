// tools/worker-broker/tests/daemon-frontends.test.ts
// verify CLI parsing, daemon routing, wait looping, output, & client cleanup

import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import type {
  BrokerConfig,
  StartWorkerRequest,
  WorkerJob,
  WorkerResult,
  WorkerStatus,
} from '../src/contracts.js'
import { parseCli, runCli, type CliDependencies } from '../src/cli.js'
import type {
  DaemonClient,
  DaemonIdentity,
  DaemonMethod,
  DaemonMethods,
  DaemonStatusResult,
} from '../src/daemon/protocol.js'

interface CallRecord
{
  method: DaemonMethod
  params: unknown
}

const IDENTITY: DaemonIdentity = {
  pid: 123,
  build_id: 'test-build',
  protocol_version: 1,
  state_schema_version: 1,
  started_at: '2026-08-01T00:00:00.000Z',
  socket_path: '/tmp/worker-broker/daemon.sock',
  state_dir: '/tmp/worker-broker',
}

class StubDaemonClient implements DaemonClient
{
  readonly calls: CallRecord[] = []
  closeCount = 0
  private readonly responses = new Map<DaemonMethod, unknown[]>()

  identity(): DaemonIdentity
  {
    return IDENTITY
  }

  enqueue<M extends DaemonMethod>(
    method: M,
    result: DaemonMethods[M]['result']
  ): void
  {
    const responses = this.responses.get(method) ?? []
    responses.push(result)
    this.responses.set(method, responses)
  }

  async call<M extends DaemonMethod>(
    method: M,
    params: DaemonMethods[M]['params']
  ): Promise<DaemonMethods[M]['result']>
  {
    this.calls.push({ method, params })
    const response = this.responses.get(method)?.shift()
    assert.notEqual(response, undefined, `missing response for ${method}`)
    return response as DaemonMethods[M]['result']
  }

  async close(): Promise<void>
  {
    this.closeCount += 1
  }
}

function workerResult(jobId: string): WorkerResult
{
  return {
    job_id: jobId,
    status: 'completed',
    provider: 'codex',
    mode: 'edit',
    repo: '/repo',
    base_ref: 'HEAD',
    base_sha: 'base-sha',
    assumptions: [],
    risks: [],
    follow_ups: [],
    changed_files: ['src/result.ts'],
    changes: [{ status: 'M', paths: ['src/result.ts'] }],
    setup: [],
    verification: [],
    scope_violations: [],
    event_log_path: '/job/events.jsonl',
    stderr_path: '/job/provider.stderr.log',
    model_result_path: '/job/model-result.json',
    process_exit_code: 0,
    process_signal: null,
    created_at: '2026-08-01T00:00:00.000Z',
    started_at: '2026-08-01T00:00:01.000Z',
    completed_at: '2026-08-01T00:00:02.000Z',
  }
}

function worker(jobId: string, status: WorkerStatus): WorkerJob
{
  const job: WorkerJob = {
    job_id: jobId,
    status,
    request: {
      provider: 'codex',
      mode: 'edit',
      repo: '/repo',
      base_ref: 'HEAD',
      task: 'CLI fixture',
      allowed_paths: ['src'],
      acceptance_criteria: [],
      setup_commands: [],
      verification_commands: [],
      depends_on: [],
      allow_nested_agents: false,
    },
    base_sha: 'base-sha',
    created_at: '2026-08-01T00:00:00.000Z',
  }
  if (status === 'completed') job.result = workerResult(jobId)
  return job
}

function status(
  activeJobs: string[] = [],
  draining = false
): DaemonStatusResult
{
  return {
    identity: IDENTITY,
    active_jobs: activeJobs,
    queued_jobs: [],
    draining,
  }
}

function dependencies(
  client: StubDaemonClient,
  output: string[],
  configs: BrokerConfig[],
  request: StartWorkerRequest = {
    provider: 'codex',
    mode: 'edit',
    repo: '/repo',
    task: 'CLI fixture',
    allowed_paths: ['src'],
  }
): CliDependencies
{
  return {
    connect: async (config) =>
    {
      configs.push(config)
      return client
    },
    writeStdout: (value) => output.push(value),
    readRequest: async () => request,
  }
}

test('CLI parses daemon status and stop options', () =>
{
  assert.deepEqual(
    parseCli([
      'daemon',
      'stop',
      '--when-idle',
      '--state-dir',
      './state',
      '--pretty',
    ]),
    {
      command: 'daemon',
      positionals: ['stop'],
      state_dir: './state',
      pretty: true,
      when_idle: true,
    }
  )
  assert.deepEqual(parseCli(['daemon', 'status']), {
    command: 'daemon',
    positionals: ['status'],
    pretty: false,
    when_idle: false,
  })
})

test('CLI daemon commands route arguments and report active-job refusal', async () =>
{
  const statusClient = new StubDaemonClient()
  const daemonStatus = status()
  statusClient.enqueue('daemon_status', daemonStatus)
  const statusOutput: string[] = []
  const statusConfigs: BrokerConfig[] = []
  const statusExit = await runCli(
    ['daemon', 'status', '--state-dir', './daemon-state', '--pretty'],
    dependencies(statusClient, statusOutput, statusConfigs)
  )
  assert.equal(statusExit, 0)
  assert.deepEqual(statusClient.calls, [
    { method: 'daemon_status', params: {} },
  ])
  assert.equal(statusClient.closeCount, 1)
  assert.equal(statusConfigs[0]?.state_dir, path.resolve('./daemon-state'))
  assert.equal(statusOutput[0], `${JSON.stringify(daemonStatus, null, 2)}\n`)

  const stopClient = new StubDaemonClient()
  const busyStatus = status(['active-job'])
  stopClient.enqueue('shutdown', busyStatus)
  const stopOutput: string[] = []
  const stopExit = await runCli(
    ['daemon', 'stop'],
    dependencies(stopClient, stopOutput, [])
  )
  assert.equal(stopExit, 1)
  assert.deepEqual(stopClient.calls, [
    { method: 'shutdown', params: { when_idle: false } },
  ])
  assert.equal(stopOutput[0], `${JSON.stringify(busyStatus)}\n`)
  assert.equal(stopClient.closeCount, 1)

  const drainClient = new StubDaemonClient()
  const drainingStatus = status(['active-job'], true)
  drainClient.enqueue('shutdown', drainingStatus)
  const drainExit = await runCli(
    ['daemon', 'stop', '--when-idle'],
    dependencies(drainClient, [], [])
  )
  assert.equal(drainExit, 0)
  assert.deepEqual(drainClient.calls, [
    { method: 'shutdown', params: { when_idle: true } },
  ])
  assert.equal(drainClient.closeCount, 1)
})

test('CLI run, list, and result are daemon-backed', async () =>
{
  const queued = worker('cli-job', 'queued')
  const completed = worker('cli-job', 'completed')
  const runClient = new StubDaemonClient()
  runClient.enqueue('start_worker', queued)
  runClient.enqueue('wait_for_workers', {
    timed_out: true,
    workers: [queued],
  })
  runClient.enqueue('wait_for_workers', {
    timed_out: false,
    workers: [completed],
  })
  const runOutput: string[] = []
  const exitCode = await runCli(
    ['run', '--request', './request.json'],
    dependencies(runClient, runOutput, [])
  )
  assert.equal(exitCode, 0)
  assert.deepEqual(runClient.calls, [
    {
      method: 'start_worker',
      params: {
        provider: 'codex',
        mode: 'edit',
        repo: '/repo',
        task: 'CLI fixture',
        allowed_paths: ['src'],
      },
    },
    {
      method: 'wait_for_workers',
      params: { job_ids: ['cli-job'], timeout_seconds: 300 },
    },
    {
      method: 'wait_for_workers',
      params: { job_ids: ['cli-job'], timeout_seconds: 300 },
    },
  ])
  assert.equal(runOutput[0], `${JSON.stringify(completed.result)}\n`)
  assert.equal(runClient.closeCount, 1)

  const listClient = new StubDaemonClient()
  listClient.enqueue('list_workers', [completed])
  const listOutput: string[] = []
  await runCli(['list'], dependencies(listClient, listOutput, []))
  assert.deepEqual(listClient.calls, [{ method: 'list_workers', params: {} }])
  assert.equal(listOutput[0], `${JSON.stringify([completed])}\n`)

  const resultClient = new StubDaemonClient()
  resultClient.enqueue('get_worker_result', completed)
  const resultOutput: string[] = []
  await runCli(
    ['result', 'cli-job'],
    dependencies(resultClient, resultOutput, [])
  )
  assert.deepEqual(resultClient.calls, [
    { method: 'get_worker_result', params: { job_id: 'cli-job' } },
  ])
  assert.equal(resultOutput[0], `${JSON.stringify(completed.result)}\n`)
})
