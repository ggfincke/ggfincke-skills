# Comment Style - TypeScript

These are defaults. Explicit target-project API documentation requirements and tooling-significant syntax take precedence, including on functions, methods, modules, and tests. Preserve required docblocks; scope any necessary enforcer override to that documented surface.


Follows the shared principles in `../SKILL.md`. TypeScript specifics + how to enforce them.

## Header

```ts
// src/path/file.ts
// brief lowercase purpose
```

Path is repo-relative. The purpose is an untagged lowercase phrase with no trailing period. Keep it short when practical, but preserve useful module context rather than truncating it.

## Language specifics

- TSDoc/JSDoc belongs on classes, interfaces, and enums when a short paragraph helps orient on the larger unit. Ordinary functions and methods use a plain `//` comment above them instead.
- Prose block-doc summaries are capitalized, full sentences, and period-terminated. Tests and private helpers use plain why-comments.
- Preserve JavaScript JSDoc that supplies checker semantics (`@type`, `@param`, `@returns`, `@typedef`, `@import`, and related supported type tags), including inline casts and annotations in tests. Preserve `@deprecated` in both JS and TS, and syntax-sensitive tooling directives. Without a target documentation requirement, these exemptions do not justify prose-only function docs or redundant JSDoc types in TypeScript; see the [TypeScript JSDoc reference](https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html).
- Comment interface/type members on the line above each member when a note helps; do not put a TSDoc block on every member.
- Keep `eslint-disable` and other tooling directives narrow. Add a plain rationale above only when the reason is not obvious.

## Enforcement (`assets/eslint-rules/`)

Five custom rules, plus core `no-inline-comments`:

| Rule                  | What it does                                                                              | Auto-fix                         |
| --------------------- | ----------------------------------------------------------------------------------------- | -------------------------------- |
| `file-header`         | exact two-line path + untagged lowercase purpose; optional `prefixes` filter and `root` anchor | path/case/period/separation only |
| `comment-tags`        | canonical `*`, `!`, `?`, and uppercase `TODO(scope):` syntax                              | no                               |
| `plain-comment-case`  | lowercase natural-language starts while preserving code-like symbols                      | yes                              |
| `block-doc-comments`  | restricts prose blocks to class/interface/enum docs; preserves semantic JSDoc and tool directives | no                         |
| `no-unicode-arrow`    | bans the Unicode arrow; use ASCII `->`                                                    | yes                              |

Wire it up:

1. Copy `assets/eslint-rules/` into the repo (e.g. `eslint-rules/`). Keep the folder's `package.json` — the rules are ESM, and Node resolves module type from the nearest `package.json`, so without it the plugin fails to load in a repo declaring `"type": "commonjs"` (or one with no type field on Node 20).
2. Register it as a local plugin in `eslint.config.js` and enable the rules:

```js
import ggfincke from "./eslint-rules/index.js";

export default [
  {
    plugins: { ggfincke },
    rules: {
      "ggfincke/file-header": ["error", { prefixes: ["src/", "scripts/"] }],
      "ggfincke/comment-tags": "error",
      "ggfincke/plain-comment-case": "error",
      "ggfincke/block-doc-comments": "error",
      "ggfincke/no-unicode-arrow": "error",
      "no-inline-comments": [
        "error",
        {
          ignorePattern:
            "^\\s*(?:\\*\\s*)*(?:eslint(?:-disable)?|@ts-|istanbul|c8\\b|v8\\b)|(?:^|\\n)\\s*\\*?\\s*@(?:type|satisfies)\\b",
        },
      ],
    },
  },
];
```

3. Omit `prefixes` to cover every linted file, or set it to the repo's owned source roots.
   Header paths are resolved against the nearest `.git` ancestor, matching `git rev-parse --show-toplevel`, so linting from a package subdirectory reports the same path as linting from the root. Set `root` only when the repo has no `.git` (vendored trees, build sandboxes).
4. Run via your `format` / `lint` scripts (Prettier for formatting, ESLint for the comment rules).
