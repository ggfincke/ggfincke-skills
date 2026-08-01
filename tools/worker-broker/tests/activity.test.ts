// tools/worker-broker/tests/activity.test.ts
// verify private ordered activity persistence & bounded safe normalization

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ActivityWriter } from '../src/activity.js'
import type { ActivityRecord } from '../src/contracts.js'
import {
  parseClaudeActivities,
  parseClaudeActivity,
} from '../src/providers/claude.js'
import { parseCodexActivity } from '../src/providers/codex.js'
import { parseCursorActivity } from '../src/providers/cursor.js'

async function readActivity(filePath: string): Promise<ActivityRecord[]>
{
  return (await readFile(filePath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as ActivityRecord)
}

test('activity writer serializes private bounded records in append order', async () =>
{
  const directory = await mkdtemp(path.join(os.tmpdir(), 'broker-activity-'))
  const filePath = path.join(directory, 'activity.jsonl')
  try
  {
    const writer = new ActivityWriter(
      filePath,
      () => new Date('2026-07-31T12:00:00.000Z')
    )
    await Promise.all([
      writer.append({
        kind: 'message',
        summary: `  safe\u0000 summary ${'x'.repeat(1_100)}  `,
      }),
      writer.append({ kind: 'action', status: 'started' }),
      writer.append({ kind: 'action', status: 'completed' }),
    ])
    const records = await readActivity(filePath)
    assert.deepEqual(
      records.map((record) => record.sequence),
      [1, 2, 3]
    )
    assert.equal(records[0]?.recorded_at, '2026-07-31T12:00:00.000Z')
    assert.equal(records[0]?.kind, 'message')
    if (records[0]?.kind !== 'message') assert.fail('expected message record')
    assert.equal([...records[0].summary].length, 1_000)
    assert.equal(records[0].summary.includes('\u0000'), false)
    assert.equal((await stat(filePath)).mode & 0o777, 0o600)
  }
  finally
  {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Codex actions discard native command and output content', () =>
{
  const activity = parseCodexActivity(
    JSON.stringify({
      type: 'item.completed',
      item: {
        type: 'command_execution',
        command: 'print-secret-token',
        aggregated_output: 'secret-token',
      },
    })
  )
  assert.deepEqual(activity, { kind: 'action', status: 'completed' })
  assert.equal(JSON.stringify(activity).includes('secret-token'), false)
  assert.equal(
    parseCodexActivity(
      JSON.stringify({ type: 'unknown', command: 'secret-token' })
    ),
    undefined
  )
})

test('provider messages expose only a structured summary', () =>
{
  const result = JSON.stringify({
    summary: 'safe progress',
    assumptions: ['private assumption'],
    risks: ['private risk'],
    follow_ups: [],
  })
  const codex = parseCodexActivity(
    JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: result },
    })
  )
  const anthropicLine = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: result }] },
  })
  const cursorLine = JSON.stringify({ type: 'result', result })
  assert.deepEqual(codex, { kind: 'message', summary: 'safe progress' })
  assert.deepEqual(parseClaudeActivity(anthropicLine), codex)
  assert.deepEqual(parseCursorActivity(cursorLine), codex)
  for (const activity of [
    codex,
    parseClaudeActivity(anthropicLine),
    parseCursorActivity(cursorLine),
  ])
  {
    assert.equal(JSON.stringify(activity).includes('private assumption'), false)
    assert.equal(JSON.stringify(activity).includes('private risk'), false)
  }
  assert.equal(
    parseCodexActivity(
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: 'plain provider prose' },
      })
    ),
    undefined
  )
})

test('native provider action events preserve only abstract status', () =>
{
  assert.deepEqual(
    parseCursorActivity(
      JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        call_id: 'call-1',
        tool_call: { readToolCall: { args: { path: '/private/file' } } },
      })
    ),
    { kind: 'action', status: 'started' }
  )
  assert.deepEqual(
    parseCursorActivity(
      JSON.stringify({
        type: 'tool_call',
        subtype: 'completed',
        call_id: 'call-1',
        tool_call: {
          readToolCall: {
            args: { path: '/private/file' },
            result: { failure: { message: 'private output' } },
          },
        },
      })
    ),
    { kind: 'action', status: 'failed' }
  )
  assert.deepEqual(
    parseCursorActivity(
      JSON.stringify({
        type: 'tool_call',
        subtype: 'completed',
        call_id: 'call-2',
        tool_call: {
          readToolCall: {
            result: { error: null, failure: null },
          },
        },
      })
    ),
    { kind: 'action', status: 'completed' }
  )
  assert.deepEqual(
    parseCodexActivity(
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'mcp_tool_call',
          status: 'failed',
          error: { message: 'private output' },
        },
      })
    ),
    { kind: 'action', status: 'failed' }
  )
  assert.deepEqual(
    parseCodexActivity(
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'mcp_tool_call',
          status: 'completed',
          error: null,
          result: { content: [{ type: 'text', text: 'private output' }] },
        },
      })
    ),
    { kind: 'action', status: 'completed' }
  )
  assert.deepEqual(
    parseClaudeActivities(
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', is_error: false, content: 'private' },
            { type: 'tool_result', is_error: true, content: 'private error' },
          ],
        },
      })
    ),
    [
      { kind: 'action', status: 'completed' },
      { kind: 'action', status: 'failed' },
    ]
  )
})

test('activity writer separates a torn tail and closes interrupted state', async () =>
{
  const directory = await mkdtemp(path.join(os.tmpdir(), 'broker-activity-'))
  const filePath = path.join(directory, 'activity.jsonl')
  try
  {
    await writeFile(
      filePath,
      [
        JSON.stringify({
          schema_version: 1,
          sequence: 4,
          recorded_at: '2026-07-31T12:00:00.000Z',
          kind: 'phase',
          phase: 'working',
          status: 'started',
        }),
        JSON.stringify({
          schema_version: 1,
          sequence: 5,
          recorded_at: '2026-07-31T12:00:01.000Z',
          kind: 'action',
          status: 'started',
        }),
        '{"schema_version":1',
      ].join('\n')
    )
    const writer = new ActivityWriter(filePath)
    assert.equal(await writer.currentOpenPhase(), 'working')
    await writer.failPendingActions()
    await writer.append({ kind: 'phase', phase: 'working', status: 'failed' })

    const lines = (await readFile(filePath, 'utf8')).trim().split('\n')
    assert.equal(lines[2], '{"schema_version":1')
    const recovered = lines
      .flatMap((line) =>
      {
        try
        {
          return [JSON.parse(line) as ActivityRecord]
        }
        catch
        {
          return []
        }
      })
      .slice(-2)
    assert.deepEqual(
      recovered.map((record) => [
        record.sequence,
        record.kind,
        record.kind === 'message' ? undefined : record.status,
      ]),
      [
        [6, 'action', 'failed'],
        [7, 'phase', 'failed'],
      ]
    )
    assert.equal(await writer.currentOpenPhase(), undefined)
  }
  finally
  {
    await rm(directory, { recursive: true, force: true })
  }
})
