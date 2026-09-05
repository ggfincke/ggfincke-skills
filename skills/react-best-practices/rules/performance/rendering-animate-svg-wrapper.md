---
title: Animate SVG Wrapper Instead of SVG Element
impact: LOW
impactDescription: a measured alternative for costly SVG animation
tags: rendering, svg, css, animation, performance
---

## Animate SVG Wrapper Instead of SVG Element

If profiling shows expensive SVG animation on a target browser, compare animating a wrapper's transform or opacity. Compositing depends on the browser, SVG contents, property, and layer decisions; a wrapper is not a universal GPU-acceleration switch. Preserve layout, transform origin, accessibility, and reduced-motion behavior.

**Direct SVG animation (valid; measure it):**

```tsx
function LoadingSpinner() {
  return (
    <svg
      className="animate-spin"
      width="24"
      height="24"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" />
    </svg>
  )
}
```

**Wrapper alternative to compare:**

```tsx
function LoadingSpinner() {
  return (
    <div className="animate-spin">
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
      >
        <circle cx="12" cy="12" r="10" stroke="currentColor" />
      </svg>
    </div>
  )
}
```

Use browser performance/layer tools on representative devices. Keep the direct SVG version when it already performs well; no hardware-acceleration or frame-rate improvement is implied by this source change alone.
