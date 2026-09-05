---
title: Choose Ref and Context APIs for the Supported React Version
impact: MEDIUM
impactDescription: preserves compatibility while using newer APIs where useful
tags: react19, refs, context, hooks
---

## Choose Ref and Context APIs for the Supported React Version

Check the application's React version and a library's entire supported peer-version range. React 19 allows function components to receive `ref` as a prop; it does not make existing `forwardRef` code incorrect. Keep a compatible wrapper when React 18 consumers still need it, and do not migrate working APIs without a task-specific reason.

**Supported React 18/19 wrapper:**

```tsx
import { forwardRef, type ComponentPropsWithoutRef } from 'react'

type InputProps = ComponentPropsWithoutRef<'input'>

const ComposerInput = forwardRef<HTMLInputElement, InputProps>((props, ref) => {
  return <input ref={ref} {...props} />
})
```

**React 19+ option for new function components:**

```tsx
import type { ComponentPropsWithRef } from 'react'

function ComposerInput({ ref, ...props }: ComponentPropsWithRef<'input'>) {
  return <input ref={ref} {...props} />
}
```

`useContext` remains supported in React 19. `use(context)` is an additional option that can read context after a conditional return or in a loop; it is not a mandatory replacement for ordinary context reads.

```tsx
import { createContext, use, useContext } from 'react'

const ThemeContext = createContext('light')

function ThemeLabel() {
  const theme = useContext(ThemeContext)
  return <span>{theme}</span>
}

function OptionalThemeLabel({ visible }: { visible: boolean }) {
  if (!visible) return null
  const theme = use(ThemeContext)
  return <span>{theme}</span>
}
```

The conditional `use` example requires React 19+. It still belongs inside a component or Hook and must not be placed in `try/catch`. On React 18, keep ordinary top-level `useContext` or split the conditional UI into a child. Preserve the repository's existing convention when both APIs are appropriate.

References: [React 19 ref props](https://react.dev/blog/2024/12/05/react-19), [useContext](https://react.dev/reference/react/useContext), [use](https://react.dev/reference/react/use).
