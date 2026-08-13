#!/usr/bin/env bash
# scripts/checks/check-python-style.sh
# run Python comment, Ruff lint, & Ruff format gates

set -euo pipefail

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODE="${1:---format-check}"
if (($#)); then
  shift
fi
RUFF_CONFIG="${RUFF_CONFIG:-pyproject.toml}"
CHECKER="${CHECKER:-skills/comment-style/assets/check_comment_style.py}"
RUFF_VERSION="0.16.2"
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

EXPLICIT_FILES=()
EXPLICIT_COMMENT_FILES=()
if [[ "$MODE" == "--format-files" || "$MODE" == "format-files" ]]; then
  if (($# == 0)); then
    echo "error: --format-files requires at least one Python file" >&2
    exit 2
  fi
  for input_path in "$@"; do
    if [[ "$input_path" == /* ]]; then
      candidate="$input_path"
    else
      candidate="$ROOT/$input_path"
    fi
    if [[ ! -f "$candidate" || -L "$candidate" || "$candidate" != *.py ]]; then
      echo "error: explicit path is not an existing Python file: $input_path" >&2
      exit 2
    fi
    resolved_dir="$(cd -P "$(dirname "$candidate")" && pwd)"
    resolved="$resolved_dir/$(basename "$candidate")"
    case "$resolved" in
      "$ROOT"/scripts/*.py|"$ROOT"/tests/*.py|"$ROOT"/projects/*.py|"$ROOT"/skills/comment-style/assets/check_comment_style.py)
        EXPLICIT_FILES+=("$resolved")
        if [[ "$resolved" != "$ROOT/skills/comment-style/assets/check_comment_style.py" ]]; then
          EXPLICIT_COMMENT_FILES+=("$resolved")
        fi
        ;;
      *)
        echo "error: explicit Python path is outside owned roots: $input_path" >&2
        exit 2
        ;;
    esac
  done
elif (($#)); then
  echo "error: unexpected path arguments for $MODE" >&2
  exit 2
fi

# prefer an exact ephemeral Ruff without treating this repo as a uv project;
# a PATH fallback must be the same reviewed version
if command -v uv >/dev/null 2>&1; then
  RUN_RUFF=(uv run --with "ruff==$RUFF_VERSION" --no-project ruff)
elif command -v ruff >/dev/null 2>&1; then
  if [[ "$(ruff --version)" != "ruff $RUFF_VERSION" ]]; then
    echo "error: Ruff $RUFF_VERSION is required; install uv or the exact Ruff version" >&2
    exit 1
  fi
  RUN_RUFF=(ruff)
else
  echo "error: need uv (preferred) or ruff on PATH" >&2
  exit 1
fi
RUN_PY=(python3)

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

run_explicit_comments()
{
  if ((${#EXPLICIT_COMMENT_FILES[@]} == 0)); then
    return
  fi
  action="$1"
  explicit_comment_args=("$CHECKER" --root "$ROOT" --python)
  for file in "${EXPLICIT_COMMENT_FILES[@]}"; do
    explicit_comment_args+=(--python-file "$file")
  done
  "${RUN_PY[@]}" "${explicit_comment_args[@]}" "$action"
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
  --format-files|format-files)
    run_explicit_comments --fix
    "${RUN_RUFF[@]}" check --config "$RUFF_CONFIG" --fix "${EXPLICIT_FILES[@]}"
    "${RUN_RUFF[@]}" format --config "$RUFF_CONFIG" "${EXPLICIT_FILES[@]}"
    run_explicit_comments --check
    ;;
  --format-check|format-check|--check|check)
    run_lint || exit $?
    "${RUN_RUFF[@]}" format --config "$RUFF_CONFIG" --check "${RUFF_TARGETS[@]}"
    ;;
  *)
    echo "usage: $0 [--lint|--format|--format-check|--format-files <file.py> ...]" >&2
    exit 2
    ;;
esac
