#!/usr/bin/env bash
# tools/check_swift_style.sh
# run Swift formatting, linting, & comment-style checks

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:---check}"

# dependencies are invoked through their interpreter so the wrapper works even when a copy
# into the target repo did not preserve the executable bit
case "$MODE" in
  --format|format)
    bash "$ROOT/apps/ios/styling.sh" --format
    python3 "$ROOT/tools/check_comment_style.py" --fix --swift --root "$ROOT" --swift-root "$ROOT/apps/ios"
    bash "$ROOT/apps/ios/styling.sh" --format
    python3 "$ROOT/tools/check_comment_style.py" --check --swift --root "$ROOT" --swift-root "$ROOT/apps/ios"
    ;;
  --check|check|--lint|lint)
    bash "$ROOT/apps/ios/styling.sh" --check
    python3 "$ROOT/tools/check_comment_style.py" --check --swift --root "$ROOT" --swift-root "$ROOT/apps/ios"
    ;;
  *)
    echo "usage: $0 [--format|--check]"
    exit 2
    ;;
esac
