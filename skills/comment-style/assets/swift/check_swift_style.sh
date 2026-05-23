#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:---check}"

case "$MODE" in
  --format|format)
    "$ROOT/apps/ios/styling.sh" --format
    "$ROOT/tools/check_comment_style.py" --fix --swift
    "$ROOT/apps/ios/styling.sh" --format
    "$ROOT/tools/check_comment_style.py" --check --swift
    ;;
  --check|check|--lint|lint)
    "$ROOT/apps/ios/styling.sh" --check
    "$ROOT/tools/check_comment_style.py" --check --swift
    ;;
  *)
    echo "usage: $0 [--format|--check]"
    exit 2
    ;;
esac
