---
title: Preserve Lookup Semantics When Building Index Maps
impact: LOW-MEDIUM
impactDescription: amortizes repeated linear scans
tags: javascript, map, indexing, optimization, performance
---

## Preserve Lookup Semantics When Building Index Maps

Build an index when repeated lookups justify its construction and memory cost. These examples use string IDs and pure reads. A `find` lookup selects the first duplicate, so the index must not silently keep the last one.

**Before:**

```typescript
function processOrders(orders: Order[], users: User[]) {
  return orders.map(order => ({
    ...order,
    user: users.find(user => user.id === order.userId)
  }))
}
```

**Equivalent first-match index:**

```typescript
function processOrders(orders: Order[], users: User[]) {
  const userById = new Map<string, User>()
  for (const user of users) {
    if (!userById.has(user.id)) userById.set(user.id, user)
  }
  return orders.map(order => ({
    ...order,
    user: userById.get(order.userId)
  }))
}
```

Missing IDs still yield `undefined`. `new Map(users.map(...))` is suitable only when unique IDs are an established invariant or last-match behavior is intentional. For other key types, check equality semantics too; `Map` treats `NaN` keys as equal while `===` does not.

Expected work can move from repeated scans toward one build plus lookups. This is a cost model, not a measured speedup: a small or one-off lookup may not benefit. Invalidate or rebuild the index when its source changes.
