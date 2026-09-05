# React Core Practices

Use this reference for correctness, maintainability, and compiler-friendly React. It is based on official React docs, especially Rules of React, You Might Not Need an Effect, Synchronizing with Effects, Lifecycle of Reactive Effects, Hooks references, and React Compiler docs.

## Contents

- [Purity](#purity)
- [Hooks](#hooks)
- [Effects](#effects)
- [State](#state)
- [Forms and inputs](#forms-and-inputs)
- [Refs](#refs)
- [External stores](#external-stores)
- [Hydration](#hydration)
- [Context](#context)
- [Component APIs](#component-apis)
- [Accessibility](#accessibility)
- [Lists and keys](#lists-and-keys)
- [Escape hatches](#escape-hatches)
- [Rendering untrusted content](#rendering-untrusted-content)
- [React Compiler](#react-compiler)
- [React 19 notes](#react-19-notes)

## Purity

Components and Hooks must be pure:

- Same props, state, and context -> same rendered output.
- No mutation of props, state, context, module singletons, or values created outside the current render.
- No side effects during render: no network, timers, subscriptions, DOM mutation, storage writes, logging-as-behavior, random IDs, or date reads that affect output.
- Local mutation of values created during the same render is fine.
- Keep render resilient to Strict Mode remounts and repeated calls.

If a component needs a non-deterministic value, create it in state initialization, an event handler, or an Effect depending on what the value represents.

## Hooks

Follow Hook rules:

- Call Hooks only at the top level of function components or custom Hooks.
- Do not call Hooks conditionally, in loops, after early returns, in callbacks, or from ordinary functions.
- Custom Hooks should describe behavior, not lifecycle phases.
- Split custom Hooks when their dependencies or responsibilities are unrelated.
- Do not use refs or dependency omissions to bypass React's data flow without a clear reason.

React 19's `use` API is the documented exception to the conditional/loop restriction: it can read context or a supported promise conditionally, but still belongs inside a component or Hook and must not be wrapped in `try/catch`. This exception does not apply to `useState`, `useContext`, or other Hooks.

When lint complains about dependencies, treat it as design feedback first. Usually the fix is to move event-specific code to the event, derive data during render, split the Effect, or stabilize a real input.

## Effects

Effects synchronize React with external systems:

- DOM APIs not represented in JSX.
- Network connections, subscriptions, sockets, observers, timers.
- Third-party widgets.
- Browser APIs with setup/cleanup.
- Analytics or telemetry tied to a component being visible.

Effects are usually wrong for:

- Deriving values from props or state.
- Mirroring props into state.
- Handling user events.
- Chaining state updates.
- Notifying a parent about data the parent should own.
- Resetting state that can be reset by a key.

Preferred alternatives:

- Calculate render data directly during render.
- Use `useMemo` only for expensive calculations.
- Store canonical state, not derived state.
- Reset a subtree by changing its `key`.
- Put event-caused work in the event handler.
- Lift shared state to the nearest common owner.
- Use a reducer when multiple state fields change as one transition.

When an Effect is valid:

- Include every reactive value it reads in its dependency list.
- Return cleanup for subscriptions, observers, timers, async race guards, and external resources.
- Keep setup and cleanup symmetric.
- Split unrelated synchronization into separate Effects.
- Avoid setting state in an Effect unless the state represents the external system or async result being synchronized.

Prefer `useEffect` by default. Use `useLayoutEffect` only when DOM measurement or mutation must happen before paint to avoid visible flicker. Use `useInsertionEffect` only for CSS-in-JS style injection libraries.

## State

Choose the smallest canonical state:

- Do not store values that can be derived from current props or state.
- Avoid duplicate state that can drift.
- Prefer IDs over storing copied objects from a collection.
- Use functional `setState` when the next value depends on the previous value.
- Use lazy `useState(() => initialValue)` for expensive initial values.
- Use reducers for multi-field transitions, state machines, or logic that benefits from named actions.

Avoid effect-driven resets. If all local state should reset when an identity changes, key the child by that identity. If only one piece of state needs adjustment, first check whether the adjusted value can be derived during render.

## Forms and inputs

Choose an input strategy and keep it consistent:

- Controlled inputs (`value` + `onChange`) when React must react to every keystroke: live validation, formatting, or dependent fields.
- Uncontrolled inputs with `defaultValue` and a ref when the value is only read on submit. Cheaper and less re-render churn.
- Never switch an input between controlled and uncontrolled across renders. A `value` that flips between defined and `undefined` triggers React's warning and loses state. Default to `value ?? ''`.
- Store the smallest canonical form state; derive validity and error messages during render instead of mirroring them into state.
- Put validation in the change or submit handler, not in an Effect that watches the field.

Use `useId` (React 18+) for ids that tie a label to its control or feed `aria-describedby`. Do not hand-roll counters or random ids; both break SSR hydration. Call `useId` once and derive related ids from it; do not use it for list keys.

On React 19, model submission state with Actions (`useActionState`, `useFormStatus`, `useOptimistic`) rather than manual pending/error flags. See React 19 notes.

## Refs

Use refs for values that should not trigger rendering:

- DOM nodes.
- Imperative handles.
- Timer IDs, observer instances, cached external handles.
- Latest callback/value used by an external subscription.

Do not read or write refs during render when it changes behavior. Do not use refs to hide render state from React. If UI depends on a value, it belongs in state or props.

## External stores

Use `useSyncExternalStore` for subscriptions to external mutable stores that React does not own. It gives React a consistent snapshot contract across concurrent rendering and SSR.

Do not subscribe to external stores through ad hoc Effects when the value is used for rendering. If a repo already has Zustand, Jotai, Redux, MobX, or another state layer, follow its React integration instead of wrapping it yourself.

## Hydration

When the app server-renders, the first client render must produce the same tree the server sent:

- Keep render deterministic. Reading `Date.now()`, `Math.random()`, `window`, `localStorage`, locale, or timezone during render makes server and client output diverge and throws a hydration mismatch.
- Move client-only values into state set from an Effect, or gate them behind a mounted flag, so the first client render still matches the server.
- Use `suppressHydrationWarning` only on a single intentionally-divergent node such as a rendered timestamp, never to mute a real mismatch.
- Invalid HTML nesting (a `<div>` inside a `<p>`, a block element inside a table row) also surfaces as a hydration error; fix the markup, not the warning.

## Context

Context is for values many descendants need, not for avoiding all prop passing.

- Keep context values narrow and stable.
- Split read-heavy state from write-only actions when that reduces re-renders.
- Memoize provider values when referential identity matters and React Compiler is not handling it.
- Prefer explicit provider APIs over exposing implementation details.

For reusable components, design context around an interface: state, actions, and metadata. The provider owns implementation details.

## Component APIs

Prefer composition over flag-heavy components:

- Avoid adding boolean props to customize many modes.
- Use explicit variant components when modes have different behavior.
- Use compound components for complex widgets with shared state.
- Prefer `children` composition over render props unless callers need a function.
- Keep public prop contracts simple and stable.

Do not define components inside components. Nested component definitions reset state and create new component types on every render.

## Accessibility

Accessibility is mostly correct semantic markup, which is framework-agnostic. If the `frontend-workbench` skill is installed, use it for the general rules - but it is not part of this skill's portable set, so do not assume it exists. The baseline when it is unavailable:

- Use semantic elements (`button`, `a`, `nav`, `main`, `label`, ordered headings) before ARIA; a real `button` beats a `div` with a click handler.
- Give every interactive control an accessible name: visible text, an associated `label`, or `aria-label`.
- Keep all functionality keyboard-operable and never remove visible focus without an equivalent.
- Tie form controls to their labels and errors (`htmlFor`/`id`, `aria-describedby`).
- Do not rely on color alone, and meet contrast minimums.
- Respect `prefers-reduced-motion` for non-essential animation.

The React-specific pieces:

- Manage focus on view changes React controls: move focus to the new content on route change, into a dialog on open, and back to the trigger on close. Use a ref and an Effect, not autofocus guesswork.
- Restore focus across portals. A modal or menu rendered through a portal still owns focus and Escape/return behavior even though its DOM lives elsewhere.
- Announce async or state-driven updates through an `aria-live` region that is already in the tree; toggling the region's existence does not announce reliably.
- Associate labels and descriptions with `useId` rather than hardcoded ids that collide when a component renders more than once.

## Lists and keys

Keys describe identity, not position:

- Use stable IDs from the data model.
- Avoid array indexes when items can be inserted, removed, sorted, or filtered.
- Change a `key` intentionally to reset a component subtree.
- Do not generate random keys during render; that remounts every item.

Bad keys often show up as lost input state, broken animation, or unnecessary remounting.

## Escape hatches

Use imperative escape hatches sparingly:

- `flushSync` is for rare integration points where the DOM must be updated synchronously before the next line runs.
- Imperative handles should expose a small command surface, not component internals.
- Portals preserve React tree ownership even when DOM placement changes; keep event and focus behavior in mind.
- Error boundaries catch rendering errors below them; they do not replace data validation or event-handler error handling.

## Rendering untrusted content

React escapes string children by default, so plain `{userText}` is safe. The footguns are the places that bypass escaping:

- `dangerouslySetInnerHTML` injects raw HTML. Only use it with content you sanitize (e.g. DOMPurify) or fully control. Never pass user input straight through.
- Validate user-controlled URLs according to the sink's allowed schemes and destinations. Current React DOM blocks `javascript:` in several common URL props; this is not a general URL policy, and it does not make arbitrary external origins, form destinations, or `data:` content appropriate. Check the installed renderer/version and validate any imperative DOM or third-party sinks separately.
- Spreading untrusted objects as props (`<a {...userProps}>`) can smuggle in `dangerouslySetInnerHTML`, event handlers, or URL props. Pick known props explicitly.
- Add `rel="noopener noreferrer"` to `target="_blank"` links unless the repo already applies this globally.

For a full injection and untrusted-input audit, use the `security-remediation` skill; this section only covers the React render-layer footguns.

## React Compiler

If React Compiler is configured and passing:

- Trust it for routine memoization.
- Keep code pure and readable instead of adding blanket `useMemo`, `useCallback`, or `React.memo`.
- Preserve manual memoization only when it expresses a real API contract or profiling proves it matters.

If React Compiler is not configured:

- Still do not memoize everything.
- Use manual memoization for expensive calculations, stable props to memoized children, context provider values, and callback identity required by external APIs.

Do not change compiler configuration casually. Treat it as project infrastructure and verify with lint/type/build checks.

## React 19 notes

Only apply React 19-specific APIs when the repo uses React 19 or newer.

- `ref` can be passed as a prop to function components in React 19; older React still needs `forwardRef`.
- `use` is for reading promises or context in supported environments. Do not replace ordinary `useContext` unless the repo already uses the newer pattern.
- Newer APIs such as `useEffectEvent`, `Activity`, and View Transitions depend on version and stability. Check the repo before introducing them.
- Actions: `useActionState`, `useFormStatus`, `useOptimistic`, and `<form action={fn}>` model pending, error, and optimistic state for submissions without manual `useState` plumbing. Use them when the repo is on React 19; otherwise keep the existing controlled-form pattern.
- A ref callback may return a cleanup function in React 19; older React must clean up when it is called with `null`.
