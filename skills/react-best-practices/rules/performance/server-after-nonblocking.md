---
title: Use after() for Permitted Best-Effort Work
impact: MEDIUM
impactDescription: removes noncritical work from response latency
tags: server, async, logging, analytics, side-effects
---

## Use after() for Permitted Best-Effort Work

Use Next.js `after()` only when the installed version and deployment adapter support it (stable in Next.js 15.1+). It schedules work after a response or prerender completes; it is not a durable job queue.

**A noncritical metric on the response path:**

```tsx
import { updateDatabase, logUserAction } from '@/app/utils'

export async function POST(request: Request) {
  await updateDatabase(request)
  await logUserAction({ event: 'record-updated' })
  return Response.json({ status: 'success' })
}
```

**The same best-effort metric after the response:**

```tsx
import { after } from 'next/server'
import { updateDatabase, logUserAction } from '@/app/utils'

export async function POST(request: Request) {
  await updateDatabase(request)
  after(async () => {
    await logUserAction({ event: 'record-updated' })
  })
  return Response.json({ status: 'success' })
}
```

The application-owned `updateDatabase` still authenticates, authorizes, and finishes the mutation before success. The callback awaits the logger so its promise represents the work's completion. Log only approved fields; never send raw session cookies, bearer tokens, complete requests, or other credentials to telemetry. Include a nonsecret actor identifier only when the application permits it.

Keep security/audit records that must be durable on an acknowledged path, such as the mutation's transaction or an accepted durable queue write. Notifications and cache invalidation may also be correctness-critical; do not move them here automatically.

Callbacks remain bounded by the platform's duration limit, including `maxDuration` where supported, and can run after failed or redirected responses. Static prerenders can run them at build/revalidation time. Request APIs inside the callback are supported in Route Handlers and Server Functions, but not in Server Components; capture approved values in the supported outer context when needed. Static export does not support this feature.

Reference: [Next.js after](https://nextjs.org/docs/app/api-reference/functions/after).
