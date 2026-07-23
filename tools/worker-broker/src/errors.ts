// tools/worker-broker/src/errors.ts
// normalize unknown thrown values for user-facing broker messages

export function errorMessage(error: unknown): string
{
  return error instanceof Error ? error.message : String(error)
}
