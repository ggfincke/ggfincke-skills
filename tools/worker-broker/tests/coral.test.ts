// tools/worker-broker/tests/coral.test.ts
// protect Coral headless arguments & native result parsing

import assert from 'node:assert/strict'
import test from 'node:test'
import type { BrokerConfig, ProviderRunContext } from '../src/contracts.js'
import { buildCoralArgs, parseCoralExecResult } from '../src/providers/coral.js'

function context(mode: 'read' | 'edit'): ProviderRunContext
{
  return {
    job_id: 'job-coral',
    request: {
      provider: 'coral',
      mode,
      repo: '/repo',
      base_ref: 'HEAD',
      task: 'inspect local code',
      allowed_paths: mode === 'edit' ? ['src/local'] : [],
      acceptance_criteria: [],
      setup_commands: [],
      verification_commands: [],
      allow_nested_agents: false,
      depends_on: [],
    },
    worktree: '/worktree',
    job_dir: '/job',
    prompt_path: '/job/prompt.md',
    event_log_path: '/job/events.jsonl',
    stderr_path: '/job/stderr.log',
    model_result_path: '/job/result.json',
    signal: new AbortController().signal,
    on_process_started: () => undefined,
    on_process_finished: () => undefined,
  }
}

const config: BrokerConfig = {
  state_dir: '/state',
  codex_binary: 'codex',
  cursor_binary: 'cursor-agent',
  coral_binary: 'coral',
  claude_binary: 'claude',
  default_coral_model: 'local-test-model',
  coral_host: 'http://ollama.test:11434',
}

test('Coral arguments select deterministic headless profiles and isolation', () =>
{
  const readArgs = buildCoralArgs(
    context('read'),
    config,
    '/job/coral-result.json'
  )
  assert.deepEqual(readArgs.slice(0, 7), [
    'exec',
    '--cwd',
    '/worktree',
    '--model',
    'local-test-model',
    '--host',
    'http://ollama.test:11434',
  ])
  assert.deepEqual(
    readArgs.slice(
      readArgs.indexOf('--permission-profile'),
      readArgs.indexOf('--permission-profile') + 2
    ),
    ['--permission-profile', 'read-only']
  )
  assert.ok(readArgs.includes('--ephemeral'))
  assert.ok(readArgs.includes('--no-mcp'))
  assert.equal(readArgs.at(-1), '--no-mcp')

  const editArgs = buildCoralArgs(
    context('edit'),
    config,
    '/job/coral-result.json'
  )
  assert.deepEqual(
    editArgs.slice(
      editArgs.indexOf('--permission-profile'),
      editArgs.indexOf('--permission-profile') + 2
    ),
    ['--permission-profile', 'workspace-write']
  )
})

test('Coral native results parse the completed exec payload', () =>
{
  assert.deepEqual(
    parseCoralExecResult({
      version: 1,
      run_id: 'run-1',
      status: 'completed',
      model: 'local-test-model',
      response:
        '{"summary":"done","assumptions":[],"risks":[],"follow_ups":[]}',
      usage: {},
    }),
    {
      version: 1,
      run_id: 'run-1',
      status: 'completed',
      model: 'local-test-model',
      response:
        '{"summary":"done","assumptions":[],"risks":[],"follow_ups":[]}',
    }
  )
})
