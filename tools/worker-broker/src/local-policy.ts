// tools/worker-broker/src/local-policy.ts
// inspect power and installed local models without starting inference

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'

export type PowerState = 'ac' | 'battery' | 'unknown'

export function parsePowerState(output: string): PowerState
{
  if (/Now drawing from 'AC Power'/u.test(output)) return 'ac'
  if (/Now drawing from 'Battery Power'/u.test(output)) return 'battery'
  return 'unknown'
}

export async function readPowerState(): Promise<PowerState>
{
  if (process.platform !== 'darwin') return 'unknown'
  try
  {
    const { stdout } = await promisify(execFile)(
      '/usr/bin/pmset',
      ['-g', 'batt'],
      { timeout: 2000 }
    )
    return parsePowerState(stdout)
  }
  catch
  {
    return 'unknown'
  }
}

export function localEndpoint(value: string): string
{
  const url = new URL(value)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
  {
    throw new Error('Ollama endpoint must be a loopback HTTP origin')
  }
  return url.origin
}

async function metadata(
  endpoint: string,
  route: string,
  body?: unknown
): Promise<unknown>
{
  const response = await fetch(`${localEndpoint(endpoint)}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' },
        }),
    redirect: 'error',
    signal: AbortSignal.timeout(3000),
  })
  if (!response.ok)
    throw new Error(
      `Ollama metadata unavailable: ${route} (${response.status})`
    )
  return await response.json()
}

function hasRemoteMetadata(value: unknown): boolean
{
  if (typeof value !== 'object' || value === null) return false
  return Object.entries(value).some(
    ([key, entry]) =>
      (/remote|cloud/iu.test(key) &&
        entry !== null &&
        entry !== false &&
        entry !== '') ||
      (typeof entry === 'object' && hasRemoteMetadata(entry))
  )
}

export async function installedLocalModels(
  endpoint: string
): Promise<string[]>
{
  const status = z
    .object({ cloud: z.object({ disabled: z.literal(true) }) })
    .safeParse(await metadata(endpoint, '/api/status'))
  if (!status.success)
    throw new Error('Ollama cloud execution must be disabled')
  const tags = z
    .object({ models: z.array(z.object({ name: z.string() }).passthrough()) })
    .parse(await metadata(endpoint, '/api/tags'))
  const models: string[] = []
  for (const model of tags.models)
  {
    if (/:cloud$/iu.test(model.name) || hasRemoteMetadata(model)) continue
    const details = await metadata(endpoint, '/api/show', { model: model.name })
    if (!hasRemoteMetadata(details)) models.push(model.name)
  }
  return models
}

export function requireLocalPower(
  power: PowerState,
  allowBattery: boolean
): void
{
  if (power === 'unknown' || (power === 'battery' && !allowBattery))
  {
    throw new Error(`local execution blocked: power is ${power}`)
  }
}
