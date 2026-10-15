// tools/worker-broker/src/run-store.ts
// persist explicit run scope while counting assignments from authoritative job records

import { randomUUID } from 'node:crypto'
import { readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { writePrivateFile } from './artifact.js'
import { PROVIDER_NAMES, WORKER_MODES } from './contracts.js'

export const CreateRunSchema = z
  .object({
    repo: z.string().min(1),
    targets: z
      .array(
        z
          .object({
            provider: z.enum(PROVIDER_NAMES),
            model: z.string().min(1).optional(),
            modes: z.array(z.enum(WORKER_MODES)).min(1).default(['read']),
          })
          .strict()
      )
      .min(1),
    max_assignments: z.number().int().positive().max(100).default(4),
    allow_battery: z.boolean().default(false),
  })
  .strict()

export type CreateRunInput = z.input<typeof CreateRunSchema>

const RunSchema = z
  .object({
    schema_version: z.literal(1),
    id: z.string().uuid(),
    repo: z.string(),
    targets: z.array(
      z
        .object({
          provider: z.enum(PROVIDER_NAMES),
          model: z.string().min(1),
          modes: z.array(z.enum(WORKER_MODES)),
          endpoint: z.string().optional(),
        })
        .strict()
    ),
    max_assignments: z.number().int().positive(),
    allow_battery: z.boolean(),
    created_at: z.string().datetime(),
    expires_at: z.string().datetime(),
    closed_at: z.string().datetime().optional(),
  })
  .strict()

export type WorkerRun = z.infer<typeof RunSchema>

export class RunStore
{
  constructor(private readonly stateDir: string)
  {}

  private file(id: string): string
  {
    z.string().uuid().parse(id)
    return path.join(this.stateDir, 'runs', `${id}.json`)
  }

  async read(id: string): Promise<WorkerRun>
  {
    const run = RunSchema.parse(
      JSON.parse(await readFile(this.file(id), 'utf8'))
    )
    if (run.id !== id)
      throw new Error('stored run identity does not match its filename')
    return run
  }

  async write(run: WorkerRun): Promise<void>
  {
    const file = this.file(run.id)
    const temporary = `${file}.${randomUUID()}.tmp`
    await writePrivateFile(
      temporary,
      JSON.stringify(RunSchema.parse(run), null, 2) + '\n'
    )
    await rename(temporary, file)
  }
}
