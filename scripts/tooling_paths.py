# scripts/tooling_paths.py
# resolve agent homes and guard external tooling targets consistently

from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path

# global agents that receive generated instruction files
# name -> (home env var, default home dir, instruction filename)
AGENT_INSTRUCTION = {
	"codex": ("CODEX_HOME", ".codex", "AGENTS.md"),
	"agents": ("AGENTS_HOME", ".agents", "AGENTS.md"),
	"claude": ("CLAUDE_HOME", ".claude", "CLAUDE.md"),
}


def resolve_path(path: Path) -> Path:
	return path.expanduser().resolve()


def resolve_home(
	agent: str,
	*,
	environ: Mapping[str, str] | None = None,
	user_home: Path | None = None,
) -> Path:
	# exactly empty means unset; whitespace stays literal until policy says otherwise
	values = os.environ if environ is None else environ
	env_var, default, _ = AGENT_INSTRUCTION[agent]
	raw = values.get(env_var)
	base = (user_home or Path.home()) / default if raw is None or raw == "" else Path(raw)
	return resolve_path(base)


def instruction_path(
	agent: str,
	*,
	environ: Mapping[str, str] | None = None,
	user_home: Path | None = None,
) -> Path:
	return resolve_home(agent, environ=environ, user_home=user_home) / AGENT_INSTRUCTION[agent][2]


def is_within(path: Path, parent: Path) -> bool:
	resolved = resolve_path(path)
	resolved_parent = resolve_path(parent)
	return resolved == resolved_parent or resolved_parent in resolved.parents


def require_outside_repo(path: Path, repo_root: Path, label: str) -> Path:
	resolved = resolve_path(path)
	if is_within(resolved, repo_root):
		raise ValueError(
			f"refusing {label} {path}: it resolves inside this repo ({resolve_path(repo_root)})"
		)
	return resolved


def resolve_write_target(logical_path: Path) -> Path:
	# replacing a symlink path would destroy the user's dotfile-manager link;
	# write its physical referent instead while callers also fingerprint the link
	return (
		logical_path.resolve(strict=False)
		if logical_path.is_symlink()
		else resolve_path(logical_path)
	)
