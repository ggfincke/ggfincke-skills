#!/usr/bin/env python3
# scripts/sync-skills.py
# validate, plan, and transactionally install canonical skill packages

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path

import always_on
import skill_inventory
import sync_transaction
import tooling_paths

ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = ROOT / "skills"
PROJECTS_DIR = ROOT / "projects"
GLOBAL_AGENTS = tuple(tooling_paths.AGENT_INSTRUCTION)
DEFAULT_GLOBAL_SKILL_TARGETS = ("agents", "claude")
SYNC_MARKER = ".ggfincke-skills-sync"
MARKER_SOURCE_RE = re.compile(r"^installed from (?P<src>.+?)\s*$", re.MULTILINE)
PROJECT_REPO_RE = re.compile(r"^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$")


@dataclass(frozen=True)
class SkillAction:
	operation_id: str
	target_label: str
	source: Path
	destination: Path
	mode: str


@dataclass(frozen=True)
class PruneAction:
	operation_id: str
	target_label: str
	destination: Path


@dataclass(frozen=True)
class InstructionAction:
	operation_id: str
	agents: tuple[str, ...]
	logical_path: Path
	verb: str


@dataclass(frozen=True)
class SkillSyncPlan:
	transaction: sync_transaction.RunPlan
	targets: tuple[tuple[str, Path], ...]
	skill_actions: tuple[SkillAction, ...]
	prune_actions: tuple[PruneAction, ...]
	instruction_actions: tuple[InstructionAction, ...]
	always_on_empty: bool = False


def is_within(path: Path, parent: Path) -> bool:
	return tooling_paths.is_within(path, parent)


def assert_target_outside_repo(target_root: Path) -> None:
	try:
		tooling_paths.require_outside_repo(target_root, ROOT, "install target")
	except ValueError as exc:
		raise SystemExit(f"{exc}. Check CODEX_HOME/AGENTS_HOME/CLAUDE_HOME & --project.") from exc


def default_targets(project: Path | None) -> dict[str, Path]:
	targets = {agent: tooling_paths.resolve_home(agent) / "skills" for agent in GLOBAL_AGENTS}
	if project is not None:
		targets["project-claude"] = project / ".claude" / "skills"
		targets["project-agents"] = project / ".agents" / "skills"
	return targets


def expand_targets(names: list[str], project: Path | None) -> list[tuple[str, Path]]:
	available = default_targets(project)
	expanded: list[str] = []
	for name in names:
		if name == "all":
			expanded.extend(DEFAULT_GLOBAL_SKILL_TARGETS)
		else:
			expanded.append(name)

	result: list[tuple[str, Path]] = []
	for name in expanded:
		if name.startswith("project-") and project is None:
			raise SystemExit(f"--target {name} requires --project")
		if name not in available:
			allowed = ", ".join(
				sorted({"all", "project-claude", "project-agents", *available.keys()})
			)
			raise SystemExit(f"unknown target {name!r}; choose one of: {allowed}")
		result.append((name, tooling_paths.resolve_path(available[name])))

	seen: set[Path] = set()
	deduped: list[tuple[str, Path]] = []
	for name, path in result:
		resolved = path.resolve(strict=False)
		if resolved in seen:
			continue
		seen.add(resolved)
		deduped.append((name, path))
	return deduped


def instruction_agents_for_targets(names: list[str]) -> list[str]:
	agents: list[str] = []
	for name in names:
		if name == "all":
			agents.extend(GLOBAL_AGENTS)
		elif name == "agents":
			agents.extend(("codex", "agents"))
		elif name in GLOBAL_AGENTS:
			agents.append(name)
	return list(dict.fromkeys(agents))


def _lane_for(base_dir: Path) -> skill_inventory.SourceLane:
	if tooling_paths.is_within(base_dir, PROJECTS_DIR):
		return skill_inventory.SourceLane("project", base_dir, base_dir.name)
	return skill_inventory.SourceLane("portable", base_dir)


def _format_inventory_issues(issues: tuple[skill_inventory.SkillIssue, ...]) -> str:
	lines: list[str] = []
	for issue in issues:
		level = "WARN" if issue.is_warning else "ERROR"
		location = str(issue.path)
		if issue.line is not None:
			location += f":{issue.line}"
		lines.append(f"{level} {location}: {issue.message}")
	return "\n".join(lines)


def _inspect_source(
	base_dir: Path,
	selected: list[str],
	*,
	require_all: bool,
) -> tuple[skill_inventory.SkillInventory, skill_inventory.SkillInventory]:
	if not base_dir.is_dir():
		raise SystemExit(f"missing skills directory: {base_dir}")
	candidates = skill_inventory.discover_candidates((_lane_for(base_dir),))
	chosen, selection_issues = skill_inventory.select_candidates(candidates, selected, base_dir)
	inspected = skill_inventory.inspect_candidates(candidates if require_all else chosen)
	issues = inspected.issues + selection_issues
	if any(not issue.is_warning for issue in issues):
		raise SystemExit(
			"refusing skill sync; source validation failed:\n" + _format_inventory_issues(issues)
		)
	selected_inventory = skill_inventory.select_inventory(inspected, selected, base_dir)
	if selection_issues:
		selected_inventory = skill_inventory.SkillInventory(
			selected_inventory.candidates,
			selected_inventory.packages,
			selected_inventory.issues + selection_issues,
		)
	return inspected, selected_inventory


def find_skills(base_dir: Path, selected: list[str]) -> list[Path]:
	_, chosen = _inspect_source(base_dir, selected, require_all=False)
	return [package.candidate.directory for package in chosen.packages]


def marker_source(entry: Path) -> Path | None:
	marker = entry / SYNC_MARKER
	if not marker.is_file():
		return None
	try:
		match = MARKER_SOURCE_RE.search(marker.read_text(encoding="utf-8"))
	except (OSError, UnicodeDecodeError):
		return None
	return Path(match.group("src")) if match else None


def is_managed_install(entry: Path, base_dir: Path) -> bool:
	if entry.is_symlink():
		return is_within(entry.resolve(), base_dir)
	if not entry.is_dir():
		return False
	source = marker_source(entry)
	return source is not None and is_within(source, base_dir)


def prune_skip_reason(entry: Path) -> str | None:
	if entry.is_symlink() or not entry.is_dir() or not (entry / "SKILL.md").is_file():
		return None
	source = marker_source(entry)
	if source is None:
		return "no sync marker; hand-placed, or a copy predating markers"
	return f"installed from {source}, outside this run's source tree"


def _plan_prunes(
	target_label: str,
	target_root: Path,
	base_dir: Path,
	source_names: set[str],
) -> tuple[tuple[sync_transaction.Prune, ...], tuple[PruneAction, ...], tuple[str, ...]]:
	if not target_root.is_dir():
		return (), (), ()
	plans: list[sync_transaction.Prune] = []
	actions: list[PruneAction] = []
	skipped: list[str] = []
	unmarked = False
	for entry in sorted(target_root.iterdir()):
		if entry.name in source_names:
			continue
		if not is_managed_install(entry, base_dir):
			reason = prune_skip_reason(entry)
			if reason:
				skipped.append(f"{entry.name} ({reason})")
				unmarked = unmarked or "no sync marker" in reason
			continue
		operation_id = f"prune:{target_label}:{entry.name}"
		plans.append(sync_transaction.prune(operation_id, entry))
		actions.append(PruneAction(operation_id, target_label, entry))
	if skipped:
		skipped.insert(0, "left alone, not prunable: " + "; ".join(skipped))
		if unmarked:
			skipped.append(
				"  one `make sync-copy-force` pass stamps markers on existing copies, "
				"making them prunable next run"
			)
	return tuple(plans), tuple(actions), tuple(skipped)


def _skill_replacement(
	source: Path,
	target_label: str,
	target_root: Path,
	mode: str,
	force: bool,
) -> tuple[sync_transaction.Replacement | None, SkillAction | None, str | None, bool]:
	destination = target_root / source.name
	if destination.exists() or destination.is_symlink():
		if (
			destination.is_symlink()
			and destination.resolve() == source.resolve()
			and mode == "link"
		):
			return None, None, f"ok existing link {destination}", False
		if not destination.is_symlink() and destination.resolve() == source.resolve():
			raise SystemExit(
				f"refusing to install {source.name}: destination is the source itself "
				f"({destination}); removing it would delete the canonical skill"
			)
		if not force:
			return None, None, f"skip existing {destination} (use --force to replace)", True

	if mode == "link":
		payload: sync_transaction.Payload = sync_transaction.SymlinkPayload(
			source, target_is_directory=True
		)
	else:
		payload = sync_transaction.copy_tree_payload(
			source,
			ignored_names=(".DS_Store", "__pycache__", ".git"),
			generated_files=((Path(SYNC_MARKER), f"installed from {source}\n".encode()),),
		)
	operation_id = f"skill:{target_label}:{source.name}"
	replacement = sync_transaction.replacement(
		operation_id,
		destination,
		payload,
		additional_observed=(source,) if mode == "link" else (),
	)
	return (
		replacement,
		SkillAction(operation_id, target_label, source, destination, mode),
		None,
		False,
	)


def collect_always_on() -> list[tuple[str, str, str]]:
	inspected, _ = _inspect_source(SKILLS_DIR, [], require_all=True)
	items = [
		(package.name, block.title, block.content)
		for package in inspected.packages
		for block in package.always_on
	]
	return sorted(items)


def _instruction_destination_plans(
	agents: list[str],
	items: list[tuple[str, str, str]],
) -> tuple[
	tuple[sync_transaction.DestinationPlan, ...],
	tuple[InstructionAction, ...],
	tuple[sync_transaction.ArtifactScan, ...],
]:
	region = always_on.render_region(items) if items else None
	aliases: dict[Path, list[tuple[str, Path]]] = {}
	preflight_errors: list[str] = []
	for agent in agents:
		home = tooling_paths.resolve_home(agent)
		logical = tooling_paths.instruction_path(agent)
		physical = tooling_paths.resolve_write_target(logical)
		for label, path in ((f"{agent} home", home), (f"{agent} instruction file", physical)):
			try:
				tooling_paths.require_outside_repo(path, ROOT, label)
			except ValueError as exc:
				preflight_errors.append(str(exc))
		aliases.setdefault(physical, []).append((agent, logical))

	plans: list[sync_transaction.DestinationPlan] = []
	actions: list[InstructionAction] = []
	for physical, agent_paths in aliases.items():
		logical_paths = tuple(path for _, path in agent_paths)
		if physical.exists() and not physical.is_file():
			preflight_errors.append(f"{physical}: instruction destination is not a file")
			continue
		try:
			existing = physical.read_text(encoding="utf-8") if physical.exists() else ""
		except (OSError, UnicodeError) as exc:
			preflight_errors.append(f"{physical}: cannot read instruction file as UTF-8: {exc}")
			continue
		error = always_on.region_marker_error(existing)
		if error:
			preflight_errors.append(f"{physical}: {error}")
			continue
		present = bool(always_on.REGION_RE.search(existing))
		if region is None:
			if not present:
				continue
			desired = always_on.remove_region(existing)
			verb = "remove"
		else:
			desired = always_on.apply_region(existing, region)
			if desired == existing:
				continue
			verb = "update" if present else "write"
		operation_id = "instruction:" + "+".join(agent for agent, _ in agent_paths)
		payload = sync_transaction.BytesPayload(
			desired.encode(),
			preserve_metadata_from=physical if physical.is_file() else None,
		)
		replacement = sync_transaction.replacement(
			operation_id,
			physical,
			payload,
			logical_destination=logical_paths[0],
			additional_observed=logical_paths,
			atomic_file=True,
		)
		plans.append(sync_transaction.DestinationPlan(operation_id, (replacement,)))
		actions.append(
			InstructionAction(
				operation_id,
				tuple(agent for agent, _ in agent_paths),
				logical_paths[0],
				verb,
			)
		)
	if preflight_errors:
		raise SystemExit(
			"refusing to update any instruction file; repair these first:\n  "
			+ "\n  ".join(preflight_errors)
		)
	artifact_scans = tuple(
		sync_transaction.ArtifactScan(physical.parent, (physical.name,)) for physical in aliases
	)
	return tuple(plans), tuple(actions), artifact_scans


def build_sync_plan(
	sources: list[Path],
	base_dir: Path,
	targets: list[tuple[str, Path]],
	mode: str,
	force: bool,
	*,
	prune_enabled: bool = False,
	source_names: set[str] | None = None,
	instruction_agents: list[str] | None = None,
	always_on_items: list[tuple[str, str, str]] | None = None,
) -> SkillSyncPlan:
	destination_plans: list[sync_transaction.DestinationPlan] = []
	skill_actions: list[SkillAction] = []
	prune_actions: list[PruneAction] = []
	noops: list[sync_transaction.PlanMessage] = []
	skips: list[sync_transaction.PlanMessage] = []
	artifact_scans = [
		sync_transaction.ArtifactScan(target_root) for _target_label, target_root in targets
	]
	for target_label, target_root in targets:
		assert_target_outside_repo(target_root)
		replacements: list[sync_transaction.Replacement] = []
		for source in sources:
			replacement, action, message, skipped = _skill_replacement(
				source, target_label, target_root, mode, force
			)
			if replacement is not None and action is not None:
				replacements.append(replacement)
				skill_actions.append(action)
			elif message is not None:
				collection = skips if skipped else noops
				collection.append(sync_transaction.PlanMessage(target_label, message))

		prunes: tuple[sync_transaction.Prune, ...] = ()
		if prune_enabled:
			prunes, planned_actions, prune_messages = _plan_prunes(
				target_label, target_root, base_dir, source_names or set()
			)
			prune_actions.extend(planned_actions)
			noops.extend(
				sync_transaction.PlanMessage(target_label, message) for message in prune_messages
			)
		destination_plans.append(
			sync_transaction.DestinationPlan(target_label, tuple(replacements), prunes)
		)

	instruction_actions: tuple[InstructionAction, ...] = ()
	agents = instruction_agents or []
	items = always_on_items or []
	if agents:
		instruction_plans, instruction_actions, instruction_scans = _instruction_destination_plans(
			agents, items
		)
		destination_plans.extend(instruction_plans)
		artifact_scans.extend(instruction_scans)

	transaction = sync_transaction.RunPlan(
		tuple(destination_plans),
		tuple(noops),
		tuple(skips),
		tuple(artifact_scans),
	)
	issues = sync_transaction.plan_issues(transaction)
	if issues:
		raise SystemExit("refusing skill sync:\n  " + "\n  ".join(issues))
	return SkillSyncPlan(
		transaction,
		tuple(targets),
		tuple(skill_actions),
		tuple(prune_actions),
		instruction_actions,
		always_on_empty=bool(agents and not items),
	)


def _grouped_plan_lines(plan: SkillSyncPlan, dry_run: bool) -> tuple[str, ...]:
	lines: list[str] = []
	for target_label, target_root in plan.targets:
		lines.append(f"[{target_label}] {target_root}")
		for action in plan.skill_actions:
			if action.target_label != target_label:
				continue
			verb = "link" if action.mode == "link" else "copy"
			prefix = "would " if dry_run else ""
			lines.append(f"  {prefix}{verb} {action.source} -> {action.destination}")
		for action in plan.prune_actions:
			if action.target_label == target_label:
				lines.append(f"  {'would prune' if dry_run else 'prune'} {action.destination}")
		for message in (*plan.transaction.noops, *plan.transaction.skips):
			if message.label == target_label:
				lines.append("  " + message.message)
	if plan.instruction_actions or plan.always_on_empty:
		lines.append("[always-on] global instruction files")
		if plan.always_on_empty:
			lines.append("  no always-on blocks found; removing any region a previous sync wrote")
		for action in plan.instruction_actions:
			prefix = "would " if dry_run else ""
			verb = action.verb
			lines.append(f"  {prefix}{verb} always-on region in {action.logical_path}")
	return tuple(lines)


def _report_lines(plan: SkillSyncPlan, report: sync_transaction.ApplyReport) -> tuple[str, ...]:
	actions = {action.operation_id: action for action in plan.skill_actions}
	prunes = {action.operation_id: action for action in plan.prune_actions}
	instructions = {action.operation_id: action for action in plan.instruction_actions}
	lines: list[str] = []
	for target_label, target_root in plan.targets:
		lines.append(f"[{target_label}] {target_root}")
		for message in (*plan.transaction.noops, *plan.transaction.skips):
			if message.label == target_label:
				lines.append("  " + message.message)
	if plan.instruction_actions or plan.always_on_empty:
		lines.append("[always-on] global instruction files")
		if plan.always_on_empty:
			lines.append("  no always-on blocks found; removing any region a previous sync wrote")
	for event in report.events:
		action = actions.get(event.operation_id)
		prune_action = prunes.get(event.operation_id)
		instruction = instructions.get(event.operation_id)
		if event.status == "applied" and action is not None:
			verb = "linked" if action.mode == "link" else "copied"
			lines.append(
				f"[{action.target_label}] {verb} {action.source.name} -> {action.destination}"
			)
			continue
		if event.status == "applied" and prune_action is not None:
			lines.append(f"[{prune_action.target_label}] pruned {prune_action.destination}")
			continue
		if event.status == "applied" and instruction is not None:
			verbs = {"remove": "removed", "update": "updated", "write": "wrote"}
			lines.append(
				f"[always-on] {verbs[instruction.verb]} always-on region in "
				f"{instruction.logical_path}"
			)
			continue
		label = (
			action.target_label
			if action is not None
			else prune_action.target_label
			if prune_action is not None
			else "always-on"
			if instruction is not None
			else "sync"
		)
		lines.append(f"[{label}] {event.status}: {event.path}: {event.detail}")
	return tuple(lines)


def install_skill(
	src: Path,
	target_root: Path,
	mode: str,
	force: bool,
	dry_run: bool,
) -> str:
	plan = build_sync_plan([src], src.parent, [("target", target_root)], mode, force)
	action = next((item for item in plan.skill_actions), None)
	if action is None:
		messages = (*plan.transaction.noops, *plan.transaction.skips)
		return messages[0].message
	verb = "link" if mode == "link" else "copy"
	if dry_run:
		return f"would {verb} {src} -> {action.destination}"
	report = sync_transaction.apply_plan(plan.transaction)
	if not report.success:
		raise SystemExit("skill install failed:\n  " + "\n  ".join(_report_lines(plan, report)))
	return f"{verb}ed {src.name} -> {action.destination}"


def prune_target(
	target_root: Path,
	base_dir: Path,
	source_names: set[str],
	dry_run: bool,
) -> list[str]:
	plans, actions, messages = _plan_prunes("target", target_root, base_dir, source_names)
	transaction = sync_transaction.RunPlan(
		(sync_transaction.DestinationPlan("target", prunes=plans),),
		artifact_scans=(sync_transaction.ArtifactScan(target_root),),
	)
	issues = sync_transaction.plan_issues(transaction)
	if issues:
		raise SystemExit("refusing prune:\n  " + "\n  ".join(issues))
	lines = list(messages)
	if dry_run:
		return [*(f"would prune {action.destination}" for action in actions), *lines]
	if not plans:
		return lines
	report = sync_transaction.apply_plan(transaction)
	if not report.success:
		raise SystemExit(
			"prune failed:\n  "
			+ "\n  ".join(
				f"{event.status}: {event.path}: {event.detail}" for event in report.events
			)
		)
	return [*(f"pruned {action.destination}" for action in actions), *lines]


def sync_always_on(agents: list[str], dry_run: bool) -> None:
	items = collect_always_on()
	instruction_plans, actions, artifact_scans = _instruction_destination_plans(agents, items)
	plan = SkillSyncPlan(
		sync_transaction.RunPlan(instruction_plans, artifact_scans=artifact_scans),
		(),
		(),
		(),
		actions,
		always_on_empty=not items,
	)
	if dry_run:
		for line in _grouped_plan_lines(plan, dry_run=True)[1:]:
			print(line)
		return
	report = sync_transaction.apply_plan(plan.transaction)
	for line in _report_lines(plan, report)[1:]:
		print(line)
	if not report.success:
		raise SystemExit("always-on sync failed:\n  " + "\n  ".join(_report_lines(plan, report)))


def main() -> int:
	parser = argparse.ArgumentParser(
		description="Install canonical skills into local agent skill directories."
	)
	parser.add_argument(
		"--target",
		action="append",
		default=[],
		help=(
			"Install target: agents, claude, project-claude, project-agents, all, "
			"or legacy codex. Can be repeated."
		),
	)
	parser.add_argument("--skill", action="append", default=[], help="Install one skill name")
	parser.add_argument(
		"--mode",
		choices=["copy", "link"],
		default="copy",
		help="Copy stable snapshots or symlink for active development.",
	)
	parser.add_argument("--project", type=Path, help="Project root for project-* targets")
	parser.add_argument(
		"--project-repo",
		help="Install project-only skills from projects/<name>/ into one repo (requires --project)",
	)
	parser.add_argument("--force", action="store_true", help="Replace existing installed skills")
	parser.add_argument(
		"--prune",
		action="store_true",
		help="Also remove installs this tool created whose source skill no longer exists",
	)
	parser.add_argument("--dry-run", action="store_true", help="Print planned changes only")
	parser.add_argument(
		"--skip-always-on",
		action="store_true",
		help="Do not emit the always-on region into global instruction files",
	)
	args = parser.parse_args()

	project = tooling_paths.resolve_path(args.project) if args.project else None
	if args.project_repo:
		if project is None:
			raise SystemExit("--project-repo requires --project <path>")
		if args.prune:
			raise SystemExit(
				"--prune is not supported with --project-repo: that lane sources only "
				f"projects/{args.project_repo}/, so it cannot tell an orphan from a "
				"portable skill installed into the same root"
			)
		requested = args.target or ["project-agents"]
		leaked = [name for name in requested if not name.startswith("project-")]
		if leaked:
			raise SystemExit(
				"--project-repo installs project-only skills; refusing non-project target(s): "
				+ ", ".join(leaked)
				+ ". Use project-agents or project-claude."
			)
		if not PROJECT_REPO_RE.fullmatch(args.project_repo):
			raise SystemExit(
				f"invalid --project-repo {args.project_repo!r}: use a bare projects/ "
				"subdirectory name, not a path (no '/', '..', or absolute paths)"
			)
		base_dir = PROJECTS_DIR / args.project_repo
		if base_dir.resolve().parent != PROJECTS_DIR.resolve():
			raise SystemExit(
				f"--project-repo {args.project_repo!r} must resolve to a direct child of "
				f"{PROJECTS_DIR}; refusing to read skills from outside projects/"
			)
		if not base_dir.is_dir():
			raise SystemExit(
				f"unknown project repo {args.project_repo!r}: {base_dir} does not exist"
			)
		target_names = requested
	else:
		base_dir = SKILLS_DIR
		target_names = args.target or ["all"]

	targets = expand_targets(target_names, project)
	global_agents = (
		[]
		if args.project_repo or args.skip_always_on
		else instruction_agents_for_targets(target_names)
	)
	require_all = bool(args.prune or global_agents)
	full_inventory, selected_inventory = _inspect_source(
		base_dir, args.skill, require_all=require_all
	)
	if not selected_inventory.packages and not global_agents and not args.prune:
		build_sync_plan([], base_dir, targets, args.mode, args.force)
		print(f"No installable skills found in {base_dir}.")
		return 0

	for issue in full_inventory.issues:
		if issue.is_warning:
			print(_format_inventory_issues((issue,)))

	sources = [package.candidate.directory for package in selected_inventory.packages]
	source_names = {package.name for package in full_inventory.packages} if args.prune else set()
	always_on_items: list[tuple[str, str, str]] = []
	if global_agents:
		always_on_items = sorted(
			(package.name, block.title, block.content)
			for package in full_inventory.packages
			for block in package.always_on
		)
	plan = build_sync_plan(
		sources,
		base_dir,
		targets,
		args.mode,
		args.force,
		prune_enabled=args.prune,
		source_names=source_names,
		instruction_agents=global_agents,
		always_on_items=always_on_items,
	)

	if args.dry_run:
		for line in _grouped_plan_lines(plan, dry_run=True):
			print(line)
		return 0

	report = sync_transaction.apply_plan(plan.transaction)
	for line in _report_lines(plan, report):
		print(line)
	return 0 if report.success else 1


if __name__ == "__main__":
	raise SystemExit(main())
