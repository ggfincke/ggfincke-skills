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
	"agy": ("AGY_HOME", ".gemini/antigravity-cli", "GEMINI.md"),
}


def resolve_path(path: Path) -> Path:
	return path.expanduser().resolve()


def resolve_gemini_home(
	*,
	environ: Mapping[str, str] | None = None,
	user_home: Path | None = None,
) -> Path:
	values = os.environ if environ is None else environ
	raw = values.get("GEMINI_HOME")
	if raw is not None and raw != "":
		return resolve_path(Path(raw))
	return resolve_path((user_home or Path.home()) / ".gemini")


def _home_override(agent: str, environ: Mapping[str, str]) -> Path | None:
	env_var = AGENT_INSTRUCTION[agent][0]
	# the native Claude setting wins; CLAUDE_HOME remains a sync-only fallback
	keys = ("CLAUDE_CONFIG_DIR", env_var) if agent == "claude" else (env_var,)
	for key in keys:
		raw = environ.get(key)
		# exactly empty means unset; whitespace remains a literal path
		if raw is not None and raw != "":
			return Path(raw)
	return None


def resolve_home(
	agent: str,
	*,
	environ: Mapping[str, str] | None = None,
	user_home: Path | None = None,
) -> Path:
	values = os.environ if environ is None else environ
	base = _home_override(agent, values)
	if base is None:
		if agent == "agy":
			base = resolve_gemini_home(environ=values, user_home=user_home) / "antigravity-cli"
		else:
			base = (user_home or Path.home()) / AGENT_INSTRUCTION[agent][1]
	return resolve_path(base)


def claude_state_path(
	*,
	environ: Mapping[str, str] | None = None,
	user_home: Path | None = None,
) -> Path:
	values = os.environ if environ is None else environ
	base = _home_override("claude", values)
	# without a profile override, native state is beside ~/.claude, not inside it
	if base is None:
		base = user_home or Path.home()
	return resolve_path(base) / ".claude.json"


def instruction_path(
	agent: str,
	*,
	environ: Mapping[str, str] | None = None,
	user_home: Path | None = None,
) -> Path:
	if agent == "agy":
		return (
			resolve_gemini_home(environ=environ, user_home=user_home) / AGENT_INSTRUCTION[agent][2]
		)
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
