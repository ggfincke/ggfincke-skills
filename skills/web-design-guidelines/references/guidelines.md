# Web Interface Guidelines

Pinned local reference adapted from Vercel Labs Web Interface Guidelines command prompt.

Source: https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
License: MIT, see `LICENSE.txt`.

## Scope

Use universal interface rules by default. Treat the Content & Copy rules as Vercel-specific unless the target project already follows those conventions or the user explicitly asks for Vercel-style compliance.

## Accessibility

- Icon-only buttons need `aria-label`.
- Form controls need `<label>` or `aria-label`.
- Interactive elements need keyboard handlers (`onKeyDown`/`onKeyUp`).
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

- Large lists over roughly 50 items need virtualization or `content-visibility: auto`.
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

- Inputs with `value` need `onChange`, or use `defaultValue` for uncontrolled inputs.
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
- Large arrays mapped without virtualization.
- Form inputs without labels.
- Icon buttons without `aria-label`.
- Hardcoded date or number formats.
- `autoFocus` without clear justification.

## Output Format

Group by file. Use `file:line` format. Keep findings terse.

```text
## src/Button.tsx

src/Button.tsx:42 - icon button missing aria-label
src/Button.tsx:18 - input lacks label
src/Button.tsx:55 - animation missing prefers-reduced-motion
src/Button.tsx:67 - transition: all -> list properties

## src/Modal.tsx

src/Modal.tsx:12 - missing overscroll-behavior: contain

## src/Card.tsx

pass
```
