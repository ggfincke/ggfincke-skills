---
title: Stabilize Defaults Passed Across Reference Boundaries
impact: MEDIUM
impactDescription: avoids changing downstream callback or dependency identities
tags: rerender, memo, optimization
---

## Stabilize Defaults Passed Across Reference Boundaries

`memo` compares incoming props before calling the component. Omitting an optional callback does not by itself defeat that component's own memo boundary: a destructuring default is created only when the body actually runs.

A default function can matter downstream. In this example, changing `status` rerenders `UserAvatar`, creates a new default callback, and changes the props of its memoized child.

**Unstable downstream reference:**

```tsx
import { memo } from 'react'

const AvatarButton = memo(function AvatarButton({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick}>Open avatar</button>
})

const UserAvatar = memo(function UserAvatar({ status, onClick = () => {} }: {
  status: string
  onClick?: () => void
}) {
  return <><span>{status}</span><AvatarButton onClick={onClick} /></>
})
```

**Stable default when that downstream boundary matters:**

```tsx
const NOOP = () => {}

const UserAvatar = memo(function UserAvatar({ status, onClick = NOOP }: {
  status: string
  onClick?: () => void
}) {
  return <><span>{status}</span><AvatarButton onClick={onClick} /></>
})
```

The same distinction applies to default objects/arrays passed to children or used as Effect dependencies. Do not hoist every default or add `memo` by habit. Check React Compiler and demonstrate that the downstream work or identity contract matters; unchanged incoming props already allow the outer `memo` to skip its body.

Reference: [React memo](https://react.dev/reference/react/memo).
