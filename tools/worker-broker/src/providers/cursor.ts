// tools/worker-broker/src/providers/cursor.ts
// invoke Cursor CLI in its native sandbox & normalize observed stream events

import { writePrivateFile } from '../artifact.js'
import { assignmentPrompt } from '../assignment-prompt.js'
import type {
  BrokerConfig,
  ProviderOutcome,
  ProviderRunContext,
  WorkerProvider,
} from '../contracts.js'
import { parseModelResultText } from '../model-result.js'
import { runProcess } from '../process-runner.js'

function textFromAssistantEvent(event: Record<string, unknown>): string | undefined {
  const message = event.message
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return undefined
  const content = (message as Record<string, unknown>).content
  if (!Array.isArray(content)) return undefined
  const text = content
    .filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === 'object' && entry !== null && !Array.isArray(entry),
    )
    .filter((entry) => entry.type === 'text' && typeof entry.text === 'string')
    .map((entry) => entry.text as string)
    .join('')
  return text === '' ? undefined : text
}

export interface CursorEventData {
  session_id?: string
  assistant_text?: string
  result_text?: string
}

export function parseCursorEventLine(line: string): CursorEventData | undefined {
  let event: Record<string, unknown>
  try {
    event = JSON.parse(line) as Record<string, unknown>
  } catch {
    return undefined
  }
  const data: CursorEventData = {}
  if (typeof event.session_id === 'string') data.session_id = event.session_id
  if (event.type === 'assistant') {
    const text = textFromAssistantEvent(event)
    if (text !== undefined) data.assistant_text = text
  }
  if (event.type === 'result' && typeof event.result === 'string') {
    data.result_text = event.result
  }
  return data
}

export function parseCursorResultText(text: string) {
  return parseModelResultText(text, 'Cursor')
}

export function buildCursorArgs(
  context: ProviderRunContext,
  config: BrokerConfig,
  prompt: string,
): string[] {
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

export class CursorProvider implements WorkerProvider {
  readonly name = 'cursor' as const

  constructor(private readonly config: BrokerConfig) {}

  async run(context: ProviderRunContext): Promise<ProviderOutcome> {
    const prompt = assignmentPrompt(context)
    await writePrivateFile(context.prompt_path, prompt)
    let workerSessionId: string | undefined
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
      on_stdout_line: (line) => {
        const event = parseCursorEventLine(line)
        if (event?.session_id !== undefined) workerSessionId = event.session_id
        if (event?.assistant_text !== undefined) assistantText = event.assistant_text
        if (event?.result_text !== undefined) resultText = event.result_text
      },
    })

    const outcome: ProviderOutcome = {
      exit_code: processResult.exit_code,
      signal: processResult.signal,
    }
    if (workerSessionId !== undefined) outcome.worker_session_id = workerSessionId
    if (processResult.exit_code === 0) {
      const text = assistantText ?? resultText
      if (text === undefined) throw new Error('Cursor completed without a textual result')
      const modelResult = parseCursorResultText(text)
      await writePrivateFile(
        context.model_result_path,
        `${JSON.stringify(modelResult, null, 2)}\n`,
      )
      outcome.model_result = modelResult
    }
    return outcome
  }
}
