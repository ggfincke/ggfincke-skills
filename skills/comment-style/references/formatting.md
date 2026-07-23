# Code formatting

House formatting conventions for TypeScript/JavaScript (and Prettier-owned
sidecar files). Comment policy is separate — see `house-guide.md` and
`../SKILL.md`. This file is policy + a copyable Prettier config; this repo
enforces it via root Prettier/ESLint and `make check`.

## Style

| Setting            | Value                                      |
| ------------------ | ------------------------------------------ |
| Brace style        | Allman (opening brace on its own line)     |
| Semicolons         | no                                         |
| Quotes             | single                                     |
| Trailing commas    | ES5                                        |
| Indent             | 2 spaces                                   |
| Print width        | 80                                         |
| Arrow params       | always parenthesized                       |

Allman braces need `prettier-plugin-brace-style` with `"braceStyle": "allman"`.
Without that plugin, stock Prettier cannot express Allman.

## Prettier config (copy into `package.json` or `.prettierrc`)

```json
{
  "plugins": ["prettier-plugin-brace-style"],
  "braceStyle": "allman",
  "semi": false,
  "singleQuote": true,
  "trailingComma": "es5",
  "tabWidth": 2,
  "printWidth": 80,
  "arrowParens": "always"
}
```

Dev dependency: `prettier-plugin-brace-style` (alongside `prettier`).

Ignore generated and agent-local paths in `.prettierignore` (examples: `dist/`,
generated backend output, `.agents/`, lockfiles). Keep local-only agent guides
out of Prettier when the repo excludes them from git.

## Python formatting

Python uses Ruff format (not Prettier). Pair it with the comment-style checker
via `assets/check-python-style.sh` (or an equivalent wrapper). Typical Ruff
settings from a reference app:

```toml
[tool.ruff]
target-version = "py314"
line-length = 100

[tool.ruff.lint]
extend-select = ["D400", "D403"]

[tool.ruff.format]
quote-style = "double"
indent-style = "tab"
```

`D400` / `D403` reinforce docstring period + capitalization for the rare
class-level block docs that comment-style allows.

## Change hygiene

- Repository formatting and comment style apply to every new or revised source
  file in a wired repo, even when comments/format are not the task’s focus.
- Prefer the inherited comment-style rules and the local enforcers. Do not
  churn untouched legacy comments unless requested or required by a gate.
- `format` / `lint:fix` are mutating and can touch files outside a narrow
  change. In a dirty worktree, target the files you own unless repository-wide
  formatting was requested.
- Keep refactors, formatting churn, dependency changes, and unrelated cleanup
  out of a behavioral patch unless required or explicitly approved.

## Status in this repo (ggfincke-skills)

**Adopted.** Root Prettier/ESLint and Ruff + comment-style gates run via `make check` / CI. Policy and copyable assets still live under `skills/comment-style/` for wiring other repos (`wiring-recipe.md`).
