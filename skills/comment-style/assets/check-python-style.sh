#!/usr/bin/env bash
# scripts/checks/check-python-style.sh
# run Python comment, Ruff lint, & Ruff format gates

set -euo pipefail

# customize these when copying into a target repo
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODE="${1:---format-check}"
UV_PROJECT="${UV_PROJECT:-scripts/seed_pipeline}"
RUFF_CONFIG="${RUFF_CONFIG:-scripts/seed_pipeline/pyproject.toml}"
CHECKER="${CHECKER:-scripts/checks/check_comment_style.py}"
# space-separated paths relative to ROOT for Ruff; override via RUFF_TARGETS
RUFF_TARGETS_DEFAULT=("$CHECKER" "scripts/seed_pipeline")
# shellcheck disable=SC2206
RUFF_TARGETS=(${RUFF_TARGETS:-${RUFF_TARGETS_DEFAULT[*]}})

UV=(uv run --project "$UV_PROJECT" --frozen)
COMMENT_ARGS=(
  "$CHECKER"
  --root "$ROOT"
  --python
)

# optional extra python roots (repeatable): COMMENT_PYTHON_ROOTS="a b"
if [[ -n "${COMMENT_PYTHON_ROOTS:-}" ]]; then
  # shellcheck disable=SC2206
  for dir in ${COMMENT_PYTHON_ROOTS}; do
    COMMENT_ARGS+=(--python-root "$ROOT/$dir")
  done
fi

cd "$ROOT"

run_lint()
{
  # run both semantic comment validation and ordinary Python linting together
  "${UV[@]}" ruff check --config "$RUFF_CONFIG" "${RUFF_TARGETS[@]}"
  "${UV[@]}" python "${COMMENT_ARGS[@]}"
}

case "$MODE" in
  --lint|lint)
    run_lint || exit $?
    ;;
  --format|format)
    "${UV[@]}" python "${COMMENT_ARGS[@]}" --fix
    "${UV[@]}" ruff check --config "$RUFF_CONFIG" --fix "${RUFF_TARGETS[@]}"
    "${UV[@]}" ruff format --config "$RUFF_CONFIG" "${RUFF_TARGETS[@]}"
    "${UV[@]}" python "${COMMENT_ARGS[@]}"
    ;;
  --format-check|format-check|--check|check)
    run_lint || exit $?
    "${UV[@]}" ruff format --config "$RUFF_CONFIG" --check "${RUFF_TARGETS[@]}"
    ;;
  *)
    echo "usage: $0 [--lint|--format|--format-check]" >&2
    exit 2
    ;;
esac
