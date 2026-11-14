---
name: comment-style
description: Apply house comment and code-shape conventions when adding or revising comments, docstrings, file headers, or function structure in any language, or wiring their enforcement. Covers the copyable ESLint and Python/Swift checkers and the Ruff shape rules.
---

# Comment Style

A comment is a short note above a unit so a glance explains what it does and why it is shaped that way. Caps keep it that way: when a note outgrows them, the detail belongs in a type or a maintained doc, not a longer comment. Docstrings / TSDoc / `///` are a normal tool on functions and types, also capped. The principles below are uniform across languages; only enforcement differs (see `references/` + `assets/`).

## Core rules

<!-- always-on:start title="Comment style" -->

- Every covered file starts with exactly two comment lines: repo-relative path, then a lowercase untagged purpose phrase. Shebangs stay above them; no module docstrings. A file meant to be copied into another repo is the one exception: it carries the path it will live at in the destination, not its path where it is stored.
- A plain `#` / `//` comment sits above the unit it describes and says what it is for, plus why when that is not obvious. Hard cap 3 lines per block; `*` / `!` / `?` tags cap at 2. Checkers enforce both.
- Detail that does not fit goes into types first: a comment that lists a dict's keys or a param's fields becomes a TypedDict / dataclass / interface with a one-line comment per field. Remaining explanation moves to a tracked doc near the code (a per-area `NOTES.md` section or a docs page), linked with one pointer line. Never point at a gitignored directory such as `dev-docs/`.
- Docstrings / TSDoc / `///` are welcome on functions, methods, and types when they earn it: one summary sentence, then optionally a blank line and a short body. Caps: 5 content lines on functions, 8 on classes and types. Full sentences, no Args/Returns sections that repeat the signature, and a docstring or a plain comment above, never both.
- Plain comments are lowercase and casual, above the code and never beside it, and do not restate types already visible in the signature.
- Natural abbreviations such as `&`, `w/`, `w/o`, `config`, and `params` are welcome when they improve brevity.
- ASCII `->`, never the Unicode arrow, and no em dashes in comments or docstrings.
- Structured tags are sparing: `*` important invariant, `!` warning/deprecation, `?` unresolved design question, `TODO` actionable follow-up. TODOs use one short `TODO action` or `TODO(scope): action` line with a lowercase scope and context directly above.
- Cross-reference exact symbols plus stable module paths, never source line numbers.
- Code shape: aim for functions under ~60 lines; more than ~3 nested `def`s sharing state become a small class or module helpers; more than ~6 params become a dataclass / TypedDict / options object. Descriptive names; single letters only for loop indexes and math. Split by meaning, never only to hit a number. Ruff `C901` / `PLR0913` / `PLR0915` enforce this in Python.
- Honor explicit target-project conventions and public API documentation requirements. Preserve generated/vendor formats and annotations required by documentation, type-checking, deprecation, or other tooling; apply these prose defaults only where they do not conflict with those contracts.

<!-- always-on:end -->

## Placement

```
# normalize payload before validation      <- correct: on the line above
payload = normalize(raw)

payload = normalize(raw)  # normalize ...   <- wrong: side comment
```

## Caps

| Construct                                   | Cap                  |
| ------------------------------------------- | -------------------- |
| plain comment block (consecutive lines)     | 3 lines              |
| `*` / `!` / `?` tag plus continuation lines | 2 lines              |
| `TODO` line                                 | 1 line, not counted  |
| function / method docstring or TSDoc        | 5 content lines      |
| class / interface / enum / type docstring   | 8 content lines      |

A blank line, a tooling directive, or a code line ends a block. Splitting one note into two blocks with a blank line to dodge the cap defeats the rule; move the detail instead.

## Plain comments vs. block docs

Pick one per unit. A plain comment above a function is the light option. A docstring is better when the summary is a full sentence a reader (or tooling) wants attached to the symbol. Never write both.

A target project may require public API docblocks for its documentation pipeline. Follow that requirement, and scope any checker override to that surface.

Preserve annotations whose block syntax or placement carries type-checking, deprecation, or tooling meaning. Do not convert them to plain comments; the JavaScript/TypeScript exceptions are in `references/typescript.md`.

Put constructor-level behavior on the class docstring rather than repeating it on `__init__` or a constructor.

## Where long explanations go

1. **Types.** Shapes, fields, and keys belong in a TypedDict, dataclass, interface, or enum with a one-line comment per member. The type checker then keeps them honest.
2. **Names.** A step that needs narration becomes a named helper.
3. **Tracked docs.** Architecture, data layout, and multi-step rationale go to a maintained doc committed with the code: a per-area `NOTES.md` section named for the symbol, or a docs page. Leave one pointer line: `# detail: engine/NOTES.md#object_draw_tables`. A gitignored working-notes directory such as `dev-docs/` is never a pointer target, because the pointer would dangle for everyone else.
4. **Commit or PR.** Tradeoff history and "why not X" go there.

## Anti-patterns

- Comment essays above a function (the cap exists for these).
- Prose that documents a schema the code could declare as a type.
- Third file-header lines or tagged purpose phrases.
- Edge-case enumeration, step-by-step narration, or defensive "future-reader" notes.
- A docstring and a plain comment on the same unit.
- Args/Returns docstring sections that restate the signature.
- Legacy labels such as `NOTE:`, `HACK:`, `FIXME:`, or `FOOTGUN:`.
- Em dashes in comments or docstrings; rewrite the sentence.

## Expanded references

- `references/house-guide.md` - full house guide (headers, banners, tags, Cartographer, anti-patterns)
- `references/code-shape.md` - function size, nesting, params, naming, the Ruff/ESLint shape rules, & how to refactor toward them safely
- `references/formatting.md` - Prettier/Allman + Ruff formatting conventions and change hygiene
- `references/wiring-recipe.md` - how to install enforcers, npm scripts, lint-staged, and CI in a target repo
- `references/typescript.md` / `python.md` / `swift.md` - per-language specifics

**Status in this repository (ggfincke-skills):** **adopted** for comments: root Prettier/ESLint, Python Ruff + comment checker, `make check` format gates, pre-commit lint-staged, and CI format jobs are wired. The Ruff shape rules gate `scripts/`, `projects/`, and the Python checker asset, with `tests/` exempt. The core ESLint shape rules run as warnings on the rule assets and the worker broker until their existing hits are refactored. Skill `assets/` remain copyable for other repos (destination-path headers exempt from `file-header` here).

## Applying in a repo

Principles stay the same; pick the matching language guide and copy its enforcer from `assets/`:

- TypeScript -> `references/typescript.md`, `assets/eslint-rules/`
- Python -> `references/python.md`, `assets/check_comment_style.py`, optional `assets/check-python-style.sh` (Ruff + comment checker wrapper)
- Swift -> `references/swift.md`, `assets/check_comment_style.py` + `assets/swift/`
- Code shape -> `references/code-shape.md` (Ruff config for Python, core ESLint rules for TS)
- Formatting (TS/JS) -> `references/formatting.md` + `references/wiring-recipe.md`

`assets/` holds the actual enforcers to copy into a target repo. They are project-by-project wiring, not run by this skill.

Because they ship, their own headers name the destination path rather than their path in this repo - `# tools/check_comment_style.py`, `# scripts/checks/check-python-style.sh`, and `// eslint-rules/index.js`, which is where each lands once copied. A checker run over this repo will flag those; that is the exception above, not a violation. Update the header if you change where an asset is meant to land.
