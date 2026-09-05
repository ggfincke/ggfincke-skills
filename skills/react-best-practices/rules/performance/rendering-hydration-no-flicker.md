---
title: Keep Initial Theme State Consistent Across Hydration
impact: MEDIUM
impactDescription: avoids a theme mismatch when the server knows the preference
tags: rendering, ssr, hydration, localStorage, flicker
---

## Keep Initial Theme State Consistent Across Hydration

Prefer a theme value that the server and first client render share. Read a nonsecret preference cookie through the framework's server API, validate it to `light` or `dark`, and pass that value as `initialTheme`. The serialized client prop must match the value used for server rendering; do not independently read localStorage during the first client render.

**Client component with a server-provided initial snapshot:**

```tsx
'use client'

import { useState, type ReactNode } from 'react'

type Theme = 'light' | 'dark'

export function ThemeWrapper({ initialTheme, children }: {
  initialTheme: Theme
  children: ReactNode
}) {
  const [theme, setTheme] = useState(initialTheme)
  return (
    <div className={theme}>
      <button onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}>
        Toggle theme
      </button>
      {children}
    </div>
  )
}
```

The application owns reading and persisting the validated preference. Wire the toggle to that existing persistence path if it should survive a reload. Changes after hydration are normal React updates. This approach needs no new inline bootstrap script or CSP exception; it also works when browser storage is unavailable.

If the server cannot know the preference, choose an explicit tradeoff: a deterministic fallback followed by a guarded Effect may visibly update, while CSS `prefers-color-scheme` can handle a purely visual system preference. A maintained framework theme integration may support a pre-paint script, but verify both its React hydration contract and the application's CSP nonce/hash requirements. Never interpolate an untrusted preference into executable script text.

Changing DOM classes before hydration does not by itself make React's expected tree match them. `suppressHydrationWarning` is an escape hatch, not a proof of parity. Check the actual server HTML, first hydrated output, console diagnostics, and the selected theme in the target application before claiming flicker-free behavior. This preference recipe is not an authentication-state strategy.

Reference: [React hydrateRoot](https://react.dev/reference/react-dom/client/hydrateRoot).
