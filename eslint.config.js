// eslint.config.js
// root flat config: comment-style rules over owned TS/JS

import ggfincke from './skills/comment-style/assets/eslint-rules/index.js'
import tseslint from 'typescript-eslint'

const commentRules = {
  'ggfincke/file-header': 'error',
  'ggfincke/comment-tags': 'error',
  'ggfincke/plain-comment-case': 'error',
  'ggfincke/block-doc-comments': 'error',
  'ggfincke/no-unicode-arrow': 'error',
  'no-inline-comments': [
    'error',
    {
      ignorePattern:
        '^\\s*(?:\\*\\s*)*(?:eslint(?:-disable)?|@ts-|istanbul|c8\\b|v8\\b)|(?:^|\\n)\\s*\\*?\\s*@(?:type|satisfies)\\b',
    },
  ],
}

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/package-lock.json',
      'eslint.config.js',
      'lint-staged.config.js',
    ],
  },
  {
    files: [
      'tools/worker-broker/**/*.{ts,tsx,js,mjs}',
      'skills/comment-style/assets/eslint-rules/**/*.js',
      'projects/**/*.{js,mjs,ts,tsx}',
    ],
    plugins: { ggfincke },
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: commentRules,
  },
  {
    // destination-path headers on copyable skill assets
    files: ['skills/comment-style/assets/eslint-rules/**'],
    rules: {
      'ggfincke/file-header': 'off',
    },
  }
)
