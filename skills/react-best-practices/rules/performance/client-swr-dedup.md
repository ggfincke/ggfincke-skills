---
title: Use the Existing Data Layer for Deduplication
impact: MEDIUM-HIGH
impactDescription: shares equivalent reads within a configured cache boundary
tags: client, swr, deduplication, data-fetching
---

## Use the Existing Data Layer for Deduplication

Prefer the project's existing query/cache layer. SWR is one option when already installed; this rule does not authorize adding it or replacing TanStack Query, Relay, router loaders, or another working data layer.

With SWR, consumers using the same key, cache provider, and compatible options can share cached data and deduplicated requests. Distinct cache providers, keys, timing, or revalidation settings can still cause separate requests. The `fetcher` and `updateUser` below are application functions that must handle HTTP failures and validate returned data.

**Shared reads:**

```tsx
import useSWR from 'swr'

function UserList() {
  const { data: users, error } = useSWR('/api/users', fetcher)
  // Render the application's loading, error, and data states.
}
```

**Data that is actually immutable:**

```tsx
import useSWRImmutable from 'swr/immutable'

function StaticContent() {
  const { data, error } = useSWRImmutable('/api/config', fetcher)
}
```

**User-triggered mutations (SWR 2+):**

```tsx
import useSWRMutation from 'swr/mutation'

function UpdateButton() {
  const { trigger, isMutating, error } = useSWRMutation('/api/user', updateUser)
  return <>
    <button disabled={isMutating} onClick={async () => {
      try {
        await trigger()
      } catch {
        // SWR exposes the failure through error for the UI below.
      }
    }}>Update</button>
    {error && <p role="alert">Update failed. Please retry.</p>}
  </>
}
```

Use the default exports shown above, not an undeclared project wrapper or named `useSWRMutation` import. Check the installed SWR version and follow its mutation argument, error, and cache-invalidation contracts.

References: [SWR mutation](https://swr.vercel.app/docs/mutation), [SWR revalidation and immutable data](https://swr.vercel.app/docs/revalidation).
