# Comment Style - Swift

Follows the shared principles in `../SKILL.md`. Swift specifics + how to enforce them.

## Header

```swift
// Path/From/SourceRoot.swift
// brief lowercase purpose
```

Path is relative to the Swift source root (e.g. `apps/ios`); the description is one lowercase fragment.

## Language specifics

- `// MARK: -` for sections.
- `#Preview`, not `PreviewProvider`.
- No `///` doc comments, no `/* */` block comments.
- Tooling comments are exempt: `swiftlint:`.

## Enforcement

Comment style via the shared checker (`assets/check_comment_style.py`):

```bash
python3 tools/check_comment_style.py --check --swift --root . --swift-root apps/ios
python3 tools/check_comment_style.py --fix   --swift --root . --swift-root apps/ios
```

Formatting/linting via `assets/swift/` - example wrappers from a SwimMate-style layout. Adjust the baked-in `apps/ios` / `tools/` paths for your repo:

- `styling.sh` - runs SwiftFormat + SwiftLint over its own directory (needs `.swiftformat` + `.swiftlint.yml`). It also carries a bash reimplementation of the comment checks that overlaps with `check_comment_style.py`; pick one as the source of truth.
- `check_swift_style.sh` - thin orchestrator that calls `styling.sh`, then `check_comment_style.py --swift`.
