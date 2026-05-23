# Comment Style - TypeScript

Follows the shared principles in `../SKILL.md`. TypeScript specifics + how to enforce them.

## Header

```ts
// src/path/file.ts
// brief lowercase purpose using & and w/
```

Path is repo-relative; the description is one lowercase fragment, no trailing period.

## Language specifics

- No JSDoc/TSDoc `/** */` - the types are the documentation.
- Comment interface/type members on the line above each member.
- No `eslint-disable` comments; follow the configured rules.

## Enforcement (`assets/eslint-rules/`)

Five custom rules, plus core `no-inline-comments`:

| Rule | What it does | Auto-fix |
|---|---|---|
| `file-header` | path header on line 1 + description on line 2; takes a `prefixes` option | inserts missing path |
| `no-jsdoc-blocks` | bans `/** */` blocks | no |
| `comment-style-guide` | `and` -> `&`, `with` -> `w/` | yes |
| `comment-block-length` | caps consecutive `//` at 3 | no |
| `no-unicode-arrow` | bans the Unicode arrow; use ASCII `->` | yes |

Wire it up:

1. Copy `assets/eslint-rules/` into the repo (e.g. `eslint-rules/`).
2. Register it as a local plugin in `eslint.config.js` and enable the rules:

```js
import ggfincke from './eslint-rules/index.js'

export default [
  {
    plugins: { ggfincke },
    rules: {
      'ggfincke/file-header': ['error', { prefixes: ['src/'] }],
      'ggfincke/no-jsdoc-blocks': 'error',
      'ggfincke/comment-style-guide': 'warn',
      'ggfincke/comment-block-length': 'warn',
      'ggfincke/no-unicode-arrow': 'error',
      'no-inline-comments': 'error',
    },
  },
]
```

3. Set `prefixes` to your repo's source roots. The rule ships with defaults `['src/', 'convex/', 'packages/contracts/', 'scripts/']` - override per repo.
4. Run via your `format` / `lint` scripts (Prettier for formatting, ESLint for the comment rules).
