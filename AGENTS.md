# Repository Instructions

- Treat `skills/` as the canonical source of truth for installable skills.
- Keep skill frontmatter portable by default: use only `name` and `description` unless an agent-specific overlay is intentionally introduced.
- Do not edit installed copies under `~/.codex/skills`, `~/.agents/skills`, `~/.claude/skills`, or project `.claude/skills` directly. Edit this repo and run `scripts/sync-skills.py`.
- Put detailed material in a skill's `references/`, deterministic helpers in `scripts/`, and reusable output resources in `assets/`.
- Do not add `README.md` files inside individual skill folders. Keep instructions in `SKILL.md` and referenced files.
- Run `python3 scripts/validate-skills.py` (or `make check`) before syncing or committing skill changes. Validation is strict by default: frontmatter beyond `name`/`description` fails unless you pass `--lenient-frontmatter`. `make install-hooks` runs validation + the script regression tests as a pre-commit hook, and CI runs both on every push/PR.

## Portable vs project skills

- `skills/` holds portable skills that sync into every agent's global dir (`~/.codex`, `~/.agents`, `~/.claude`). The global sync (`--target all`) only ever reads `skills/`.
- `projects/<repo>/<skill>/` holds project-only skills: ones whose triggers would collide across repos, or whose body is procedure specific to one codebase. They never sync globally.
- Install one repo's project skills into just that repo: `scripts/sync-skills.py --project-repo <repo> --project <path>` (or `make sync-project-repo REPO=<repo> PROJECT=<path>`). They land in the target's `.agents/skills`; git-exclude that path in the target repo.
- `validate-skills.py` checks both trees, so project skills follow the same name/description rules and the same pre-commit + CI gate.
- Name project skills locally without a repo prefix; the `projects/<repo>/` path already namespaces them.

## Always-on conventions

- Skills are pull-based: only `name` + `description` stay in context, and the body loads only when an agent judges it relevant. That is wrong for a standing convention you want applied on nearly every session (e.g. comment style).
- A skill promotes rules to always-on context by wrapping them in `<!-- always-on:start title="..." -->` / `<!-- always-on:end -->` markers in `SKILL.md`. The markers are invisible in rendered markdown; the wrapped lines stay the single source of truth.
- `sync-skills.py` collects every skill's always-on block & writes a generated region into each global agent's instruction file (`~/.codex/AGENTS.md`, `~/.agents/AGENTS.md`, `~/.claude/CLAUDE.md`). The region is delimited by `BEGIN/END ggfincke-skills:always-on`, updated in place; content outside it is preserved.
- It runs only on the global lane, collects from all of `skills/` (so syncing one skill never drops others), & skips with `--skip-always-on`. Shared logic lives in `scripts/always_on.py`; one ordered parser feeds both extraction & validation, so `validate-skills.py` fails on any malformed marker (stray, nested, unclosed, untitled, body on the start line, or a generated-region delimiter inside a block).
- Do not edit the generated region by hand. Edit the source skill's always-on block & re-run sync.

