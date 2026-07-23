// tools/worker-broker/tests/mcp-server.test.ts
// exercise the five-tool MCP contract through an in-memory protocol connection

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
import { initializeTestRepo, waitUntil } from './helpers.js'

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

test('MCP exposes start, list, status, result, and cancel tools', async () =>
{
  const repo = await initializeTestRepo()
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'worker-broker-mcp-'))
  const config: BrokerConfig = {
    state_dir: stateDir,
    codex_binary: 'codex',
    cursor_binary: 'cursor-agent',
    coral_binary: 'coral',
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
      'get_worker_result',
      'get_worker_status',
      'list_workers',
      'start_worker',
    ])
    const startWorker = tools.find((tool) => tool.name === 'start_worker')
    const providerSchema = startWorker?.inputSchema.properties?.provider as
      { enum?: string[] } | undefined
    assert.deepEqual(providerSchema?.enum, ['codex', 'cursor', 'coral'])

    const started = structured(
      await client.callTool({
        name: 'start_worker',
        arguments: {
          provider: 'codex',
          mode: 'edit',
          repo,
          task: 'create MCP fixture',
          allowed_paths: ['src'],
          verification_commands: ['test "$(cat src/mcp.txt)" = "mcp-smoke"'],
        },
      })
    )
    const startedWorker = started.worker as Record<string, unknown>
    const jobId = startedWorker.job_id
    assert.equal(typeof jobId, 'string')

    await waitUntil(async () =>
    {
      const status = structured(
        await client.callTool({
          name: 'get_worker_status',
          arguments: { job_id: jobId },
        })
      )
      return (status.worker as Record<string, unknown>).status === 'completed'
    })

    const listed = structured(
      await client.callTool({
        name: 'list_workers',
        arguments: { status: 'completed' },
      })
    )
    assert.equal((listed.workers as unknown[]).length, 1)
    const result = structured(
      await client.callTool({
        name: 'get_worker_result',
        arguments: { job_id: jobId },
      })
    )
    const evidence = result.result as Record<string, unknown>
    assert.deepEqual(evidence.changed_files, ['src/mcp.txt'])
    assert.deepEqual(evidence.scope_violations, [])
    assert.equal(
      (evidence.verification as Array<Record<string, unknown>>)[0]?.exit_code,
      0
    )
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
