# New repo bootstrap

Setup checklist for spinning up a new repo - or re-normalizing an existing one - to repo standards: comment-style enforcers, an AGENTS.md, the standing conventions, a landing gate + pre-commit hook, and CI. This repo (ggfincke-skills) is the reference implementation.

Why a workflow and not a skill: occasional setup pass, not something to auto-fire every session. Open this file and work the list top to bottom, skipping rows a repo doesn't need (e.g. the Python step on a TS-only repo). Do them roughly in order - AGENTS.md first since later steps reference the command names it defines; CI last since it just runs the gate.

## 1. AGENTS.md

Seed the repo's conventions doc before anything else - later steps reference the command names it defines. Model the structure on this repo's `AGENTS.md`:
- A top block of repo conventions (source of truth, what not to hand-edit, where detail lives).
- A portable vs project split if the repo has both reusable and repo-only material.
- The gate / landing commands stated explicitly (this repo: `make check` for the full validation, test, broker, and format gate; `make install-hooks` for root-owned staged formatting plus index-snapshot validation/tests; and what CI runs). Name them so every agent lands changes the same way.
- A repo-specific carve-out only if this repo deviates from the `working-conventions` always-on rules (commit grouping by concern, test restraint); otherwise nothing to add - they ride in via the global always-on block.

Check the repo in for a `CLAUDE.md` -> `See AGENTS.md` one-liner so both agents read the same doc (this repo does exactly that).

## 2. Comment-style enforcers

Wire the matching linter for the repo's languages. The `comment-style` skill carries per-language enforcer configs under its `assets/`, plus formatting and install recipes in `references/formatting.md` and `references/wiring-recipe.md`:
- TypeScript/JS -> the ESLint rules in the skill's `assets/eslint-rules`, plus Prettier/Allman from `references/formatting.md`.
- Python -> Ruff + `assets/check_comment_style.py` (optional wrapper: `assets/check-python-style.sh`).
- Swift -> SwiftFormat (the skill's `assets/swift`).
- Any language -> the skill's portable `assets/check_comment_style.py` as a fallback enforcer.

The comment-style rules already ship globally via the always-on block; this step only adds the repo's lint-config enforcement so violations fail locally + in CI. Follow `wiring-recipe.md` for scripts, lint-staged, and CI shape.

## 3. Landing gate + pre-commit hook

The full gate bundles validation, tests, broker checks, and non-mutating format checks. The pre-commit hook is a narrower adapter: it formats staged files owned by the repository's formatter, then validates and tests a temporary checkout of the resulting index. In this repo (confirm against the target repo's Makefile before copying):

```sh
make check          # validate + test + broker-check + format-check + format-python-check
make install-hooks  # owned staged formatting + validation/tests against the final index snapshot
```

For a new repo without a Makefile, give it a `check` target (or `npm run check` / `just check`) that runs the validator + the test suite + format gates. Its pre-commit hook should normalize staged files first, then validate and test the updated index rather than the restored dirty worktree. This repo's hook does **not** run full `make check` (broker-check stays for CI / `make check`).

## 4. Python repos

Stand up the interpreter + venv with `uv`, and pin a default interpreter so every agent + the hook resolve the same Python. Skip on non-Python repos.

```sh
uv venv
```

## 5. Changelog scaffold

Add a `CHANGELOG.md` in Keep-a-Changelog format with a standing `## [Unreleased]` section to accrue entries between releases:

```md
# Changelog

All notable changes to this project are documented here.
Format: Keep a Changelog. Versioning: SemVer.

## [Unreleased]
```

Optional: where the repo wants it enforced, wire a changelog-check into the `check` target so a change without an entry fails the gate. Not part of this repo's gate - aspirational, not yet implemented here.

## 6. CI

Clone the validate workflow from a sibling repo rather than writing one from scratch. This repo's `.github/workflows/validate.yml` decomposes the full local gate across Python-version, root-format, and worker-broker jobs on every push + PR, with actions pinned by SHA. Copy the structure, replace its commands with the new repo's full gate, and take current action pins from the live workflow rather than prose.
