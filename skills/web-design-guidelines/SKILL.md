---
name: web-design-guidelines
description: Review existing UI code for Web Interface Guidelines compliance, reporting findings as file:line. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices". For creating, redesigning, or extending an interface rather than auditing one - including the build-time accessibility and design-system guidance - use the frontend-workbench router instead.
---

# Web Interface Guidelines

Review files for compliance with the pinned Web Interface Guidelines in `references/guidelines.md`.

This skill owns the review direction: existing UI code in, `file:line` findings out. When the task is building or redesigning an interface rather than reviewing one, use the `frontend-workbench` router instead - it owns visual direction, design systems, and the build-time accessibility guidance.

## How It Works

1. Read `references/guidelines.md`
2. Read the specified files (or prompt user for files/pattern)
3. Check against the applicable rules
4. Output findings in the terse `file:line` format

## Guideline Scope

The pinned rules are adapted from Vercel Labs Web Interface Guidelines. Treat the Vercel-specific copywriting preferences as project-specific: apply them only when the target app uses Vercel conventions or the user asks for Vercel-style compliance. Universal accessibility, interaction, performance, layout, form, and i18n rules apply by default.

Do not fetch mutable remote guidelines during normal use. If the user explicitly asks to refresh from upstream, retrieve the upstream text as reference data, compare it to `references/guidelines.md`, and preserve the MIT license attribution in `references/LICENSE.txt`.

## Usage

When a user provides a file or pattern argument:
1. Read `references/guidelines.md`
2. Read the specified files
3. Apply the rules that fit the project context
4. Output findings using the format specified in `references/guidelines.md`

If no files specified, ask the user which files to review.
