---
name: comment-style
description: Apply a low-noise comment style in any language - exact path+purpose file headers, glanceable plain comments by default, sentence-style block docs only on large units (classes and similar), lowercase why-comments above code, canonical structured tags, and ASCII arrows. Use whenever adding or revising comments/docstrings or wiring comment-style enforcement (ESLint, Ruff, SwiftFormat) in a repo.
---

# Comment Style

Plain comments are the default: a short note above a unit so a glance explains what it does and why it is shaped that way. Block docs (docstrings / TSDoc / `///`) are for larger constructs — typically classes, or similarly substantial types — not routine functions. Move architecture essays, incident history, and long tradeoff records to maintained docs. The principles below are uniform across languages; only enforcement differs (see `references/` + `assets/`).

## Core rules

<!-- always-on:start title="Comment style" -->

- Every covered file starts with exactly two comment lines: repo-relative path, then a lowercase untagged purpose phrase. Shebangs stay above them; module docstrings do not duplicate them. A file meant to be copied into another repo is the one exception: it carries the path it will live at in the destination, not its path where it is stored.
- Plain `#` / `//` comments are the default. Put them above the unit they describe so a glance explains what that function or block is for (and why it is shaped that way when that matters).
- Docstrings / TSDoc / `///` blocks are for larger constructs (typically classes; TypeScript also interfaces/enums; Swift types similarly), not routine functions. When used, they are full sentences with capitalization and terminal punctuation.
- Plain comments are lowercase and casual. Put them above the code, never beside it, and do not repeat a block doc or types already visible in the signature.
- Natural abbreviations such as `&`, `w/`, `w/o`, `config`, and `params` are welcome when they improve brevity, but are not mandatory rewrites.
- ASCII `->`, never the Unicode arrow.
- Plain comments are the default. Use structured tags sparingly: `*` important invariant, `!` warning/deprecation, `?` unresolved design question, `TODO` actionable follow-up.
- TODOs use one short `TODO action` or `TODO(scope): action` line with a lowercase scope. Put context immediately above in a plain block.
- Keep comment blocks concise; there is no hard line cap. Move durable architecture and long rationale to maintained docs.
- Cross-reference exact symbols plus stable module paths, never source line numbers.

<!-- always-on:end -->

## Placement

```
# normalize payload before validation      <- correct: on the line above
payload = normalize(raw)

payload = normalize(raw)  # normalize ...   <- wrong: side comment
```

## Plain comments vs. block docs

There is no separate “public API documentation” category. A short “what this does” plain comment above a function is welcome when it helps orientation. Do not narrate every assignment, branch, or type already visible in the code.

Block docs orient maintainers (and agents) on a larger unit — usually a class, or a similarly substantial TypeScript type/class when a paragraph helps. Ordinary functions and private helpers get a plain comment above them, not a docstring or TSDoc block.

Do not duplicate a block doc and a plain comment that say the same thing. Put constructor-level behavior on the class docstring rather than repeating it on `__init__` or a constructor.

## Anti-patterns that bloat comments

- Third file-header lines or tagged purpose phrases.
- "Why not X" tradeoff dumps - belongs in the commit/PR.
- Edge-case enumeration - the types and body already show it.
- Step-by-step narration - name steps with helper functions or let the code read itself.
- Defensive "future-reader" notes - they rot silently when the code changes.
- Docstring/TSDoc/`///` on every function or export; “public API docstring theater”.
- Legacy labels such as `NOTE:`, `HACK:`, `FIXME:`, or `FOOTGUN:` when a plain comment or canonical tag expresses the real meaning.

## Expanded references

Load these when you need more than the core rules:

- `references/house-guide.md` — full house guide (headers, banners, tags, Cartographer, anti-patterns)
- `references/formatting.md` — Prettier/Allman + Ruff formatting conventions and change hygiene
- `references/wiring-recipe.md` — how to install enforcers, npm scripts, lint-staged, and CI in a target repo
- `references/typescript.md` / `python.md` / `swift.md` — per-language specifics

**Status in this repository (ggfincke-skills):** **adopted** — root Prettier/ESLint, Python Ruff + comment checker, `make check` format gates, pre-commit lint-staged, and CI format jobs are wired. Skill `assets/` remain copyable for other repos (destination-path headers exempt from `file-header` here).

## Applying in a repo

Principles stay the same; pick the matching language guide and copy its enforcer from `assets/`:

- TypeScript -> `references/typescript.md`, `assets/eslint-rules/`
- Python -> `references/python.md`, `assets/check_comment_style.py`, optional `assets/check-python-style.sh` (Ruff + comment checker wrapper)
- Swift -> `references/swift.md`, `assets/check_comment_style.py` + `assets/swift/`
- Formatting (TS/JS) -> `references/formatting.md` + `references/wiring-recipe.md`

`assets/` holds the actual enforcers to copy into a target repo. They are project-by-project wiring, not run by this skill.

Because they ship, their own headers name the destination path rather than their path in this repo - `# tools/check_comment_style.py`, `# scripts/checks/check-python-style.sh`, and `// eslint-rules/index.js`, which is where each lands once copied. A checker run over this repo will flag those; that is the exception above, not a violation. Update the header if you change where an asset is meant to land.
