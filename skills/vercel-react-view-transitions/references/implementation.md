# Implementation Workflow

Use the steps relevant to the requested interaction. Check existing dependencies and behavior first; do not turn a component animation into an app-wide motion rewrite.

## Step 1: Inspect the Requested Surface

Read the package/lockfile and framework configuration to confirm that the existing runtime supports the APIs. If it does not, retain a nonanimated path and seek approval before changing dependencies or experimental configuration. Within the requested surface, inspect:

- **Relevant links and navigation actions** — preserve push/replace/back, query/hash handling, modifier keys, focus, and scroll behavior.
- **Relevant `<Suspense>` boundaries** — inspect fallbacks only where the requested animation crosses them.
- **Participating components** — identify which subtree mounts, unmounts, changes identity, or merely updates.
- **Persistent elements** — isolate headers or controls only if the selected snapshot would otherwise move them incorrectly.
- **Shared visual elements** — images, cards, or avatars that appear on both a source and target view (e.g., a thumbnail in a list and the same image on a detail page).
- **Skeleton-to-content control pairs** — if a Suspense fallback renders a control (search input, tab bar) that also exists in the real content, both need a matching `viewTransitionName`.

For navigation work, map the affected paths. A local toggle does not need a whole-app route inventory:

```
| Route           | Navigates to         | Direction    | VT pattern            |
|-----------------|----------------------|--------------|-----------------------|
| /               | /detail/[id]         | forward      | directional slide     |
| /detail/[id]    | /                    | back         | directional slide     |
| /detail/[id]    | /detail/[other]      | sequential   | directional slide (ordered prev/next) or key+share crossfade |
| /tab/[a]        | /tab/[b]             | lateral      | key+share crossfade   |
| (Suspense)      | (content loads)      | —            | slide-up reveal       |
```

For each selected shared element (`name` prop), note where a pair forms and where it does not. This determines whether an enter/exit fallback is useful. Include Back/forward in navigation acceptance checks without changing those actions to push.

## Step 2: Add CSS Recipes

Copy the selected recipes from `css-recipes.md` into the stylesheet that owns the feature. Include their keyframes, timing variables, and reduced-motion handling; do not copy unrelated recipes or overwrite existing global transition rules.

Adapt timing, distances, and CSS names to the existing design. Custom CSS is appropriate when needed; ensure each class referenced by a VT has a corresponding rule. The recipes are examples, not a required replacement for the app's animation system.

## Step 3: Isolate Persistent Elements

If an affected persistent element is incorrectly captured, a unique `viewTransitionName` can separate it from the moving snapshot:

```jsx
<header style={{ viewTransitionName: "persistent-nav" }}>...</header>
```

Then add the persistent element isolation CSS from `css-recipes.md` (prevents the element from animating during page transitions). If the element uses `backdrop-blur` or `backdrop-filter`, use the backdrop-blur workaround from `css-recipes.md` instead.

If a Suspense fallback mirrors a persistent control (e.g., a skeleton search input), give both the real control and the skeleton the same `viewTransitionName` so they morph in place.

## Step 4: Add Directional Page Transitions

For requested hierarchical navigation effects, tag the existing forward action inside `startTransition`. Keep Back as Back; a missing traversal animation is a fallback, not permission to push a replacement URL:

```jsx
startTransition(() => {
  addTransitionType('nav-forward');
  router.push('/detail/1');
});
```

Place the boundary on the participating subtree that actually mounts/unmounts, such as a selected page component:

```jsx
<ViewTransition
  enter={{
    "nav-forward": "nav-forward",
    "nav-back": "nav-back",
    default: "none",
  }}
  exit={{
    "nav-forward": "nav-forward",
    "nav-back": "nav-back",
    default: "none",
  }}
  default="none"
>
  <div>...page content...</div>
</ViewTransition>
```

The `nav-forward` and `nav-back` CSS classes from `css-recipes.md` produce horizontal slides. For simpler apps where directional motion isn't needed, a bare `<ViewTransition default="none">` wrapper with `enter="fade-in"` / `exit="fade-out"` works too.

When several selected pages repeat this exact map, a shared component can own that policy:

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

Do not create this wrapper for a single use merely to anticipate future pages.

**Rules:**
- Select enter and exit separately; use both when the requested effect needs both snapshots.
- Include the fallback required by installed type declarations; `default="none"` is useful for opting out of unrelated eligible changes.
- A persistent layout boundary does not enter/exit on every route change. Place page enter/exit on the changing subtree; keep a layout boundary when it intentionally owns updates.
- Only use directional slides for hierarchical navigation or ordered sequences (prev/next). Lateral/sibling navigation (tab-to-tab) should use a bare `<ViewTransition>` (cross-fade) or `default="none"`.

## Step 5: Add Suspense Reveals

If the requested interaction includes a Suspense reveal, the fallback and content can have separate boundaries:

```jsx
<Suspense
  fallback={
    <ViewTransition exit="slide-down">
      <Skeleton />
    </ViewTransition>
  }
>
  <ViewTransition enter="slide-up" default="none">
    <AsyncContent />
  </ViewTransition>
</Suspense>
```

This example uses `slide-down` / `slide-up` for directional vertical motion. For a simpler reveal, a bare `<ViewTransition>` around the `<Suspense>` gives a cross-fade with zero configuration. Choose based on the spatial meaning — consult the "Choosing the Right Animation Style" table in the main skill file.

**Rules:**
- Use `default="none"` when content should animate only on the selected trigger, not on later eligible updates.
- Later Suspense reveals do not retain the earlier navigation types. Use string props or an intentional type-map fallback for those reveals.

## Step 6: Add Shared Element Transitions

For each requested shared visual element, use the same stable name on the outgoing and incoming boundaries in one transition:

```jsx
// On the source view (e.g., list/grid page)
<ViewTransition name={`photo-${photo.id}`} share="morph" default="none">
  <Image src={photo.src} ... />
</ViewTransition>

// On the target view (e.g., detail page) — same name
<ViewTransition name={`photo-${photo.id}`} share="morph">
  <Image src={photo.src} ... />
</ViewTransition>
```

The `share="morph"` class uses the morph recipe from `css-recipes.md` (controlled duration + motion blur). For a simpler cross-fade, use `share="auto"` (browser default).

When list items contain shared elements, compose both patterns with two nested `<ViewTransition>` layers — see "Composing Shared Elements with List Identity" in `SKILL.md`.

**Rules:**
- Names must be unique among simultaneously rendered boundaries; outgoing/incoming partners deliberately share a name. Use prefixes like `photo-${id}`.
- Add `default="none"` on list-side shared elements to prevent per-item cross-fades on filter/search updates.

## Step 7: Verify Each Navigation Path

Exercise the requested interaction and, for route work, the affected paths from Step 1:

- Does the VT mount/unmount on this navigation, or does it stay mounted (same-route)?
- For named VTs: does a shared pair form? If not, does `enter`/`exit` provide a fallback?
- Does `default="none"` block an animation you actually want?
- Do persistent elements stay static (not sliding with page content)?
- Do Suspense reveals animate independently from directional navigations?
- Do browser Back/forward, history replacement, focus, and scroll restoration retain their original behavior?
- Does reduced-motion mode remove the selected CSS and JavaScript motion, while unsupported browsers retain the interaction?

If any path produces no animation or competing animations, revisit the relevant step.

---

## Common Mistakes

- **Unintended default cross-fades** — `default="none"` can limit eligible triggers. A bare boundary remains valid when its default cross-fade is the requested effect.
- **Enter/exit on a persistent boundary** — inspect the changing subtree; a layout that remains mounted does not enter/exit on route changes.
- **Competing parent animation** — check the selected shared morph before changing its parent's effect. Directional slides are not a universal fix.
- **Missing animation dependencies** — include the keyframes and reduced-motion rules for each selected class, including any custom CSS.
- **Missing type-map fallback** — follow the installed declaration's `default` requirement and choose the fallback deliberately; do not assume every eligible change should animate.
- **Expecting earlier navigation types during a later reveal** — types reset after a commit. Use string props or a deliberate type-map fallback for the reveal.
- **Raw `viewTransitionName` CSS to trigger animations** — React only calls `document.startViewTransition` when `<ViewTransition>` components are in the tree. A bare `viewTransitionName` style is for isolating elements from a parent's snapshot, not for triggering animations.
- **Assuming every change reaches the parent `update`** — nested boundaries can own their own mutations. Keep an update when it works; change a key only when remounting and resetting that content is intended.
- **Named VT in a reusable component** — if a component with a named VT is rendered in both a modal/popover *and* a page, both mount simultaneously and break the morph. Make the name conditional or move it to the specific consumer.
- **Replacing Back with `push`** — legacy `popstate` may skip motion. Preserve traversal, history entries, and restoration; do not change navigation semantics to force an animation.

---

For Next.js-specific implementation steps (version-specific setup, `transitionTypes` on `<Link>`, same-route dynamic segments), see `nextjs.md`.
