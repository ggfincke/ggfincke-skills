# Personal AI Coding Skills

Personal AI coding skills, prompts, and workflows for working with local codebases.

## Working Model

This repo is the source of truth. Skills live here in a portable format, then get installed into the directories each agent discovers.

- `skills/`: installable Agent Skills, one folder per skill.
- `projects/<repo>/`: project-only skills installed into a single repo, never synced globally.
- `prompts/`: reusable prompts that are not ready to become skills yet.
- `workflows/`: longer playbooks, checklists, and process notes.
- `templates/skill/`: starter structure for a new portable skill.
- `scripts/validate-skills.py`: validates local skill folders.
- `scripts/sync-skills.py`: copies or symlinks skills into Codex, Claude Code, or a target project.
- `scripts/hooks/`: git hooks; `pre-commit` runs validation before each commit.
- `Makefile`: convenience wrappers around the scripts (`make help` lists targets).
- `docs/interop.md`: notes on how Codex and Claude Code source skills.

The default rule is to write skills against the common subset:

```yaml
---
name: skill-name
description: What this skill does, including when the agent should use it.
---
```

Agent-specific behavior can be added later, but it should be explicit because it may make a skill less portable.

## Quick Start

Validate all canonical skills:

```bash
python3 scripts/validate-skills.py   # or: make validate
```

Enable the pre-commit hook so validation runs automatically before each commit:

```bash
make install-hooks
```

CI runs the same validation on every push and pull request
(`.github/workflows/validate.yml`).

Install all skills into personal Codex and Claude locations by symlink for active development:

```bash
python3 scripts/sync-skills.py --target all --mode link
```

Install a specific skill into one Claude Code project:

```bash
python3 scripts/sync-skills.py --target project-claude --project /path/to/repo --skill skill-name
```

Install a repo's project-only skills (from `projects/<repo>/`) into just that repo:

```bash
python3 scripts/sync-skills.py --project-repo <repo> --project /path/to/repo --mode link
```

Use `--mode copy` when you want a stable snapshot instead of a live link, and `--force` when intentionally replacing an existing installed skill.

## Creating A Skill

1. Copy `templates/skill/` into `skills/<skill-name>/`.
2. Rename placeholders in `SKILL.md`.
3. Add optional `references/`, `scripts/`, or `assets/` only when they directly support the skill.
4. Run `python3 scripts/validate-skills.py`.
5. Sync it into the relevant agent directory.

