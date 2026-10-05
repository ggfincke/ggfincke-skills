// tools/worker-broker/src/providers/agy.ts
// parse Antigravity headless evidence and stop on broadened native capabilities

import { z } from 'zod'
import { writePrivateFile } from '../artifact.js'
import { assignmentPrompt } from '../assignment-prompt.js'
import type {
  BrokerConfig,
  ProviderOutcome,
  ProviderRunContext,
  WorkerProvider,
} from '../contracts.js'
import { parseModelResult } from '../model-result.js'
import { runProcess } from '../process-runner.js'
import { AGY_AGENT_NAME, AGY_READ_TOOLS } from '../targets.js'

const EventSchema = z
  .object({
    event: z.string(),
    conversation_id: z.string().optional(),
    init: z
      .object({
        agent: z.string().optional(),
        model: z.string().optional(),
        tools: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    step_update: z
      .object({
        tool_name: z.string().optional(),
        subagent_info: z.unknown().optional(),
        text_delta: z.string().optional(),
      })
      .passthrough()
      .optional(),
    result: z.unknown().optional(),
  })
  .passthrough()

export function parseAgyResult(
  value: unknown
): ReturnType<typeof parseModelResult>
{
  const result = value as Record<string, unknown> | undefined
  if (!result || result.status !== 'SUCCESS')
    throw new Error(`Antigravity ended with ${String(result?.status)}`)
  return parseModelResult(result.structured_output, 'Antigravity')
}

export class AgyProvider implements WorkerProvider
{
  readonly name = 'agy' as const

  constructor(private readonly config: BrokerConfig)
  {}

  async run(context: ProviderRunContext): Promise<ProviderOutcome>
  {
    if (context.request.mode !== 'read' || !context.request.model)
      throw new Error('Antigravity requires read mode and a pinned model')
    const prompt = assignmentPrompt(context)
    await writePrivateFile(context.prompt_path, prompt)
    const controller = new AbortController()
    const signal = AbortSignal.any([context.signal, controller.signal])
    let terminal: unknown
    let session: string | undefined
    let observedModel: string | undefined
    let invalid: string | undefined
    let initialized = false
    const schema = {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        assumptions: { type: 'array', items: { type: 'string' } },
        risks: { type: 'array', items: { type: 'string' } },
        follow_ups: { type: 'array', items: { type: 'string' } },
      },
      required: ['summary', 'assumptions', 'risks', 'follow_ups'],
      additionalProperties: false,
    }
    const outcome = await runProcess({
      command: this.config.agy_binary ?? 'agy',
      args: [
        '--print',
        prompt,
        '--model',
        context.request.model,
        '--agent',
        AGY_AGENT_NAME,
        '--output-format',
        'stream-json',
        '--json-schema',
        JSON.stringify(schema),
        '--disable-slash-commands',
        '--print-timeout',
        '31m',
      ],
      cwd: context.worktree,
      stdout_path: context.event_log_path,
      stderr_path: context.stderr_path,
      signal,
      timeout_ms: 30 * 60 * 1000,
      on_process_started: context.on_process_started,
      on_process_finished: context.on_process_finished,
      on_stdout_line: (line) =>
      {
        try
        {
          const event = EventSchema.parse(JSON.parse(line))
          if (event.event === 'init')
          {
            if (
              initialized ||
              event.init?.agent !== AGY_AGENT_NAME ||
              event.init?.model !== context.request.model ||
              !Array.isArray(event.init?.tools) ||
              event.init.tools.some(
                (tool: unknown) =>
                  typeof tool !== 'string' || !AGY_READ_TOOLS.includes(tool)
              )
            )
              throw new Error(
                'Antigravity effective agent/model/tools differ from the read-only contract'
              )
            initialized = true
            observedModel = event.init?.model
            session = event.conversation_id
          }
          else if (!initialized)
            throw new Error(
              'Antigravity emitted work before verified initialization'
            )
          if (event.event === 'step_update')
          {
            const step = event.step_update
            if (
              step?.subagent_info ||
              (step?.tool_name && !AGY_READ_TOOLS.includes(step.tool_name))
            )
              throw new Error('Antigravity exposed forbidden tools or nesting')
            if (typeof step?.text_delta === 'string')
              context.on_activity?.({
                kind: 'message',
                summary: step.text_delta.slice(0, 500),
              })
          }
          if (event.event === 'result')
          {
            if (terminal)
              throw new Error('Antigravity emitted multiple terminal results')
            terminal = event.result
          }
        }
        catch (error)
        {
          invalid = String(error)
          controller.abort()
        }
      },
    })
    if (invalid) throw new Error(invalid)
    if (signal.aborted || outcome.timed_out || outcome.exit_code !== 0)
      throw new Error('Antigravity cancelled, timed out, or failed')
    if (!initialized)
      throw new Error('Antigravity did not report its effective tools')
    const result = parseAgyResult(terminal)
    await writePrivateFile(context.model_result_path, JSON.stringify(result))
    return {
      exit_code: 0,
      signal: null,
      model_result: result,
      ...(session ? { worker_session_id: session } : {}),
      ...(observedModel ? { effective_model: observedModel } : {}),
    }
  }
}
