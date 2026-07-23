// tools/worker-broker/src/artifact.ts
// enforce private modes on broker-owned directories & files

import { chmod, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const PRIVATE_DIRECTORY_MODE = 0o700
export const PRIVATE_FILE_MODE = 0o600

export async function secureDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
  await chmod(directory, PRIVATE_DIRECTORY_MODE)
}

export async function preparePrivateFile(filePath: string): Promise<void> {
  await secureDirectory(path.dirname(filePath))
  await writeFile(filePath, '', { mode: PRIVATE_FILE_MODE })
  await chmod(filePath, PRIVATE_FILE_MODE)
}

export async function writePrivateFile(
  filePath: string,
  data: string | Uint8Array,
): Promise<void> {
  await secureDirectory(path.dirname(filePath))
  await writeFile(filePath, data, { mode: PRIVATE_FILE_MODE })
  await chmod(filePath, PRIVATE_FILE_MODE)
}

export async function securePrivateFile(
  filePath: string,
  ignoreMissing = false,
): Promise<void> {
  try {
    await chmod(filePath, PRIVATE_FILE_MODE)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (ignoreMissing && code === 'ENOENT') return
    throw error
  }
}
