// tools/worker-broker/tests/mcp-server.test.ts
// exercise broker lifecycle & orchestration tools through an in-memory connection

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type {
  BrokerConfig,
  ProviderOutcome,
  ProviderRunContext,
  WorkerProvider,
} from '../src/contracts.js'
import { JobManager } from '../src/job-manager.js'
import { createWorkerBrokerServer } from '../src/mcp-server.js'
import { initializeTestRepo } from './helpers.js'

class McpFixtureProvider implements WorkerProvider
{
  readonly name = 'codex' as const

  async run(context: ProviderRunContext): Promise<ProviderOutcome>
  {
    await mkdir(path.join(context.worktree, 'src'), { recursive: true })
    await writeFile(
      path.join(context.worktree, 'src', 'mcp.txt'),
      'mcp-smoke\n'
    )
    return {
      exit_code: 0,
      signal: null,
      effective_model: 'gpt-effective',
      model_result: {
        summary: 'created MCP fixture',
        assumptions: [],
        risks: [],
        follow_ups: [],
      },
    }
  }
}

function structured(result: unknown): Record<string, unknown>
{
  const candidate = result as { structuredContent?: Record<string, unknown> }
  assert.ok(candidate.structuredContent)
  return candidate.structuredContent
}

test('MCP exposes lifecycle, run, wait, and artifact tools', async () =>
{
  const repo = await initializeTestRepo()
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'worker-broker-mcp-'))
  const config: BrokerConfig = {
    state_dir: stateDir,
    codex_binary: 'codex',
    cursor_binary: 'cursor-agent',
    coral_binary: 'coral',
    claude_binary: 'claude',
  }
  const manager = new JobManager(config, [new McpFixtureProvider()])
  const server = createWorkerBrokerServer(manager)
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
        repo,
        task: 'reject empty stage',
        allowed_paths: ['src'],
        stage: '   ',
      },
    })
    assert.equal((invalid as { isError?: boolean }).isError, true)

    const started = structured(
      await client.callTool({
        name: 'start_worker',
        arguments: {
          provider: 'codex',
          mode: 'edit',
          repo,
          task: 'create MCP fixture',
          allowed_paths: ['src'],
          stage: '  implementation  ',
          workflow: '  standard  ',
          run: '  run-1  ',
          model: 'gpt-fixture',
          effort: 'high',
          verification_commands: ['test "$(cat src/mcp.txt)" = "mcp-smoke"'],
        },
      })
    )
    const startedWorker = started.worker as Record<string, unknown>
    const jobId = startedWorker.job_id
    assert.equal(typeof jobId, 'string')
    assert.equal(startedWorker.stage, 'implementation')
    assert.equal(startedWorker.workflow, 'standard')
    assert.equal(startedWorker.run, 'run-1')
    assert.equal(startedWorker.model, 'gpt-fixture')
    assert.equal(startedWorker.effort, 'high')

    const waited = structured(
      await client.callTool({
        name: 'wait_for_workers',
        arguments: { run: 'run-1', timeout_seconds: 10 },
      })
    )
    assert.equal(waited.timed_out, false)
    assert.deepEqual(waited.pending_job_ids, [])
    assert.equal((waited.jobs as unknown[]).length, 1)
    const status = structured(
      await client.callTool({
        name: 'get_worker_status',
        arguments: { job_id: jobId },
      })
    )
    const statusWorker = status.worker as Record<string, unknown>
    assert.equal(statusWorker.model, 'gpt-fixture')
    assert.equal(statusWorker.effort, 'high')

    const listed = structured(
      await client.callTool({
        name: 'list_workers',
        arguments: {
          status: 'completed',
          run: 'run-1',
          workflow: 'standard',
        },
      })
    )
    assert.equal((listed.workers as unknown[]).length, 1)
    const listedWorker = (listed.workers as Array<Record<string, unknown>>)[0]
    assert.equal(listedWorker?.stage, 'implementation')
    assert.equal(listedWorker?.workflow, 'standard')
    assert.equal(listedWorker?.model, 'gpt-fixture')
    assert.equal(listedWorker?.effort, 'high')
    const runStatus = structured(
      await client.callTool({
        name: 'get_run_status',
        arguments: { run: 'run-1' },
      })
    )
    assert.deepEqual(runStatus.workflows, ['standard'])
    assert.equal((runStatus.totals as Record<string, unknown>).completed, 1)
    const stages = runStatus.stages as Array<Record<string, unknown>>
    assert.equal(stages[0]?.stage, 'implementation')
    assert.deepEqual(stages[0]?.job_ids, [jobId])
    const result = structured(
      await client.callTool({
        name: 'get_worker_result',
        arguments: { job_id: jobId },
      })
    )
    const evidence = result.result as Record<string, unknown>
    assert.equal(evidence.stage, 'implementation')
    assert.equal(evidence.workflow, 'standard')
    assert.equal(evidence.model, 'gpt-fixture')
    assert.equal(evidence.effort, 'high')
    assert.equal(evidence.effective_model, 'gpt-effective')
    assert.deepEqual(evidence.changed_files, ['src/mcp.txt'])
    assert.deepEqual(evidence.scope_violations, [])
    assert.equal(
      (evidence.verification as Array<Record<string, unknown>>)[0]?.exit_code,
      0
    )
    const artifact = structured(
      await client.callTool({
        name: 'get_worker_artifact',
        arguments: {
          job_id: jobId,
          artifact: 'patch',
          max_bytes: 16,
          tail: true,
        },
      })
    )
    assert.equal(artifact.truncated, true)
    assert.equal(Buffer.byteLength(artifact.content as string), 16)
  }
  finally
  {
    await client.close()
    await server.close()
    await manager.shutdown()
    await rm(repo, { recursive: true, force: true })
    await rm(stateDir, { recursive: true, force: true })
  }
})
