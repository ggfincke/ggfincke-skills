// eslint.config.js
// root flat config: comment-style rules over owned TS/JS

import ggfincke from './skills/comment-style/assets/eslint-rules/index.js'
import tseslint from 'typescript-eslint'

const commentRules = {
  'ggfincke/file-header': 'error',
  'ggfincke/comment-block-length': 'error',
  'ggfincke/comment-tags': 'error',
  'ggfincke/plain-comment-case': 'error',
  'ggfincke/block-doc-comments': 'error',
  'ggfincke/no-unicode-arrow': 'error',
  'ggfincke/no-em-dash': 'error',
  'no-inline-comments': [
    'error',
    {
      ignorePattern:
        '^\\s*(?:\\*\\s*)*(?:eslint(?:-disable)?|@ts-|istanbul|c8\\b|v8\\b)|(?:^|\\n)\\s*\\*?\\s*@(?:type|satisfies)\\b',
    },
  ],
}

// code-shape limits from skills/comment-style/references/code-shape.md. warnings until the
// existing hits in the rule assets & the worker broker are refactored in their own wave
const shapeRules = {
  complexity: ['warn', 15],
  'max-params': ['warn', 7],
  'max-statements': ['warn', 60],
}

const ownedFiles = [
  'tools/worker-broker/**/*.{ts,tsx,js,mjs}',
  'skills/comment-style/assets/eslint-rules/**/*.js',
  'projects/**/*.{js,mjs,ts,tsx}',
]

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
    files: ownedFiles,
    plugins: { ggfincke },
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: commentRules,
  },
  {
    files: ownedFiles,
    rules: shapeRules,
  },
  {
    // destination-path headers on copyable skill assets
    files: ['skills/comment-style/assets/eslint-rules/**'],
    rules: {
      'ggfincke/file-header': 'off',
    },
  }
)
