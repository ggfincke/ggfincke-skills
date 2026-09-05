---
name: vercel-react-view-transitions
description: Guide for implementing smooth, native-feeling animations using React's View Transition API (`ViewTransition` component, `addTransitionType`, and CSS view transition pseudo-elements). Use this skill whenever the user wants to add page transitions, animate route changes, create shared element animations, animate enter/exit of components, animate list reorder, implement directional (forward/back) navigation animations, or integrate view transitions in Next.js. Also use when the user mentions view transitions, `startViewTransition`, `ViewTransition`, transition types, or asks about animating between UI states in React without third-party animation libraries.
---

# React View Transitions

Animate between UI states using the browser's native `document.startViewTransition`. Declare *what* with `<ViewTransition>`, trigger *when* with `startTransition` / `useDeferredValue` / `Suspense`, control *how* with CSS classes. Unsupported browsers skip animations gracefully.

## When to Animate

Every `<ViewTransition>` should communicate a spatial relationship or continuity. If you can't articulate what it communicates, don't add it.

Start with the interaction the user requested. Choose the relevant pattern from this list; it is a menu, not an instruction to animate the rest of the app:

| Priority | Pattern | What it communicates |
|----------|---------|---------------------|
| 1 | **Shared element** (`name`) | "Same thing — going deeper" |
| 2 | **Suspense reveal** | "Data loaded" |
| 3 | **List identity** (per-item `key`) | "Same items, new arrangement" |
| 4 | **State change** (`enter`/`exit`) | "Something appeared/disappeared" |
| 5 | **Route change** (layout-level) | "Going to a new place" |

Expand to an app-wide motion pass only when that scope is requested. Preserve existing navigation, state, scroll, focus, and accessibility behavior. An animation request does not authorize dependency upgrades or router replacement.

### Choosing Animation Style

| Context | Animation | Why |
|---------|-----------|-----|
| Hierarchical navigation (list → detail) | Type-keyed `nav-forward` / `nav-back` | Communicates spatial depth |
| Lateral navigation (tab-to-tab) | Bare `<ViewTransition>` (fade) or `default="none"` | No depth to communicate |
| Suspense reveal | `enter`/`exit` string props | Content arriving |
| Revalidation / background refresh | `default="none"` | Silent — no animation needed |

Reserve directional slides for hierarchical navigation (list → detail) and ordered sequences (prev/next photo, carousel, paginated results). For ordered sequences, the direction communicates position: "next" slides from right, "previous" from left. Lateral/unordered navigation (tab-to-tab) should not use directional slides — it falsely implies spatial depth.

---

## Availability

- Check the installed React/React DOM versions, framework integration, type declarations, and browser capabilities before changing code. Keep the lockfile and dependency versions unchanged unless an upgrade is separately approved.
- **React:** As checked on 2026-08-27, [`ViewTransition`](https://react.dev/reference/react/ViewTransition) and `addTransitionType` are available in Canary/Experimental channels. If the installed runtime lacks them, preserve a nonanimated interaction; discuss a dependency change instead of installing canary automatically.
- **Next.js:** App Router builds can supply a framework-managed React runtime. Do not replace it with a separate canary install. Verify the installed build and any required experimental flag or Link prop using `references/nextjs.md`.
- **Browser:** Base API support and support for class selectors are separate capabilities; check the actual target browsers rather than relying on a minimum-version list. A supported React integration can skip animation on unsupported browsers. An unavailable React export still requires a compatible implementation; browser fallback cannot fix that build error.

---

## Implementation Workflow

Use `references/implementation.md` to inspect and change the requested surfaces. Copy only the required recipes from `references/css-recipes.md`, including their keyframes, timing variables, and reduced-motion rule. Adapt them to existing design tokens and CSS ownership; custom CSS is appropriate when the requested effect needs it. Do not introduce unrelated global animation rules.

---

## Core Concepts

### The `<ViewTransition>` Component

```jsx
import { ViewTransition } from 'react';

<ViewTransition>
  <Component />
</ViewTransition>
```

React auto-assigns a unique `view-transition-name` and calls `document.startViewTransition` behind the scenes. Never call `startViewTransition` yourself.

### Animation Triggers

| Trigger | When it fires |
|---------|--------------|
| **enter** | `<ViewTransition>` first inserted during a Transition |
| **exit** | `<ViewTransition>` first removed during a Transition |
| **update** | DOM mutations inside a `<ViewTransition>`. With nested VTs, mutation applies to the innermost one |
| **share** | Named VT unmounts and another with same `name` mounts in the same Transition |

Only `startTransition`, `useDeferredValue`, or `Suspense` activate VTs. Regular `setState` does not animate.

### Critical Placement Rule

For enter/exit, place `<ViewTransition>` before the first DOM node in the subtree being inserted or removed:

```jsx
// when this whole subtree is inserted, the boundary owns its enter animation
<ViewTransition enter="auto" exit="auto">
  <div>Content</div>
</ViewTransition>

// when this whole subtree is inserted, the new div owns the insertion
<div>
  <ViewTransition enter="auto" exit="auto">
    <div>Content</div>
  </ViewTransition>
</div>
```

A persistent parent DOM node is not itself a blocker: conditionally inserting a boundary inside that existing parent can animate. Determine which subtree changes instead of removing every wrapper.

---

## Styling with View Transition Classes

### Props

Values: `"auto"` (browser cross-fade), `"none"` (disabled), `"class-name"` (custom CSS), or `{ [type]: value }` for type-specific animations.

```jsx
<ViewTransition default="none" enter="slide-up" exit="slide-down" share="morph" />
```

If `default` is `"none"`, all triggers are off unless explicitly listed.

### CSS Pseudo-Elements

- `::view-transition-old(.class)` — outgoing snapshot
- `::view-transition-new(.class)` — incoming snapshot
- `::view-transition-group(.class)` — container
- `::view-transition-image-pair(.class)` — old + new pair

See `references/css-recipes.md` for ready-to-use animation recipes.

---

## Transition Types

Tag transitions with `addTransitionType` so VTs can pick different animations based on context. Call it multiple times to stack types — different VTs in the tree react to different types:

```jsx
startTransition(() => {
  addTransitionType('nav-forward');
  addTransitionType('select-item');
  router.push('/detail/1');
});
```

Pass an object to map types to CSS classes. Works on `enter`, `exit`, **and** `share`:

```jsx
<ViewTransition
  enter={{ 'nav-forward': 'slide-from-right', 'nav-back': 'slide-from-left', default: 'none' }}
  exit={{ 'nav-forward': 'slide-to-left', 'nav-back': 'slide-to-right', default: 'none' }}
  share={{ 'nav-forward': 'morph', 'nav-back': 'morph', default: 'none' }}
  default="none"
>
  <Page />
</ViewTransition>
```

`enter` and `exit` don't have to be symmetric. For example, fade in but slide out directionally:

```jsx
<ViewTransition
  enter={{ 'nav-forward': 'fade-in', 'nav-back': 'fade-in', default: 'none' }}
  exit={{ 'nav-forward': 'nav-forward', 'nav-back': 'nav-back', default: 'none' }}
  default="none"
>
```

**TypeScript:** Check the installed `ViewTransitionClassPerType` declaration; versions that require a `default` key need an explicit fallback such as `default: 'none'`.

If the selected pages actually repeat the same type map, a shared wrapper can own it:

```jsx
export function DirectionalTransition({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition
      enter={{ 'nav-forward': 'nav-forward', 'nav-back': 'nav-back', default: 'none' }}
      exit={{ 'nav-forward': 'nav-forward', 'nav-back': 'nav-back', default: 'none' }}
      default="none"
    >
      {children}
    </ViewTransition>
  );
}
```

### `router.back()` and Browser Back Button

Preserve `router.back()` and browser Back/forward semantics. React currently skips animations triggered by legacy `popstate` to preserve synchronous scroll and form restoration; that is an acceptable nonanimated fallback. A supported router using the Navigation API may animate traversal, but adopting it is a separate scope decision. **Do not replace Back with `push`**: that adds a history entry and can change the destination. A deliberate "Return to list" link is a different action and should keep its own semantics. See the [React router guidance](https://react.dev/reference/react/ViewTransition#building-view-transition-enabled-routers).

### Types and Suspense

Types reset after each commit, so a later Suspense reveal does not inherit the original navigation types. Use a string class or an intentional type-map `default` for that reveal. See [`addTransitionType` caveats](https://react.dev/reference/react/addTransitionType#caveats).

---

## Shared Element Transitions

Same `name` on two VTs — one unmounting, one mounting — creates a shared element morph:

```jsx
<ViewTransition name="hero-image">
  <img src="/thumb.jpg" onClick={() => startTransition(() => onSelect())} />
</ViewTransition>

// On the other view — same name
<ViewTransition name="hero-image">
  <img src="/full.jpg" />
</ViewTransition>
```

- Only one VT with a given `name` can be mounted at a time — use unique names (`photo-${id}`). Watch for reusable components: if a component with a named VT is rendered in both a modal/popover *and* a page, both mount simultaneously and break the morph. Either make the name conditional (via a prop) or move the named VT out of the shared component into the specific consumer.
- `share` takes precedence over `enter`/`exit`. Think through each navigation path: when no matching pair forms (e.g., the target page doesn't have the same name), `enter`/`exit` fires instead. Consider whether the element needs a fallback animation for those paths.
- Check whether a parent fade or slide competes with the selected shared morph. Keep the requested motion style; do not add directional navigation merely to conceal a competing animation.

---

## Common Patterns

### Enter/Exit

```jsx
{show && (
  <ViewTransition enter="fade-in" exit="fade-out"><Panel /></ViewTransition>
)}
```

### List Reorder

```jsx
{items.map(item => (
  <ViewTransition key={item.id}><ItemCard item={item} /></ViewTransition>
))}
```

Trigger inside `startTransition`. The item component should expose its VT before the first DOM node that moves; the list container itself can remain a normal DOM element.

### Composing Shared Elements with List Identity

Shared elements and list identity are independent concerns — don't confuse one for the other. When a list item contains a shared element (e.g., an image that morphs into a detail view), use two nested `<ViewTransition>` boundaries:

```jsx
{items.map(item => (
  <ViewTransition key={item.id}>                                      {/* list identity */}
    <Link href={`/items/${item.id}`}>
      <ViewTransition name={`item-image-${item.id}`} share="morph">   {/* shared element */}
        <Image src={item.image} />
      </ViewTransition>
      <p>{item.name}</p>
    </Link>
  </ViewTransition>
))}
```

The outer VT can own list movement; the inner VT can own a distinct shared element. Use both only when both effects are requested and the captured DOM boundaries differ. A single named item boundary can be sufficient when the same element owns both behaviors.

### Force Re-Enter with `key`

```jsx
<ViewTransition key={searchParams.toString()} enter="slide-up" default="none">
  <ResultsGrid />
</ViewTransition>
```

**Caution:** If wrapping `<Suspense>`, changing `key` remounts the boundary and refetches.

### Suspense Fallback to Content

Simple cross-fade:
```jsx
<ViewTransition>
  <Suspense fallback={<Skeleton />}><Content /></Suspense>
</ViewTransition>
```

Directional reveal:
```jsx
<Suspense fallback={<ViewTransition exit="slide-down"><Skeleton /></ViewTransition>}>
  <ViewTransition enter="slide-up" default="none"><Content /></ViewTransition>
</Suspense>
```

For more patterns, see `references/patterns.md`.

---

## How Multiple VTs Interact

Every VT matching the trigger fires simultaneously in a single `document.startViewTransition`. VTs in **different** transitions (navigation vs later Suspense resolve) don't compete.

### Use `default="none"` Liberally

Use `default="none"` when only selected triggers should animate. Without it, eligible changes use the browser default cross-fade; this is useful for an intentional simple cross-fade, not evidence that every boundary animates on every update. Do not disable existing motion outside the requested surface.

### Two Patterns Coexist

**Pattern A — Directional slides:** Type-keyed VT on each page, fires during navigation.
**Pattern B — Suspense reveals:** String props or an intentional fallback, independent of earlier navigation types.

They can coexist when they fire at different moments. Set each trigger intentionally and check whether the fallback/content mounts in the same commit or a later reveal. For page enter/exit, use a boundary that actually mounts/unmounts; a persistent layout may instead own updates. Do not add an exit animation unless the interaction needs one.

### Nested VT Limitation

When an entire parent boundary is inserted or removed, it normally owns that subtree's enter/exit instead of each descendant animating separately. A nested boundary can still animate an independent change while the parent stays mounted, and matching named shared elements are a separate case. Inspect the actual changed subtree and installed React behavior; nesting alone is not a reason to remove a layout boundary.

---

## Next.js Integration

For version-specific Next.js setup, the `transitionTypes` prop on `next/link`, App Router patterns, and Server Components, see `references/nextjs.md`.

---

## Accessibility

Preserve or add the reduced-motion rule from `references/css-recipes.md` for the selected animations. React does not disable motion automatically. Gate any JavaScript animation or smooth scrolling separately, and verify focus, keyboard operation, and nonanimated behavior.

---

## Reference Files

- **`references/implementation.md`** — Step-by-step implementation workflow.
- **`references/patterns.md`** — Patterns, animation timing, events API, troubleshooting.
- **`references/css-recipes.md`** — Ready-to-use CSS animation recipes.
- **`references/nextjs.md`** — Next.js App Router patterns and Server Component details.
