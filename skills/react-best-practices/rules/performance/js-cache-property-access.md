---
title: Cache Property Access in Loops
impact: LOW-MEDIUM
impactDescription: reduces lookups
tags: javascript, loops, optimization, caching
---

## Cache Property Access in Loops

Consider caching property reads only after profiling a hot path. Modern engines may already optimize them. This example assumes plain stable data: `process` must not change `obj.config.settings.value` or the array length, and property reads must not have getter/proxy side effects. Otherwise hoisting changes observable behavior. The source-level difference below is not a measured speedup.

**Repeated nested property reads inside the loop:**

```typescript
for (let i = 0; i < arr.length; i++) {
  process(obj.config.settings.value)
}
```

**Read the nested value once before the loop:**

```typescript
const value = obj.config.settings.value
const len = arr.length
for (let i = 0; i < len; i++) {
  process(value)
}
```
