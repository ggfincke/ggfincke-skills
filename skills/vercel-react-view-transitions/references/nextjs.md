# View Transitions in Next.js

## Setup

Check the installed Next.js build, framework-managed React exports, and type declarations before using these examples. A React version printed by `npm ls` is not proof of App Router capability. Do not install a separate canary React or upgrade Next.js to make an animation request work without approval.

The current Next.js guide documents App Router view transitions without configuration. Older builds can expose an experimental flag instead. Only use the following configuration if the installed build supports and requires it for the requested integration, and the change is approved; do not add it by default:

```js
// next.config.js
const nextConfig = {
  experimental: { viewTransition: true },
};
module.exports = nextConfig;
```

React coordinates the native transition for participating boundaries. The flag is not a promise that every Link or Back navigation animates. Check the actual affected route and use `default="none"` when unrelated eligible changes should remain still.

Primary documentation checked 2026-08-27: [Next.js view transition guide](https://nextjs.org/docs/app/guides/view-transitions) and [Link transitionTypes source](https://github.com/vercel/next.js/blob/cce7bf2fc01340ae0fed37eb79906faa53166b4e/docs/01-app/03-api-reference/02-components/link.mdx#transitiontypes). These APIs can vary between builds; installed exports, declarations, and a working fixture decide local availability.

---

## Next.js Implementation Additions

When following `implementation.md`, apply these additions:

**After Step 2, if needed:** Confirm whether the installed build needs configuration and obtain approval for any change. Do not enable an obsolete flag in a build that works without it.

**Step 4, for requested navigation motion:** Use `transitionTypes` on `<Link>` only where supported. Otherwise preserve the existing Link and its behavior; directional animation can degrade.

**After Step 6, if relevant:** Inspect whether a dynamic route update actually remounts content before choosing update or key/name/share behavior below.

---

## Layout-Level ViewTransition

A persistent layout boundary can coexist with a changing child boundary. When the parent itself enters/exits, it normally owns that subtree's enter/exit; this does not mean all nested boundaries are inert. Check which boundary and first DOM node are inserted/removed before changing an existing layout.

A layout can own an update or cross-fade, while child boundaries own independent changes or shared pairs. Avoid overlapping effects only where a fixture shows they compete.

**Persistent layouts do not remount on each navigation.** Their enter/exit props will not describe every route change, but type-keyed update behavior may still be useful. Put page enter/exit on a boundary that actually mounts/unmounts.

---

## The `transitionTypes` Prop on `next/link`

No wrapper component needed, works in Server Components:

```tsx
<Link href="/products/1" transitionTypes={['transition-to-detail']}>View Product</Link>
```

Replaces the manual pattern of `onNavigate` + `startTransition` + `addTransitionType` + `router.push()`. Reserve manual `startTransition` for non-link interactions (buttons, forms).

**Availability:** Check the installed build's `next/link` and App Router Link declarations, relevant runtime code, and existing type check; do not assume a Next.js major version guarantees this prop. For example, search `rg -n 'transitionTypes' node_modules/next/dist/client` and inspect the result, not just whether a string exists somewhere. If unavailable, retain a normal Link, including prefetch, modifier keys, replace/scroll options, and accessibility. Do not convert links to buttons or intercept ordinary link behavior only to force motion.

---

## Programmatic Navigation

Use this for an existing button action that already pushes a destination. It is not a replacement for Back, replace, or an ordinary Link:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { startTransition, addTransitionType } from 'react';

function NavigateButton({ href }: { href: string }) {
  const router = useRouter();

  function handleNavigate() {
    startTransition(() => {
      addTransitionType('nav-forward');
      router.push(href);
    });
  }

  return <button onClick={handleNavigate}>Open</button>;
}
```

---

## Server-Side Filtering with `router.replace`

When the existing filter action already replaces URL parameters, it can be scheduled in `startTransition`. Preserve other query parameters, the hash, and the route's existing scroll policy; do not change push to replace solely for animation:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { startTransition } from 'react';

function SortControl() {
  const router = useRouter();

  function handleSort(sort: string) {
    startTransition(() => {
      const url = new URL(window.location.href);
      url.searchParams.set('sort', sort);
      router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
    });
  }

  return <button onClick={() => handleSort('newest')}>Newest</button>;
}
```

Here `scroll: false` assumes the existing filter preserves scroll; retain the actual app policy. Participating keyed item boundaries can animate reorder when the framework schedules a compatible transition. Verify that behavior instead of assuming the wrapper alone proves it.

---

## Two-Layer Pattern (Directional + Suspense)

Directional slides + Suspense reveals coexist because they fire at different moments. Place the directional VT in the **page component** (not layout):

```tsx
<ViewTransition
  enter={{ "nav-forward": "slide-from-right", default: "none" }}
  exit={{ "nav-forward": "slide-to-left", default: "none" }}
  default="none"
>
  <div>
    <Suspense fallback={<ViewTransition exit="slide-down"><Skeleton /></ViewTransition>}>
      <ViewTransition enter="slide-up" default="none"><Content /></ViewTransition>
    </Suspense>
  </div>
</ViewTransition>
```

---

## `loading.tsx` as Suspense Boundary

Next.js `loading.tsx` is an implicit `<Suspense>` boundary. Wrap the skeleton in `<ViewTransition exit="...">` in `loading.tsx`, and the content in `<ViewTransition enter="..." default="none">` in the page:

```tsx
// loading.tsx
<ViewTransition exit="slide-down"><PhotoGridSkeleton /></ViewTransition>

// page.tsx
<ViewTransition enter="slide-up" default="none"><PhotoGrid photos={photos} /></ViewTransition>
```

As with explicit Suspense, a later reveal does not inherit earlier navigation types. Use string props or an intentional type-map fallback.

---

## Shared Elements Across Routes

```tsx
// List page
{products.map((product) => (
  <Link key={product.id} href={`/products/${product.id}`} transitionTypes={['nav-forward']}>
    <ViewTransition name={`product-${product.id}`}>
      <Image src={product.image} alt={product.name} width={400} height={300} />
    </ViewTransition>
  </Link>
))}

// Detail page — same name
<ViewTransition name={`product-${product.id}`}>
  <Image src={product.image} alt={product.name} width={800} height={600} />
</ViewTransition>
```

---

## Same-Route Dynamic Segment Transitions

If the router keeps a boundary mounted when a dynamic segment changes, an update may be enough. When the content identity should reset, a changed key plus a **stable matching name** creates an outgoing/incoming shared pair in one transition:

```tsx
<Suspense fallback={<Skeleton />}>
  <ViewTransition key={slug} name="collection-surface" share="auto" default="none">
    <Content slug={slug} />
  </ViewTransition>
</Suspense>
```

- `key={slug}` deliberately remounts that content and resets its local state. Omit it if state should remain and an update transition suffices.
- `name="collection-surface"` stays the same on both sides; changing the name with the slug would prevent matching. Only one such surface may be rendered at a time; namespace it when multiple independent collections are present.
- Keep the Suspense boundary's identity stable. A scheduled transition can preserve already revealed content while new content suspends; if a fallback appears between the two commits, the shared pair will not form. Provide explicit enter/exit fallbacks if that path should animate.

---

## Server Components

- Use `<ViewTransition>` in Server Components only when the installed framework exposes it in that environment.
- A supported `<Link transitionTypes>` can be used in Server Components; confirm the prop is available before adopting it.
- `addTransitionType` and `startTransition` for programmatic nav require Client Components
