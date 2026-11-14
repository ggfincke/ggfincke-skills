# Comment Style - Swift

These are defaults. Explicit target-project API documentation requirements and tooling-significant syntax take precedence, including on functions, methods, modules, and tests. Preserve required docblocks; scope any necessary enforcer override to that documented surface.


Follows the shared principles in `../SKILL.md`. Swift specifics + how to enforce them.

## Header

```swift
// Path/From/SourceRoot.swift
// brief lowercase purpose
```

Path is relative to the repo root. The description is one untagged lowercase phrase with no trailing period.

## Language specifics

- `// MARK: -` for sections.
- Choose `#Preview` or `PreviewProvider` according to the actual Swift/Xcode and deployment target. The comment checker does not enforce this API choice.
- `///` documentation sits directly above the declaration it documents (types, functions, properties), including when a standalone attribute such as `@MainActor` comes between. Caps: 5 content lines on functions and members, 8 on types (`class`, `struct`, `enum`, `actor`, `protocol`). Do not use prose `/* */` blocks; those characters inside string literals or line comments are not block comments.
- `///` summaries are complete sentences: capitalized and period-terminated.
- Plain `//` comment blocks cap at 3 lines; a `*` / `!` / `?` tag and its continuation lines cap at 2.
- No em dashes in `//` comments or `///` docs.
- Tooling comments are exempt: `swiftlint:`.

## Enforcement

Comment style via the shared checker (`assets/check_comment_style.py`):

```bash
python3 tools/check_comment_style.py --check --swift --root . --swift-root apps/ios
python3 tools/check_comment_style.py --fix   --swift --root . --swift-root apps/ios
```

Formatting/linting via `assets/swift/` - example wrappers from a SwimMate-style layout. Adjust the baked-in `apps/ios` / `tools/` paths for your repo:

- `styling.sh` - runs SwiftFormat + SwiftLint over its own directory (needs `.swiftformat` + `.swiftlint.yml`).
- `check_swift_style.sh` - thin orchestrator that calls `styling.sh`, then `check_comment_style.py --swift`.
