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

OpenAI's Codex customization docs designate the shared Agents directory as the personal global skill location:

- https://learn.chatgpt.com/docs/customization/overview#skills

For local development in this environment, install canonical personal skills to:

- `~/.agents/skills/<skill-name>/`

Codex discovers that shared location directly. Do not also install the same personal skill under `~/.codex/skills`; Codex can discover both paths and surface duplicate entries. `scripts/sync-skills.py --target agents --target claude` updates `~/.agents/skills` and `~/.claude/skills`, while the explicit `--target codex` option remains only for legacy environments.

## Coral

Coral discovers personal skills from the same shared Agents directory Codex uses:

- Skills: `$AGENTS_HOME/skills/<skill-name>/` (default `~/.agents/skills`)
- Always-on: `$AGENTS_HOME/AGENTS.md` (default `~/.agents/AGENTS.md`)

`--target agents` or `make sync` is enough. Do not also sync a duplicate tree into `~/.coral/skills`.

## Claude Code

Claude Code documents these skill locations:

- Personal: `~/.claude/skills/<skill-name>/SKILL.md`
- Project: `.claude/skills/<skill-name>/SKILL.md`
- Plugin: `<plugin>/skills/<skill-name>/SKILL.md`

Reference:

- https://code.claude.com/docs/en/skills

Use personal installs for workflows you want everywhere. Use project installs only when a skill is specific enough that committing it with the repo is useful.

## Antigravity (agy)

Google Antigravity CLI (`agy`) and the shared Gemini environment discover skills and rules from these locations:

- Global CLI skills: `$AGY_HOME/skills/<skill-name>/` (default `~/.gemini/antigravity-cli/skills/`)
- Shared skills: `$GEMINI_HOME/skills/<skill-name>/` (default `~/.gemini/skills/`)
- Project workspace skills: `.agents/skills/<skill-name>/`
- Always-on instructions: `$GEMINI_HOME/GEMINI.md` (default `~/.gemini/GEMINI.md`)

An explicit `scripts/sync-skills.py --target all` or `--target agy` seeds global skills into `~/.gemini/antigravity-cli/skills/` and writes always-on conventions into `~/.gemini/GEMINI.md`. Use `--target gemini` (or `--target agy-shared`) to explicitly seed into the shared root instead. Project-only skills install into a project's `.agents/skills` via `--target project-agy` or `--target project-agents`.

## Always-On Conventions

Skills load lazily, so a standing convention you want applied on nearly every session never reliably triggers. Such rules instead live in each agent's global instruction file, which is loaded unconditionally:

- Codex: `~/.codex/AGENTS.md`
- Local agents and Coral: `~/.agents/AGENTS.md`
- Claude Code: `~/.claude/CLAUDE.md`
- Antigravity: `~/.gemini/GEMINI.md`

The rules stay single-sourced in the owning skill's `SKILL.md`, wrapped in `always-on:start` / `always-on:end` markers. `scripts/sync-skills.py` collects them on every global sync and writes a `BEGIN/END ggfincke-skills:always-on` region into each file, updating in place and preserving any hand-written content around it.

## Recommended Distribution

Use this repo as the canonical source, then sync outward:

- Active development: `--mode link`
- Stable snapshots: `--mode copy`
- Default personal Agents/Codex and Claude use: `--target agents --target claude`
- Explicit additional agy installation: `--target agy` (or `--target all` for all three)
- Project-local Claude use: `--target project-claude --project <repo>`
- Project-local agy/agents use: `--target project-agy --project <repo>`

Avoid editing installed copies directly. They are deployment artifacts.
