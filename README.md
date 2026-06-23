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
- `scripts/sync-skills.py`: copies or symlinks skills into Codex, Claude Code, or a target project, and emits always-on rules into each agent's global instruction file.
- `scripts/always_on.py`: shared helper that extracts skills' always-on blocks and manages the generated region.
- `scripts/hooks/`: git hooks; `pre-commit` runs validation + tests before each commit.
- `tests/`: regression tests for the sync, always-on parser, and comment-style checker.
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

Validate all canonical skills, then run the regression tests:

```bash
python3 scripts/validate-skills.py   # or: make validate
make check                            # validate + tests
```

Validation is strict by default: frontmatter beyond `name`/`description` fails
unless you pass `--lenient-frontmatter`.

Enable the pre-commit hook so validation + tests run automatically before each commit:

```bash
make install-hooks
```

CI runs the same validation and tests on every push and pull request
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

## Always-On Conventions

Skills only load when an agent decides they're relevant, so a convention you want applied on nearly every session (like comment style) gets skipped. To make a rule always-on, wrap it in `SKILL.md` with markers:

```markdown
<!-- always-on:start title="Comment style" -->
- the rules, stated once
<!-- always-on:end -->
```

A global sync then writes those rules into each agent's global instruction file (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.agents/AGENTS.md`) inside a generated, idempotent region. The skill stays the source of truth; the region is regenerated each sync. Pass `--skip-always-on` to leave the instruction files untouched.

## Creating A Skill

1. Copy `templates/skill/` into `skills/<skill-name>/`.
2. Rename placeholders in `SKILL.md`.
3. Add optional `references/`, `scripts/`, or `assets/` only when they directly support the skill.
4. Run `python3 scripts/validate-skills.py`.
5. Sync it into the relevant agent directory.

