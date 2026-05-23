# Repository Instructions

- Treat `skills/` as the canonical source of truth for installable skills.
- Keep skill frontmatter portable by default: use only `name` and `description` unless an agent-specific overlay is intentionally introduced.
- Do not edit installed copies under `~/.codex/skills`, `~/.agents/skills`, `~/.claude/skills`, or project `.claude/skills` directly. Edit this repo and run `scripts/sync-skills.py`.
- Put detailed material in a skill's `references/`, deterministic helpers in `scripts/`, and reusable output resources in `assets/`.
- Do not add `README.md` files inside individual skill folders. Keep instructions in `SKILL.md` and referenced files.
- Run `python3 scripts/validate-skills.py` before syncing or committing skill changes. `make install-hooks` enforces this as a pre-commit hook, and CI runs it on every push/PR.

