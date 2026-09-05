---
title: Cross-Request LRU Caching
impact: HIGH
impactDescription: caches across requests
tags: server, cache, lru, cross-request
---

## Cross-Request LRU Caching

`React.cache()` only works within one request. For data shared across sequential requests (user clicks button A then button B), use an LRU cache only for data that is safe to share across requests. Keys must include every authorization boundary that affects the result, and mutations must invalidate or bypass stale entries.

Use the project's existing cache owner. The `lru-cache` example assumes that package is already present or its adoption is separately approved; this rule does not authorize adding a cache service or dependency.

**Implementation:**

```typescript
import { LRUCache } from 'lru-cache'

type UserSummary = {
  id: string
  name: string
  avatarUrl: string | null
}

const cache = new LRUCache<string, UserSummary | null>({
  max: 1000,
  ttl: 5 * 60 * 1000  // 5 minutes
})

export async function getUserSummary(tenantId: string, viewerId: string, userId: string) {
  const cacheKey = `${tenantId}:${viewerId}:${userId}`
  const cached = cache.get(cacheKey)
  if (cached) return cached

  await assertCanViewUser({ tenantId, viewerId, userId })
  const user = await db.user.findFirst({
    where: { id: userId, tenantId },
    select: { id: true, name: true, avatarUrl: true }
  })
  cache.set(cacheKey, user)
  return user
}

// Request 1: DB query, result cached
// Request 2: cache hit, no DB query
```

Use when sequential user actions hit multiple endpoints needing the same non-sensitive or authorization-scoped data within seconds.

Do not cache request-specific secrets, unscoped user records, or data that changes without an invalidation path. Prefer a small DTO over the raw database row.

**With Vercel's [Fluid Compute](https://vercel.com/docs/fluid-compute):** LRU caching is especially effective because multiple concurrent requests can share the same function instance and cache. This means the cache persists across requests without needing external storage like Redis.

An in-process cache is not a cross-process or durable guarantee. Treat its retention as opportunistic; use the application's existing shared cache only when its consistency requirements need that boundary, rather than adding Redis by default.

Reference: [https://github.com/isaacs/node-lru-cache](https://github.com/isaacs/node-lru-cache)
