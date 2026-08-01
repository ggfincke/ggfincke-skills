#!/usr/bin/env node
// tools/worker-broker/src/server.ts
// run a shutdown-safe stdio MCP client over the shared worker daemon

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import process from 'node:process'
import { defaultBrokerConfig } from './config.js'
import { ensureDaemonClient } from './daemon/client.js'
import { errorMessage } from './errors.js'
import { createWorkerBrokerServer } from './mcp-server.js'

async function main(): Promise<void>
{
  const config = defaultBrokerConfig()
  const client = await ensureDaemonClient(config)
  const server = createWorkerBrokerServer(client)
  const transport = new StdioServerTransport()
  let closing: Promise<void> | undefined

  const close = (): Promise<void> =>
  {
    closing ??= (async () =>
    {
      try
      {
        await server.close()
      }
      finally
      {
        await client.close()
      }
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
