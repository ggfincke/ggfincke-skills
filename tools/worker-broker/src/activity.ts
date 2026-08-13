// tools/worker-broker/src/activity.ts
// persist bounded provider-neutral worker activity in stable sequence order

import { appendFile, open, readFile } from 'node:fs/promises'
import { PRIVATE_FILE_MODE, securePrivateFile } from './artifact.js'
import type {
  ActivityInput,
  ActivityPhase,
  ActivityRecord,
} from './contracts.js'

const MAX_SUMMARY_CHARACTERS = 1_000

export interface ActivityMessageSnapshot
{
  summary: string
  recorded_at?: string
}

export function sanitizeActivitySummary(summary: string): string | undefined
{
  const controlSafe = summary
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, '')
    .trim()
  if (controlSafe === '') return undefined
  return [...controlSafe].slice(0, MAX_SUMMARY_CHARACTERS).join('')
}

export function parseActivitySummary(text: string): string | undefined
{
  let value: unknown
  try
  {
    value = JSON.parse(text)
  }
  catch
  {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return undefined
  const summary = (value as Record<string, unknown>).summary
  return typeof summary === 'string'
    ? sanitizeActivitySummary(summary)
    : undefined
}

export class ActivityWriter
{
  private sequence = 0
  private needsDelimiter = false
  private openPhase: ActivityPhase | undefined
  private lastMessage: string | undefined
  private lastMessageAt: string | undefined
  private pendingActions = 0
  private pending: Promise<void>

  constructor(
    private readonly filePath: string,
    private readonly now: () => Date = () => new Date()
  )
  {
    this.pending = this.initialize()
  }

  private async initialize(): Promise<void>
  {
    const handle = await open(this.filePath, 'a', PRIVATE_FILE_MODE)
    await handle.close()
    await securePrivateFile(this.filePath)
    const content = await readFile(this.filePath, 'utf8')
    this.needsDelimiter = content !== '' && !content.endsWith('\n')
    const lines = content.split('\n')
    for (const line of lines)
    {
      try
      {
        const record = JSON.parse(line) as Record<string, unknown>
        if (
          Number.isSafeInteger(record.sequence) &&
          (record.sequence as number) > this.sequence
        )
        {
          this.sequence = record.sequence as number
        }
        this.applyPriorRecord(record)
      }
      catch
      {
        // malformed prior records stay in-band without blocking new activity
      }
    }
  }

  private applyPriorRecord(record: Record<string, unknown>): void
  {
    if (record.schema_version !== 1) return
    // the newest prose line is the other half of a useful progress report; a
    // timed-out wait that carries only job ids is what drove the 5-minute poll
    if (record.kind === 'message' && typeof record.summary === 'string')
    {
      this.lastMessage = record.summary
      if (typeof record.recorded_at === 'string')
      {
        this.lastMessageAt = record.recorded_at
      }
      return
    }
    if (record.kind === 'action')
    {
      if (record.status === 'started') this.pendingActions += 1
      else if (
        (record.status === 'completed' || record.status === 'failed') &&
        this.pendingActions > 0
      )
      {
        this.pendingActions -= 1
      }
      return
    }
    const phase = record.phase
    if (
      record.kind !== 'phase' ||
      (phase !== 'preparing' &&
        phase !== 'working' &&
        phase !== 'verifying' &&
        phase !== 'finalizing')
    )
    {
      return
    }
    if (record.status === 'started') this.openPhase = phase
    else if (
      (record.status === 'completed' || record.status === 'failed') &&
      this.openPhase === phase
    )
    {
      this.openPhase = undefined
    }
  }

  async currentOpenPhase(): Promise<ActivityPhase | undefined>
  {
    await this.pending.catch(() => undefined)
    return this.openPhase
  }

  // replayed by initialize(), so this survives a daemon restart w/o re-reading
  async latestMessage(): Promise<ActivityMessageSnapshot | undefined>
  {
    await this.pending.catch(() => undefined)
    if (this.lastMessage === undefined) return undefined
    const latest: ActivityMessageSnapshot = { summary: this.lastMessage }
    if (this.lastMessageAt !== undefined)
    {
      latest.recorded_at = this.lastMessageAt
    }
    return latest
  }

  async failPendingActions(): Promise<void>
  {
    await this.pending.catch(() => undefined)
    const count = this.pendingActions
    for (let index = 0; index < count; index += 1)
    {
      await this.append({ kind: 'action', status: 'failed' })
    }
  }

  append(input: ActivityInput): Promise<void>
  {
    this.pending = this.pending
      .catch(() => undefined)
      .then(async () =>
      {
        const sequence = this.sequence + 1
        let record: ActivityRecord
        if (input.kind === 'message')
        {
          const summary = sanitizeActivitySummary(input.summary)
          if (summary === undefined) return
          record = {
            schema_version: 1,
            sequence,
            recorded_at: this.now().toISOString(),
            kind: 'message',
            summary,
          }
        }
        else
        {
          record = {
            schema_version: 1,
            sequence,
            recorded_at: this.now().toISOString(),
            ...input,
          }
        }
        const delimiter = this.needsDelimiter ? '\n' : ''
        await appendFile(
          this.filePath,
          `${delimiter}${JSON.stringify(record)}\n`
        )
        await securePrivateFile(this.filePath)
        this.needsDelimiter = false
        this.sequence = sequence
        this.applyPriorRecord(record)
      })
    return this.pending
  }
}
