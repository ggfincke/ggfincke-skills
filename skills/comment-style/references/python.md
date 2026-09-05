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
- Docstrings are for module-level non-`_` classes when a short paragraph helps orient on the larger unit. Put constructor behavior on the class rather than `__init__`.
- Ordinary functions, methods, nested classes, and private/`_` classes use a plain `#` comment above them instead.
- Test files use plain `#` comments only - no docstrings, including on classes. A file counts as a test when it sits under a `test/`, `tests/`, or `e2e/` directory, its name starts with `test_`, or it ends in `.spec.py`/`.test.py`. This matches the `isTestFile` definition the TypeScript rules use, so one repo is judged the same way in both languages.
- Allowed class docstrings are sentence-style: capitalized and period-terminated.
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
- Pair with Ruff for formatting (`ruff format`, `ruff check --fix`). Optionally enable `D400` and `D403` so Ruff also checks sentence style on the class docstrings that remain allowed, then run both tools from the repo's format/check wrappers.
- Optional orchestrator: copy `assets/check-python-style.sh` next to the checker and customize `UV_PROJECT`, `RUFF_CONFIG`, `CHECKER`, and `RUFF_TARGETS` (see `wiring-recipe.md`).
