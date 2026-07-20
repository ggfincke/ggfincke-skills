# Accessibility Workflow

Use WCAG 2.2 as the default technical baseline unless the project, contract, or jurisdiction specifies another standard. Do not represent an automated scan or a partial review as a conformance claim.

## Audit in layers

1. Identify the affected user flows and interactive states, including errors, loading, empty states, overlays, and mobile layouts.
2. Run available automated checks to locate likely defects.
3. Manually verify keyboard operation: logical tab order, visible focus, no traps, predictable escape behavior, and focus return from dialogs or menus.
4. Verify semantic structure: meaningful headings, landmarks, native controls before custom ARIA, labels for controls, and text alternatives for meaningful non-text content.
5. Verify visual access: contrast, zoom and reflow, non-text contrast, focus not being obscured, target size, no color-only meaning, and reduced-motion behavior.
6. Verify dynamic behavior: status messages, errors, validation, async updates, and custom-widget name, role, and value exposure.
7. When the change or audit involves complex widgets, announcements, or screen-reader-specific behavior, test with the relevant screen reader and browser combination.

## Implementation rules

- Prefer native HTML elements. Add ARIA only when native semantics cannot express the interaction.
- Preserve visible labels in accessible names for controls.
- Pair every input with an accessible label and connect errors or help text deliberately.
- Keep focus visible and usable when sticky UI, modals, menus, or animations are present.
- Provide a keyboard alternative for drag, pointer-only, and hover-dependent interaction.
- Respect `prefers-reduced-motion`; never make motion the sole carrier of information.

Report findings by user impact, affected flow, evidence, and relevant WCAG criterion. Distinguish confirmed defects from items that require device, assistive-technology, or product-owner verification.
