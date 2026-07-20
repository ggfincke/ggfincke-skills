# Design-System Workflow

Start by inventorying the current tokens, primitives, themes, component APIs, and documentation. Extend an intentional system; do not create a parallel one for a single feature.

## Token model

Use three layers when a system needs to grow:

1. Primitive tokens hold raw values such as color scales, spacing steps, type scales, and radii.
2. Semantic tokens express a role such as `surface`, `text-muted`, or `focus-ring`.
3. Component tokens express a stable component contract only when the semantic layer is insufficient.

Bind components to semantic tokens, not raw values. Support themes by remapping semantic roles instead of duplicating components or scattering conditional style values.

## Component decisions

- Build a reusable primitive only after the interaction or visual contract is stable across more than one consumer.
- Prefer composition and slots over a growing collection of boolean styling props.
- Define states together: default, hover, focus-visible, pressed, disabled, loading, error, empty, and reduced motion where relevant.
- Preserve accessible names, keyboard behavior, and focus handling as part of the component API.
- Document the intended token and component contract close to the system, then validate one real consuming surface before expanding it.

For a Figma-backed system, reuse published components and variables instead of recreating similar primitives with hard-coded values.
