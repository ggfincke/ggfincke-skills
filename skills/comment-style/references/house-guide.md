# Comment Style Guide

Expanded house guide for comments and docstrings. Complements the always-on
core in `../SKILL.md`; language-specific enforcement lives in
`typescript.md`, `python.md`, and `swift.md`.

Applies to owned TypeScript, JavaScript, Python, Swift, and shell sources
(application code, backends, scripts, and tests). Read this before opening a
PR; if the guide fights a real contract, flag it in review rather than
ignoring it.

The same philosophy applies across languages. Syntax differs (`//` vs `#`,
Python docstrings vs occasional `/** */`); the roles of header, plain comment,
block doc, and tag do not.

Generated, vendored, third-party, and format-owned files are exempt unless the
repository owns and checks their source form. Formats without normal line
comments (JSON, etc.) follow their canonical syntax.

## TL;DR

- Every covered file starts with a two-line header: repo-relative path on line
  1, lowercase purpose phrase on line 2. No module docstrings.
- Plain `#` / `//` comments sit above the unit they describe so a glance
  explains what that function or block is for (and why, when that matters).
  Hard cap: 3 lines per block, 2 for a `*` / `!` / `?` tag.
- Detail past the cap goes into types first (TypedDict, dataclass, interface),
  then a tracked doc near the code with a one-line pointer.
- Docstrings / TSDoc / `///` are welcome on functions, methods, and types.
  Caps: 5 content lines on functions, 8 on classes and types. One per unit:
  a docstring or a plain comment above, not both.
- Plain comments are lowercase and casual. Block docs use full sentences
  (capitalized, period-terminated).
- Better Comments tags (`*`, `!`, `?`, `TODO`) are uncommon and carry structured
  meaning. `*` is rare.
- No side comments beside code. Blank line above an attached comment when
  syntax allows; no blank line between comment and code.
- Cross-reference by exact symbol + stable module path, never by line number.
- Section banners only when a file has 3+ logical sections and is longer than
  150 lines.
- No abridged, `see file`, or narrating-the-next-line comments in committed
  code.

## 1. File headers

Every covered file starts with two lines: path relative to the repo root, then
a lowercase purpose phrase. The header replaces a module docstring.

```typescript
// src/features/workspace/boards/data/cloud/boardMapper.ts
// map board snapshots to the cloud persistence contract
```

```python
# scripts/seed_pipeline/seed_pipeline/build/source.py
# compose split seed sources into the legacy manifest
```

Executable scripts keep the shebang on line 1 and put the header immediately
below it (encoding cookies stay above the header when present):

```python
#!/usr/bin/env python3
# scripts/seed_pipeline/seed_pipeline/dev_tools/dev_reset.py
# reset dev convex data behind explicit safety gates
```

A file meant to be copied into another repo is the one exception: it carries
the path it will live at in the destination, not its path where it is stored.

### Why two lines

- The path stays a clean, copy-pasteable string.
- The purpose wraps cleanly in narrow editor splits without dragging the path.
- Matches tooling that already expects this shape.

### Header rules

- Path is relative to the repo root, no leading slash.
- Purpose phrase is lowercase, no terminal period. Soft target ~60 characters;
  go longer when a shorter phrase would drop useful module context.
- No em-dash joining path and purpose (single-line headers are retired).
- No `*`, `!`, `?`, `TODO`, or other annotation labels in the purpose.
- No third header line. If the module needs more explanation, put it in a
  maintained architecture or design guide.
- Proper names and code identifiers may keep their canonical casing when
  lowercasing would mislead.

## 2. Plain comments

Plain comments are the default layer. They sit above a function, statement, or
block so you can glance at the comment and know what that unit is doing, and
why it is shaped that way when the reason is not obvious from the code.

```typescript
// stable ordering keeps graph hashes identical across repeated scans
const rows = sortRows(input)
```

```python
# the checkpoint owns release identity across resumed runs
release_id = cached["releaseId"]
```

A short "what this does" summary above a function is welcome when it helps
orientation. Do not narrate every assignment, branch, or type already visible
in the code.

### Comment rules

- Prefer intent, constraint, ownership, sequencing, or a non-obvious tradeoff.
- Use `#` in Python/shell and `//` in TypeScript/JavaScript. Use the language's
  required form in CSS, JSX, and other constrained formats.
- Keep comments above their code. Tool directives (`# noqa`,
  `eslint-disable-next-line`, etc.) are syntax-driven exceptions; keep them
  narrow and add a plain rationale above when the reason is not obvious.
- Short forms (`&`, `w/`, `w/o`, `config`, `params`) are fine when they stay
  readable.
- Preserve canonical casing for symbols, acronyms, protocols, and product names.
- Use ASCII `->` for directional relationships, never `→`.
- No em dashes in comments or block docs. Rewrite the sentence with a comma,
  a period, or parentheses.
- 3 lines per block at most (2 for a tagged comment; a `TODO` line is not
  counted). A blank line, tooling directive, or code line ends a block; do not
  split one note across blocks to dodge the cap.
- When a comment would list a dict's keys or a parameter's fields, declare a
  type instead and give each member a one-line comment.
- Long design history, data layout, and multi-step rationale belong in a
  maintained doc that is committed with the code (a per-area `NOTES.md`
  section named for the symbol, or a docs page), linked with one pointer line
  such as `# detail: engine/NOTES.md#object_draw_tables`. Never point at a
  gitignored working-notes directory such as `dev-docs/`.
- One blank line above an attached comment when surrounding syntax permits; no
  blank line between the comment and the code it owns.

## 3. Docstrings and block docs

Docstrings, TSDoc, and `///` are a normal tool on functions, methods, classes,
and types. Use one when the summary is a full sentence worth attaching to the
symbol; otherwise a plain comment above is the lighter option. Never both.

An explicit target-project public API or documentation-pipeline requirement
takes precedence, including required docblocks on every function or module.

Preserve machine-readable annotations whose syntax or attachment carries type,
deprecation, or tooling meaning. They are not prose documentation. The
JavaScript/TypeScript exceptions and inline wiring are in `typescript.md`.

```python
class SeedCompiler:
	"""Compile authored seed sources into protocol payloads.

	Owns schema validation, asset binding, and the legacy manifest shape.
	"""

	def compose_dataset(self, core_path: Path, repo_root: Path) -> JsonObject:
		"""Compose the legacy manifest that downstream ts parity still expects."""
		manifest = read_json(core_path)
		return manifest
```

```typescript
/**
 * Owns board snapshot normalization for cloud persistence.
 *
 * Runtime-only editor state stays out of this type.
 */
export class CloudBoardMapper
{
  // container order is transient, so derive persisted order from the snapshot
  toCloudBoardState(snapshot: BoardSnapshot): CloudBoardState
  {
    return { title: snapshot.title }
  }
}
```

### Block-doc rules

- One summary sentence, then optionally a blank line and a short body.
- Caps: 5 content lines on functions and methods, 8 on classes, interfaces,
  enums, and type aliases. Blank lines do not count.
- Full sentences: capitalized and period-terminated.
- No Args/Returns/Raises sections that restate the signature; mention a
  parameter only when its meaning is not obvious from its name and type.
- A docstring or a plain comment above the unit, never both.
- No module docstrings; the two-line header owns module identity and purpose.
- Put constructor-level behavior on the class docstring rather than repeating
  it on `__init__` or a constructor.

## 4. Tagged comments

Plain comments are the default. Better Comments tags escalate meaning, so use
them deliberately.

### `*` important invariant

Use only for genuinely important, easy-to-miss, or footgun-adjacent info.

```typescript
// * deployment identity is the final guard against resetting production
assertNonProductionDeployment(deployment)
```

### `!` warning or deprecation

Use for an immediate warning, unsafe boundary, or active deprecation.

```python
# ! this compatibility path accepts unsigned legacy artifacts
legacy = load_legacy_artifact(path)
```

### `?` design question

Use for a real unresolved design question that should stay visible until
answered.

```typescript
// ? should public embeds preserve the author's hidden-label preference
const showLabels = resolveEmbedLabels(template)
```

### `TODO` follow-up

Use `TODO action` or `TODO(scope): action` with a short lowercase scope when
ownership helps. Keep the tag line short and actionable. Put context in a plain
comment directly above, with no blank line between context, tag, and code.

```python
# legacy manifests still omit criterion ids
# TODO remove fallback after seed protocol v2 is retired
fallback = row.get("criterionId") or row["name"]
```

```typescript
// portability endpoints do not exist yet
// TODO(backend): add data export & import
return null
```

Do not invent parallel labels such as `NOTE:`, `HACK:`, `FIXME:`, or
`FOOTGUN:`. Use a plain comment or the tag whose meaning fits.

## 5. Cross-references

Name the exact symbol and a stable module path so the reference survives line
moves.

```typescript
// keep parity w/ projectBoardCloudFields in convex/workspace/boards/cloudFields.ts
const fields = projectCloudFields(board)
```

- Use the canonical repo-relative path, import path, or Python module path.
- Never reference a source line number.
- Explain the relationship (parity, ownership, lifecycle, delegation). Avoid
  bare `see file` comments and positional language (`above`, `below`) when a
  symbol reference is available.

## 6. Section banners

Use a section banner only when both are true: the file is longer than 150 lines
and it has at least three real logical sections.

```python
# === Artifact admission ===
```

```typescript
// === Cloud reconciliation ===
```

Banner labels may use title-style capitalization. Do not add banners to short
files or use them as decoration.

## 7. Cartographer compatibility

Write comments so Cartographer can attach them to a stable module, symbol, or
code block without flattening their meaning.

| Source form                           | Meaning                             |
| ------------------------------------- | ----------------------------------- |
| two-line file header                  | module identity + short purpose     |
| plain leading comment                 | glanceable unit orientation         |
| docstring, TSDoc, or `///`            | sentence summary attached to symbol |
| `*`, `!`, `?`, or `TODO`              | structured annotation + severity    |
| symbol + module reference             | resolvable code relationship        |

Keep documentation and comments immediately adjacent to their owner. Prefer
stable names and paths over prose such as `the helper above`.

## 8. Anti-patterns

Do not commit:

- comment essays: blocks past 3 lines, or docstrings past their cap
- prose that documents a schema the code could declare as a type
- comments that restate the next line
- step-by-step narration of readable code
- Args/Returns docstring sections that restate the signature
- a block doc and a plain comment on the same unit
- module-level Python docstrings
- side comments beside code
- file-header essays or third header lines
- stale line-number references
- pointers into a gitignored directory
- em dashes in comments or block docs
- `abridged`, `see file`, `details elsewhere`, or similar placeholders
- large TODO plans disguised as comments
- tags used only for color or emphasis

## 9. Enforcement

When a repo wires the skill's enforcers (see `wiring-recipe.md`):

- TypeScript/JS: ESLint `ggfincke/*` comment rules + core `no-inline-comments`
  (and the core shape rules in `code-shape.md`)
- Python: `assets/check_comment_style.py` (or a thin wrapper) plus Ruff, with
  the shape rules in `code-shape.md`

They cover:

- two-line path + purpose file headers
- lowercase plain comments; Better Comments / `TODO` tag shape
- no side comments beside code; ASCII `->` only; no em dashes
- plain comment blocks capped at 3 lines, tagged comments at 2
- block docs / docstrings attached to a declaration, sentence-style, capped at
  5 content lines on functions & 8 on types; Python also flags a docstring
  paired with a plain comment above the same def

The bundled enforcers implement these defaults. For a target with required API
documentation or a tooling-significant annotation the checker does not recognize,
keep that contract and use a narrow target-owned rule override or checker
adaptation for the affected surface. Do not strip required docs to satisfy this
style, or disable unrelated checks.

Typical command shapes once wired (names vary by repo):

```bash
npm run lint
npm run lint:python
npm run lint:all
npm run format
npm run format:python
npm run format:all
npm run format:check
npm run format:python:check
npm run format:all:check
```

`lint-staged` usually runs the mutating checkers on commit. Pre-push, CI, and
release gates run the non-mutating checks. When a real conflict shows up,
adjust the guide and the checker together.

## Provenance

Imported from a live TypeScript + Python app's house guide (2026-07) and
de-branded for portable use. Canonical always-on bullets remain in
`../SKILL.md`. Skill `assets/eslint-rules/` are the authoritative ESLint
enforcers and intentionally ahead of some older per-repo copies (optional
`prefixes` / `root` on `file-header`, `rule-context.js` helpers). Do not
regress those assets from a downstream fork that still uses older rule files
or a repo-only rule such as `no-inline-invalid-input`.
