# Comment Style - Python

These are defaults. Explicit target-project API documentation requirements and tooling-significant syntax take precedence, including on functions, methods, modules, and tests. Preserve required docblocks; scope any necessary enforcer override to that documented surface.


Follows the shared principles in `../SKILL.md`. Python specifics + how to enforce them.

## Header

```python
# path/from/repo-root.py
# brief lowercase purpose
```

A shebang stays on line 1; the path header follows it.

## Language specifics

- No module docstrings; the two-line header owns module identity and purpose.
- Docstrings are allowed on any function, method, or class (tests included): one summary sentence, optional blank line and short body. Caps: 5 content lines on functions and methods, 8 on classes. Put constructor behavior on the class rather than `__init__`.
- A def or class with a docstring must not also carry a plain comment directly above it (tags and `TODO` are fine).
- Docstring summaries are sentence-style: capitalized and period-terminated.
- Plain comment blocks cap at 3 lines; a `*` / `!` / `?` tag and its continuation lines cap at 2.
- Shape: Ruff `C901`, `PLR0913`, `PLR0915` with the limits in `code-shape.md`.
- No em dashes in comments or docstrings; the checker reports them and leaves the rewrite to you.
- Tooling comments are exempt: `noqa`, `type: ignore`, `pragma: no cover`, `pyright:`, `mypy:`.

## Enforcement (`assets/check_comment_style.py`)

One checker handles Python and Swift. Copy it into the repo (e.g. `tools/`). For Python:

```bash
# check only
python3 tools/check_comment_style.py --check --python --root . --python-root apps/backend --python-root tools

# safe mechanical fixes (header paths, arrows, and plain-comment case)
python3 tools/check_comment_style.py --fix --python --root . --python-root apps/backend
```

- `--root` sets the repo root used for header paths (defaults to the git toplevel, else cwd).
- `--python-root` is repeatable and defaults to the repo root. `migrations/`, `.venv/`, `__pycache__/` are skipped.
- Pair with Ruff for formatting (`ruff format`, `ruff check --fix`). Enable `D400` and `D403` so Ruff also checks docstring sentence style, plus the shape rules from `code-shape.md`, then run both tools from the repo's format/check wrappers.
- Optional orchestrator: copy `assets/check-python-style.sh` next to the checker and customize `UV_PROJECT`, `RUFF_CONFIG`, `CHECKER`, and `RUFF_TARGETS` (see `wiring-recipe.md`).
