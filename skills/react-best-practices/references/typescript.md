# React with TypeScript

Use this reference for typing React code: props, hooks, events, generics, and modeling state so impossible states do not compile. It covers the React/TypeScript interface, not general TypeScript. It is framework-neutral; do not pull in Next.js type helpers unless the repo already uses them.

## Typing posture

- Annotate the boundaries: props, exported hook/function returns, context shape, reducer actions. Let inference handle locals and component return types.
- Prefer `unknown` over `any`, and narrow instead of casting. A type assertion is a promise to the compiler, not a runtime check.
- Model impossible states out of existence with discriminated unions instead of several booleans plus nullable fields.
- Lean on `strict`. If `noUncheckedIndexedAccess` is on, it catches the unsafe array/record access that list rendering invites.
- Do not over-annotate. Explicit types on every local is noise; the type system already knows.

## Props

- House preference: type the props parameter directly instead of using `React.FC` / `FunctionComponent`, especially for generic components. This is a style/readability choice: modern `@types/react` does not add implicit children to `FunctionComponent`; declare `children` explicitly when accepted.
- `type` or `interface` is fine; match the repo. Use a union `type` when props have mutually exclusive modes.
- Extend native element props with `ComponentPropsWithoutRef<'button'>` instead of re-listing DOM attributes. Derive from another component with `ComponentProps<typeof Button>`.
- Type renderable children as `React.ReactNode`, not `JSX.Element` (too narrow) or `any`.
- Replace boolean-flag soup with a discriminated union so invalid combinations do not typecheck. This pairs with the composition-over-flags guidance in `react-core.md`.

```tsx
type AlertProps =
  | { variant: 'inline'; onDismiss?: () => void }
  | { variant: 'toast'; onDismiss: () => void; duration: number }
```

## Hooks

- `useState`: let primitives infer; give an explicit type when the initial value is `null` or a narrow union. `useState<User | null>(null)`, `useState<'idle' | 'loading' | 'error'>('idle')`. A bare string/number initial widens to `string`/`number` and loses the union.
- `useReducer`: type the state, and type actions as a discriminated union on a `type` field so the reducer narrows per action.
- `useRef`: `useRef<HTMLDivElement>(null)` for DOM nodes; `current` is `T | null`. Use `useRef<T>(initial)` for mutable instance values. Do not annotate a DOM ref as non-null.
- `useContext`: create the context with a typed shape and a guard hook that throws outside its provider, so consumers get a non-null type instead of null-checking everywhere.
- Custom hooks: return a named object, or a tuple with `as const` so the positions keep distinct types.

```tsx
const ThemeContext = createContext<Theme | null>(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (ctx === null) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
```

## Events and DOM

- Use the specific synthetic event types: `React.ChangeEvent<HTMLInputElement>`, `React.FormEvent<HTMLFormElement>`, `React.MouseEvent<HTMLButtonElement>`, `React.KeyboardEvent`.
- For handler props, use `React.ChangeEventHandler<HTMLInputElement>` and friends, or inline the function type.
- Let inline JSX handlers infer their event type from the attribute. Annotate only when the handler is declared separately.

## Generics

- Components can be generic: `function List<T>(props: ListProps<T>)`. In `.tsx`, write `<T,>` for arrow-function generics so the parser does not read it as JSX.
- Use generics to connect `items: T[]` to `renderItem: (item: T) => ReactNode`, so callers get inference instead of `any`.

## Async and external data

- Model fetch state as a discriminated union (`loading | success | error`) rather than `isLoading` plus nullable `data`. The success branch then carries non-null data and the error branch carries the error.
- Validate untyped boundaries: network JSON, `localStorage`, route params, env. Parse with the repo's schema library (zod, valibot) when present rather than asserting a shape you did not check.

## Inference helpers

- `import type { ... }` (or `import { type X }`) for type-only imports, so they erase cleanly and pull no runtime side effects.
- `satisfies` constrains a config or style object while keeping its precise inferred type: `const styles = { ... } satisfies Record<string, CSSProperties>`.
- `as const` for fixed literal arrays/objects used as tuples or option sets.

## Refs across versions

- React 19: new function components can accept `ref` in their props (`ref?: Ref<HTMLButtonElement>`). Existing supported `forwardRef` code is not a mandatory migration; retain it when React 18/library compatibility or repository conventions require it.
- Pre-React 19: `forwardRef<HTMLButtonElement, ButtonProps>(...)`. The first type argument is the ref element, the second the props.
