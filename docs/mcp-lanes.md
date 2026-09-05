# docs/mcp-lanes.md
# how the canonical MCP registry maps onto each tool's native config

## The lane

`mcp/servers.json` is the single source of truth for MCP server registrations.
`scripts/sync-mcp.py` reads it, validates it, and transactionally merges it into
each tool's native config file. Like skills and agents, edit here, run sync,
never hand-edit installed copies.

```bash
python3 scripts/sync-mcp.py --dry-run          # or: make sync-mcp-dry-run
python3 scripts/sync-mcp.py                    # or: make sync-mcp (runs make check first)
python3 scripts/sync-mcp.py --tool opencode    # one tool only (repeatable)
python3 scripts/sync-mcp.py --server figma     # one server only (repeatable)
```

## Registry schema

```jsonc
{
	"$comment": "ignored documentation key; allowed anywhere",
	"version": 1,
	"servers": {
		"<name>": {
			"description": "required non-empty string",
			"transport": "remote | local",
			"url": "required for remote; must be http(s)",
			"command": ["required for local; non-empty strings"],
			"environment": {"optional for local; string -> string"},
			"tools": ["subset of: opencode, claude-code"],
			"enabled": true
		}
	}
}
```

Names are lowercase words separated by `-` or `_`. Unknown keys fail validation;
`$comment` is the one exempt metadata key. Disabled entries stay in the registry
as documentation but are skipped by sync.

## Ownership semantics

The merge is structural and surgical. Within a target's MCP section:

- Names present in the registry are **owned**: added or overwritten on every sync.
- All other names are **foreign**: preserved byte-for-value in their original order.
- Everything outside the MCP section (`provider`, `model`, `numStartups`, ...)
  is untouched.

There is no prune. Removing a server means deleting it from the registry and
manually deleting its entry from each tool config; sync never deletes foreign
content because it cannot prove it wrote it.

## Per-tool mapping

| Tool | Config file | Section | Remote entry | Local entry |
| --- | --- | --- | --- | --- |
| opencode | `~/.config/opencode/opencode.json` | `mcp` | `{"type": "remote", "url": ...}` | `{"type": "local", "command": [...], "environment"?}` |
| Claude Code | `~/.claude.json` | `mcpServers` | `{"type": "http", "url": ...}` | `{"command", "args"?, "env"?}` |

OpenCode honors `OPENCODE_HOME`. Claude uses a nonempty native
`CLAUDE_CONFIG_DIR`, then the repository's `CLAUDE_HOME` sync-only fallback.
An override places `.claude.json`, skills, agents, and `CLAUDE.md` in that profile;
without one, state remains at `~/.claude.json` and the other resources under
`~/.claude/`. Setting `CLAUDE_HOME` alone does not configure the Claude runtime.

Writes are atomic with rollback via `sync_transaction.py`; a target file that
fails to parse refuses the whole run rather than being replaced. New config
files, byte stages, and backups start private (`0600`) before content is written.
Existing file modes and metadata are preserved, including when the config path
is a symlink.

Claude Code already serializes `~/.claude.json` at two-space indent, so merges
produce no formatting churn.

## Authentication

OAuth is per client, not per registry entry: run `opencode mcp auth <server>`
for opencode; Claude Code opens the browser on first tool use. Stored tokens
live in each tool's own credential store — this duplication is inherent to the
tools, not to the registry.

## Concurrent writers

Claude Code treats `~/.claude.json` as live state: open sessions periodically
persist their in-memory copy, silently dropping keys added after the session
started. If a merge into `mcpServers` vanishes, a session clobbered it. The
recovery sequence is:

1. Quit all Claude Code sessions.
2. `make sync-mcp`.
3. Restart Claude Code — servers are read at startup, then OAuth on first use.

opencode does not rewrite its global config, so its merges are stable while
sessions run.

## Current tenants

- `figma` -> Claude Code only: official remote server
  (`https://mcp.figma.com/mcp`). Figma **allowlists MCP clients**, not users —
  only clients in the Figma MCP Catalog can register (Claude Code, Cursor,
  Codex, VS Code, ...). Unlisted clients get a bare HTTP 403 `Forbidden` from
  `api.figma.com/v1/oauth/mcp/register`; opencode is currently unlisted, so it
  cannot authenticate against the remote server. Authenticate inside Claude
  Code (`/mcp` -> figma) instead.
- `figma-local` -> opencode: the desktop Dev Mode MCP server
  (`http://127.0.0.1:3845/mcp`). No OAuth and no allowlist. Requires the Figma
  desktop app running with Dev Mode enabled and the MCP toggle turned on
  (Preferences, or the Inspect panel while a file is in Dev Mode). If tools
  fail to connect, check that toggle first.

If a registry entry stops targeting a tool, its existing entry in that tool's
config becomes foreign content; remove it manually (there is intentionally no
prune) or re-extend its `tools` list.

## Roadmap

- Phase 2 targets: Codex (`~/.codex/config.toml`, TOML emit), Cursor
  (`~/.cursor/mcp.json`), Claude Desktop (`~/Library/Application Support/
  Claude/claude_desktop_config.json`). Absorb `worker-broker`'s manual
  registration into the registry.
- Possible phase 3: an opt-in `--prune` backed by marker state if manual removal
  proves annoying in practice.
