---
title: Preserve Empty and Tie Behavior When Replacing Sort
impact: LOW
impactDescription: one pass when only an extreme value is needed
tags: javascript, arrays, performance, sorting, algorithms
---

## Preserve Empty and Tie Behavior When Replacing Sort

A loop can avoid sorting when only min/max values are needed. Preserve empty results and which equal-valued item wins. These examples assume a dense array of projects with finite numeric `updatedAt` values; validate that invariant at the application's data boundary rather than silently changing invalid-input behavior here.

**Before:**

```typescript
interface Project {
  id: string
  name: string
  updatedAt: number
}

function getLatestProject(projects: Project[]) {
  const sorted = [...projects].sort((a, b) => b.updatedAt - a.updatedAt)
  return sorted[0]
}

function getOldestAndNewest(projects: Project[]) {
  const sorted = [...projects].sort((a, b) => a.updatedAt - b.updatedAt)
  return { oldest: sorted[0], newest: sorted[sorted.length - 1] }
}
```

**Equivalent single-pass versions:**

```typescript
function getLatestProject(projects: Project[]): Project | undefined {
  let latest = projects[0]
  if (latest === undefined) return undefined
  for (const project of projects) {
    if (project.updatedAt > latest.updatedAt) latest = project
  }
  return latest
}

function getOldestAndNewest(projects: Project[]): {
  oldest: Project | undefined
  newest: Project | undefined
} {
  let oldest = projects[0]
  let newest = projects[0]
  if (oldest === undefined || newest === undefined) {
    return { oldest: undefined, newest: undefined }
  }
  for (const project of projects) {
    if (project.updatedAt < oldest.updatedAt) oldest = project
    if (project.updatedAt >= newest.updatedAt) newest = project
  }
  return { oldest, newest }
}
```

An empty input still returns `undefined` values, not `null`. Stable descending sort selected the first latest project; stable ascending sort selected the first oldest and the last newest project. The `>` versus `>=` distinction preserves those tie choices.

The cost changes from sorting to a linear scan, but wall-clock benefit depends on the workload. `Math.min(...numbers)` / `Math.max(...numbers)` are convenient for small numeric arrays; their empty-input results are infinities, and spreading a large array can exceed engine argument limits. Neither is a drop-in replacement for this object-returning contract.
