# Wiring recipe

How to install comment-style + formatting enforcement in a **target** repo.
Copied and generalized from a live TypeScript + Python app. Adjust paths,
package manager, and gate names to the target.

This is a recipe for **target** repos. ggfincke-skills itself is already
adopted (see §6).

## 1. Copy enforcers

From this skill’s `assets/`:

| Asset | Typical destination |
| ----- | ------------------- |
| `eslint-rules/` (keep its `package.json`) | `eslint-rules/` at repo root |
| `check_comment_style.py` | e.g. `scripts/checks/check_comment_style.py` or `tools/check_comment_style.py` |
| `check-python-style.sh` | e.g. `scripts/checks/check-python-style.sh` |
| `swift/` (Swift repos) | as documented in `swift.md` |

Update each asset’s two-line header to the destination path after copying.
Wire ESLint as in `typescript.md` (plugin `ggfincke`, five custom rules +
`no-inline-comments`).

## 2. Prettier + npm scripts

Install `prettier` and `prettier-plugin-brace-style`. Put the config from
`formatting.md` in `package.json` (or `.prettierrc`).

Suggested scripts:

```json
{
  "scripts": {
    "lint": "eslint .",
    "lint:fix": "eslint --fix .",
    "lint:python": "bash scripts/checks/check-python-style.sh --lint",
    "lint:all": "npm run lint && npm run lint:python",
    "format": "prettier --write . && npm run lint:fix",
    "format:check": "prettier --check . && npm run lint",
    "format:python": "bash scripts/checks/check-python-style.sh --format",
    "format:python:check": "bash scripts/checks/check-python-style.sh --format-check",
    "format:all": "npm run format && npm run format:python",
    "format:all:check": "npm run format:check && npm run format:python:check"
  }
}
```

Fold `format:check` into the repo’s aggregate gate (`check:all` / `make check`)
when ready. Keep a separate Python format-check if the aggregate does not
already include it.

## 3. lint-staged (pre-commit)

Mutating checks on staged files only:

```json
{
  "lint-staged": {
    "*.{js,mjs,ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md,css,yml,yaml}": ["prettier --write"],
    "*.py": [
      "uv run --project <python-project> --frozen python scripts/checks/check_comment_style.py --root . --fix",
      "uv run --project <python-project> --frozen ruff check --config <ruff-config> --fix",
      "uv run --project <python-project> --frozen ruff format --config <ruff-config>"
    ]
  }
}
```

Husky (or equivalent) pre-commit: `npx lint-staged`.

## 4. Pre-push / CI

Non-mutating full checks:

- Pre-push example: run the aggregate JS/TS gate, then
  `npm run format:python:check` if Python is not inside that aggregate.
- CI: `npm run format:check` (Prettier + ESLint including comment rules); a
  separate job for the Python comment checker + `ruff check` +
  `ruff format --check`.

## 5. Agent / docs pointers

In the target repo’s `AGENTS.md` (or equivalent):

- Point “any code change” at the local comment-style guide (or this skill’s
  `house-guide.md` once synced).
- Document the format style (Allman, no semis, …) and that mutating
  `format` / `lint:fix` should stay scoped in a dirty worktree.
- Note which hooks cover which languages.

## 6. Status in this repo (ggfincke-skills)

| Piece | Status here |
| ----- | ----------- |
| Always-on comment principles | shipped via skill sync |
| Expanded guide + formatting notes | in `references/` |
| Copyable ESLint / Python / Swift assets | in `assets/` |
| Root Prettier / ESLint / format make targets | **adopted** (`make format` / `format-check`) |
| Pre-commit format gates / CI format:check | **adopted** (lint-staged + CI jobs) |

Assets stay copyable for other repos. Destination-path headers on those assets
are exempt from `file-header` in this repo's ESLint config.
