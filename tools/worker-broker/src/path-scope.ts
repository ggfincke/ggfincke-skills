// tools/worker-broker/src/path-scope.ts
// normalize conservative path prefixes & compare assignments with Git changes

import path from 'node:path'

const GLOB_CHARACTERS = /[*?[\]{}!]/u

export function normalizeAllowedPath(value: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error('allowed paths must be non-empty and have no surrounding whitespace')
  }
  if (value.includes('\\') || path.posix.isAbsolute(value)) {
    throw new Error(`allowed path must be a POSIX repository-relative path: ${value}`)
  }
  if (GLOB_CHARACTERS.test(value)) {
    throw new Error(`allowed path prefixes cannot contain glob characters: ${value}`)
  }

  const withoutTrailingSlash = value.replace(/\/+$/u, '')
  const normalized = path.posix.normalize(withoutTrailingSlash)
  if (
    normalized === '' ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized !== withoutTrailingSlash
  ) {
    throw new Error(`allowed path is not normalized: ${value}`)
  }
  if (normalized === '.git' || normalized.startsWith('.git/')) {
    throw new Error('allowed paths cannot grant access to Git metadata')
  }
  return normalized
}

export function normalizeAllowedPaths(values: readonly string[]): string[] {
  const normalized = [...new Set(values.map(normalizeAllowedPath))].sort()
  return normalized.filter(
    (candidate, index) =>
      !normalized.some(
        (other, otherIndex) =>
          otherIndex !== index && isPathWithinPrefix(candidate, other),
      ),
  )
}

export function isPathWithinPrefix(filePath: string, prefix: string): boolean {
  return filePath === prefix || filePath.startsWith(`${prefix}/`)
}

export function scopeViolations(
  changedFiles: readonly string[],
  allowedPaths: readonly string[],
): string[] {
  return changedFiles.filter(
    (filePath) => !allowedPaths.some((prefix) => isPathWithinPrefix(filePath, prefix)),
  )
}

export function scopesOverlap(left: readonly string[], right: readonly string[]): boolean {
  return left.some((leftPath) =>
    right.some(
      (rightPath) =>
        isPathWithinPrefix(leftPath, rightPath) ||
        isPathWithinPrefix(rightPath, leftPath),
    ),
  )
}
