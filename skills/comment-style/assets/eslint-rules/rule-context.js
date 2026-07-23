// eslint-rules/rule-context.js
// share ESLint context accessors, repo-root resolution, & comment fixers

import { existsSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

export const getSourceCode = (context) =>
  context.sourceCode ?? context.getSourceCode()

export const getAllComments = (context) =>
  getSourceCode(context).getAllComments()

export const getFilename = (context) =>
  context.filename ?? context.getFilename()

export const getCwd = (context) => context.cwd ?? process.cwd()

const normalizePath = (value) => value.replace(/\\/g, '/')

// one lookup per directory is enough for a whole lint run
const repoRootCache = new Map()

// walk up from the linted file to the nearest .git, matching the Python
// enforcer's `git rev-parse --show-toplevel` definition of repo-relative
// (.git is a file rather than a directory in worktrees & submodules)
const nearestRepoRoot = (start) =>
{
  if (repoRootCache.has(start)) return repoRootCache.get(start)
  let current = start
  let found
  for (;;)
  {
    if (existsSync(resolve(current, '.git')))
    {
      found = current
      break
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  repoRootCache.set(start, found)
  return found
}

// repo-relative path for a linted file, plus how its anchor was chosen: an
// explicit `root` option wins, then the nearest .git ancestor, then ESLint's
// cwd as a last resort. anchoring on the repo rather than the cwd is what
// keeps results identical whether ESLint runs from the root or from a package
// subdirectory
// * `guessed` marks the cwd fallback, where no .git & no `root` pinned the
//   anchor. the resulting path is a guess, so callers must report without
//   autofixing -- in a tree with no .git (vendored copy, tarball extract,
//   build sandbox, Docker COPY of sources only) `eslint --fix` run from a
//   package subdirectory would otherwise rewrite correct headers en masse
export const resolveRepoRelative = (filename, { root, cwd } = {}) =>
{
  if (!isAbsolute(filename))
  {
    return { path: normalizePath(filename), guessed: false }
  }
  const base = cwd ?? process.cwd()
  if (root)
  {
    return {
      path: normalizePath(relative(resolve(base, root), filename)),
      guessed: false,
    }
  }
  const found = nearestRepoRoot(dirname(filename))
  return {
    path: normalizePath(relative(found ?? base, filename)),
    guessed: found === undefined,
  }
}

// path-only view for callers that do not gate behavior on anchor confidence
export const repoRelativePath = (filename, options) =>
  resolveRepoRelative(filename, options).path

export const wrapCommentText = (comment, text) =>
  comment.type === 'Line' ? `//${text}` : `/*${text}*/`
