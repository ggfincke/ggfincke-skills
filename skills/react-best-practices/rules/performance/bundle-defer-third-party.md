---
title: Defer Non-Critical Third-Party Libraries
impact: MEDIUM
impactDescription: loads after hydration
tags: bundle, third-party, analytics, defer
---

## Defer Non-Critical Third-Party Libraries

Analytics, logging, and error tracking don't block user interaction, but use each vendor's documented integration first. Only defer a third-party component with `next/dynamic(..., { ssr: false })` from a Client Component; `ssr: false` is not supported in Server Components such as App Router root layouts.

**Correct for Vercel Analytics in an App Router root layout:**

```tsx
import { Analytics } from '@vercel/analytics/next'

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
```

**Correct for browser-only third-party widgets inside a Client Component:**

```tsx
'use client'

import dynamic from 'next/dynamic'

const ChatWidget = dynamic(
  () => import('./chat-widget').then(m => m.ChatWidget),
  { ssr: false }
)

export function SupportLauncher() {
  return <ChatWidget />
}
```
