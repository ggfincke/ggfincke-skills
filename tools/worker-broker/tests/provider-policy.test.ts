// tools/worker-broker/tests/provider-policy.test.ts
// reject cloud metadata and unsafe Antigravity events before accepting provider results

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  installedLocalModels,
  localEndpoint,
  parsePowerState,
} from '../src/local-policy.js'
import { AgyProvider } from '../src/providers/agy.js'
import { defaultBrokerConfig } from '../src/config.js'
import { AGY_AGENT_NAME } from '../src/targets.js'
import { normalizeRequest } from '../src/request.js'

test('local discovery excludes remote models and requires disabled cloud without generation calls', async () =>
{
  let disabled = true
  const routes: string[] = []
  const server = createServer((request, response) =>
  {
    routes.push(request.url ?? '')
    response.setHeader('Content-Type', 'application/json')
    const data =
      request.url === '/api/status'
        ? { cloud: { disabled } }
        : request.url === '/api/tags'
          ? {
              models: [
                { name: 'local' },
                { name: 'hosted:cloud' },
                { name: 'remote', remote_host: 'https://example.invalid' },
              ],
            }
          : { capabilities: ['completion', 'tools'] }
    response.end(JSON.stringify(data))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try
  {
    const address = server.address() as { port: number }
    const endpoint = `http://127.0.0.1:${address.port}`
    assert.deepEqual(await installedLocalModels(endpoint), ['local'])
    assert.deepEqual(routes, ['/api/status', '/api/tags', '/api/show'])
    disabled = false
    await assert.rejects(installedLocalModels(endpoint), /cloud/u)
    assert.throws(() => localEndpoint('https://ollama.com'), /loopback/u)
    assert.equal(parsePowerState("Now drawing from 'Battery Power'"), 'battery')
    assert.equal(parsePowerState('unrecognized'), 'unknown')
  }
  finally
  {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('Antigravity accepts verified init plus structured success and rejects widened tools, false success, and cancellation', async () =>
{
  const directory = await mkdtemp(path.join(os.tmpdir(), 'broker-agy-fixture-'))
  const binary = path.join(directory, 'agy-fixture')
  const result = {
    summary: 'fixture',
    assumptions: [],
    risks: [],
    follow_ups: [],
  }
  const init = {
    event: 'init',
    conversation_id: 'session',
    init: {
      agent: AGY_AGENT_NAME,
      model: 'fixture',
      tools: ['view_file', 'grep_search'],
    },
  }
  const request = normalizeRequest({
    provider: 'agy',
    mode: 'read',
    repo: directory,
    run: 'fixture',
    task: 'read fixture',
    model: 'fixture',
    allowed_paths: [],
  })
  const context = {
    job_id: 'fixture',
    request,
    worktree: directory,
    job_dir: directory,
    prompt_path: path.join(directory, 'prompt.md'),
    event_log_path: path.join(directory, 'events.jsonl'),
    stderr_path: path.join(directory, 'stderr.log'),
    model_result_path: path.join(directory, 'result.json'),
    signal: new AbortController().signal,
    on_process_started: () => undefined,
    on_process_finished: () => undefined,
  }
  const provider = new AgyProvider({
    ...defaultBrokerConfig({}),
    agy_binary: binary,
  })
  const script = async (events: unknown[], linger = false) =>
  {
    await writeFile(
      binary,
      `#!${process.execPath}\n// fixture\n// emit native events\n${events.map((event) => `console.log(${JSON.stringify(JSON.stringify(event))})`).join('\n')}\n${linger ? 'setInterval(() => {}, 1000)' : ''}\n`
    )
    await chmod(binary, 0o700)
  }
  try
  {
    await script([
      init,
      {
        event: 'result',
        result: { status: 'SUCCESS', structured_output: result },
      },
    ])
    assert.deepEqual((await provider.run(context)).model_result, result)
    await script(
      [{ ...init, init: { ...init.init, tools: ['run_command'] } }],
      true
    )
    await assert.rejects(provider.run(context), /tools differ/u)
    await script([
      init,
      {
        event: 'result',
        result: { status: 'CANCELED', structured_output: result },
      },
    ])
    await assert.rejects(provider.run(context), /CANCELED/u)
    await script([
      init,
      { event: 'result', result: { status: 'SUCCESS', structured_output: {} } },
    ])
    await assert.rejects(provider.run(context), /summary/u)
    await script([init], true)
    await assert.rejects(
      provider.run({ ...context, signal: AbortSignal.timeout(100) }),
      /cancelled/u
    )
  }
  finally
  {
    await rm(directory, { recursive: true, force: true })
  }
})
