---
title: Cache Storage Only with Bounded Ownership and Invalidation
impact: LOW-MEDIUM
impactDescription: may reduce synchronous storage reads on measured hot paths
tags: javascript, localStorage, storage, caching, performance
---

## Cache Storage Only with Bounded Ownership and Invalidation

Storage reads can be costly, but caching changes freshness. Prefer the existing state/storage owner. The following browser cache has one known key, handles blocked storage, and falls back to `light`; it is not reactive React state or a general request cache.

```typescript
let themeCache: string | null | undefined

function getTheme(): string {
  if (typeof window === 'undefined') return 'light'
  try {
    if (themeCache === undefined) themeCache = window.localStorage.getItem('theme')
    return themeCache ?? 'light'
  } catch {
    return 'light'
  }
}

function writeTheme(value: string | null): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (value === null) window.localStorage.removeItem('theme')
    else window.localStorage.setItem('theme', value)
    themeCache = value
    return true
  } catch {
    themeCache = undefined
    return false
  }
}

function subscribeToThemeInvalidation(): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === 'theme') themeCache = undefined
  }
  const onVisibility = () => {
    if (document.visibilityState === 'visible') themeCache = undefined
  }
  window.addEventListener('storage', onStorage)
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    window.removeEventListener('storage', onStorage)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
```

Install the subscription once from a browser lifecycle and run its cleanup. Cross-tab `storage` events invalidate the key; `key === null` represents `clear()`. Same-tab writes do not emit that event: route them through `writeTheme`, and invalidate this cache after any same-tab `localStorage.clear()`. If the application cannot own all relevant writes, do not keep this cache. Use the existing store or `useSyncExternalStore` when rendered UI must subscribe to changes.

**Cookies: parse a fresh snapshot instead of keeping an indefinitely stale cache.** Split at the first equals sign so values such as `abc==` stay intact. Keep raw values unless the caller's cookie contract requires decoding.

```typescript
function parseCookies(value: string): Map<string, string> {
  const cookies = new Map<string, string>()
  for (const part of value.split(';')) {
    const cookie = part.trim()
    const separator = cookie.indexOf('=')
    if (separator < 0) continue
    cookies.set(cookie.slice(0, separator), cookie.slice(separator + 1))
  }
  return cookies
}

function getCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined
  return parseCookies(document.cookie).get(name)
}
```

The last duplicate cookie name wins here, matching the earlier `Object.fromEntries` example. Server-set cookies and direct `document.cookie` writes need no cache invalidation because each call reads anew. Do not cache credentials or introduce a cookie subscription just for this micro-optimization.
