---
name: comment-style
description: Apply a low-noise, single-line comment style when writing or editing code in any language - comments above the code (never inline), a path+description file header, terse abbreviations (& w/ w/o), ASCII arrows, a 3-line cap, and sparing Better Comments tags. Use whenever adding or revising comments, or wiring up comment-style enforcement (ESLint, Ruff, SwiftFormat) in a repo.
---

# Comment Style

Comments are source-code annotations, not a design journal. Durable rationale belongs in `dev-docs/` or the PR, never the source file. The principles below are uniform across languages; only enforcement differs (see `references/` + `assets/`).

## Core rules

<!-- always-on:start title="Comment style" -->
- Single-line comments only (`//`, `#`). Never side/inline comments - always on the line above the code.
- File header = path line + one short lowercase description. 2-3 lines max; a 3rd line only if line 2 would wrap. No module essays.
- Direct, imperative, terse.
- Abbreviations: `&` not "and", `w/` not "with", `w/o` not "without"; `calc`, `config`, `info`, `func`, `var`, `params`.
- ASCII `->`, never the Unicode arrow.
- Hard cap: 3 consecutive comment lines.
- Better Comments tags, used sparingly: `*` foundational classes / entry points, `!` warnings / deprecated / circular-import avoidance, `?` design questions, `todo` real follow-ups.
- No doc-comment blocks (JSDoc/TSDoc `/** */`, Swift `///`, narrative Python docstrings) and no `/* */` block comments.
- Don't restate what types or signatures already say.
<!-- always-on:end -->

## Placement

```
# normalize payload before validation      <- correct: on the line above
payload = normalize(raw)

payload = normalize(raw)  # normalize ...   <- wrong: side comment
```

## The 3-line cap

When a comment block wants a 4th line, do one of:

1. Delete - most overlong comments restate the code or say things the reader needn't act on.
2. Condense - merge clauses with `;`, swap words for `&`/`w/`/`->`. A 6-line rationale usually collapses to 1-2: state the rule, then one short "why".
3. Relocate - genuine design rationale, algorithm walkthroughs, tradeoff matrices, and incident history go in `dev-docs/` or the PR.

## Anti-patterns that bloat comments

- File-header module essays (what it does, why it exists, what it replaces).
- "Why not X" tradeoff dumps - belongs in the commit/PR.
- Edge-case enumeration - the types and body already show it.
- Step-by-step narration - name steps with helper functions or let the code read itself.
- Defensive "future-reader" notes - they rot silently when the code changes.

## Applying in a repo

Principles stay the same; pick the matching language guide and copy its enforcer from `assets/`:

- TypeScript -> `references/typescript.md`, `assets/eslint-rules/`
- Python -> `references/python.md`, `assets/check_comment_style.py`
- Swift -> `references/swift.md`, `assets/check_comment_style.py` + `assets/swift/`

`assets/` holds the actual enforcers to copy into a target repo. They are project-by-project wiring, not run by this skill.
