#!/usr/bin/env bash
# apps/ios/styling.sh
# run SwiftFormat & SwiftLint for the iOS source tree

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:---format}"

case "$MODE" in
  --format|format)
    MODE="format"
    ;;
  --check|check|--lint|lint)
    MODE="check"
    ;;
  *)
    echo "usage: $0 [--format|--check]"
    exit 2
    ;;
esac

require_tool()
{
  local tool="$1"

  if ! command -v "$tool" >/dev/null 2>&1
  then
    echo "$tool not found. Install it with: brew install $tool"
    exit 1
  fi
}

require_tool swiftformat
require_tool swiftlint

if [[ "$MODE" == "format" ]]
then
  swiftformat "$SCRIPT_DIR" --config "$SCRIPT_DIR/.swiftformat"
else
  swiftformat "$SCRIPT_DIR" --config "$SCRIPT_DIR/.swiftformat" --lint --reporter github-actions-log
fi

swiftlint lint "$SCRIPT_DIR" \
  --config "$SCRIPT_DIR/.swiftlint.yml" \
  --strict \
  --quiet \
  --force-exclude
