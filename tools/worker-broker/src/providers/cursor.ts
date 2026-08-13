// tools/worker-broker/src/providers/cursor.ts
// invoke Cursor CLI in its native sandbox & normalize observed stream events

import { parseActivitySummary } from '../activity.js'
import { writePrivateFile } from '../artifact.js'
import { assignmentPrompt } from '../assignment-prompt.js'
import type {
  ActivityInput,
  BrokerConfig,
  ProviderOutcome,
  ProviderRunContext,
  WorkerProvider,
} from '../contracts.js'
import { serializePrettyJson } from '../json.js'
import { parseModelResultText } from '../model-result.js'
import { runProcess } from '../process-runner.js'

// malformed ndjson is ignored; the raw log still has the line
function parseJsonRecord(line: string): Record<string, unknown> | undefined
{
  try
  {
    return JSON.parse(line) as Record<string, unknown>
  }
  catch
  {
    return undefined
  }
}

function textFromAssistantEvent(
  event: Record<string, unknown>
): string | undefined
{
  const message = event.message
  if (typeof message !== 'object' || message === null || Array.isArray(message))
    return undefined
  const content = (message as Record<string, unknown>).content
  if (!Array.isArray(content)) return undefined
  const text = content
    .filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === 'object' && entry !== null && !Array.isArray(entry)
    )
    .filter((entry) => entry.type === 'text' && typeof entry.text === 'string')
    .map((entry) => entry.text as string)
    .join('')
  return text === '' ? undefined : text
}

interface CursorEventData
{
  session_id?: string
  model?: string
  assistant_text?: string
  result_text?: string
}

// session, model, and result text from a parsed cursor event
function eventFromRecord(event: Record<string, unknown>): CursorEventData
{
  const data: CursorEventData = {}
  if (typeof event.session_id === 'string') data.session_id = event.session_id
  if (typeof event.model === 'string') data.model = event.model
  if (event.type === 'assistant')
  {
    const text = textFromAssistantEvent(event)
    if (text !== undefined) data.assistant_text = text
  }
  if (event.type === 'result' && typeof event.result === 'string')
  {
    data.result_text = event.result
  }
  return data
}

// abstract tool/message activity from a parsed cursor event
function activityFromRecord(
  value: Record<string, unknown>
): ActivityInput | undefined
{
  if (value.type === 'tool_call')
  {
    if (value.subtype === 'started')
      return { kind: 'action', status: 'started' }
    if (value.subtype === 'completed')
    {
      const toolCall = value.tool_call
      let failed = value.is_error === true
      if (
        typeof toolCall === 'object' &&
        toolCall !== null &&
        !Array.isArray(toolCall)
      )
      {
        for (const call of Object.values(toolCall))
        {
          if (typeof call !== 'object' || call === null || Array.isArray(call))
            continue
          const result = (call as Record<string, unknown>).result
          if (
            typeof result === 'object' &&
            result !== null &&
            !Array.isArray(result)
          )
          {
            const resultRecord = result as Record<string, unknown>
            failed =
              failed ||
              resultRecord.is_error === true ||
              (resultRecord.error !== undefined &&
                resultRecord.error !== null) ||
              (resultRecord.failure !== undefined &&
                resultRecord.failure !== null)
          }
        }
      }
      return { kind: 'action', status: failed ? 'failed' : 'completed' }
    }
    return undefined
  }
  if (value.type === 'result' && typeof value.result === 'string')
  {
    const summary = parseActivitySummary(value.result)
    return summary === undefined ? undefined : { kind: 'message', summary }
  }
  const event = eventFromRecord(value)
  if (event.assistant_text !== undefined)
  {
    const summary = parseActivitySummary(event.assistant_text)
    return summary === undefined ? undefined : { kind: 'message', summary }
  }
  return undefined
}

// test entry: parse once, then eventFromRecord
export function parseCursorEventLine(
  line: string
): CursorEventData | undefined
{
  const event = parseJsonRecord(line)
  return event === undefined ? undefined : eventFromRecord(event)
}

// test entry: parse once, then activityFromRecord
export function parseCursorActivity(line: string): ActivityInput | undefined
{
  const value = parseJsonRecord(line)
  return value === undefined ? undefined : activityFromRecord(value)
}

export function parseCursorResultText(text: string)
{
  return parseModelResultText(text, 'Cursor')
}

export function buildCursorArgs(
  context: ProviderRunContext,
  config: BrokerConfig,
  prompt: string
): string[]
{
  const args = [
    '--print',
    '--trust',
    '--workspace',
    context.worktree,
    '--sandbox',
    'enabled',
    '--output-format',
    'stream-json',
  ]
  if (context.request.mode === 'edit') args.push('--force')
  else args.push('--mode', 'plan')
  const model = context.request.model ?? config.default_cursor_model
  if (model !== undefined) args.push('--model', model)
  args.push(prompt)
  return args
}

export class CursorProvider implements WorkerProvider
{
  readonly name = 'cursor' as const

  constructor(private readonly config: BrokerConfig)
  {}

  async run(context: ProviderRunContext): Promise<ProviderOutcome>
  {
    const prompt = assignmentPrompt(context)
    await writePrivateFile(context.prompt_path, prompt)
    let workerSessionId: string | undefined
    let effectiveModel: string | undefined
    let assistantText: string | undefined
    let resultText: string | undefined
    const processResult = await runProcess({
      command: this.config.cursor_binary,
      args: buildCursorArgs(context, this.config, prompt),
      cwd: context.worktree,
      stdout_path: context.event_log_path,
      stderr_path: context.stderr_path,
      signal: context.signal,
      on_process_started: context.on_process_started,
      on_process_finished: context.on_process_finished,
      on_stdout_line: (line) =>
      {
        const value = parseJsonRecord(line)
        if (value === undefined) return
        const event = eventFromRecord(value)
        const activity = activityFromRecord(value)
        if (event.session_id !== undefined) workerSessionId = event.session_id
        if (event.model !== undefined) effectiveModel = event.model
        if (event.assistant_text !== undefined)
          assistantText = event.assistant_text
        if (event.result_text !== undefined) resultText = event.result_text
        if (activity !== undefined) context.on_activity?.(activity)
      },
    })

    const outcome: ProviderOutcome = {
      exit_code: processResult.exit_code,
      signal: processResult.signal,
    }
    if (workerSessionId !== undefined)
      outcome.worker_session_id = workerSessionId
    if (effectiveModel !== undefined) outcome.effective_model = effectiveModel
    if (processResult.exit_code === 0)
    {
      const text = resultText ?? assistantText
      if (text === undefined)
        throw new Error('Cursor completed without a textual result')
      const modelResult = parseCursorResultText(text)
      await writePrivateFile(
        context.model_result_path,
        serializePrettyJson(modelResult)
      )
      outcome.model_result = modelResult
    }
    return outcome
  }
}
