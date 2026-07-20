---
name: frontend-workbench
description: Route frontend work to the relevant visual-direction, image-first, anti-slop, accessibility, design-system, or Figma guidance without adding a separate skill for each. Use when creating, redesigning, or extending a user-facing web interface, including the build-time accessibility and design-system guidance that work needs. For auditing existing UI code against the Web Interface Guidelines and reporting file:line findings, use web-design-guidelines instead.
---

# Frontend Workbench

Use this as a router, not a mandate to load every reference. Read the smallest set that matches the task.

| Task | Read |
| --- | --- |
| Create a new page, screen, or visible redesign | [`references/design-direction.md`](references/design-direction.md), [`references/image-first.md`](references/image-first.md), and [`references/anti-slop.md`](references/anti-slop.md) |
| Make a narrow visual change to an existing product | [`references/design-direction.md`](references/design-direction.md) and [`references/anti-slop.md`](references/anti-slop.md); capture the current UI first |
| Audit or implement accessibility while building or changing an interface | [`references/accessibility.md`](references/accessibility.md) |
| Review existing UI code for compliance and report findings as `file:line` | the `web-design-guidelines` skill - it owns the Web Interface Guidelines review pass; this router owns build-time guidance |
| Create tokens, themes, primitives, or a component library | [`references/design-systems.md`](references/design-systems.md) |
| Create or update a Figma screen | [`references/figma-design.md`](references/figma-design.md) |

## Shared workflow

1. Inspect the repository and current UI before changing an existing interface.
2. Keep the existing design system when it is intentional; do not replace it with a generic new aesthetic.
3. For new visual work or redesigns, establish a concrete visual target before coding. Use the built-in `imagegen` skill when the image-first reference requires generation.
4. Implement the interface in real code, then compare a rendered screenshot against the target at the same viewport.
5. Apply the accessibility route for interactive controls, forms, custom widgets, navigation, dialogs, motion, or an explicit audit.

Use React-, framework-, and motion-specific skills alongside this router when their triggers match. The references here own visual direction and process; they do not replace implementation guidance for a framework.

## Sources

Read [`references/sources.md`](references/sources.md) only when updating this package, checking provenance, or refreshing its pinned material.
