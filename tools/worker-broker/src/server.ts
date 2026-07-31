#!/usr/bin/env node
// tools/worker-broker/src/server.ts
// run the worker broker as a shutdown-safe stdio MCP service

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import process from 'node:process'
import { defaultBrokerConfig } from './config.js'
import { errorMessage } from './errors.js'
import { JobManager } from './job-manager.js'
import { createWorkerBrokerServer } from './mcp-server.js'
import { CodexProvider } from './providers/codex.js'
import { ClaudeProvider } from './providers/claude.js'
import { CoralProvider } from './providers/coral.js'
import { CursorProvider } from './providers/cursor.js'

async function main(): Promise<void>
{
  const config = defaultBrokerConfig()
  const manager = new JobManager(config, [
    new CodexProvider(config),
    new ClaudeProvider(config),
    new CursorProvider(config),
    new CoralProvider(config),
  ])
  await manager.initialize()
  const server = createWorkerBrokerServer(manager)
  const transport = new StdioServerTransport()
  let closing: Promise<void> | undefined

  const close = (): Promise<void> =>
  {
    closing ??= (async () =>
    {
      await manager.shutdown()
      await server.close()
    })()
    return closing
  }

  process.once('SIGINT', () => void close())
  process.once('SIGTERM', () => void close())
  process.stdin.once('end', () => void close())
  await server.connect(transport)
}

main().catch((error: unknown) =>
{
  process.stderr.write(`${errorMessage(error)}\n`)
  process.exitCode = 1
})
