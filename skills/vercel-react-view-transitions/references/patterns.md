# Patterns and Guidelines

## Searchable Grid with `useDeferredValue`

`useDeferredValue` makes filter updates a transition, activating `<ViewTransition>`:

```tsx
'use client';

import { useDeferredValue, useState, ViewTransition, Suspense } from 'react';

export default function SearchableGrid({ itemsPromise }) {
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);

  return (
    <>
      <input value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
      <ViewTransition>
        <Suspense fallback={<GridSkeleton />}>
          <ItemGrid itemsPromise={itemsPromise} search={deferredSearch} />
        </Suspense>
      </ViewTransition>
    </>
  );
}
```

If only a shared morph is wanted, use `default="none"` to avoid other eligible per-item cross-fades. Add `update="auto"` only when list movement is also requested:

```tsx
{filteredItems.map(item => (
  <ViewTransition key={item.id} name={`item-${item.id}`} share="morph" default="none">
    <ItemCard item={item} />
  </ViewTransition>
))}
```

## Card Expand/Collapse with `startTransition`

Toggle between grid and detail view with shared element morph:

```tsx
'use client';

import { useState, useRef, useLayoutEffect, startTransition, ViewTransition } from 'react';

export default function ItemGrid({ items }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const scrollRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (expandedId === null && scrollRef.current !== null) {
      window.scrollTo({ behavior: 'instant', top: scrollRef.current });
      scrollRef.current = null;
    }
  }, [expandedId]);

  return expandedId !== null ? (
    <ViewTransition name={`item-${expandedId}`} share="morph" enter="scale-in" exit="scale-out" default="none">
      <ItemDetail
        item={items.find(i => i.id === expandedId)}
        onClose={() => {
          startTransition(() => {
            setExpandedId(null);
          });
        }}
      />
    </ViewTransition>
  ) : (
    <div className="grid grid-cols-3 gap-4">
      {items.map(item => (
        <ViewTransition key={item.id} name={`item-${item.id}`} share="morph" default="none">
          <ItemCard
            item={item}
            onSelect={() => {
              scrollRef.current = window.scrollY;
              startTransition(() => setExpandedId(item.id));
            }}
          />
        </ViewTransition>
      ))}
    </div>
  );
}
```

Use the morph/scale recipes and reduced-motion rule in `css-recipes.md`. This example restores the saved scroll position after the grid commits, without a timer or forced smooth scroll. Keep the application's existing focus-restoration policy on `ItemCard`/`ItemDetail`; do not let animation replace it.

## Type-Safe Transition Helpers

Use `as const` arrays and derived types to prevent ID clashes:

```tsx
const transitionTypes = ['default', 'transition-to-detail', 'transition-to-list'] as const;
const animationTypes = ['auto', 'none', 'slide-from-left', 'slide-from-right', 'slide-to-left', 'slide-to-right'] as const;

type TransitionType = (typeof transitionTypes)[number];
type AnimationType = (typeof animationTypes)[number];
type TransitionMap = { default: AnimationType } & Partial<Record<Exclude<TransitionType, 'default'>, AnimationType>>;

export function HorizontalTransition({ children, enter, exit }: {
  children: React.ReactNode;
  enter: TransitionMap;
  exit: TransitionMap;
}) {
  return <ViewTransition default="none" enter={enter} exit={exit}>{children}</ViewTransition>;
}
```

## Cross-Fade Without Remount

Omit `key` to trigger an update (cross-fade) instead of exit + enter. Avoids Suspense remount/refetch:

```jsx
<ViewTransition>
  <TabPanel tab={activeTab} />
</ViewTransition>
```

Use `key` only when content identity should change and local state should reset. The same-surface keyed shared-pair example in `nextjs.md` uses a stable name; changing both key and name does not create a shared pair.

## Isolate Elements from Parent Animations

### Persistent Layout Elements

Persistent elements (headers, navbars, sidebars) get captured in the page's transition snapshot. Fix with `viewTransitionName`:

```jsx
<nav style={{ viewTransitionName: "persistent-nav" }}>{/* ... */}</nav>
```

Then add the persistent element isolation CSS from `css-recipes.md`. For `backdrop-blur`/`backdrop-filter`, use the backdrop-blur workaround from `css-recipes.md`.

### Floating Elements

Give popovers/tooltips their own `viewTransitionName`:

```jsx
<SelectPopover style={{ viewTransitionName: 'popover' }}>{options}</SelectPopover>
```

Global fix: see persistent element isolation in `css-recipes.md`.

## Shared Controls Between Skeleton and Content

Give matching controls in fallback and content the same `viewTransitionName`:

```jsx
// Fallback
<input disabled placeholder="Search..." style={{ viewTransitionName: 'search-input' }} />
// Content
<input placeholder="Search..." style={{ viewTransitionName: 'search-input' }} />
```

Don't put manual `viewTransitionName` on the root DOM node inside `<ViewTransition>` — React's auto-generated name overrides it.

## Reusable Animated Collapse

```jsx
function AnimatedCollapse({ open, children }) {
  if (!open) return null;
  return (
    <ViewTransition enter="expand-in" exit="collapse-out">
      {children}
    </ViewTransition>
  );
}

// Usage: toggle with startTransition
<button onClick={() => startTransition(() => setOpen(o => !o))}>Toggle</button>
<AnimatedCollapse open={open}><SectionContent /></AnimatedCollapse>
```

The expand/collapse recipes in `css-recipes.md` reveal or conceal the captured snapshot. They do not interpolate surrounding document-flow height; add a separate layout boundary only if that behavior is requested.

## Preserve State with Activity

```jsx
<Activity mode={isVisible ? 'visible' : 'hidden'}>
  <ViewTransition enter="slide-up" exit="slide-down" default="none">
    <Sidebar />
  </ViewTransition>
</Activity>
```

## Exclude Elements with `useOptimistic`

`useOptimistic` values update before the transition snapshot, excluding them from animation. Use for controls (labels); use committed state for animated content:

```tsx
const [sort, setSort] = useState('newest');
const [optimisticSort, setOptimisticSort] = useOptimistic(sort);

function cycleSort() {
  const nextSort = getNextSort(optimisticSort);
  startTransition(() => {
    setOptimisticSort(nextSort);  // before snapshot — no animation
    setSort(nextSort);            // between snapshots — animates
  });
}

<button>Sort: {LABELS[optimisticSort]}</button>
{items.toSorted(comparators[sort]).map(item => (
  <ViewTransition key={item.id}><ItemCard item={item} /></ViewTransition>
))}
```

---

## View Transition Events

Imperative control via `onEnter`, `onExit`, `onUpdate`, `onShare`. Return a cleanup function when creating an animation. `onShare` takes precedence over `onEnter`/`onExit`. CSS reduced-motion rules cannot cancel a JavaScript animation, so gate it explicitly:

```jsx
<ViewTransition
  onEnter={(instance, types) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const anim = instance.new.animate(
      [{ transform: 'scale(0.8)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
      { duration: 300, easing: 'ease-out' }
    );
    return () => anim.cancel();
  }}
>
  <Component />
</ViewTransition>
```

The `instance` object: `instance.old`, `instance.new`, `instance.group`, `instance.imagePair`, `instance.name`.

The `types` array (second argument) lets you vary animation based on transition type.

---

## Animation Timing

| Interaction | Duration |
|------------|----------|
| Direct toggle (expand/collapse) | 100–200ms |
| Route transition (slide) | 150–250ms |
| Suspense reveal (skeleton → content) | 200–400ms |
| Shared element morph | 300–500ms |

---

## Troubleshooting

**VT not activating:** Check the installed APIs and scheduling first. For enter/exit, the boundary must precede the first DOM node in the inserted/removed subtree; a persistent DOM parent does not prevent a newly inserted child boundary from animating.

**"Two ViewTransition components with the same name":** Names must be globally unique. Use IDs: `name={`hero-${item.id}`}`.

**`router.back()` and browser back/forward skip animation:** Preserve traversal. Legacy `popstate` may need a nonanimated fallback; do not replace it with `push`. See SKILL.md "router.back() and Browser Back Button."

**`flushSync` skips animations:** Keep required synchronous behavior. Change scheduling only when its semantics are compatible with the task; otherwise accept the nonanimated result.

**Only updates animate (no enter/exit):** Check whether the same boundary remains mounted. Conditionally render or key it only when remounting is intended; Suspense is not required for an ordinary enter/exit toggle.

**Nested enter/exit does not fire:** When the whole parent boundary enters/exits, it normally owns that subtree. If the parent remains mounted, a child boundary can animate its own change. Inspect the changed subtree and shared names before removing layout boundaries.

**List reorder not animating with `useOptimistic`:** Optimistic values resolve before snapshot. Use committed state for list order.

**TS error "Property 'default' is missing":** Follow the installed type declaration and provide a deliberate fallback, usually `default: 'none'` for an opt-out.

**Hash fragments cause scroll jumps:** Preserve the fragment and anchor/focus contract. Fix the existing restoration conflict or degrade motion; do not discard the hash to make the animation look smoother.

**Backdrop-blur flickers:** Use the backdrop-blur workaround from `css-recipes.md`.

**`border-radius` lost during transitions:** Apply `border-radius` directly to the captured element.

**Skeleton controls slide away:** Give matching controls the same `viewTransitionName`.

**Batching:** Multiple updates during animation are batched. A→B→C→D becomes B→D.
