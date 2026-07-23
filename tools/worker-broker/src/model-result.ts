// tools/worker-broker/src/model-result.ts
// validate provider prose against the broker's compact structured result contract

import type { ModelWorkerResult } from './contracts.js'

export function parseModelResult(value: unknown, provider: string): ModelWorkerResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${provider} model result must be an object`)
  }
  const candidate = value as Record<string, unknown>
  const stringArray = (field: string): string[] => {
    const entry = candidate[field]
    if (!Array.isArray(entry) || entry.some((item) => typeof item !== 'string')) {
      throw new Error(`${provider} model result ${field} must be an array of strings`)
    }
    return entry as string[]
  }
  if (typeof candidate.summary !== 'string') {
    throw new Error(`${provider} model result summary must be a string`)
  }
  return {
    summary: candidate.summary,
    assumptions: stringArray('assumptions'),
    risks: stringArray('risks'),
    follow_ups: stringArray('follow_ups'),
  }
}

export function parseModelResultText(text: string, provider: string): ModelWorkerResult {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed)
  const direct = fenced?.[1] ?? trimmed
  try {
    return parseModelResult(JSON.parse(direct) as unknown, provider)
  } catch (directError) {
    const end = trimmed.lastIndexOf('}')
    for (
      let start = trimmed.lastIndexOf('{', end);
      start >= 0;
      start = trimmed.lastIndexOf('{', start - 1)
    ) {
      try {
        return parseModelResult(
          JSON.parse(trimmed.slice(start, end + 1)) as unknown,
          provider,
        )
      } catch {
        // keep searching backward for the final complete result object
      }
    }
    throw directError
  }
}
