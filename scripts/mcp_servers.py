# scripts/mcp_servers.py
# load, validate, and render the canonical MCP server registry for per-tool configs

from __future__ import annotations

import json
import os
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Union

import tooling_paths

ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = ROOT / "mcp" / "servers.json"

# registry schema version accepted by this module
REGISTRY_VERSION = 1

# mcp sync targets
MCP_TARGETS = ("opencode", "claude-code")

# config section each tool nests server entries under
SECTION_KEYS = {
	"opencode": "mcp",
	"claude-code": "mcpServers",
}

SERVER_NAME_RE = re.compile(r"^[a-z0-9]+(?:[-_][a-z0-9]+)*$")
TRANSPORTS = frozenset({"remote", "local"})
ENTRY_KEYS = frozenset(
	{"description", "transport", "url", "command", "environment", "tools", "enabled"}
)


@dataclass(frozen=True)
class RemoteServer:
	name: str
	description: str
	url: str
	tools: frozenset[str]
	enabled: bool = True


@dataclass(frozen=True)
class LocalServer:
	name: str
	description: str
	command: tuple[str, ...]
	environment: tuple[tuple[str, str], ...]
	tools: frozenset[str]
	enabled: bool = True


ServerSpec = Union[RemoteServer, LocalServer]


def resolve_target(
	tool: str,
	*,
	environ: Mapping[str, str] | None = None,
	user_home: Path | None = None,
) -> Path:
	if tool == "claude-code":
		return tooling_paths.claude_state_path(environ=environ, user_home=user_home)
	if tool != "opencode":
		raise KeyError(tool)
	values = os.environ if environ is None else environ
	raw = values.get("OPENCODE_HOME")
	base = (
		Path(raw)
		if raw is not None and raw != ""
		else (user_home or Path.home()) / ".config/opencode"
	)
	# leave the filename unresolved so the transaction also observes a dotfile symlink
	return tooling_paths.resolve_path(base) / "opencode.json"


def read_json_object(path: Path) -> dict:
	try:
		text = path.read_text(encoding="utf-8")
	except OSError as exc:
		raise ValueError(f"{path}: cannot read ({exc})") from exc
	try:
		document = json.loads(text)
	except ValueError as exc:
		raise ValueError(f"{path}: invalid JSON ({exc})") from exc
	if not isinstance(document, dict):
		raise ValueError(f"{path}: root is not a JSON object")
	return document


def _entry_issues(name: str, entry: Any) -> tuple[str, ...]:
	if not isinstance(entry, dict):
		return (f"servers.{name}: entry must be an object",)
	issues: list[str] = []
	unknown = sorted(set(str(key) for key in entry) - ENTRY_KEYS - {"$comment"})
	if unknown:
		issues.append(f"servers.{name}: unknown key(s): {', '.join(unknown)}")
	description = entry.get("description")
	if not isinstance(description, str) or not description.strip():
		issues.append(f"servers.{name}: description must be a non-empty string")
	transport = entry.get("transport")
	if transport not in TRANSPORTS:
		issues.append(f"servers.{name}: transport must be one of {sorted(TRANSPORTS)}")
	tools = entry.get("tools")
	if (
		not isinstance(tools, list)
		or not tools
		or any(tool not in MCP_TARGETS or not isinstance(tool, str) for tool in tools)
		or len(set(tools)) != len(tools)
	):
		issues.append(
			f"servers.{name}: tools must be a non-empty list of unique {sorted(MCP_TARGETS)}"
		)
	enabled = entry.get("enabled", True)
	if not isinstance(enabled, bool):
		issues.append(f"servers.{name}: enabled must be a boolean")
	url = entry.get("url")
	command = entry.get("command")
	environment = entry.get("environment")
	if transport == "remote":
		if not isinstance(url, str) or not url.startswith(("http://", "https://")):
			issues.append(f"servers.{name}: remote transport requires an http(s) url")
		if any(key in entry for key in ("command", "environment")):
			issues.append(f"servers.{name}: remote transport forbids command/environment")
	elif transport == "local":
		if (
			not isinstance(command, list)
			or not command
			or any(not isinstance(part, str) or not part for part in command)
		):
			issues.append(f"servers.{name}: local transport requires a non-empty command list")
		if url is not None:
			issues.append(f"servers.{name}: local transport forbids url")
		if environment is not None:
			if not isinstance(environment, dict) or any(
				not isinstance(key, str) or not isinstance(value, str)
				for key, value in environment.items()
			):
				issues.append(f"servers.{name}: environment must map strings to strings")
	return tuple(issues)


def registry_issues(path: Path = REGISTRY_PATH) -> tuple[str, ...]:
	try:
		registry = read_json_object(path)
	except ValueError as exc:
		return (str(exc),)
	issues: list[str] = []
	unknown_top = sorted(set(str(key) for key in registry) - {"version", "servers"} - {"$comment"})
	if unknown_top:
		issues.append(f"unknown top-level key(s): {', '.join(unknown_top)}")
	version = registry.get("version")
	if version != REGISTRY_VERSION or isinstance(version, bool):
		issues.append(f"version must be {REGISTRY_VERSION}")
	servers = registry.get("servers")
	if not isinstance(servers, dict):
		issues.append("servers must be an object")
		return tuple(issues)
	for name, entry in servers.items():
		if isinstance(name, str) and not SERVER_NAME_RE.fullmatch(name):
			issues.append(f"server name {name!r} must be lowercase words separated by '-' or '_'")
		issues.extend(_entry_issues(name, entry))
	return tuple(issues)


def load_servers(path: Path = REGISTRY_PATH) -> tuple[ServerSpec, ...]:
	issues = registry_issues(path)
	if issues:
		raise SystemExit("invalid MCP registry:\n  " + "\n  ".join(issues))
	registry = read_json_object(path)
	servers: list[ServerSpec] = []
	for name, entry in registry["servers"].items():
		tools = frozenset(entry["tools"])
		common = {
			"name": name,
			"description": entry["description"],
			"tools": tools,
			"enabled": entry.get("enabled", True),
		}
		if entry["transport"] == "remote":
			servers.append(RemoteServer(url=entry["url"], **common))
			continue
		environment = entry.get("environment") or {}
		servers.append(
			LocalServer(
				command=tuple(entry["command"]),
				environment=tuple(sorted(environment.items())),
				**common,
			)
		)
	return tuple(servers)


def _tool_servers(servers: tuple[ServerSpec, ...], tool: str) -> list[ServerSpec]:
	return [server for server in servers if server.enabled and tool in server.tools]


def desired_opencode(servers: tuple[ServerSpec, ...]) -> dict[str, dict[str, Any]]:
	entries: dict[str, dict[str, Any]] = {}
	for server in _tool_servers(servers, "opencode"):
		if isinstance(server, RemoteServer):
			entries[server.name] = {"type": "remote", "url": server.url}
			continue
		entry: dict[str, Any] = {"type": "local", "command": list(server.command)}
		if server.environment:
			entry["environment"] = dict(server.environment)
		entries[server.name] = entry
	return entries


def desired_claude(servers: tuple[ServerSpec, ...]) -> dict[str, dict[str, Any]]:
	entries: dict[str, dict[str, Any]] = {}
	for server in _tool_servers(servers, "claude-code"):
		if isinstance(server, RemoteServer):
			entries[server.name] = {"type": "http", "url": server.url}
			continue
		entry = {"command": server.command[0]}
		if len(server.command) > 1:
			entry["args"] = list(server.command[1:])
		if server.environment:
			entry["env"] = dict(server.environment)
		entries[server.name] = entry
	return entries


DESIRED_SECTIONS = {
	"opencode": desired_opencode,
	"claude-code": desired_claude,
}


def merge_section(
	document: dict, section_key: str, desired: Mapping[str, Any]
) -> tuple[dict, bool]:
	if not desired and section_key not in document:
		return document, False
	old = document.get(section_key)
	old_entries = dict(old) if isinstance(old, dict) else {}
	section: dict[str, Any] = {}
	# foreign entries keep their position untouched; owned names update in place
	for key, value in old_entries.items():
		section[key] = desired[key] if key in desired else value
	for key, value in desired.items():
		if key not in section:
			section[key] = value
	merged = dict(document)
	merged[section_key] = section
	return merged, merged != document


def summarize_change(old_section: Mapping[str, Any], desired: Mapping[str, Any]) -> str:
	added = [name for name in desired if name not in old_section]
	updated = [
		name for name in desired if name in old_section and old_section[name] != desired[name]
	]
	parts = [f"add {name}" for name in added] + [f"update {name}" for name in updated]
	return ", ".join(parts) if parts else "no changes"


def serialize(document: Mapping[str, Any]) -> bytes:
	return (json.dumps(document, indent=2) + "\n").encode("utf-8")
