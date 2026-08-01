// tools/worker-broker/tests/claude.test.ts
// protect claude headless arguments, prompt delivery, & stream normalization

import assert from 'node:assert/strict'
import test from 'node:test'
import type { BrokerConfig, ProviderRunContext } from '../src/contracts.js'
import {
  buildClaudeArgs,
  parseClaudeEventLine,
} from '../src/providers/claude.js'
import { normalizeRequest } from '../src/request.js'

function context(mode: 'read' | 'edit'): ProviderRunContext
{
  return {
    job_id: 'job-claude',
    request: {
      provider: 'claude',
      mode,
      repo: '/repo',
      base_ref: 'HEAD',
      task: 'inspect routing',
      allowed_paths: mode === 'edit' ? ['src/routing'] : [],
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
  }
}

const config: BrokerConfig = {
  state_dir: '/state',
  codex_binary: 'codex',
  cursor_binary: 'cursor-agent',
  coral_binary: 'coral',
  claude_binary: 'claude',
  default_claude_model: 'claude-test-model',
}

test('Claude arguments separate planning from isolated worktree edits', () =>
{
  const editArgs = buildClaudeArgs(context('edit'), config, 'edit prompt')
  assert.deepEqual(editArgs.slice(0, 4), [
    '-p',
    'edit prompt',
    '--output-format',
    'stream-json',
  ])
  assert.ok(editArgs.includes('--dangerously-skip-permissions'))
  assert.equal(editArgs.includes('--permission-mode'), false)
  assert.deepEqual(
    editArgs.slice(
      editArgs.indexOf('--model'),
      editArgs.indexOf('--model') + 2
    ),
    ['--model', 'claude-test-model']
  )

  const readArgs = buildClaudeArgs(context('read'), config, 'read prompt')
  assert.equal(readArgs.includes('--dangerously-skip-permissions'), false)
  assert.deepEqual(
    readArgs.slice(
      readArgs.indexOf('--permission-mode'),
      readArgs.indexOf('--permission-mode') + 2
    ),
    ['--permission-mode', 'plan']
  )
  assert.equal(readArgs[1], 'read prompt')
})

test('Claude model and supported effort overrides reach the native CLI', () =>
{
  const runContext = context('read')
  runContext.request.model = 'claude-opus-test'
  runContext.request.effort = 'high'
  const args = buildClaudeArgs(runContext, config, 'prompt')
  assert.deepEqual(
    args.slice(args.indexOf('--model'), args.indexOf('--model') + 2),
    ['--model', 'claude-opus-test']
  )
  assert.deepEqual(
    args.slice(args.indexOf('--effort'), args.indexOf('--effort') + 2),
    ['--effort', 'high']
  )
})

test('Claude keeps unsupported ultra effort as advisory metadata', () =>
{
  const request = normalizeRequest({
    provider: 'claude',
    mode: 'read',
    repo: '/repo',
    task: 'inspect',
    allowed_paths: [],
    effort: 'ultra',
  })
  assert.equal(request.effort, 'ultra')
  const runContext = context('read')
  runContext.request = request
  assert.equal(
    buildClaudeArgs(runContext, config, 'prompt').includes('--effort'),
    false
  )
})

test('Claude stream events expose session, effective model, and result text', () =>
{
  assert.deepEqual(
    parseClaudeEventLine(
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'session-1',
        model: 'claude-sonnet-effective',
      })
    ),
    {
      session_id: 'session-1',
      model: 'claude-sonnet-effective',
    }
  )
  assert.deepEqual(
    parseClaudeEventLine(
      JSON.stringify({
        type: 'result',
        session_id: 'session-1',
        result:
          '{"summary":"done","assumptions":[],"risks":[],"follow_ups":[]}',
      })
    ),
    {
      session_id: 'session-1',
      result_text:
        '{"summary":"done","assumptions":[],"risks":[],"follow_ups":[]}',
    }
  )
  assert.equal(parseClaudeEventLine('not json'), undefined)
})
