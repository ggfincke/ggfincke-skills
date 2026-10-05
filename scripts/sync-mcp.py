#!/usr/bin/env python3
# scripts/sync-mcp.py
# validate, plan, and transactionally merge the canonical MCP registry into tool configs

from __future__ import annotations

import argparse
import os
import shutil
from dataclasses import dataclass
from pathlib import Path

import mcp_servers
import sync_transaction
import tooling_paths

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class ToolSyncPlan:
	tool: str
	label: str
	target: Path
	messages: tuple[str, ...]
	detail: str = ""
	replacement: sync_transaction.Replacement | None = None


def selected_servers(
	servers: tuple[mcp_servers.ServerSpec, ...], tool: str, only_names: frozenset[str]
) -> tuple[mcp_servers.ServerSpec, ...]:
	return tuple(
		server
		for server in servers
		if server.enabled and tool in server.tools and (not only_names or server.name in only_names)
	)


def codex_payload(physical: Path, desired: dict, repo_root: Path) -> tuple[bytes, bool, str]:
	# tomlkit retains comments and unrelated fields rather than rewriting the whole config
	try:
		import tomlkit
	except ImportError as exc:
		raise SystemExit(
			"Codex sync requires requirements-tooling.txt in the current Python environment"
		) from exc
	before = physical.read_text(encoding="utf-8") if physical.exists() else ""
	try:
		document = tomlkit.parse(before)
		section = document.setdefault("mcp_servers", tomlkit.table())
		if not isinstance(section, dict):
			raise ValueError("mcp_servers must be a table")
		for name, fields in desired.items():
			entry = section.setdefault(name, tomlkit.table())
			if not isinstance(entry, dict):
				raise ValueError(f"mcp_servers.{name} must be a table")
			for key, value in fields.items():
				if key == "args":
					value = [part.replace("${REPO_ROOT}", str(repo_root)) for part in value]
				if key == "command" and name == "worker-broker":
					existing = entry.get("command")
					if isinstance(existing, str) and Path(existing).name in ("node", "nodejs"):
						resolved = shutil.which(existing)
						if resolved and os.access(resolved, os.X_OK):
							continue
				if key == "env":
					environment = entry.setdefault("env", tomlkit.table())
					if not isinstance(environment, dict):
						raise ValueError(f"mcp_servers.{name}.env must be a table")
					for env_key, env_value in value.items():
						environment.setdefault(env_key, env_value)
				else:
					entry[key] = value
		after = tomlkit.dumps(document)
	except (ValueError, TypeError, KeyError) as exc:
		raise SystemExit(f"refusing Codex config {physical}: {exc}") from exc
	return (
		after.encode("utf-8"),
		after != before,
		"merge owned server fields; preserve local settings",
	)


def build_tool_plan(
	tool: str,
	servers: tuple[mcp_servers.ServerSpec, ...],
	*,
	repo_root: Path = ROOT,
	environ: dict[str, str] | None = None,
	user_home: Path | None = None,
) -> ToolSyncPlan:
	target = mcp_servers.resolve_target(tool, environ=environ, user_home=user_home)
	try:
		tooling_paths.require_outside_repo(target, repo_root, f"{tool} config")
	except ValueError as exc:
		raise SystemExit(str(exc)) from exc
	label = f"mcp-{tool}"
	desired = mcp_servers.DESIRED_SECTIONS[tool](servers)
	if not desired:
		return ToolSyncPlan(
			tool, label, target, (f"skip: no enabled registry entries target {tool}",)
		)
	document: dict = {}
	physical = tooling_paths.resolve_write_target(target)
	if tool == "codex":
		content, changed, detail = codex_payload(physical, desired, repo_root)
		if not changed:
			return ToolSyncPlan(tool, label, target, (f"ok existing config: {target}",))
		replacement = sync_transaction.replacement(
			f"mcp:{tool}",
			physical,
			sync_transaction.BytesPayload(
				content,
				preserve_metadata_from=physical if physical.is_file() else None,
				private=True,
			),
			logical_destination=target,
			atomic_file=True,
		)
		return ToolSyncPlan(
			tool, label, target, (f"would update: {target} ({detail})",), detail, replacement
		)
	if physical.exists():
		try:
			document = mcp_servers.read_json_object(physical)
		except ValueError as exc:
			raise SystemExit(f"refusing {label}:\n  {exc}") from exc
	section_key = mcp_servers.SECTION_KEYS[tool]
	old_section = document.get(section_key)
	old_entries = old_section if isinstance(old_section, dict) else {}
	merged, changed = mcp_servers.merge_section(document, section_key, desired)
	if not changed:
		return ToolSyncPlan(tool, label, target, (f"ok existing config: {target}",))
	detail = mcp_servers.summarize_change(old_entries, desired)
	payload = sync_transaction.BytesPayload(
		mcp_servers.serialize(merged),
		preserve_metadata_from=physical if physical.is_file() else None,
		private=True,
	)
	replacement = sync_transaction.replacement(
		f"mcp:{tool}",
		physical,
		payload,
		logical_destination=target,
		atomic_file=True,
	)
	return ToolSyncPlan(
		tool,
		label,
		target,
		(f"would update: {target} ({detail})",),
		detail,
		replacement,
	)


def build_run_plan(plans: list[ToolSyncPlan]) -> sync_transaction.RunPlan:
	destinations: list[sync_transaction.DestinationPlan] = []
	scans: list[sync_transaction.ArtifactScan] = []
	for plan in plans:
		replacements = (plan.replacement,) if plan.replacement is not None else ()
		destinations.append(sync_transaction.DestinationPlan(plan.label, replacements))
		if plan.replacement is not None:
			assert plan.replacement.physical_destination.parent is not None
			scans.append(
				sync_transaction.ArtifactScan(
					plan.replacement.physical_destination.parent,
					(plan.replacement.physical_destination.name,),
				)
			)
	return sync_transaction.RunPlan(tuple(destinations), (), (), tuple(scans))


def _report_lines(
	plans: list[ToolSyncPlan], report: sync_transaction.ApplyReport
) -> tuple[str, ...]:
	details = {f"mcp:{plan.tool}": plan.detail for plan in plans}
	lines: list[str] = []
	for plan in plans:
		# would-update previews are superseded by their applied event lines
		lines.extend(m for m in plan.messages if not m.startswith("would update"))
	for event in report.events:
		if event.status == "applied":
			lines.append(f"updated: {event.path} ({details.get(event.operation_id, '')})")
		else:
			lines.append(f"{event.status}: {event.path}: {event.detail}")
	return tuple(lines)


def main() -> int:
	parser = argparse.ArgumentParser(
		description="Merge canonical MCP servers into per-tool config files."
	)
	parser.add_argument(
		"--tool",
		action="append",
		default=[],
		choices=sorted(mcp_servers.MCP_TARGETS),
		help="Limit to one tool config (repeatable; default: all)",
	)
	parser.add_argument(
		"--server", action="append", default=[], help="Limit to one server name (repeatable)"
	)
	parser.add_argument(
		"--registry",
		type=Path,
		default=mcp_servers.REGISTRY_PATH,
		help="Path to an alternative servers registry (testing)",
	)
	parser.add_argument("--dry-run", action="store_true")
	args = parser.parse_args()

	servers = mcp_servers.load_servers(args.registry)
	only_names = frozenset(args.server)
	unknown = sorted(only_names - {server.name for server in servers})
	if unknown:
		raise SystemExit("unknown server(s): " + ", ".join(unknown))

	tools = args.tool or list(mcp_servers.MCP_TARGETS)
	plans: list[ToolSyncPlan] = []
	for tool in tools:
		chosen = selected_servers(servers, tool, only_names)
		if only_names and not chosen:
			plans.append(
				ToolSyncPlan(
					tool,
					f"mcp-{tool}",
					mcp_servers.resolve_target(tool),
					(f"skip: filtered server(s) do not target {tool}",),
				)
			)
			continue
		plans.append(build_tool_plan(tool, chosen))

	for plan in plans:
		print(f"[{plan.label}] {plan.target}")
	if args.dry_run:
		for plan in plans:
			for message in plan.messages:
				print("  " + message)
		return 0

	report = sync_transaction.apply_plan(build_run_plan(plans))
	for line in _report_lines(plans, report):
		print("  " + line)
	return 0 if report.success else 1


if __name__ == "__main__":
	raise SystemExit(main())
