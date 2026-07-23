// tools/worker-broker/tests/cursor.test.ts
// protect Cursor sandbox arguments, stream parsing, & provider-specific overrides

import assert from 'node:assert/strict'
import test from 'node:test'
import type { BrokerConfig, ProviderRunContext } from '../src/contracts.js'
import {
  buildCursorArgs,
  parseCursorEventLine,
  parseCursorResultText,
} from '../src/providers/cursor.js'
import { normalizeRequest } from '../src/request.js'

function context(mode: 'read' | 'edit'): ProviderRunContext
{
  return {
    job_id: 'job-cursor',
    request: {
      provider: 'cursor',
      mode,
      repo: '/repo',
      base_ref: 'HEAD',
      task: 'inspect routing',
      allowed_paths: mode === 'edit' ? ['src/routing'] : [],
      acceptance_criteria: [],
      verification_commands: [],
      allow_nested_agents: false,
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
  default_cursor_model: 'cursor-test-model',
}

test('Cursor arguments separate read-only planning from sandboxed edits', () =>
{
  const editArgs = buildCursorArgs(context('edit'), config, 'edit prompt')
  assert.deepEqual(editArgs.slice(0, 8), [
    '--print',
    '--trust',
    '--workspace',
    '/worktree',
    '--sandbox',
    'enabled',
    '--output-format',
    'stream-json',
  ])
  assert.ok(editArgs.includes('--force'))
  assert.equal(editArgs.includes('--mode'), false)
  assert.deepEqual(
    editArgs.slice(
      editArgs.indexOf('--model'),
      editArgs.indexOf('--model') + 2
    ),
    ['--model', 'cursor-test-model']
  )
  assert.equal(editArgs.at(-1), 'edit prompt')

  const readArgs = buildCursorArgs(context('read'), config, 'read prompt')
  assert.equal(readArgs.includes('--force'), false)
  assert.deepEqual(
    readArgs.slice(readArgs.indexOf('--mode'), readArgs.indexOf('--mode') + 2),
    ['--mode', 'plan']
  )
})

test('Cursor stream events normalize the observed native event contract', () =>
{
  const session = '3393f180-ae0d-4ce5-af40-a9e467c98d1c'
  assert.deepEqual(
    parseCursorEventLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: '{"summary":"done","assumptions":[],"risks":[],"follow_ups":[]}',
            },
          ],
        },
        session_id: session,
      })
    ),
    {
      session_id: session,
      assistant_text:
        '{"summary":"done","assumptions":[],"risks":[],"follow_ups":[]}',
    }
  )
  const result = parseCursorEventLine(
    JSON.stringify({
      type: 'result',
      result: '{"summary":"done","assumptions":[],"risks":[],"follow_ups":[]}',
      session_id: session,
    })
  )
  assert.equal(result?.result_text?.includes('"summary":"done"'), true)
  assert.equal(parseCursorEventLine('not json'), undefined)
  assert.deepEqual(
    parseCursorResultText(
      '```json\n{"summary":"done","assumptions":[],"risks":[],"follow_ups":[]}\n```'
    ),
    { summary: 'done', assumptions: [], risks: [], follow_ups: [] }
  )
  assert.deepEqual(
    parseCursorResultText(
      'progress prose{"summary":"final","assumptions":[],"risks":[],"follow_ups":[]}'
    ),
    { summary: 'final', assumptions: [], risks: [], follow_ups: [] }
  )
})

test('Cursor rejects a generic effort override instead of silently ignoring it', () =>
{
  assert.throws(
    () =>
      normalizeRequest({
        provider: 'cursor',
        mode: 'read',
        repo: '/repo',
        task: 'inspect',
        allowed_paths: [],
        effort: 'high',
      }),
    /effort must be encoded in the model identifier/u
  )
})
