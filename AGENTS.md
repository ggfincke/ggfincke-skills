# Repository Instructions

- Treat `skills/` as the canonical source of truth for installable skills.
- Keep skill frontmatter portable by default: use only `name` and `description` unless an agent-specific overlay is intentionally introduced.
- Do not edit installed copies under `~/.codex/skills`, `~/.agents/skills`, `~/.claude/skills`, or project `.claude/skills` directly. Edit this repo and run `scripts/sync-skills.py`.
- Put detailed material in a skill's `references/`, deterministic helpers in `scripts/`, and reusable output resources in `assets/`.
- Do not add `README.md` files inside individual skill folders. Keep instructions in `SKILL.md` and referenced files.
- Run `python3 scripts/validate-skills.py` before syncing or committing skill changes. `make install-hooks` enforces this as a pre-commit hook, and CI runs it on every push/PR.

## Portable vs project skills

- `skills/` holds portable skills that sync into every agent's global dir (`~/.codex`, `~/.agents`, `~/.claude`). The global sync (`--target all`) only ever reads `skills/`.
- `projects/<repo>/<skill>/` holds project-only skills: ones whose triggers would collide across repos, or whose body is procedure specific to one codebase. They never sync globally.
- Install one repo's project skills into just that repo: `scripts/sync-skills.py --project-repo <repo> --project <path>` (or `make sync-project-repo REPO=<repo> PROJECT=<path>`). They land in the target's `.agents/skills`; git-exclude that path in the target repo.
- `validate-skills.py` checks both trees, so project skills follow the same name/description rules and the same pre-commit + CI gate.
- Name project skills locally without a repo prefix; the `projects/<repo>/` path already namespaces them.

