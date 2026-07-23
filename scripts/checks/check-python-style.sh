#!/usr/bin/env bash
# scripts/checks/check-python-style.sh
# run Python comment, Ruff lint, & Ruff format gates

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODE="${1:---format-check}"
RUFF_CONFIG="${RUFF_CONFIG:-pyproject.toml}"
CHECKER="${CHECKER:-skills/comment-style/assets/check_comment_style.py}"
# space-separated paths relative to ROOT for Ruff; override via RUFF_TARGETS
RUFF_TARGETS_DEFAULT=(
  scripts
  tests
  skills/comment-style/assets/check_comment_style.py
  projects
)
# shellcheck disable=SC2206
RUFF_TARGETS=(${RUFF_TARGETS:-${RUFF_TARGETS_DEFAULT[*]}})

# comment checker scans these roots (exclude copyable assets with destination headers)
COMMENT_PYTHON_ROOTS_DEFAULT="scripts tests projects"
COMMENT_PYTHON_ROOTS="${COMMENT_PYTHON_ROOTS:-$COMMENT_PYTHON_ROOTS_DEFAULT}"

# prefer uv's ephemeral ruff without treating this repo as a uv project;
# fall back to a PATH ruff + system python
if command -v uv >/dev/null 2>&1; then
  RUN_RUFF=(uv run --with ruff --no-project ruff)
  RUN_PY=(uv run --with ruff --no-project python)
elif command -v ruff >/dev/null 2>&1; then
  RUN_RUFF=(ruff)
  RUN_PY=(python3)
else
  echo "error: need uv (preferred) or ruff on PATH" >&2
  exit 1
fi

COMMENT_ARGS=(
  "$CHECKER"
  --root "$ROOT"
  --python
)

# shellcheck disable=SC2206
for dir in ${COMMENT_PYTHON_ROOTS}; do
  COMMENT_ARGS+=(--python-root "$ROOT/$dir")
done

cd "$ROOT"

run_lint()
{
  # run both semantic comment validation and ordinary Python linting together
  "${RUN_RUFF[@]}" check --config "$RUFF_CONFIG" "${RUFF_TARGETS[@]}"
  "${RUN_PY[@]}" "${COMMENT_ARGS[@]}"
}

case "$MODE" in
  --lint|lint)
    run_lint || exit $?
    ;;
  --format|format)
    "${RUN_PY[@]}" "${COMMENT_ARGS[@]}" --fix
    "${RUN_RUFF[@]}" check --config "$RUFF_CONFIG" --fix "${RUFF_TARGETS[@]}"
    "${RUN_RUFF[@]}" format --config "$RUFF_CONFIG" "${RUFF_TARGETS[@]}"
    "${RUN_PY[@]}" "${COMMENT_ARGS[@]}"
    ;;
  --format-check|format-check|--check|check)
    run_lint || exit $?
    "${RUN_RUFF[@]}" format --config "$RUFF_CONFIG" --check "${RUFF_TARGETS[@]}"
    ;;
  *)
    echo "usage: $0 [--lint|--format|--format-check]" >&2
    exit 2
    ;;
esac
