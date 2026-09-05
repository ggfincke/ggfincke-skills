# Personal AI Coding Skills

Personal AI coding skills, prompts, and workflows for working with local codebases.

## Working Model

This repo is the source of truth. Skills live here in a portable format, then get installed into the directories each agent discovers.

- `skills/`: installable Agent Skills, one folder per skill.
- `agents/`: canonical personal Claude custom-agent definitions.
- `projects/<repo>/`: project-only skills installed into a single repo, never synced globally.
- `tools/worker-broker/`: local stdio MCP broker for isolated native-harness workers.
- `prompts/`: reusable prompts that are not ready to become skills yet.
- `workflows/`: longer playbooks, checklists, and process notes.
- [`workflows/review-chain.md`](workflows/review-chain.md): the audit -> approval -> implementation -> re-verification handoff.
- `templates/skill/`: starter structure for a new portable skill.
- `scripts/validate-skills.py`: validates local skill folders.
- `scripts/sync-skills.py`: copies or symlinks skills into the shared Agents root, Claude Code, Antigravity CLI (agy), or a target project, and emits always-on rules into each agent's global instruction file.
- `scripts/sync-agents.py`: copies or symlinks canonical Claude custom agents into `~/.claude/agents`.
- `mcp/servers.json`: canonical registry of MCP servers, one entry per server with the tools it targets.
- `scripts/sync-mcp.py`: merges that registry transactionally into each tool's native config (`~/.config/opencode/opencode.json`, `~/.claude.json`); see [`docs/mcp-lanes.md`](docs/mcp-lanes.md).
- `scripts/always_on.py`, `scripts/skill_inventory.py`, `scripts/sync_transaction.py`, and `scripts/tooling_paths.py`: canonical seams for always-on extraction, skill inventory/validation, transactional sync, and external tooling paths.
- `scripts/hooks/`: git hooks; `pre-commit` formats staged files, then validates and tests the resulting index snapshot.
- `tests/`: regression tests for sync, always-on parsing, comment style, branch sweep, pre-commit hook behavior, inventory/path resolution, and sync transactions.
- `Makefile`: convenience wrappers around the scripts (`make help` lists targets).
- `docs/interop.md`: notes on how Codex, Claude Code, and Antigravity source skills.

The default rule is to write skills against the common subset:

```yaml
---
name: skill-name
description: What this skill does, including when the agent should use it.
---
```

Agent-specific behavior can be added later, but it should be explicit because it may make a skill less portable.

## Quick Start

Use Node.js 24+, Python 3.9+, and `uv` (or Ruff 0.16.2 already on `PATH`). Install both Node dependency trees in a fresh checkout, then run the full repository gate:

```bash
npm ci
npm --prefix tools/worker-broker ci
python3 scripts/validate-skills.py   # or: make validate
make check                            # validation + generated outputs + tests + broker + format checks + audits
```

Validation is strict by default: frontmatter beyond `name`/`description` fails
unless you pass `--lenient-frontmatter`.

Enable the pre-commit hook so staged JS/TS and root-formatter-owned Python files are formatted and the resulting index snapshot is validated and tested before each commit:

```bash
make install-hooks
```

CI runs the full gate's skill validation, regression tests, worker-broker checks, and
root format checks on every push and pull request (`.github/workflows/validate.yml`).

Install all skills into the personal Agents and Claude locations by symlink for active development. Codex discovers personal skills from the shared Agents location:

```bash
python3 scripts/sync-skills.py --target agents --target claude --mode link
```

Install canonical Claude custom agents separately:

```bash
python3 scripts/sync-agents.py --mode link
```

## MCP Servers

MCP server registrations live in `mcp/servers.json` — one canonical entry per server naming the tools it targets — and are merged into each tool's native config by:

```bash
python3 scripts/sync-mcp.py --dry-run   # preview per-file changes
python3 scripts/sync-mcp.py             # apply (or: make sync-mcp)
```

The merge is surgical: only registry-owned names inside each tool's MCP section (`mcp` for opencode, `mcpServers` for Claude Code) are added or updated; every other key and foreign server entry is preserved untouched. Re-runs with an unchanged registry are no-ops, and a malformed target config refuses the run instead of guessing. Registry semantics, schema rules, and the roadmap for Codex/Cursor/Claude Desktop targets live in [`docs/mcp-lanes.md`](docs/mcp-lanes.md).

Remote servers authenticate per client on first use (`opencode mcp auth <server>`; Claude Code triggers OAuth on its first tool call).

The worker broker is a Node 24+ package. Install, build, and register its stdio server with Claude Code:

```bash
npm --prefix tools/worker-broker ci
npm --prefix tools/worker-broker run build
claude mcp add --transport stdio --scope user worker-broker \
  -- /absolute/path/to/node /absolute/path/to/ggfincke-skills/tools/worker-broker/dist/src/server.js
```

The broker exposes native Codex, Cursor, Coral, and Claude workers. Override their executable paths or defaults with `WORKER_BROKER_CODEX_BINARY`, `WORKER_BROKER_CODEX_MODEL`, `WORKER_BROKER_CURSOR_BINARY`, `WORKER_BROKER_CURSOR_MODEL`, `WORKER_BROKER_CORAL_BINARY`, `WORKER_BROKER_CORAL_MODEL`, `WORKER_BROKER_CORAL_HOST`, `WORKER_BROKER_CLAUDE_BINARY`, and `WORKER_BROKER_CLAUDE_MODEL`. Cursor effort belongs in the Cursor model identifier rather than the broker's generic `effort` field. Coral rejects generic effort and nested-agent overrides. Claude forwards `low`, `medium`, `high`, `xhigh`, and `max`; `ultra` remains assignment metadata because the Claude CLI does not accept it.

Claude Code is the orchestration UI. Worker jobs remain isolated broker records surfaced through MCP tool output and job artifacts; they do not appear as native Claude Code child conversations. T3 is not part of this setup.

Launch the model-inheriting orchestrator after the `orchestrate` skill and `fable-orchestrator` agent are synced. The agent name is a workflow name and does not select Fable: `--model` chooses the Claude Code parent model. For example, start the lower-cost Haiku parent used for acceptance:

```bash
claude --model haiku --agent fable-orchestrator
```

The parent plans and integrates the change in the interactive Claude Code session. It starts native Codex, Cursor, Coral, or Claude jobs through `worker-broker`, follows their status with `list_workers` or `get_worker_status`, and retrieves terminal evidence with `get_worker_result`. The broker creates the isolated worktrees and owns lifecycle, scope validation, verification, and final patch capture.

Install a specific skill into one Claude Code project:

```bash
python3 scripts/sync-skills.py --target project-claude --project /path/to/repo --skill skill-name
```

Install a repo's project-only skills (from `projects/<repo>/`) into just that repo:

```bash
python3 scripts/sync-skills.py --project-repo <repo> --project /path/to/repo --mode link
```

Use `--mode copy` when you want a stable snapshot instead of a live link, and `--force` when intentionally replacing an existing installed skill. Without `--force` an already-installed skill is skipped. A divergent selected copy, or retained copy contributing global rules, blocks instruction advancement rather than silently mixing generations. Switching modes needs the explicit force variants: `make sync-force` and `make sync-copy-force` are the `make sync` / `make sync-copy` equivalents that replace what is already there.

Pass `--prune` to also remove installs this tool created whose source skill no longer exists (a skill deleted or renamed upstream). It is opt-in and never touches anything hand-placed; pair it with `--dry-run` first.

Pruning identifies its own copies by a `.ggfincke-skills-sync` marker recording the source they came from, which has two consequences worth knowing:

- A copy installed before markers existed is **not** prunable and is left alone — `--prune` names it and says why rather than deleting a directory it cannot prove it created. One `make sync-copy-force` pass re-stamps existing copies, making them prunable from then on.
- A run only prunes copies whose recorded source is inside the source tree that run is installing from. Portable skills (`skills/`) and a repo's project-only skills (`projects/<repo>/`) can share one target root without either run treating the other's installs as orphans. `--prune` is still rejected outright on the `--project-repo` lane.

## Always-On Conventions

Skills only load when an agent decides they're relevant, so a convention you want applied on nearly every session (like comment style) gets skipped. To make a rule always-on, wrap it in `SKILL.md` with markers:

```markdown
<!-- always-on:start title="Comment style" -->
- the rules, stated once
<!-- always-on:end -->
```

A global sync then writes those rules into each agent's global instruction file (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.agents/AGENTS.md`, `~/.gemini/GEMINI.md`) inside a generated, idempotent region. Skill installs and instruction files deliberately use different roots for Codex: personal skills live in `~/.agents/skills`, while standing Codex guidance lives in `~/.codex/AGENTS.md`. The skill stays the source of truth; the region is regenerated each sync. Pass `--skip-always-on` to leave the instruction files untouched.

The small task-authority guard in `working-conventions` also has a generated Cursor `.mdc` asset. Its source remains the skill's always-on block; the machine-local delivery path is `~/.cursor/rules/ggfincke-task-boundaries.mdc`. That path is separate from account-synced rules. Verify support and discovery in the installed Cursor version before claiming that a new session loaded it. These instructions guide behavior; they are not a hard permission boundary or a repair to vendor code.

## Workflow Ownership

| Work | Maintained owner |
| --- | --- |
| Exact requisition, grounded application draft, human submission handoff | [`application-preparation`](skills/application-preparation/SKILL.md); browser/document skills retain tool ownership |
| Project/disk inventory, approved reversible cleanup, unfamiliar executable inspection | [`workspace-cleanup`](skills/workspace-cleanup/SKILL.md); Git branch deletion stays in `branch-sweep` |
| Vendor instructions that exceed task authority or assume unavailable tools | [`working-conventions`](skills/working-conventions/references/vendor-boundaries.md); technical fixes stay with the vendor owner |

Review and implementation remain separate scopes. Managed plugin caches are not canonical editable sources; a prepared patch is not an installed vendor update. Do not promote project-only skills or historical memory recipes into global skills simply to remove duplicate-looking names.

## Generated Reference Assets

Edit Vercel rules in their `rules/` folders, then regenerate the compiled references. Edit the Cursor guard in the `working-conventions` always-on block, then export its asset:

```bash
python3 scripts/compile-skill-references.py
python3 skills/working-conventions/scripts/export-cursor-guard.py
```

Both commands accept `--check` for a non-mutating drift check. They do not install dependencies, refresh upstream packages, or sync client installations.

## Creating A Skill

1. Copy `templates/skill/` into `skills/<skill-name>/`.
2. Rename placeholders in `SKILL.md`.
3. Add optional `references/`, `scripts/`, or `assets/` only when they directly support the skill.
4. Run `python3 scripts/validate-skills.py`.
5. Sync it into the relevant agent directory.

## Local doctor

Run `python3 scripts/doctor.py --target agents --target claude` for read-only installation, duplicate-name, binary, MCP-registration, and build diagnostics. Use `--json` for machine-readable output. `--project /path --project-repo name` checks project skill discovery. No repair, build, daemon start, or model call occurs by default.

The doctor resolves the registered broker Node/CLI pair before falling back to the built local CLI on the current Node runtime. Native flag support, requested restrictions, effective enforcement, and model observations remain distinct. To run one bounded disposable native protocol probe, explicitly add `--smoke --provider codex` (or claude, cursor, coral). A protocol pass is not a containment certificate; unavailable or unobserved controls stay unverified.

## Deployment generations and local rollout

The default CLI and `make sync` target Agents/Codex and Claude only. Antigravity remains available through an explicit `--target agy` or `--target all`. This audit rollout preserves link installations and Claude's unrelated `tldraw-offline` package.

Every managed root records `.ggfincke-skills-generation.json`: actual package-content hashes, link/copy mode, generated-region hashes, and a deterministic generation hash. Separate source lanes coexist in the receipt. A dirty Git revision cannot replace content identity. Global package replacements, instruction updates, generation receipts, and reviewed prunes commit in one rollback unit. Instruction aliases are coalesced and manual text survives. No sync implicitly enables `--force`; `--skip-always-on` explicitly leaves existing instructions in place and exposes retained drift to the doctor.

The consolidated owners are `react-best-practices` (core/TypeScript/performance/Next.js/composition) and `frontend-workbench` (build/audit). Retire exactly `vercel-react-best-practices`, `vercel-composition-patterns`, and `web-design-guidelines` after reviewing the prune plan. `action-first` remains installed but requires an explicit request; Codex metadata disables implicit invocation. `mega-review` and `mega-review-core` include their own neutral protocols; core never loads full/security instructions.

```bash
python3 scripts/sync-skills.py --target agents --target claude --mode link --prune --dry-run
python3 scripts/sync-skills.py --target agents --target claude --mode link --prune
```

Install project-only skills into both hosts explicitly, without changing other repositories:

```bash
python3 scripts/sync-skills.py --project-repo tierlistbuilder --project /path/to/tierlistbuilder \
  --target project-agents --target project-claude --mode link --dry-run
```

After reviewing that target-specific plan, repeat without `--dry-run`. Follow the target's local exclude convention for both skill roots; the example does not install anything by itself. Fresh host sessions are needed to check discovery independently of files on disk.

Use `make generate` to refresh compiled rule collections, packaged neutral review protocols, this repository's generated `AGENTS.md` region, and the Cursor guard asset. `make generated-check` verifies all four sources without writing. Repository instruction generation has a fixed local target and does not relax installer destination guards.

## Explicit native behavioral checks

The ordinary Python gate skips model execution. Run the curated native fixtures explicitly with `python3 scripts/check-native-behaviors.py --smoke --provider codex --output /absolute/task-owned/evidence` (or `--provider claude`). Repeat `--case NAME` to select cases. Each case has a two-minute bound and retains its fixture, native events, changed-file evidence, and verdict. The tests check reference reads, authorization boundaries, runtime behavior, and artifacts rather than matching response prose. Requested/observed model evidence and unavailable-provider outcomes remain explicit.
