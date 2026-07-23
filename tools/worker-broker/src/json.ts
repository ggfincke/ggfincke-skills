// tools/worker-broker/src/json.ts
// share broker JSON file parsing & stable pretty serialization

import { readFile } from 'node:fs/promises'

export async function readJson<T = unknown>(filePath: string): Promise<T>
{
  return JSON.parse(await readFile(filePath, 'utf8')) as T
}

export function serializePrettyJson(value: unknown): string
{
  return `${JSON.stringify(value, null, 2)}\n`
}
