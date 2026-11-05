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
