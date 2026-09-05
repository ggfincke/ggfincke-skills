#!/usr/bin/env python3
# scripts/doctor.py
# inspect skill discovery, deployment drift, and configured broker launchers without repairing them

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

import always_on
import skill_deployment
import skill_inventory
import tooling_paths

ROOT = Path(__file__).resolve().parents[1]
PROVIDERS = ("codex", "claude", "cursor", "coral")


def read_json_status(path: Path) -> tuple[dict, str]:
	try:
		if not path.is_file():
			return {}, "missing" if not path.exists() else "unreadable"
		value = json.loads(path.read_text(encoding="utf-8"))
		return (value, "ok") if isinstance(value, dict) else ({}, "malformed")
	except (OSError, ValueError):
		return {}, "unreadable_or_malformed"


def read_json(path: Path) -> dict:
	return read_json_status(path)[0]


def inspect_package(entry: Path, sources: Path) -> dict:
	source = sources / entry.name
	row = {"name": entry.name, "mode": "link" if entry.is_symlink() else "copy"}
	try:
		if not entry.is_dir() or not (entry / "SKILL.md").is_file():
			raise ValueError("package entrypoint unavailable")
		frontmatter = skill_inventory.parse_frontmatter_text(
			(entry / "SKILL.md").read_text(encoding="utf-8")
		)
		row["discovery_name"] = frontmatter.get("name") or None
		row["installed_digest"] = skill_deployment.package_digest(entry)
		row["source_digest"] = skill_deployment.package_digest(source) if source.is_dir() else None
		row["status"] = (
			"current"
			if row["installed_digest"] == row["source_digest"]
			else "drift"
			if source.is_dir()
			else "unrelated_or_retired"
		)
	except (OSError, ValueError, RuntimeError):
		row["status"] = "unreadable_or_unsafe"
	return row


def receipt_issues(root: Path, generation: dict) -> list[str]:
	issues = []
	payload = {key: value for key, value in generation.items() if key != "generation"}
	digest = hashlib.sha256(
		json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
	).hexdigest()
	if digest != generation.get("generation"):
		issues.append("receipt content hash mismatch")
	lanes = generation.get("lanes")
	if not isinstance(lanes, dict) or generation.get("schema_version") != 1:
		return [*issues, "unsupported receipt schema"]
	for source_root, lane in lanes.items():
		if (
			not isinstance(source_root, str)
			or not Path(source_root).is_absolute()
			or not isinstance(lane, dict)
		):
			issues.append("invalid recorded deployment lane")
			continue
		packages = lane.get("packages")
		if not isinstance(packages, dict):
			issues.append("invalid recorded package collection")
			packages = {}
		for name, record in packages.items():
			if not name or Path(name).name != name or name in (".", ".."):
				issues.append("invalid recorded package name")
				continue
			if not isinstance(record, dict) or record.get("mode") not in ("link", "copy"):
				issues.append(f"{name}: invalid package record")
				continue
			source = record.get("source")
			if not isinstance(source, str) or not Path(source).is_absolute():
				issues.append(f"{name}: invalid source path")
				continue
			try:
				entry = root / name
				if not entry.is_dir() or not (entry / "SKILL.md").is_file():
					raise ValueError("installed package unavailable")
				actual = skill_deployment.package_digest(entry)
				current_source = (
					skill_deployment.package_digest(Path(source)) if Path(source).is_dir() else None
				)
				mode = "link" if entry.is_symlink() else "copy"
				if actual != record.get("installed_digest") or current_source != record.get(
					"source_digest"
				):
					issues.append(f"{name}: content changed since deployment")
				if actual != current_source:
					issues.append(f"{name}: installed source drift")
				if mode != record["mode"]:
					issues.append(f"{name}: installation mode changed since deployment")
			except (OSError, ValueError, RuntimeError):
				issues.append(f"{name}: recorded package or source unavailable")
		instructions = lane.get("instructions")
		if not isinstance(instructions, list):
			issues.append("invalid recorded instruction collection")
			continue
		for record in instructions:
			if (
				not isinstance(record, dict)
				or not isinstance(record.get("path"), str)
				or not Path(record["path"]).is_absolute()
				or not isinstance(record.get("agent"), str)
				or record["agent"] not in tooling_paths.AGENT_INSTRUCTION
				or not isinstance(record.get("region_digest"), str)
			):
				issues.append("invalid recorded instruction")
				continue
			try:
				path = Path(record["path"])
				if not path.is_file():
					raise ValueError("instruction file unavailable")
				content = path.read_text(encoding="utf-8")
				match = always_on.REGION_RE.search(content)
				actual = hashlib.sha256((match.group() if match else "").encode()).hexdigest()
				if always_on.region_marker_error(content) or actual != record["region_digest"]:
					issues.append(f"{record['agent']}: instruction drift")
			except (OSError, ValueError, RuntimeError):
				issues.append("recorded instruction unavailable")
	return issues


def inspect_root(root: Path, sources: Path) -> dict:
	issues = []
	packages = []
	try:
		for entry in sorted(root.iterdir()) if root.is_dir() else []:
			if (entry / "SKILL.md").is_file() or entry.is_symlink():
				packages.append(inspect_package(entry, sources))
	except (OSError, RuntimeError):
		issues.append("installation root unreadable")
	receipt_path = root / skill_deployment.GENERATION_FILE
	generation, receipt_status = read_json_status(receipt_path)
	if receipt_path.is_symlink():
		issues.append("unsafe deployment receipt symlink")
	elif receipt_status == "ok":
		issues.extend(receipt_issues(root, generation))
	elif receipt_status != "missing":
		issues.append("deployment receipt unreadable or malformed")
	names: dict[str, list[str]] = {}
	for package in packages:
		name = package.get("discovery_name")
		if isinstance(name, str):
			names.setdefault(name, []).append(package["name"])
	return {
		"root": str(root),
		"exists": root.is_dir(),
		"packages": packages,
		"duplicate_names": {name: entries for name, entries in names.items() if len(entries) > 1},
		"generation": generation.get("generation"),
		"generation_status": "drift" if issues else "verified" if generation else "unrecorded",
		"generation_issues": issues,
	}


def broker_launcher(repo: Path = ROOT) -> tuple[list[str] | None, dict[str, str], list[dict]]:
	registrations = []
	claude_servers = read_json(tooling_paths.claude_state_path()).get("mcpServers")
	claude = claude_servers.get("worker-broker") if isinstance(claude_servers, dict) else None
	if isinstance(claude, dict):
		registrations.append(("claude", claude))
	try:
		import tomllib

		with (tooling_paths.resolve_home("codex") / "config.toml").open("rb") as file:
			codex_servers = tomllib.load(file).get("mcp_servers")
			codex = codex_servers.get("worker-broker") if isinstance(codex_servers, dict) else None
		if isinstance(codex, dict):
			registrations.append(("codex", codex))
	except (ImportError, OSError, ValueError):
		pass
	server = repo / "tools/worker-broker/dist/src/server.js"
	cli = repo / "tools/worker-broker/dist/src/cli.js"
	receipts = []
	chosen = None
	chosen_env = dict(os.environ)
	allowed_env = {"PATH", "WORKER_BROKER_HOME", "WORKER_BROKER_CORAL_HOST"}
	allowed_env.update(
		f"WORKER_BROKER_{provider.upper()}_{kind}"
		for provider in PROVIDERS
		for kind in ("BINARY", "MODEL")
	)
	for host, registration in registrations:
		args = registration.get("args", [])
		command = registration.get("command")
		# arbitrary node flags or shell wrappers cannot be replayed as the same launcher
		matches = False
		try:
			matches = (
				isinstance(args, list)
				and len(args) == 1
				and isinstance(args[0], str)
				and Path(args[0]).is_absolute()
				and Path(args[0]).resolve() == server.resolve()
				and server.is_file()
			)
		except (OSError, ValueError, RuntimeError):
			pass
		environment = dict(os.environ)
		configured_env = registration.get("env", {})
		if isinstance(configured_env, dict):
			environment.update(
				{
					key: value
					for key, value in configured_env.items()
					if key in allowed_env and isinstance(value, str)
				}
			)
		try:
			binary = (
				shutil.which(command, path=environment.get("PATH"))
				if isinstance(command, str)
				else None
			)
		except (OSError, ValueError):
			binary = None
		valid = (
			matches
			and binary is not None
			and Path(binary).name in ("node", "nodejs")
			and cli.is_file()
		)
		receipts.append(
			{
				"host": host,
				"status": "usable" if valid else "unverified",
				"source_matches": matches,
				"selected": valid and chosen is None,
			}
		)
		if valid and chosen is None:
			chosen = [binary, str(cli)]
			chosen_env = environment
	if chosen is None and cli.is_file():
		node = shutil.which("node")
		if node:
			chosen = [node, str(cli)]
	return chosen, chosen_env, receipts


def run_broker_diagnostics(
	launcher: list[str],
	environment: dict[str, str],
	*,
	smoke: bool = False,
	provider: str | None = None,
) -> dict:
	command = [*launcher, "doctor", "--json"]
	if smoke:
		command.append("--smoke")
	if provider:
		command.extend(["--provider", provider])
	timeout = 330 if smoke else 90
	try:
		result = subprocess.run(
			command,
			capture_output=True,
			text=True,
			env=environment,
			timeout=timeout,
		)
		if result.returncode != 0:
			return {"status": "failed", "exit_code": result.returncode, "launcher": launcher}
		report = json.loads(result.stdout)
		if not isinstance(report, dict):
			raise ValueError("broker report is not an object")
		return {"status": "ok", "launcher": launcher, "report": report}
	except subprocess.TimeoutExpired:
		return {"status": "timeout", "timeout_seconds": timeout, "launcher": launcher}
	except OSError:
		return {"status": "unavailable", "launcher": launcher}
	except ValueError:
		return {"status": "invalid_output", "launcher": launcher}


def inspect_instructions(agent: str) -> dict:
	path = tooling_paths.instruction_path(agent)
	try:
		if not path.is_file():
			raise OSError("instruction file unavailable")
		text = path.read_text(encoding="utf-8")
	except (OSError, ValueError, RuntimeError):
		return {"agent": agent, "path": str(path), "status": "missing"}
	match = always_on.REGION_RE.search(text)
	return {
		"agent": agent,
		"path": str(path),
		"status": "malformed"
		if always_on.region_marker_error(text)
		else "present"
		if match
		else "unmanaged",
		"region_digest": hashlib.sha256(match.group().encode()).hexdigest() if match else None,
	}


def main() -> int:
	parser = argparse.ArgumentParser(
		description="Inspect local skill and broker configuration without changing it."
	)
	parser.add_argument("--target", action="append", choices=("agents", "claude", "agy"))
	parser.add_argument("--project", type=Path)
	parser.add_argument("--project-repo")
	parser.add_argument("--json", action="store_true")
	parser.add_argument(
		"--smoke", action="store_true", help="Run bounded native probes in disposable fixtures."
	)
	parser.add_argument("--provider", choices=PROVIDERS)
	args = parser.parse_args()
	targets = args.target or ["agents", "claude"]
	sources = ROOT / "skills"
	if args.project:
		if args.project_repo:
			sources = ROOT / "projects" / args.project_repo
			if sources.resolve().parent != (ROOT / "projects").resolve():
				parser.error("--project-repo must name a direct projects/ child")
		roots = [
			(target, args.project / (".claude" if target == "claude" else ".agents") / "skills")
			for target in targets
		]
	else:
		if args.project_repo:
			parser.error("--project-repo requires --project")
		roots = [(target, tooling_paths.resolve_home(target) / "skills") for target in targets]
	installations = [{"target": target, **inspect_root(root, sources)} for target, root in roots]
	instruction_agents = (["codex"] if "agents" in targets else []) + targets
	instructions = (
		[]
		if args.project
		else [inspect_instructions(agent) for agent in dict.fromkeys(instruction_agents)]
	)
	legacy = tooling_paths.resolve_home("codex") / "skills"
	legacy_installation = inspect_root(legacy, sources)
	agents_names = {
		row.get("discovery_name")
		for installation in installations
		if installation["target"] == "agents"
		for row in installation["packages"]
	}
	legacy_names = sorted(
		{
			row["discovery_name"]
			for row in legacy_installation["packages"]
			if row.get("discovery_name") and row["discovery_name"] in agents_names
		}
	)
	launcher, environment, registrations = broker_launcher()
	broker = {"status": "unavailable", "registrations": registrations}
	if launcher:
		broker.update(
			run_broker_diagnostics(launcher, environment, smoke=args.smoke, provider=args.provider)
		)
	state = Path(
		environment.get(
			"WORKER_BROKER_HOME",
			Path(environment.get("XDG_STATE_HOME", Path.home() / ".local/state")) / "worker-broker",
		)
	)
	identity = read_json(state / "daemon.json")
	built = read_json(ROOT / "tools/worker-broker/dist/build-id.json")
	broker["daemon_build"] = identity.get("build_id")
	broker["built_id"] = built.get("build_id")
	broker["build_compatibility"] = (
		"no_daemon_record"
		if not identity
		else "matching_record"
		if isinstance(built.get("build_id"), str) and identity.get("build_id") == built["build_id"]
		else "different_or_unverified"
	)
	report = {
		"schema_version": 1,
		"installations": installations,
		"instructions": instructions,
		"legacy_codex_duplicates": legacy_names,
		"broker": broker,
	}
	print(json.dumps(report, indent=2 if not args.json else None))
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
