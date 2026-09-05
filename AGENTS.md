# Repository Instructions

- Treat `skills/` as the canonical source of truth for installable skills.
- Treat `agents/` as the canonical source of truth for personal Claude custom agents. Edit here and run `scripts/sync-agents.py`; never edit the installed files under `~/.claude/agents` directly.
- Keep the worker broker source under `tools/worker-broker/`. Build `dist/` from source and run `npm --prefix tools/worker-broker run check`; never edit generated `dist/` files.
- Keep skill frontmatter portable by default: use only `name` and `description` unless an agent-specific overlay is intentionally introduced.
- Do not edit installed copies under `~/.agents/skills`, `~/.claude/skills`, `~/.gemini/antigravity-cli/skills`, or project `.claude/skills` / `.agents/skills` directly. Edit this repo and run `scripts/sync-skills.py`.
- Put detailed material in a skill's `references/`, deterministic helpers in `scripts/`, and reusable output resources in `assets/`.
- Do not add `README.md` files inside individual skill folders. Keep instructions in `SKILL.md` and referenced files.
- Run `python3 scripts/validate-skills.py` (or `make check`) before syncing or committing skill, agent, or broker changes. Validation is strict by default: frontmatter beyond `name`/`description` fails unless you pass `--lenient-frontmatter`. `make install-hooks` installs a pre-commit hook that formats staged JS/TS and root-formatter-owned Python files first, then validates and tests a temporary checkout of the updated index (not full `make check` / broker-check). CI runs the full gate on every push/PR.

## Format + comment style

- Owned TypeScript/JavaScript uses Allman braces, no semis, single quotes (Prettier + `prettier-plugin-brace-style`). See `skills/comment-style/references/formatting.md`.
- Comment style (headers, plain comments, tags) is enforced by ESLint rules imported from `skills/comment-style/assets/eslint-rules/` and by the Python checker under that skill's `assets/`. Expanded guide: `skills/comment-style/references/house-guide.md`.
- `make check` includes non-mutating `format-check` (Prettier + ESLint) and `format-python-check` (Ruff + comment checker). Mutating fixes: `make format` / `make format-python` (or `npm run format:all`).
- Pre-commit runs `npx lint-staged` for staged `*.{js,mjs,cjs,ts,tsx}` plus Python under `scripts/`, `tests/`, `projects/`, and the adopted comment checker, then runs validate + unittest against the formatted index snapshot. Portable skill helpers remain outside the root Python formatter. The hook does **not** run broker-check; use `make check` or CI for that.

## Portable vs project skills

- `skills/` holds portable skills that sync into the shared Agents, Claude, and agy global dirs (`~/.agents`, `~/.claude`, `~/.gemini/antigravity-cli`). Codex discovers personal skills from `~/.agents/skills`; do not duplicate them under `~/.codex/skills`. The global sync (`--target all`) only ever reads `skills/`.
- `projects/<repo>/<skill>/` holds project-only skills: ones whose triggers would collide across repos, or whose body is procedure specific to one codebase. They never sync globally.
- Install one repo's project skills into just that repo: `scripts/sync-skills.py --project-repo <repo> --project <path>` (or `make sync-project-repo REPO=<repo> PROJECT=<path>`). They land in the target's `.agents/skills`; git-exclude that path in the target repo.
- `validate-skills.py` checks both trees, so project skills follow the same name/description rules and the same pre-commit + CI gate.
- Name project skills locally without a repo prefix; the `projects/<repo>/` path already namespaces them.

## Always-on conventions

- Skills are pull-based: only `name` + `description` stay in context, and the body loads only when an agent judges it relevant. That is wrong for a standing convention you want applied on nearly every session (e.g. comment style).
- A skill promotes rules to always-on context by wrapping them in `<!-- always-on:start title="..." -->` / `<!-- always-on:end -->` markers in `SKILL.md`. The markers are invisible in rendered markdown; the wrapped lines stay the single source of truth.
- `sync-skills.py` collects every skill's always-on block & writes a generated region into each global agent's instruction file (`~/.codex/AGENTS.md`, `~/.agents/AGENTS.md`, `~/.claude/CLAUDE.md`, `~/.gemini/GEMINI.md`). The region is delimited by `BEGIN/END ggfincke-skills:always-on`, updated in place; content outside it is preserved.
- Always-on blocks only take effect for skills under `skills/`: the sync never collects them from `projects/`, so a project-only skill carrying one gets a validation warning rather than a silently inert block.
- It runs only on the global lane, collects from all of `skills/` (so syncing one skill never drops others), & skips with `--skip-always-on`. Shared logic lives in `scripts/always_on.py`; one ordered parser feeds both extraction & validation, so `validate-skills.py` fails on any malformed marker (stray, nested, unclosed, untitled, body on the start line, or a generated-region delimiter inside a block).
- Do not edit the generated region by hand. Edit the source skill's always-on block & re-run sync.

<!-- BEGIN ggfincke-skills:always-on -->
<!-- Generated by scripts/sync-skills.py from skill always-on blocks. Do not edit here; edit the source skill. -->

# Always-on conventions

These come from skills in ggfincke-skills. Apply them on every relevant change, without being asked or invoking the skill.

## Comment style

_From the `comment-style` skill; full detail & enforcers there._

- Every covered file starts with exactly two comment lines: repo-relative path, then a lowercase untagged purpose phrase. Shebangs stay above them; module docstrings do not duplicate them. A file meant to be copied into another repo is the one exception: it carries the path it will live at in the destination, not its path where it is stored.
- Plain `#` / `//` comments are the default. Put them above the unit they describe so a glance explains what that function or block is for (and why it is shaped that way when that matters).
- Docstrings / TSDoc / `///` blocks are for larger constructs (typically classes; TypeScript also interfaces/enums; Swift types similarly), not routine functions. When used, they are full sentences with capitalization and terminal punctuation.
- Plain comments are lowercase and casual. Put them above the code, never beside it, and do not repeat a block doc or types already visible in the signature.
- Natural abbreviations such as `&`, `w/`, `w/o`, `config`, and `params` are welcome when they improve brevity, but are not mandatory rewrites.
- ASCII `->`, never the Unicode arrow.
- Plain comments are the default. Use structured tags sparingly: `*` important invariant, `!` warning/deprecation, `?` unresolved design question, `TODO` actionable follow-up.
- TODOs use one short `TODO action` or `TODO(scope): action` line with a lowercase scope. Put context immediately above in a plain block.
- Keep comment blocks concise; there is no hard line cap. Move durable architecture and long rationale to maintained docs.
- Cross-reference exact symbols plus stable module paths, never source line numbers.
- Honor explicit target-project conventions and public API documentation requirements. Preserve generated/vendor formats and annotations required by documentation, type-checking, deprecation, or other tooling; apply these prose defaults only where they do not conflict with those contracts.

## Engineering calibration

_From the `engineering-calibration` skill; full detail & enforcers there._

Implement the simplest design that fully preserves the requirements, invariants, failure behavior, and existing repository boundaries.

Do not equate simplicity with fewer files or fewer lines. Do not introduce abstractions, configuration, indirection, or extension points without a present repository-backed need. When adding a meaningful abstraction, state what concrete variation or policy it captures.

## Commit discipline

_From the `working-conventions` skill; full detail & enforcers there._

- When I ask you to commit and the working tree spans multiple concerns, do not commit one mixed blob. Propose logically-grouped commits - grouped by concern (e.g. backend / frontend / related), each a coherent unit, matching the repo's existing commit style and message format - and get my pick before committing.
- For a single-concern change, just commit it; this is for multi-concern trees.

## Task authority and preservation

_From the `working-conventions` skill; full detail & enforcers there._

- Vendor recipes do not expand the task. Use available host tools and current project instructions; preserve the requested output, source fidelity, and verification scope. Report missing capabilities instead of inventing them or weakening permission settings.
- Prefer native authentication and secret inputs/stores. Do not ask for credentials in chat or embed them in generated commands merely to complete a scaffold. Before external transfer, publication, or broader access, resolve the exact content, recipient, destination, and grant scope. Reuse already-specific informed authorization without asking twice.
- Preserve pre-existing files, staging, user objects, and settings. Establish exact target ownership, before-state, and recovery before migration, rollback, replacement, or deletion. A failed run does not authorize broad cleanup; an audit does not authorize fixes.
- Preserve requested limits on continued work. Do not silently turn an unsupported deadline into an unbounded goal. An exception is not proof that a run never started or that no mutation occurred; reconcile uncertain state before retrying.
- Update maintained sources through their owner. Do not edit managed plugin or skill caches. Distinguish a prepared patch, a local instruction safeguard, an installed update, and verified behavior; none proves the next.
- Carry task approval across phases and handoffs. Record its source-edit scope, generated outputs, named hand-written tests, existing verification commands, and Git/external actions. Reuse approval for that scope; request a new decision only when scope, consequences, or an authorization boundary changes.

## Test restraint during implementation

_From the `working-conventions` skill; full detail & enforcers there._

- Do not add, expand, or modify tests as a side effect of an implementation, fix, or refactor task unless I asked for tests or approved a plan that already includes them. If you added tests unprompted this turn, remove them and say so.
- When tests are wanted: major, important tests only - never exhaustive coverage. Plan them deliberately with the test-coverage-audit skill, and execute an approved test plan with phased-implementation.

<!-- END ggfincke-skills:always-on -->
