# Comment Style - Python

Follows the shared principles in `../SKILL.md`. Python specifics + how to enforce them.

## Header

```python
# path/from/repo-root.py
# brief lowercase purpose
```

A shebang stays on line 1; the path header follows it.

## Language specifics

- No docstrings for narrative - use `#` comments. The checker flags module/class/function docstrings.
- Tooling comments are exempt: `noqa`, `type: ignore`, `pragma: no cover`, `pyright:`, `mypy:`.

## Enforcement (`assets/check_comment_style.py`)

One checker handles Python and Swift. Copy it into the repo (e.g. `tools/`). For Python:

```bash
# check only
python3 tools/check_comment_style.py --check --python --root . --python-root apps/backend --python-root tools

# safe mechanical fixes (headers, abbreviations, side-comment moves)
python3 tools/check_comment_style.py --fix --python --root . --python-root apps/backend
```

- `--root` sets the repo root used for header paths (defaults to the git toplevel, else cwd).
- `--python-root` is repeatable and defaults to the repo root. `migrations/`, `.venv/`, `__pycache__/` are skipped.
- Pair with Ruff for formatting (`ruff format`, `ruff check --fix`) and run the checker from `make format` / `make check`.
