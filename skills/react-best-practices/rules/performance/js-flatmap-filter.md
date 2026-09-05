---
title: Preserve Predicates When Combining Map and Filter
impact: LOW-MEDIUM
impactDescription: may avoid an intermediate full-size array on measured hot paths
tags: javascript, arrays, flatMap, filter, performance
---

## Preserve Predicates When Combining Map and Filter

Consider `flatMap` for a measured hot path, preserving the original mapping, predicate, order, and error behavior. It still creates small callback arrays; it is not universally faster than `map().filter()`.

**Before:**

```typescript
const userNames = users
  .map(user => user.isActive ? user.name : null)
  .filter(Boolean)
```

**Equivalent for these pure property reads:**

```typescript
const userNames = users.flatMap(user => {
  const name = user.isActive ? user.name : null
  return name ? [name] : []
})
```

The truthiness check matters: `filter(Boolean)` discards an active user's empty name too. Filtering only on `isActive` changes the output.

**Another truthiness-preserving transformation:**

```typescript
// Before
const emails = responses
  .map(response => response.success ? response.data.email : null)
  .filter(Boolean)

// After
const emails = responses.flatMap(response => {
  const email = response.success ? response.data.email : null
  return email ? [email] : []
})
```

**A different predicate must stay different:**

```typescript
// Before: retain zero, discard NaN
const numbers = strings.map(value => parseInt(value, 10)).filter(value => !isNaN(value))

// After
const numbers = strings.flatMap(value => {
  const number = parseInt(value, 10)
  return isNaN(number) ? [] : [number]
})
```

Do not change a `NaN` test into truthiness or add validation that the original function did not perform. Combining passes can also change the order of callback side effects; keep the original shape when those effects matter. Benchmark only the application's relevant workload.
