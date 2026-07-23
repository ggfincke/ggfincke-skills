# New repo bootstrap

Setup checklist for spinning up a new repo - or re-normalizing an existing one - to repo standards: comment-style enforcers, an AGENTS.md, the standing conventions, a landing gate + pre-commit hook, and CI. This repo (ggfincke-skills) is the reference implementation.

Why a workflow and not a skill: occasional setup pass, not something to auto-fire every session. Open this file and work the list top to bottom, skipping rows a repo doesn't need (e.g. the Python step on a TS-only repo). Do them roughly in order - AGENTS.md first since later steps reference the command names it defines; CI last since it just runs the gate.

## 1. AGENTS.md

Seed the repo's conventions doc before anything else - later steps reference the command names it defines. Model the structure on this repo's `AGENTS.md`:
- A top block of repo conventions (source of truth, what not to hand-edit, where detail lives).
- A portable vs project split if the repo has both reusable and repo-only material.
- The gate / landing commands stated explicitly (this repo: `make check` to validate + test, `make install-hooks` for the pre-commit hook, what CI runs). Name them so every agent lands changes the same way.
- A `## Pre-1.0 breaking-change policy` section (see the pending stub at the bottom of this file).
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

The gate bundles validation + tests behind one command; the hook runs it pre-commit. In this repo (confirm against the target repo's Makefile before copying):

```sh
make check          # validate + test + broker-check + format-check + format-python-check
make install-hooks  # route git hooks at scripts/hooks (validate + tests + lint-staged)
```

For a new repo without a Makefile, give it a `check` target (or `npm run check` / `just check`) that runs the validator + the test suite + format gates, and a pre-commit hook that runs validate/tests plus lint-staged (mutating format on staged files). Note: this repo's hook does **not** run full `make check` (broker-check stays for CI / `make check`).

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

Clone the validate workflow from a sibling repo rather than writing one from scratch. This repo's `.github/workflows/validate.yml` runs the same gate as the local hook (validate, then the regression tests) on every push + PR, on pinned action SHAs. Copy it, swap the two run-steps for the new repo's gate command, and keep the SHA pins verbatim (`actions/checkout@9c091bb... # v7.0.0`, `actions/setup-python@a309ff8... # v6.2.0`).

## Pre-1.0 breaking-change policy (pending)

Not finalized. The canonical wording lands later; do not paste a specific policy here meanwhile. When decided, it lives in the repo's `AGENTS.md` (its own `## Pre-1.0 breaking-change policy` section), and this stub gets replaced with a one-line pointer to it. Until then, leave the AGENTS.md section a placeholder rather than inventing terms.
