---
title: Use Pure Lazy State Initialization
impact: MEDIUM
impactDescription: avoids repeating an expensive initial calculation on updates
tags: react, hooks, useState, performance, initialization
---

## Use Pure Lazy State Initialization

Pass a function to `useState` for an expensive initial calculation. Calling the function in the argument evaluates it on every render; passing it lets React call it during initialization. Initializers must be pure and may run twice in development Strict Mode, so "once" is not a side-effect guarantee.

**Repeated calculation:**

```tsx
const [searchIndex] = useState(buildSearchIndex(initialItems))
```

**Lazy initial snapshot:**

```tsx
const [searchIndex] = useState(() => buildSearchIndex(initialItems))
```

This intentionally captures initial items. If the index must follow changing props, derive it from current props (with measured memoization if useful) instead of leaving it in stale state.

**Storage-backed preferences need a renderer decision.** For SSR, use the same deterministic first state on the server and client, then read browser storage after hydration:

```tsx
import { useEffect, useState } from 'react'

type Settings = { theme: 'light' | 'dark' }
const DEFAULT_SETTINGS: Settings = { theme: 'light' }

function readBrowserSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = window.localStorage.getItem('settings')
    const value: unknown = raw === null ? null : JSON.parse(raw)
    if (typeof value === 'object' && value !== null && 'theme' in value) {
      if (value.theme === 'light' || value.theme === 'dark') return { theme: value.theme }
    }
  } catch {
    // blocked storage or malformed data keeps the deterministic fallback
  }
  return DEFAULT_SETTINGS
}

export function UserProfile() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  useEffect(() => { setSettings(readBrowserSettings()) }, [])
  return <p>Theme: {settings.theme}</p>
}
```

This fallback can visibly update after hydration. If that matters, pass a server-known initial preference as described in [the hydration rule](./rendering-hydration-no-flicker.md). A client-only `createRoot` app may use `useState(readBrowserSettings)` directly; a `typeof window` guard alone does not guarantee matching SSR/client initial output. Storage access can fail in normal or private browsing, so keep the failure path in either renderer.

For cheap literals and existing values such as `useState(0)` or `useState(initialValue)`, a lazy wrapper usually adds no value. Do not read or mutate the DOM in an initializer.

Reference: [React useState](https://react.dev/reference/react/useState).
