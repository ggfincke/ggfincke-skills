// tools/worker-broker/tests/daemon-frontends.test.ts
// verify CLI parsing, daemon routing, wait looping, output, & client cleanup

import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import type {
  BrokerConfig,
  WorkerJob,
  WorkerResult,
  WorkerStatus,
  WorkerSummary,
} from '../src/contracts.js'
import { parseCli, runCli, type CliDependencies } from '../src/cli.js'
import {
  DAEMON_PROTOCOL_VERSION,
  type DaemonClient,
  type DaemonIdentity,
  type DaemonMethod,
  type DaemonMethods,
  type DaemonStatusResult,
} from '../src/daemon/protocol.js'
import { STATE_SCHEMA_VERSION } from '../src/job-store.js'
import { summarizeWorkerJob } from '../src/worker-summary.js'

interface CallRecord
{
  method: DaemonMethod
  params: unknown
}

const IDENTITY: DaemonIdentity = {
  pid: 123,
  build_id: 'test-build',
  protocol_version: DAEMON_PROTOCOL_VERSION,
  state_schema_version: STATE_SCHEMA_VERSION,
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
  if (status !== 'queued' && status !== 'running')
  {
    job.completed_at = '2026-08-01T00:00:02.000Z'
    job.result = { ...workerResult(jobId), status }
    if (status !== 'completed')
    {
      job.result.error = `${status} fixture`
      job.result.failure_class = 'model'
    }
  }
  return job
}

function workerSummary(jobId: string, status: WorkerStatus): WorkerSummary
{
  return summarizeWorkerJob(worker(jobId, status))
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
  request: unknown = {
    provider: 'codex',
    mode: 'edit',
    repo: '/repo',
    task: 'CLI fixture',
    allowed_paths: ['src'],
  },
  errors: string[] = []
): CliDependencies
{
  return {
    connect: async (config) =>
    {
      configs.push(config)
      return client
    },
    connectExisting: async (config) =>
    {
      configs.push(config)
      return client
    },
    writeStdout: (value) => output.push(value),
    writeStderr: (value) => errors.push(value),
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
  const queued = workerSummary('cli-job', 'queued')
  const completedJob = worker('cli-job', 'completed')
  const completed = summarizeWorkerJob(completedJob)
  const runClient = new StubDaemonClient()
  runClient.enqueue('start_worker', {
    worker: queued,
    serializes_behind: [],
  })
  runClient.enqueue('wait_for_workers', {
    timed_out: true,
    workers: [queued],
    pending: [],
  })
  runClient.enqueue('wait_for_workers', {
    timed_out: false,
    workers: [completed],
    pending: [],
  })
  runClient.enqueue('get_worker_result', completedJob)
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
      params: { job_ids: ['cli-job'], timeout_seconds: 900 },
    },
    {
      method: 'wait_for_workers',
      params: { job_ids: ['cli-job'], timeout_seconds: 900 },
    },
    {
      method: 'get_worker_result',
      params: { job_id: 'cli-job' },
    },
  ])
  assert.equal(runOutput[0], `${JSON.stringify(completedJob.result)}\n`)
  assert.equal(runClient.closeCount, 1)

  const listClient = new StubDaemonClient()
  listClient.enqueue('list_workers', [completed])
  const listOutput: string[] = []
  await runCli(['list'], dependencies(listClient, listOutput, []))
  assert.deepEqual(listClient.calls, [{ method: 'list_workers', params: {} }])
  assert.equal(listOutput[0], `${JSON.stringify([completed])}\n`)

  const resultClient = new StubDaemonClient()
  resultClient.enqueue('get_worker_result', completedJob)
  const resultOutput: string[] = []
  await runCli(
    ['result', 'cli-job'],
    dependencies(resultClient, resultOutput, [])
  )
  assert.deepEqual(resultClient.calls, [
    { method: 'get_worker_result', params: { job_id: 'cli-job' } },
  ])
  assert.equal(resultOutput[0], `${JSON.stringify(completedJob.result)}\n`)
})

test('CLI rejects a malformed request without starting a worker', async () =>
{
  const client = new StubDaemonClient()
  const errors: string[] = []
  const configs: BrokerConfig[] = []
  assert.equal(
    await runCli(
      ['run', '--request', './request.json'],
      dependencies(
        client,
        [],
        configs,
        {
          provider: 'codex',
          mode: 'read',
          repo: '/repo',
          task: 'malformed CLI assignment',
          allowed_paths: [],
          allow_nested_agents: 'yes',
        },
        errors
      )
    ),
    1
  )
  assert.equal(errors.length, 1)
  assert.match(errors[0] ?? '', /expected boolean/iu)
  assert.deepEqual(configs, [])
  assert.deepEqual(client.calls, [])
  assert.equal(client.closeCount, 0)
})

test('CLI grammar rejects misuse before connecting and separates operational failures', async () =>
{
  const invalidInvocations = [
    ['run', '--request', 'one.json', '--request', 'two.json'],
    ['run', '--request', '--pretty'],
    ['run', '--request', 'one.json', '--timeout', '1abc'],
    ['list', '--json'],
    ['list', '--state-dir', '--bogus'],
    ['list', 'extra'],
    ['wait', '--run', 'wave', '--job-id', 'job-1'],
    ['result', 'job-1', 'job-2'],
    ['ccusage', 'tokens'],
    ['daemon', 'status', '--when-idle'],
    ['unknown'],
  ]
  for (const argv of invalidInvocations)
  {
    const client = new StubDaemonClient()
    const output: string[] = []
    const errors: string[] = []
    const configs: BrokerConfig[] = []
    assert.equal(
      await runCli(
        argv,
        dependencies(client, output, configs, undefined, errors)
      ),
      2,
      argv.join(' ')
    )
    assert.deepEqual(output, [], argv.join(' '))
    assert.equal(errors.length, 1, argv.join(' '))
    assert.deepEqual(configs, [], argv.join(' '))
    assert.deepEqual(client.calls, [], argv.join(' '))
    assert.equal(client.closeCount, 0, argv.join(' '))
  }

  const errors: string[] = []
  let connectCount = 0
  const operational = await runCli(['list'], {
    connect: async () =>
    {
      connectCount += 1
      throw new Error('injected daemon transport failure')
    },
    writeStdout: () => undefined,
    writeStderr: (value) => errors.push(value),
    readRequest: async () => ({}),
  })
  assert.equal(operational, 1)
  assert.equal(connectCount, 1)
  assert.deepEqual(errors, ['injected daemon transport failure\n'])

  assert.equal(
    await runCli(['ccusage', '--', '--json'], {
      connect: async () =>
      {
        throw new Error('ccusage must not connect to the daemon')
      },
      writeStdout: () => undefined,
      writeStderr: () => undefined,
      readRequest: async () => ({}),
      runCcusage: async () => 7,
    }),
    1
  )
})

test('wait loops across timeouts and emits only bounded terminal counts', async () =>
{
  const client = new StubDaemonClient()
  client.enqueue('wait_for_workers', {
    timed_out: true,
    workers: [],
    pending: [
      {
        job_id: 'complete-job',
        status: 'running',
        elapsed_ms: 1_000,
      },
    ],
  })
  const terminal = [
    workerSummary('complete-job', 'completed'),
    workerSummary('failed-job', 'failed'),
    workerSummary('rejected-job', 'rejected'),
    workerSummary('cancelled-job', 'cancelled'),
  ]
  client.enqueue('wait_for_workers', {
    timed_out: false,
    workers: terminal,
    pending: [],
  })
  const output: string[] = []
  const errors: string[] = []
  const exitCode = await runCli(
    [
      'wait',
      '--job-id',
      'complete-job',
      '--job-id',
      'failed-job',
      '--job-id',
      'rejected-job',
      '--job-id',
      'cancelled-job',
      '--timeout',
      '7',
      '--json',
    ],
    dependencies(client, output, [], undefined, errors)
  )
  assert.equal(exitCode, 1)
  assert.deepEqual(errors, [])
  assert.deepEqual(client.calls, [
    {
      method: 'wait_for_workers',
      params: {
        job_ids: [
          'complete-job',
          'failed-job',
          'rejected-job',
          'cancelled-job',
        ],
        timeout_seconds: 7,
      },
    },
    {
      method: 'wait_for_workers',
      params: {
        job_ids: [
          'complete-job',
          'failed-job',
          'rejected-job',
          'cancelled-job',
        ],
        timeout_seconds: 7,
      },
    },
  ])
  assert.deepEqual(JSON.parse(output[0] ?? ''), {
    selected: 4,
    completed: 1,
    failed: 1,
    rejected: 1,
    cancelled: 1,
    pending: 0,
    timed_out: false,
  })
  assert.equal(client.closeCount, 1)
})

test('wait rejects incomplete or contradictory terminal observations', async () =>
{
  const complete = workerSummary('selected-job', 'completed')
  const malformed = [
    {
      label: 'missing',
      workers: [],
      pending: [],
    },
    {
      label: 'extra',
      workers: [complete, workerSummary('extra-job', 'completed')],
      pending: [],
    },
    {
      label: 'duplicate',
      workers: [complete, complete],
      pending: [],
    },
    {
      label: 'nonterminal',
      workers: [workerSummary('selected-job', 'running')],
      pending: [],
    },
    {
      label: 'pending',
      workers: [complete],
      pending: [
        {
          job_id: 'selected-job',
          status: 'running' as const,
          elapsed_ms: 1,
        },
      ],
    },
  ]
  for (const response of malformed)
  {
    const client = new StubDaemonClient()
    client.enqueue('wait_for_workers', {
      timed_out: false,
      workers: response.workers,
      pending: response.pending,
    })
    const output: string[] = []
    const errors: string[] = []
    assert.equal(
      await runCli(
        ['wait', '--job-id', 'selected-job', '--json'],
        dependencies(client, output, [], undefined, errors)
      ),
      2,
      response.label
    )
    assert.deepEqual(output, [], response.label)
    assert.equal(errors.length, 1, response.label)
    assert.equal(client.closeCount, 1, response.label)
  }

  const noMatch = new StubDaemonClient()
  noMatch.enqueue('list_workers', [])
  const noMatchErrors: string[] = []
  assert.equal(
    await runCli(
      ['wait', '--run', 'missing-run'],
      dependencies(noMatch, [], [], undefined, noMatchErrors)
    ),
    2
  )
  assert.deepEqual(noMatchErrors, ['no workers matched the selector\n'])
})
