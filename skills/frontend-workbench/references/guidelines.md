# Web Interface Guidelines

Locally maintained adaptation of Vercel Labs Web Interface Guidelines. This is not an unmodified upstream snapshot.

Upstream repository: https://github.com/vercel-labs/web-interface-guidelines
Reviewed reference (2026-08-27): https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/command.md
The original import revision was not recorded. This ref identifies the current comparison source, not a reconstructed historical import. Local changes include project-neutral copy scope, accessible-name/native-control checks, readonly inputs, and measured performance guidance. Review the upstream diff and preserve these choices on refresh; do not overwrite this file from mutable `main`.
License: MIT, see `LICENSE.txt`.

## Scope

Use universal interface rules by default. Treat the Content & Copy rules as Vercel-specific unless the target project already follows those conventions or the user explicitly asks for Vercel-style compliance.

## Accessibility

- Icon-only buttons need a computed accessible name: suitable contents, `aria-labelledby`, or `aria-label` can supply it. Prefer a visible label where practical.
- Form controls need an accessible name, preferably an associated visible `<label>`; validate other naming mechanisms in context.
- Interactive elements need correct keyboard behavior. Preserve native button/link activation; do not add redundant handlers. Custom roles require the appropriate focusability and keyboard implementation.
- Use `<button>` for actions and `<a>`/`<Link>` for navigation.
- Images need `alt`, or `alt=""` if decorative.
- Decorative icons need `aria-hidden="true"`.
- Async updates such as toasts and validation need `aria-live="polite"`.
- Use semantic HTML before ARIA.
- Headings are hierarchical from `<h1>` to `<h6>` and pages include a skip link for main content.
- Heading anchors need `scroll-margin-top`.

## Focus States

- Interactive elements need visible focus.
- Never use `outline-none` or `outline: none` without a focus replacement.
- Prefer `:focus-visible` over `:focus`.
- Use `:focus-within` for compound controls.

## Forms

- Inputs need `autocomplete` and meaningful `name`.
- Use correct `type` and `inputmode`.
- Never block paste with `onPaste` and `preventDefault`.
- Labels are clickable via `htmlFor` or by wrapping the control.
- Disable spellcheck on emails, codes, and usernames.
- Checkboxes and radios share one hit target with their label.
- Submit stays enabled until request starts; show spinner during request.
- Errors appear inline near fields; focus first error on submit.
- Placeholders signal emptiness and show an example value or pattern.
- Use `autocomplete="off"` on non-auth fields when password managers misidentify them.
- Warn before navigation with unsaved changes.

## Animation

- Honor `prefers-reduced-motion`.
- Animate `transform` and `opacity` when possible.
- Never use `transition: all`; list properties explicitly.
- Set correct `transform-origin`.
- For SVG transforms, animate a `<g>` wrapper and set `transform-box: fill-box; transform-origin: center`.
- Animations are interruptible and respond to user input.

## Typography

- Use the project's ellipsis style consistently.
- Loading states end with an ellipsis when the project copy style uses one.
- Use `font-variant-numeric: tabular-nums` for number columns and comparisons.
- Use `text-wrap: balance` or `text-pretty` on headings when supported.

## Content Handling

- Text containers handle long content with truncation, line clamping, or breaking.
- Flex children need `min-w-0` for truncation.
- Empty strings and arrays have designed empty states.
- User-generated content handles short, average, and very long inputs.

## Images

- `<img>` needs explicit `width` and `height`.
- Below-fold images use `loading="lazy"`.
- Above-fold critical images use `priority` or `fetchpriority="high"` where supported.

## Performance

- Measure expensive lists before choosing virtualization or `content-visibility: auto`; item count alone is not a threshold. Preserve search, focus, keyboard navigation, and assistive-technology access.
- Avoid layout reads in render.
- Batch DOM reads and writes.
- Prefer uncontrolled inputs; controlled inputs must be cheap per keystroke.
- Add preconnect for CDN and asset domains.
- Critical fonts preload with `font-display: swap`.

## Navigation & State

- URL reflects filters, tabs, pagination, and expanded panels where share/refresh/back should preserve state.
- Links use `<a>` or `<Link>`.
- Destructive actions need confirmation or undo, not immediate irreversible action.

## Touch & Interaction

- Use `touch-action: manipulation` on controls.
- Set `-webkit-tap-highlight-color` intentionally.
- Use `overscroll-behavior: contain` in modals, drawers, and sheets.
- During drag, disable text selection and set `inert` where appropriate.
- Use `autoFocus` sparingly: desktop only, one primary input, avoid on mobile.

## Safe Areas & Layout

- Full-bleed layouts account for `env(safe-area-inset-*)`.
- Avoid unwanted scrollbars.
- Prefer flex/grid over JavaScript measurement for layout.

## Dark Mode & Theming

- Use `color-scheme: dark` on `<html>` for dark themes.
- `<meta name="theme-color">` matches page background.
- Native `<select>` controls set explicit background and text colors for dark mode.

## Locale & i18n

- Use `Intl.DateTimeFormat` for dates and times.
- Use `Intl.NumberFormat` for numbers and currency.
- Detect language from language settings, not IP.
- Wrap brand names, code tokens, and identifiers with `translate="no"` when auto-translation would garble them.

## Hydration Safety

- Editable controlled inputs with `value`/`checked` need a working `onChange`; intentional `readOnly` controls do not. Use `defaultValue`/`defaultChecked` for uncontrolled inputs and preserve server/client initial-state consistency.
- Date/time rendering guards against server/client mismatches.
- Use `suppressHydrationWarning` only where the mismatch is expected and isolated.

## Hover & Interactive States

- Buttons and links need hover states.
- Hover, active, and focus states should be more prominent than rest state.

## Content & Copy

Apply these only when Vercel-style copy rules match the project:

- Active voice.
- Title Case for headings and buttons; sentence case on marketing pages.
- Numerals for counts.
- Specific button labels.
- Error messages include a fix or next step.
- Second person; avoid first person.
- `&` over "and" where space-constrained.

## Anti-patterns

- `user-scalable=no` or `maximum-scale=1`.
- `onPaste` with `preventDefault`.
- `transition: all`.
- `outline-none` without focus-visible replacement.
- Inline `onClick` navigation without a link.
- `<div>` or `<span>` click handlers where `<button>` fits.
- Images without dimensions.
- Measurably expensive lists without a suitable rendering strategy.
- Form inputs without labels.
- Icon buttons without a computed accessible name.
- Hardcoded date or number formats.
- `autoFocus` without clear justification.

## Output Format

Group by file. Use `file:line` format. Keep findings terse.

```text
## src/Button.tsx

src/Button.tsx:42 - icon button has no accessible name
src/Button.tsx:18 - input lacks label
src/Button.tsx:55 - animation missing prefers-reduced-motion
src/Button.tsx:67 - transition: all -> list properties

## src/Modal.tsx

src/Modal.tsx:12 - missing overscroll-behavior: contain

## src/Card.tsx

pass
```

Checked against [WAI-ARIA button naming and keyboard behavior](https://www.w3.org/WAI/ARIA/apg/patterns/button/) and [React input ownership](https://react.dev/reference/react-dom/components/input), 2026-08-27. Static markup can establish a candidate; use computed browser semantics and keyboard checks when runtime state affects the verdict.
