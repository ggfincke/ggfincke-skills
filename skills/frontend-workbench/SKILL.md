---
name: frontend-workbench
description: Build, redesign, extend, or audit user-facing web interfaces. Select build mode for visual direction, images, accessibility, design systems, or Figma work; select audit mode for existing UI, UX, accessibility, and Web Interface Guidelines reviews with file:line findings. Audit requests do not authorize redesign or implementation.
---

# Frontend Workbench

Select **build** or **audit** from the requested outcome before loading references. If a request includes both, preserve its explicit scope and approval for each. Inspect the repository and the current interface; use the specified files or infer a bounded surface from the task before asking for missing context.

## Audit mode

Read the pinned [Web Interface Guidelines](references/guidelines.md), then inspect the requested existing files and relevant rendered behavior. Read [accessibility](references/accessibility.md) only for the audit techniques needed by the target. Produce confirmed `file:line` findings with the affected behavior, evidence, and severity; separate unverified observations. Preserve the repository's review artifact convention when one exists.

Audit mode does not load design-direction, image-first, anti-slop, or Figma build guidance; does not generate images, launch redesign, or edit application sources. An audit is not implementation approval. Vercel-specific copywriting preferences apply only to projects using those conventions or explicit Vercel-style compliance requests. Universal accessibility, interaction, layout, performance, forms, and i18n guidance applies where relevant.

## Build mode

| Task | Read |
| --- | --- |
| New page, screen, or visible redesign | [Design direction](references/design-direction.md), [image-first](references/image-first.md), [anti-slop](references/anti-slop.md) |
| Narrow visual change | [Design direction](references/design-direction.md), [anti-slop](references/anti-slop.md); capture the current UI first |
| Interactive controls, forms, navigation, dialogs, motion | [Accessibility](references/accessibility.md) |
| Tokens, themes, primitives, component library | [Design systems](references/design-systems.md) |
| Requested Figma work | [Figma design](references/figma-design.md) |

Keep an intentional existing design system. Establish a concrete visual target for new visual work or redesign; use the host's image generation capability when the image-first route calls for it. Implement within the authorized scope and compare rendered output with the target at the same viewport. Narrow changes do not authorize a whole-site redesign.

Use React, framework, and motion guidance when relevant; this package owns visual process and UI auditing. It contains its required references and does not depend on a sibling installation.

## Maintenance

[Sources](references/sources.md) records pinned material. Do not fetch mutable remote guidelines during normal use. An explicit upstream refresh requires comparison with the pinned rules and preservation of [the Web Interface Guidelines license](references/LICENSE-web-guidelines.txt).
