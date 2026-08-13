// lint-staged.config.js
// staged TS/JS and root-owned Python get exact-file formatting before snapshot validation

export default {
  '*.{js,mjs,cjs,ts,tsx}': ['eslint --fix', 'prettier --write'],
  '{scripts/**/*.py,tests/**/*.py,projects/**/*.py,skills/comment-style/assets/check_comment_style.py}':
    'bash scripts/checks/check-python-style.sh --format-files',
}
