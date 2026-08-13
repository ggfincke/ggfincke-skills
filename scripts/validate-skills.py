#!/usr/bin/env python3
# scripts/validate-skills.py
# validate portable and project-only skill packages through the canonical inventory

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import skill_inventory
import tooling_paths

ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = ROOT / "skills"
PROJECTS_DIR = ROOT / "projects"

# compatibility exports keep focused callers on the canonical implementation
SkillIssue = skill_inventory.SkillIssue
parse_frontmatter = skill_inventory.parse_frontmatter
parse_frontmatter_value = skill_inventory.parse_frontmatter_value


def display_path(path: Path) -> str:
	try:
		return str(path.relative_to(ROOT))
	except ValueError:
		return str(path)


def source_lanes() -> tuple[skill_inventory.SourceLane, ...]:
	lanes = [skill_inventory.SourceLane("portable", SKILLS_DIR)]
	if PROJECTS_DIR.is_dir():
		for repo in sorted(PROJECTS_DIR.iterdir()):
			if repo.is_dir() and not repo.name.startswith((".", "_")):
				lanes.append(skill_inventory.SourceLane("project", repo, repo.name))
	return tuple(lanes)


def skill_dirs_in(base: Path) -> list[Path]:
	lane = skill_inventory.SourceLane("portable", base)
	return [candidate.directory for candidate in skill_inventory.discover_candidates((lane,))]


def discover_skills() -> list[Path]:
	return [
		candidate.directory for candidate in skill_inventory.discover_candidates(source_lanes())
	]


def _candidate_for(path: Path) -> skill_inventory.SkillCandidate:
	if tooling_paths.is_within(path, PROJECTS_DIR):
		try:
			project_repo = path.resolve().relative_to(PROJECTS_DIR.resolve()).parts[0]
		except (IndexError, ValueError):
			project_repo = path.parent.name
		key = skill_inventory.SkillKey("project", project_repo, path.name)
	else:
		key = skill_inventory.SkillKey("portable", None, path.name)
	return skill_inventory.SkillCandidate(key, path, path / "SKILL.md")


def find_skills(selected: list[str]) -> tuple[list[Path], list[SkillIssue]]:
	if not SKILLS_DIR.exists():
		return [], [
			SkillIssue(
				None,
				SKILLS_DIR,
				None,
				"missing-root",
				"skills directory does not exist",
			)
		]
	candidates = skill_inventory.discover_candidates(source_lanes())
	chosen, issues = skill_inventory.select_candidates(candidates, selected, SKILLS_DIR)
	return [candidate.directory for candidate in chosen], list(issues)


def validate_skill(path: Path, strict_frontmatter: bool) -> list[SkillIssue]:
	result = skill_inventory.inspect_candidates((_candidate_for(path),), strict_frontmatter)
	return list(result.issues)


def readme_issues(path: Path) -> list[SkillIssue]:
	return [issue for issue in validate_skill(path, True) if issue.code == "banned-readme"]


def resource_link_issues(path: Path, _skill_file: Path) -> list[SkillIssue]:
	codes = {
		"broken-local-link",
		"legacy-resource",
		"link-escape",
		"markdown-read",
		"missing-anchor",
	}
	return [issue for issue in validate_skill(path, True) if issue.code in codes]


def main() -> int:
	parser = argparse.ArgumentParser(
		description="Validate skill folders (portable and project-only) in this repo."
	)
	parser.add_argument("--skill", action="append", default=[], help="Validate one skill name")
	frontmatter_mode = parser.add_mutually_exclusive_group()
	frontmatter_mode.add_argument(
		"--strict-frontmatter",
		action="store_true",
		help="Fail when frontmatter includes fields beyond name and description",
	)
	frontmatter_mode.add_argument(
		"--lenient-frontmatter",
		action="store_true",
		help="Downgrade non-portable frontmatter to a warning instead of an error",
	)
	args = parser.parse_args()

	if not SKILLS_DIR.exists():
		inventory = skill_inventory.SkillInventory(
			(),
			(),
			(
				SkillIssue(
					None,
					SKILLS_DIR,
					None,
					"missing-root",
					"skills directory does not exist",
				),
			),
		)
	else:
		candidates = skill_inventory.discover_candidates(source_lanes())
		selected, selection_issues = skill_inventory.select_candidates(
			candidates, args.skill, SKILLS_DIR
		)
		inspected = skill_inventory.inspect_candidates(
			selected, strict_frontmatter=not args.lenient_frontmatter
		)
		inventory = skill_inventory.SkillInventory(
			inspected.candidates,
			inspected.packages,
			inspected.issues + selection_issues,
		)

	warnings = [issue for issue in inventory.issues if issue.is_warning]
	errors = [issue for issue in inventory.issues if not issue.is_warning]
	for issue in errors:
		location = display_path(issue.path)
		if issue.line is not None:
			location += f":{issue.line}"
		print(f"ERROR {location}: {issue.message}", file=sys.stderr)
	for issue in warnings:
		location = display_path(issue.path)
		if issue.line is not None:
			location += f":{issue.line}"
		print(f"WARN  {location}: {issue.message}")

	if errors:
		return 1
	if not inventory.candidates and not args.skill:
		print("No skills found in skills/ or projects/.")
		return 0
	print(f"Validated {len(inventory.candidates)} skill(s).")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
