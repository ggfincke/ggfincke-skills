// tools/worker-broker/tests/mcp-server.test.ts
// verify MCP schemas, daemon translations, response shapes, & mapped errors

import assert from 'node:assert/strict'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { WorkerJob, WorkerResult, WorkerStatus } from '../src/contracts.js'
import type {
  DaemonClient,
  DaemonIdentity,
  DaemonMethod,
  DaemonMethods,
} from '../src/daemon/protocol.js'
import { createWorkerBrokerServer } from '../src/mcp-server.js'

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
  private readonly responses = new Map<DaemonMethod, unknown>()
  private readonly errors = new Map<DaemonMethod, unknown>()

  identity(): DaemonIdentity
  {
    return IDENTITY
  }

  set<M extends DaemonMethod>(
    method: M,
    result: DaemonMethods[M]['result']
  ): void
  {
    this.responses.set(method, result)
  }

  fail(method: DaemonMethod, error: unknown): void
  {
    this.errors.set(method, error)
  }

  async call<M extends DaemonMethod>(
    method: M,
    params: DaemonMethods[M]['params']
  ): Promise<DaemonMethods[M]['result']>
  {
    this.calls.push({ method, params })
    if (this.errors.has(method)) throw this.errors.get(method)
    assert.ok(this.responses.has(method), `missing response for ${method}`)
    return this.responses.get(method) as DaemonMethods[M]['result']
  }

  async close(): Promise<void>
  {}
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
    stage: 'implementation',
    workflow: 'standard',
    run: 'run-1',
    model: 'gpt-fixture',
    effort: 'high',
    effective_model: 'gpt-effective',
    head_sha: 'head-sha',
    worktree: '/worktree',
    branch: `agent/${jobId}`,
    summary: 'created fixture',
    assumptions: [],
    risks: [],
    follow_ups: [],
    changed_files: ['src/mcp.txt'],
    changes: [{ status: 'M', paths: ['src/mcp.txt'] }],
    setup: [],
    verification: [],
    scope_violations: [],
    patch_path: '/job/change.patch',
    event_log_path: '/job/events.jsonl',
    stderr_path: '/job/provider.stderr.log',
    model_result_path: '/job/model-result.json',
    process_exit_code: 0,
    process_signal: null,
    created_at: '2026-08-01T00:00:00.000Z',
    started_at: '2026-08-01T00:00:01.000Z',
    completed_at: '2026-08-01T00:00:02.000Z',
    elapsed_ms: 1_000,
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
      task: 'create MCP fixture',
      allowed_paths: ['src'],
      acceptance_criteria: [],
      setup_commands: [],
      verification_commands: [],
      model: 'gpt-fixture',
      effort: 'high',
      stage: 'implementation',
      workflow: 'standard',
      run: 'run-1',
      depends_on: [],
      allow_nested_agents: false,
    },
    base_sha: 'base-sha',
    branch: `agent/${jobId}`,
    worktree: '/worktree',
    created_at: '2026-08-01T00:00:00.000Z',
    started_at: '2026-08-01T00:00:01.000Z',
  }
  if (status === 'completed')
  {
    job.completed_at = '2026-08-01T00:00:02.000Z'
    job.result = workerResult(jobId)
  }
  return job
}

function summary(job: WorkerJob): Record<string, unknown>
{
  return {
    job_id: job.job_id,
    status: job.status,
    provider: 'codex',
    mode: 'edit',
    task_preview: 'create MCP fixture',
    task_bytes: 18,
    repo: '/repo',
    allowed_paths: ['src'],
    base_sha: 'base-sha',
    stage: 'implementation',
    workflow: 'standard',
    run: 'run-1',
    depends_on: [],
    model: 'gpt-fixture',
    effort: 'high',
    branch: `agent/${job.job_id}`,
    worktree: '/worktree',
    created_at: '2026-08-01T00:00:00.000Z',
    started_at: '2026-08-01T00:00:01.000Z',
    ...(job.completed_at === undefined
      ? {}
      : { completed_at: job.completed_at }),
  }
}

function structured(result: unknown): Record<string, unknown>
{
  const candidate = result as { structuredContent?: Record<string, unknown> }
  assert.ok(candidate.structuredContent)
  return candidate.structuredContent
}

function text(result: unknown): string
{
  const candidate = result as { content?: Array<{ text?: string }> }
  return candidate.content?.[0]?.text ?? ''
}

test('MCP preserves schemas and translates every tool through the daemon client', async () =>
{
  const daemon = new StubDaemonClient()
  const startedJob = worker('started-job', 'queued')
  const completedJob = worker('completed-job', 'completed')
  const runningJob = worker('running-job', 'running')
  const conflicts = [
    { job_id: 'earlier-job', overlapping_paths: ['src', 'src/mcp.txt'] },
  ]
  const totals: Record<WorkerStatus, number> = {
    queued: 0,
    running: 0,
    completed: 1,
    failed: 0,
    rejected: 0,
    cancelled: 0,
  }
  const runStatus = {
    run: 'run-1',
    workflows: ['standard'],
    totals,
    stages: [
      {
        stage: 'implementation',
        ...totals,
        job_ids: ['completed-job'],
      },
    ],
  }
  const artifact = {
    job_id: 'completed-job',
    artifact: 'patch' as const,
    content: 'patch-content',
    truncated: true,
    byte_length: 128,
  }
  daemon.set('start_worker', startedJob)
  daemon.set('edit_serialization', conflicts)
  daemon.set('list_workers', [completedJob])
  daemon.set('get_run_status', runStatus)
  daemon.set('wait_for_workers', {
    timed_out: false,
    workers: [completedJob],
  })
  daemon.set('get_worker_artifact', artifact)
  daemon.set('get_worker_status', completedJob)
  daemon.set('get_worker_result', completedJob)
  daemon.set('cancel_worker', runningJob)

  const server = createWorkerBrokerServer(daemon)
  const client = new Client({ name: 'worker-broker-tests', version: '1.0.0' })
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()

  try
  {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const tools = (await client.listTools()).tools
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [
      'cancel_worker',
      'get_run_status',
      'get_worker_artifact',
      'get_worker_result',
      'get_worker_status',
      'list_workers',
      'start_worker',
      'wait_for_workers',
    ])
    const startWorker = tools.find((tool) => tool.name === 'start_worker')
    const providerSchema = startWorker?.inputSchema.properties?.provider as
      { enum?: string[] } | undefined
    assert.deepEqual(providerSchema?.enum, [
      'codex',
      'cursor',
      'coral',
      'claude',
    ])

    const invalid = await client.callTool({
      name: 'start_worker',
      arguments: {
        provider: 'codex',
        mode: 'edit',
        repo: '/repo',
        task: 'reject empty stage',
        allowed_paths: ['src'],
        stage: '',
      },
    })
    assert.equal((invalid as { isError?: boolean }).isError, true)

    const startRequest = {
      provider: 'codex',
      mode: 'edit',
      repo: '/repo',
      task: 'create MCP fixture',
      allowed_paths: ['src'],
      stage: 'implementation',
      workflow: 'standard',
      run: 'run-1',
      model: 'gpt-fixture',
      effort: 'high',
    }
    assert.deepEqual(
      structured(
        await client.callTool({
          name: 'start_worker',
          arguments: startRequest,
        })
      ),
      { worker: summary(startedJob), serializes_behind: conflicts }
    )
    assert.deepEqual(
      structured(
        await client.callTool({
          name: 'list_workers',
          arguments: {
            status: 'completed',
            run: 'run-1',
            workflow: 'standard',
          },
        })
      ),
      { workers: [summary(completedJob)] }
    )
    assert.deepEqual(
      structured(
        await client.callTool({
          name: 'get_run_status',
          arguments: { run: 'run-1' },
        })
      ),
      runStatus
    )
    assert.deepEqual(
      structured(
        await client.callTool({
          name: 'wait_for_workers',
          arguments: {
            run: 'run-1',
            job_ids: ['completed-job'],
            timeout_seconds: 10,
          },
        })
      ),
      {
        timed_out: false,
        pending: [],
        jobs: [summary(completedJob)],
      }
    )
    assert.deepEqual(
      structured(
        await client.callTool({
          name: 'get_worker_artifact',
          arguments: {
            job_id: 'completed-job',
            artifact: 'patch',
            max_bytes: 16,
            tail: true,
          },
        })
      ),
      artifact
    )
    assert.deepEqual(
      structured(
        await client.callTool({
          name: 'get_worker_status',
          arguments: { job_id: 'completed-job' },
        })
      ),
      { worker: summary(completedJob) }
    )
    assert.deepEqual(
      structured(
        await client.callTool({
          name: 'get_worker_result',
          arguments: { job_id: 'completed-job' },
        })
      ),
      {
        worker: summary(completedJob),
        result: completedJob.result,
        summary_truncated: false,
        summary_byte_length: 15,
      }
    )
    assert.deepEqual(
      structured(
        await client.callTool({
          name: 'cancel_worker',
          arguments: { job_id: 'running-job' },
        })
      ),
      { worker: summary(runningJob) }
    )

    assert.deepEqual(daemon.calls, [
      { method: 'start_worker', params: startRequest },
      {
        method: 'edit_serialization',
        params: { job_id: 'started-job' },
      },
      {
        method: 'list_workers',
        params: {
          status: 'completed',
          run: 'run-1',
          workflow: 'standard',
        },
      },
      { method: 'get_run_status', params: { run: 'run-1' } },
      {
        method: 'wait_for_workers',
        params: {
          run: 'run-1',
          job_ids: ['completed-job'],
          timeout_seconds: 10,
        },
      },
      {
        method: 'get_worker_artifact',
        params: {
          job_id: 'completed-job',
          artifact: 'patch',
          max_bytes: 16,
          tail: true,
        },
      },
      {
        method: 'get_worker_status',
        params: { job_id: 'completed-job' },
      },
      {
        method: 'get_worker_result',
        params: { job_id: 'completed-job' },
      },
      { method: 'cancel_worker', params: { job_id: 'running-job' } },
    ])

    daemon.fail('start_worker', {
      code: 'draining',
      message: 'daemon is draining',
    })
    const draining = await client.callTool({
      name: 'start_worker',
      arguments: startRequest,
    })
    assert.equal((draining as { isError?: boolean }).isError, true)
    assert.equal(text(draining), 'worker broker is shutting down')

    daemon.fail('cancel_worker', {
      code: 'unknown_job',
      message: 'unknown worker running-job',
    })
    const unknown = await client.callTool({
      name: 'cancel_worker',
      arguments: { job_id: 'running-job' },
    })
    assert.equal((unknown as { isError?: boolean }).isError, true)
    assert.equal(
      text(unknown),
      'job is not active in this broker process: running-job'
    )
  }
  finally
  {
    await client.close()
    await server.close()
  }
})
