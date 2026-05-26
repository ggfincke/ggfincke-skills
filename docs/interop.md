# Codex And Claude Skill Interop

## Source Of Truth

Keep canonical skills in `skills/<skill-name>/`. Each skill should be a directory containing `SKILL.md`, with optional `scripts/`, `references/`, and `assets/`.

Use the smallest shared frontmatter by default:

```yaml
---
name: skill-name
description: What this skill does and when to use it.
---
```

That shape is compatible with the local Codex skill-creator guidance and with Claude Code's skill format. Claude Code supports additional frontmatter fields, but adding them to canonical skills can reduce portability.

## Codex

OpenAI's public help docs currently note that skills are supported in Codex and the API, and that skills do not sync across products yet:

- https://help.openai.com/en/articles/20001066-skills-in-chatgpt

For local development in this environment, install canonical skills to:

- `~/.codex/skills/<skill-name>/`
- `~/.agents/skills/<skill-name>/`

`~/.codex/skills` follows the local Codex skill-creator default. `~/.agents/skills` is also present on this machine for installed local agent skills, so `scripts/sync-skills.py --target all` updates both.

## Claude Code

Claude Code documents these skill locations:

- Personal: `~/.claude/skills/<skill-name>/SKILL.md`
- Project: `.claude/skills/<skill-name>/SKILL.md`
- Plugin: `<plugin>/skills/<skill-name>/SKILL.md`

Reference:

- https://code.claude.com/docs/en/skills

Use personal installs for workflows you want everywhere. Use project installs only when a skill is specific enough that committing it with the repo is useful.

## Always-On Conventions

Skills load lazily, so a standing convention you want applied on nearly every session never reliably triggers. Such rules instead live in each agent's global instruction file, which is loaded unconditionally:

- Codex: `~/.codex/AGENTS.md`
- Local agents: `~/.agents/AGENTS.md`
- Claude Code: `~/.claude/CLAUDE.md`

The rules stay single-sourced in the owning skill's `SKILL.md`, wrapped in `always-on:start` / `always-on:end` markers. `scripts/sync-skills.py` collects them on every global sync and writes a `BEGIN/END ggfincke-skills:always-on` region into each file, updating in place and preserving any hand-written content around it.

## Recommended Distribution

Use this repo as the canonical source, then sync outward:

- Active development: `--mode link`
- Stable snapshots: `--mode copy`
- Personal global use: `--target all`
- Project-local Claude use: `--target project-claude --project <repo>`

Avoid editing installed copies directly. They are deployment artifacts.

