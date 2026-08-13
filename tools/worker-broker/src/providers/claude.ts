// tools/worker-broker/src/providers/claude.ts
// invoke claude code headlessly & normalize its native stream events

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

interface ClaudeEventData
{
  session_id?: string
  model?: string
  assistant_text?: string
  result_text?: string
}

function assistantText(event: Record<string, unknown>): string | undefined
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

export function parseClaudeEventLine(
  line: string
): ClaudeEventData | undefined
{
  let event: Record<string, unknown>
  try
  {
    event = JSON.parse(line) as Record<string, unknown>
  }
  catch
  {
    return undefined
  }
  const data: ClaudeEventData = {}
  if (typeof event.session_id === 'string') data.session_id = event.session_id
  if (typeof event.model === 'string') data.model = event.model
  if (event.type === 'assistant')
  {
    const text = assistantText(event)
    if (text !== undefined) data.assistant_text = text
  }
  if (event.type === 'result' && typeof event.result === 'string')
  {
    data.result_text = event.result
  }
  return data
}

export function parseClaudeActivities(line: string): ActivityInput[]
{
  let value: Record<string, unknown>
  try
  {
    value = JSON.parse(line) as Record<string, unknown>
  }
  catch
  {
    return []
  }
  const activities: ActivityInput[] = []
  const message = value.message
  if (
    typeof message === 'object' &&
    message !== null &&
    !Array.isArray(message)
  )
  {
    const content = (message as Record<string, unknown>).content
    if (Array.isArray(content))
    {
      const entries = content.filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === 'object' && entry !== null && !Array.isArray(entry)
      )
      for (const entry of entries)
      {
        if (entry.type === 'tool_use')
          activities.push({ kind: 'action', status: 'started' })
        else if (entry.type === 'tool_result')
        {
          activities.push({
            kind: 'action',
            status: entry.is_error === true ? 'failed' : 'completed',
          })
        }
      }
    }
  }
  const event = parseClaudeEventLine(line)
  if (event?.assistant_text !== undefined)
  {
    const summary = parseActivitySummary(event.assistant_text)
    if (summary !== undefined) activities.push({ kind: 'message', summary })
  }
  if (value.type === 'tool_use')
    activities.push({ kind: 'action', status: 'started' })
  if (value.type === 'tool_result')
  {
    activities.push({
      kind: 'action',
      status: value.is_error === true ? 'failed' : 'completed',
    })
  }
  return activities
}

export function parseClaudeActivity(line: string): ActivityInput | undefined
{
  return parseClaudeActivities(line)[0]
}

export function buildClaudeArgs(
  context: ProviderRunContext,
  config: BrokerConfig,
  prompt: string
): string[]
{
  const args = ['-p', prompt, '--output-format', 'stream-json']
  if (context.request.mode === 'edit')
    args.push('--dangerously-skip-permissions')
  else args.push('--permission-mode', 'plan')
  const model = context.request.model ?? config.default_claude_model
  if (model !== undefined) args.push('--model', model)
  // claude code currently accepts effort through max; ultra stays advisory metadata
  const effort = context.request.effort
  if (effort !== undefined && effort !== 'ultra') args.push('--effort', effort)
  return args
}

export class ClaudeProvider implements WorkerProvider
{
  readonly name = 'claude' as const

  constructor(private readonly config: BrokerConfig)
  {}

  async run(context: ProviderRunContext): Promise<ProviderOutcome>
  {
    const prompt = assignmentPrompt(context)
    await writePrivateFile(context.prompt_path, prompt)
    let workerSessionId: string | undefined
    let effectiveModel: string | undefined
    let assistantResult: string | undefined
    let finalResult: string | undefined
    const processResult = await runProcess({
      command: this.config.claude_binary,
      args: buildClaudeArgs(context, this.config, prompt),
      cwd: context.worktree,
      stdout_path: context.event_log_path,
      stderr_path: context.stderr_path,
      signal: context.signal,
      on_process_started: context.on_process_started,
      on_process_finished: context.on_process_finished,
      on_stdout_line: (line) =>
      {
        const event = parseClaudeEventLine(line)
        const activities = parseClaudeActivities(line)
        if (event?.session_id !== undefined) workerSessionId = event.session_id
        if (event?.model !== undefined) effectiveModel = event.model
        if (event?.assistant_text !== undefined)
          assistantResult = event.assistant_text
        if (event?.result_text !== undefined) finalResult = event.result_text
        for (const activity of activities) context.on_activity?.(activity)
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
      const text = finalResult ?? assistantResult
      if (text === undefined)
        throw new Error('Claude completed without a textual result')
      const modelResult = parseModelResultText(text, 'Claude')
      await writePrivateFile(
        context.model_result_path,
        serializePrettyJson(modelResult)
      )
      outcome.model_result = modelResult
    }
    return outcome
  }
}
