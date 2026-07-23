// lint-staged.config.js
// staged TS/JS get eslint+prettier; any staged .py runs the python style wrapper

export default {
  '*.{js,mjs,ts,tsx}': ['eslint --fix', 'prettier --write'],
  // wrapper scans configured roots; do not append staged paths
  '*.py': () => 'bash scripts/checks/check-python-style.sh --format',
}
