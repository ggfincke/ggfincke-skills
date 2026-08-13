#!/usr/bin/env python3
# scripts/sync-agents.py
# validate, plan, and transactionally install canonical Claude custom agents

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path

import sync_transaction
import tooling_paths

ROOT = Path(__file__).resolve().parents[1]
AGENTS_DIR = ROOT / "agents"
AGENT_NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
FRONTMATTER_NAME_RE = re.compile(r"^name:\s*(?P<name>[^\s]+)\s*$", re.MULTILINE)


@dataclass(frozen=True)
class AgentAction:
	operation_id: str
	source: Path
	destination: Path
	mode: str


@dataclass(frozen=True)
class AgentSyncPlan:
	transaction: sync_transaction.RunPlan
	actions: tuple[AgentAction, ...]


def is_within(path: Path, parent: Path) -> bool:
	return tooling_paths.is_within(path, parent)


def assert_target_outside_repo(target: Path) -> None:
	try:
		tooling_paths.require_outside_repo(target, ROOT, "agent target")
	except ValueError as exc:
		raise SystemExit(str(exc)) from exc


def default_target() -> Path:
	return tooling_paths.resolve_home("claude") / "agents"


def agent_name(path: Path) -> str:
	text = path.read_text(encoding="utf-8")
	if not text.startswith("---\n") or "\n---\n" not in text[4:]:
		raise SystemExit(f"invalid agent frontmatter: {path}")
	frontmatter = text.split("\n---\n", 1)[0][4:]
	match = FRONTMATTER_NAME_RE.search(frontmatter)
	if match is None:
		raise SystemExit(f"agent frontmatter has no name: {path}")
	name = match.group("name")
	if not AGENT_NAME_RE.fullmatch(name):
		raise SystemExit(f"invalid agent name {name!r}: {path}")
	if path.stem != name:
		raise SystemExit(f"agent filename must match name {name!r}: {path.name}")
	return name


def find_agents(selected: list[str]) -> list[Path]:
	if not AGENTS_DIR.is_dir():
		raise SystemExit(f"missing agents directory: {AGENTS_DIR}")
	agents = {agent_name(path): path for path in sorted(AGENTS_DIR.glob("*.md"))}
	if selected:
		missing = sorted(set(selected) - set(agents))
		if missing:
			raise SystemExit("unknown agent(s): " + ", ".join(missing))
		return [agents[name] for name in selected]
	return list(agents.values())


def same_install(source: Path, destination: Path, mode: str) -> bool:
	if mode == "link":
		return destination.is_symlink() and destination.resolve() == source.resolve()
	if destination.is_symlink() or not destination.is_file():
		return False
	return destination.read_bytes() == source.read_bytes()


def build_plan(sources: list[Path], target: Path, mode: str, force: bool) -> AgentSyncPlan:
	replacements: list[sync_transaction.Replacement] = []
	actions: list[AgentAction] = []
	noops: list[sync_transaction.PlanMessage] = []
	skips: list[sync_transaction.PlanMessage] = []
	for source in sources:
		destination = target / source.name
		copy_payload = sync_transaction.copy_file_payload(source) if mode == "copy" else None
		if copy_payload is not None and copy_payload.unsupported_symlink is not None:
			raise SystemExit(
				"refusing agent sync:\n  copy source contains a symlink and cannot be "
				f"snapshotted safely: {copy_payload.unsupported_symlink}"
			)
		if same_install(source, destination, mode):
			noops.append(
				sync_transaction.PlanMessage("claude-agents", f"ok existing {mode}: {destination}")
			)
			continue
		if destination.exists() or destination.is_symlink():
			if destination.is_dir() and not destination.is_symlink():
				raise SystemExit(f"refusing to replace agent directory: {destination}")
			if not force:
				skips.append(
					sync_transaction.PlanMessage(
						"claude-agents",
						f"skip existing (use --force): {destination}",
					)
				)
				continue

		payload: sync_transaction.Payload
		if mode == "link":
			payload = sync_transaction.SymlinkPayload(source)
		else:
			assert copy_payload is not None
			payload = copy_payload
		operation_id = f"agent:{source.stem}"
		replacements.append(
			sync_transaction.replacement(
				operation_id,
				destination,
				payload,
				additional_observed=(source,) if mode == "link" else (),
				atomic_file=True,
			)
		)
		actions.append(AgentAction(operation_id, source, destination, mode))

	destination_plan = sync_transaction.DestinationPlan("claude-agents", tuple(replacements))
	transaction = sync_transaction.RunPlan(
		(destination_plan,),
		tuple(noops),
		tuple(skips),
		(sync_transaction.ArtifactScan(target),),
	)
	issues = sync_transaction.plan_issues(transaction)
	if issues:
		raise SystemExit("refusing agent sync:\n  " + "\n  ".join(issues))
	return AgentSyncPlan(transaction, tuple(actions))


def _dry_run_lines(plan: AgentSyncPlan) -> tuple[str, ...]:
	lines = [message.message for message in (*plan.transaction.noops, *plan.transaction.skips)]
	for action in plan.actions:
		verb = "link" if action.mode == "link" else "copy"
		lines.append(f"would {verb}: {action.source} -> {action.destination}")
	return tuple(lines)


def _apply_lines(plan: AgentSyncPlan, report: sync_transaction.ApplyReport) -> tuple[str, ...]:
	actions = {action.operation_id: action for action in plan.actions}
	lines = [message.message for message in (*plan.transaction.noops, *plan.transaction.skips)]
	for event in report.events:
		action = actions.get(event.operation_id)
		if event.status == "applied" and action is not None:
			verb = "linked" if action.mode == "link" else "copied"
			lines.append(f"{verb}: {action.source} -> {action.destination}")
		else:
			lines.append(f"{event.status}: {event.path}: {event.detail}")
	return tuple(lines)


def install_agent(
	source: Path,
	target: Path,
	mode: str,
	force: bool,
	dry_run: bool,
) -> str:
	plan = build_plan([source], target, mode, force)
	if dry_run:
		return _dry_run_lines(plan)[0]
	report = sync_transaction.apply_plan(plan.transaction)
	lines = _apply_lines(plan, report)
	if not report.success:
		raise SystemExit("agent sync failed:\n  " + "\n  ".join(lines))
	return lines[0]


def main() -> int:
	parser = argparse.ArgumentParser(
		description="Install canonical Claude custom-agent definitions."
	)
	parser.add_argument("--agent", action="append", default=[], help="Install one agent name")
	parser.add_argument("--target", type=Path, default=default_target())
	parser.add_argument("--mode", choices=("copy", "link"), default="link")
	parser.add_argument("--force", action="store_true")
	parser.add_argument("--dry-run", action="store_true")
	args = parser.parse_args()

	target = tooling_paths.resolve_path(args.target)
	assert_target_outside_repo(target)
	plan = build_plan(find_agents(args.agent), target, args.mode, args.force)
	print(f"[claude-agents] {target}")
	if args.dry_run:
		for line in _dry_run_lines(plan):
			print("  " + line)
		return 0

	report = sync_transaction.apply_plan(plan.transaction)
	for line in _apply_lines(plan, report):
		print("  " + line)
	return 0 if report.success else 1


if __name__ == "__main__":
	raise SystemExit(main())
