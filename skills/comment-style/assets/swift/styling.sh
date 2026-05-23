#!/usr/bin/env bash
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

swift_files()
{
  find "$SCRIPT_DIR" \
    -name '*.swift' \
    -not -path "$SCRIPT_DIR/Pods/*" \
    -not -path "$SCRIPT_DIR/Carthage/*" \
    -not -path "$SCRIPT_DIR/.build/*" \
    -not -path "$SCRIPT_DIR/DerivedData/*" \
    -print0
}

check_swift_comments()
{
  local failures=0
  local file
  local relative_path
  local first_line
  local second_line
  local line
  local lower_line
  local line_number

  while IFS= read -r -d '' file
  do
    relative_path="${file#"$SCRIPT_DIR"/}"
    first_line="$(sed -n '1p' "$file")"
    second_line="$(sed -n '2p' "$file")"

    if [[ ! "$first_line" =~ ^//\ .+\.swift$ ]]
    then
      printf '%s:1: Swift files must start with "// path/to/File.swift"\n' "$relative_path"
      failures=1
    fi

    if [[ ! "$second_line" =~ ^//\ [a-z0-9] ]]
    then
      printf '%s:2: Swift file header description must be lowercase\n' "$relative_path"
      failures=1
    fi

    line_number=0
    while IFS= read -r line || [[ -n "$line" ]]
    do
      ((line_number += 1))
      lower_line="${line,,}"

      if [[ "$line" =~ ^[[:space:]]*/// ]]
      then
        printf '%s:%s: use // comments, not /// doc comments\n' "$relative_path" "$line_number"
        failures=1
      fi

      if [[ "$line" == *"/*"* || "$line" == *"*/"* ]]
      then
        printf '%s:%s: use single-line // comments, not block comments\n' "$relative_path" "$line_number"
        failures=1
      fi

      if [[ "$line" == *"PreviewProvider"* ]]
      then
        printf '%s:%s: use #Preview instead of PreviewProvider\n' "$relative_path" "$line_number"
        failures=1
      fi

      if [[ ! "$line" =~ ^[[:space:]]*//\ MARK: && "$lower_line" =~ ^[[:space:]]*//.*(^|[^a-z0-9_])(and|with|without|calculate|configuration|information|function|variable|parameters)([^a-z0-9_]|$) ]]
      then
        printf '%s:%s: use comment abbreviations: &, w/, w/o, calc, config, info, func, var, params\n' "$relative_path" "$line_number"
        failures=1
      fi
    done < "$file"
  done < <(swift_files)

  return "$failures"
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

check_swift_comments
