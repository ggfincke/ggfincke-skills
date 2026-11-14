# Code shape

How functions and modules should look, so that a short comment is enough to
explain them. Comment rules live in `../SKILL.md` and `house-guide.md`; this
file covers the structure those comments sit on. These are targets, not
golf: never split a function only to hit a number, and never merge files to
look smaller.

## Targets

| Concern            | Target                                   | Python (Ruff)          | TypeScript (core ESLint) |
| ------------------ | ---------------------------------------- | ---------------------- | ------------------------ |
| function length    | ~60 lines / 60 statements                | `PLR0915` (60)         | `max-statements` (60)    |
| branching          | cyclomatic complexity <= 15              | `C901` (15)            | `complexity` (15)        |
| parameters         | <= 7; group more into one object         | `PLR0913` (7)          | `max-params` (7)         |
| nested helpers     | <= ~3 nested `def`s / closures per function | review                 | review                   |
| names              | descriptive; single letters only for loop indexes & math | review | review                   |

## Signals & fixes

- **A function needs a paragraph to explain.** Split it so each piece has a
  one-line comment or a docstring summary that says it all.
- **Nested closures share state.** More than ~3 nested `def`s that close over
  the same locals become a small class (state as attributes, helpers as
  methods) or module-level helpers that take what they need.
- **Keyword-only arg sprawl.** Past ~6-7 params, group the related ones into a
  dataclass / TypedDict / options interface. The type becomes the place to
  document each field.
- **Dict-as-config with documented keys.** If a comment lists the keys, make
  it a TypedDict (or dataclass) with a one-line comment per key. Keep wire-format
  key casing (e.g. camelCase from a JS port) when the data is shared.
- **Positional data passed around in tuples.** Name it with a dataclass or
  `NamedTuple` once it crosses a function boundary.

## Refactoring toward the targets

Pick the split by what the code is doing, then check the numbers:

- **Closures sharing state** become a small private class: the shared locals
  are attributes and each closure is a method. `create_game` with eight nested
  helpers becomes a `_GameBuilder` with one method per step.
- **A long linear body** becomes named steps called in order from the original
  function, which stays as the readable outline.
- **Closures that share nothing** become module-level helpers that take what
  they need.
- **A long if-chain over a kind or type** becomes a dispatch table or one small
  handler per kind.

Every function a refactor adds has one purpose that a comment within the cap
(or a capped docstring) states. Write that comment as part of the split; a
helper without one is a sign the cut was made by size rather than by meaning.
Avoid numbered chunks (`_step_2`) and chains of wrappers that only forward.

### Signatures & suppressions

- Change a signature only when every caller is inside the change's scope.
  Group the related params into a dataclass / TypedDict / options object built
  at those call sites.
- When callers live outside the scope (a public API, a contract several
  modules implement), keep the signature and suppress the one rule on that
  line: `# noqa: PLR0913` or `// eslint-disable-next-line max-params`.
- Give the suppression a one-line reason in the plain comment above. If the
  def already has a docstring, the reason goes in the docstring instead, since
  a unit never carries both.

### Keeping it behavior-preserving

A shape refactor changes no outputs. The usual ways one does by accident:

- emit order, dict / list insertion order, or hook call order shifts when
  steps move into methods
- a value built once becomes built per call, or the reverse
- a closure turned into a method changes late binding or shares a default
  argument
- an expression is evaluated on the other side of a mutation it used to
  precede

Prove it with the repo's own outputs rather than by reading the diff: run the
same command on the old and new code and compare the results (build
artifacts, generated files, CLI output, snapshots). When an output embeds a
hash of its own source, compare old-code rerun against new-code rerun and
mask only that field. A difference is a bug to find, never one to accept.

## Python config

Add the shape rules to the repo's Ruff config alongside the formatting
settings in `formatting.md`:

```toml
[tool.ruff.lint]
extend-select = ["D400", "D403", "C901", "PLR0913", "PLR0915"]

[tool.ruff.lint.mccabe]
max-complexity = 15

[tool.ruff.lint.pylint]
max-args = 7
max-statements = 60
```

A repo that does not use Ruff for formatting can adopt only the shape rules:
a standalone `ruff.toml` whose `[lint] select` lists the three codes, leaving
the existing formatting as written.

Test files may be exempted with `per-file-ignores` when long
arrange-act-assert bodies are the norm; the limits still apply to shared test
helpers worth reading on their own.

## TypeScript config

```js
rules: {
  complexity: ['error', 15],
  'max-params': ['error', 7],
  'max-statements': ['error', 60],
}
```

## Adopting in an existing repo

A repo with existing debt should not flip these on as a gate in one step:

1. Run the rules once and record the hit list (e.g. in the repo's dev-docs).
2. Warn on files a change touches; fix hits in those files as part of the
   change when the fix is local.
3. Refactor the large offenders in planned waves.
4. Promote to a gate once the list is empty, or keep scoped `noqa` /
   `eslint-disable-next-line` entries with a one-line reason for the few that
   are genuinely better left whole (a parser state machine, a table-driven
   dispatcher).
