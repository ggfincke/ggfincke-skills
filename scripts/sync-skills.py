#!/usr/bin/env python3
# scripts/sync-skills.py
# install canonical skills into local agent dirs

from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path

import always_on

ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = ROOT / "skills"
PROJECTS_DIR = ROOT / "projects"
GLOBAL_AGENTS = tuple(always_on.AGENT_INSTRUCTION)
DEFAULT_GLOBAL_SKILL_TARGETS = ("agents", "claude")
# dropped into every copied skill so --prune can tell our copies from hand-placed dirs
SYNC_MARKER = ".ggfincke-skills-sync"
# the marker records the source it was copied from, so --prune can tell a copy
# made by THIS lane from one another lane installed into the same target root
MARKER_SOURCE_RE = re.compile(r"^installed from (?P<src>.+?)\s*$", re.MULTILINE)
# project-repo names index projects/<name>/; a bare slug, never a path
PROJECT_REPO_RE = re.compile(r"^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$")


def is_within(path: Path, parent: Path) -> bool:
	# true when path is parent itself or nested under it (both resolved)
	path = path.resolve()
	parent = parent.resolve()
	return path == parent or parent in path.parents


def assert_target_outside_repo(target_root: Path) -> None:
	# never install into the canonical source tree: a target that resolves into
	# this repo means a misset CODEX_HOME/AGENTS_HOME/CLAUDE_HOME or --project,
	# & under --force --mode copy would delete the source skills it copies from
	if is_within(target_root, ROOT):
		raise SystemExit(
			f"refusing install target {target_root}: it resolves inside this repo "
			f"({ROOT}). Check CODEX_HOME/AGENTS_HOME/CLAUDE_HOME & --project."
		)


def default_targets(project: Path | None) -> dict[str, Path]:
	targets = {agent: always_on.agent_home(agent) / "skills" for agent in GLOBAL_AGENTS}
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
		result.append((name, available[name]))

	seen: set[Path] = set()
	deduped: list[tuple[str, Path]] = []
	for name, path in result:
		resolved = path.expanduser()
		if resolved in seen:
			continue
		seen.add(resolved)
		deduped.append((name, resolved))
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


def find_skills(base_dir: Path, selected: list[str]) -> list[Path]:
	if not base_dir.exists():
		raise SystemExit(f"missing skills directory: {base_dir}")

	skills = {
		path.name: path
		for path in sorted(base_dir.iterdir())
		if path.is_dir()
		and not path.name.startswith(".")
		and not path.name.startswith("_")
		and (path / "SKILL.md").is_file()
	}

	if selected:
		missing = sorted(set(selected) - set(skills))
		if missing:
			raise SystemExit("unknown skill(s): " + ", ".join(missing))
		return [skills[name] for name in selected]

	return list(skills.values())


def remove_existing(path: Path) -> None:
	if path.is_symlink() or path.is_file():
		path.unlink()
	elif path.exists():
		shutil.rmtree(path)


def copy_skill(src: Path, dest: Path) -> None:
	def ignore(_directory: str, names: list[str]) -> set[str]:
		return {name for name in names if name in {".DS_Store", "__pycache__", ".git"}}

	shutil.copytree(src, dest, ignore=ignore)
	(dest / SYNC_MARKER).write_text(f"installed from {src}\n", encoding="utf-8")


def marker_source(entry: Path) -> Path | None:
	# the source path copy_skill recorded in the marker, or None when the marker
	# is absent or predates the recorded-source format
	marker = entry / SYNC_MARKER
	if not marker.is_file():
		return None
	try:
		match = MARKER_SOURCE_RE.search(marker.read_text(encoding="utf-8"))
	except (OSError, UnicodeDecodeError):
		return None
	return Path(match.group("src")) if match else None


def is_managed_install(entry: Path, base_dir: Path) -> bool:
	# only ever prune what THIS lane installed: a symlink back into base_dir, or a
	# copy whose marker records a source under base_dir. the source check is what
	# keeps a portable run from eating --project-repo copies sharing one target
	# root - they carry a marker too, so the marker alone cannot tell them apart
	if entry.is_symlink():
		return is_within(entry.resolve(), base_dir)
	if not entry.is_dir():
		return False
	source = marker_source(entry)
	return source is not None and is_within(source, base_dir)


def prune_skip_reason(entry: Path) -> str | None:
	# why a skill-shaped directory --prune was asked about got left alone; None
	# when the entry is not skill-shaped & so not worth reporting
	if entry.is_symlink() or not entry.is_dir() or not (entry / "SKILL.md").is_file():
		return None
	source = marker_source(entry)
	if source is None:
		return "no sync marker; hand-placed, or a copy predating markers"
	return f"installed from {source}, outside this run's source tree"


def prune_target(
	target_root: Path, base_dir: Path, source_names: set[str], dry_run: bool
) -> list[str]:
	# reconcile one destination against the full source set, dropping installs
	# whose skill was deleted or renamed upstream
	if not target_root.is_dir():
		return []

	lines: list[str] = []
	skipped: list[str] = []
	unmarked = False
	for entry in sorted(target_root.iterdir()):
		if entry.name in source_names:
			continue
		if not is_managed_install(entry, base_dir):
			# silence here reads as "nothing to prune", which is the opposite of
			# what happened; name what was skipped so the user can act on it
			reason = prune_skip_reason(entry)
			if reason:
				skipped.append(f"{entry.name} ({reason})")
				unmarked = unmarked or "no sync marker" in reason
			continue
		if dry_run:
			lines.append(f"would prune {entry}")
			continue
		remove_existing(entry)
		lines.append(f"pruned {entry}")

	if skipped:
		lines.append("left alone, not prunable: " + "; ".join(skipped))
		if unmarked:
			lines.append(
				"  one `make sync-copy-force` pass stamps markers on existing copies, "
				"making them prunable next run"
			)
	return lines


def install_skill(src: Path, target_root: Path, mode: str, force: bool, dry_run: bool) -> str:
	dest = target_root / src.name
	action = "link" if mode == "link" else "copy"

	if dest.exists() or dest.is_symlink():
		if dest.is_symlink() and dest.resolve() == src.resolve() and mode == "link":
			return f"ok existing link {dest}"
		if not dest.is_symlink() and dest.resolve() == src.resolve():
			raise SystemExit(
				f"refusing to install {src.name}: destination is the source itself "
				f"({dest}); removing it would delete the canonical skill"
			)
		if not force:
			return f"skip existing {dest} (use --force to replace)"
		if not dry_run:
			remove_existing(dest)

	if dry_run:
		return f"would {action} {src} -> {dest}"

	target_root.mkdir(parents=True, exist_ok=True)
	if mode == "link":
		dest.symlink_to(src, target_is_directory=True)
	else:
		copy_skill(src, dest)
	return f"{action}ed {src.name} -> {dest}"


def collect_always_on() -> list[tuple[str, str, str]]:
	# gather (skill_name, title, content) from every portable skill, sorted by name
	items: list[tuple[str, str, str]] = []
	for skill in find_skills(SKILLS_DIR, []):
		text = (skill / "SKILL.md").read_text(encoding="utf-8")
		for title, content in always_on.extract_blocks(text):
			items.append((skill.name, title, content))
	return sorted(items)


def sync_always_on(agents: list[str], dry_run: bool) -> None:
	# write the generated region into each global agent's instruction file;
	# w/ zero blocks left repo-wide this becomes a removal pass, so deleting the
	# last always-on block actually retires the rules instead of stranding them
	items = collect_always_on()
	region = always_on.render_region(items) if items else None
	if region is None:
		print("  no always-on blocks found; removing any region a previous sync wrote")

	seen: set[Path] = set()
	documents: list[tuple[Path, str]] = []
	for agent in agents:
		path = always_on.instruction_file(agent)
		if path in seen:
			continue
		seen.add(path)
		documents.append((path, path.read_text(encoding="utf-8") if path.exists() else ""))

	# pre-flight every file before writing any of them: refusing mid-loop would
	# leave earlier agents on the new rules & later ones stale, naming only the
	# first bad file. refuse in dry-run too - surfacing this is what --dry-run is for
	malformed: list[str] = []
	for path, existing in documents:
		error = always_on.region_marker_error(existing)
		if error:
			malformed.append(f"{path}: {error}")
	if malformed:
		raise SystemExit(
			"refusing to update any instruction file; repair these first:\n  "
			+ "\n  ".join(malformed)
		)

	for path, existing in documents:
		# backstop: the pre-flight already cleared these, but neither apply_region
		# nor remove_region may ever run against an unbalanced document
		error = always_on.region_marker_error(existing)
		if error:
			raise SystemExit(f"refusing to update {path}: {error}")
		present = bool(always_on.REGION_RE.search(existing))

		if region is None:
			if not present:
				continue
			if dry_run:
				print(f"  would remove always-on region in {path}")
				continue
			path.write_text(always_on.remove_region(existing), encoding="utf-8")
			print(f"  removed always-on region in {path}")
			continue

		if dry_run:
			verb = "would update" if present else "would write"
			print(f"  {verb} always-on region in {path}")
			continue

		path.parent.mkdir(parents=True, exist_ok=True)
		path.write_text(always_on.apply_region(existing, region), encoding="utf-8")
		print(f"  {'updated' if present else 'wrote'} always-on region in {path}")


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

	project = args.project.expanduser().resolve() if args.project else None

	if args.project_repo:
		# project-only lane: source projects/<name>/, install into one repo, never global
		if project is None:
			raise SystemExit("--project-repo requires --project <path>")
		# a project target root can also hold portable installs from skills/, which
		# this lane's narrower source set would read as orphans & delete
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
		# global lane: source skills/, never reads projects/
		base_dir = SKILLS_DIR
		target_names = args.target or ["all"]

	targets = expand_targets(target_names, project)
	skills = find_skills(base_dir, args.skill)

	if not skills:
		print(f"No installable skills found in {base_dir}.")
		return 0

	# global lane only: keep each agent's instruction file's always-on region current
	global_agents: list[str] = []
	if not args.project_repo and not args.skip_always_on:
		global_agents = instruction_agents_for_targets(target_names)

	for _, target_root in targets:
		assert_target_outside_repo(target_root)
	# the instruction-file lane covers agents expand_targets never yields (codex),
	# so it needs the same containment check, & it must abort before any install
	for agent in global_agents:
		assert_target_outside_repo(always_on.agent_home(agent).expanduser())
		# the home can sit outside the repo while the instruction file inside it is
		# a symlink back in (dotfile managers do this routinely), & write_text
		# follows symlinks - so the resolved file needs the same check as the home
		assert_target_outside_repo(always_on.instruction_file(agent))

	# prune reconciles against the whole source tree, never the --skill subset,
	# so installing one skill can never look like every other one was deleted
	source_names = {path.name for path in find_skills(base_dir, [])} if args.prune else set()

	for target_name, target_root in targets:
		print(f"[{target_name}] {target_root}")
		for skill in skills:
			print("  " + install_skill(skill, target_root, args.mode, args.force, args.dry_run))
		if args.prune:
			for line in prune_target(target_root, base_dir, source_names, args.dry_run):
				print("  " + line)

	if global_agents:
		print("[always-on] global instruction files")
		sync_always_on(global_agents, args.dry_run)

	return 0


if __name__ == "__main__":
	raise SystemExit(main())
