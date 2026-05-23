#!/usr/bin/env python3
# scripts/validate-skills.py
# validate portable skill folders in this repo

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = ROOT / "skills"
NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
PORTABLE_FIELDS = {"name", "description"}


@dataclass
class SkillIssue:
    path: Path
    message: str
    is_warning: bool = False


def parse_frontmatter(path: Path) -> tuple[dict[str, str], list[str]]:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        raise ValueError("missing opening YAML frontmatter marker")

    try:
        end_index = lines[1:].index("---") + 1
    except ValueError as exc:
        raise ValueError("missing closing YAML frontmatter marker") from exc

    values: dict[str, str] = {}
    raw_lines = lines[1:end_index]
    for line_number, line in enumerate(raw_lines, start=2):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if ":" not in stripped:
            raise ValueError(f"unsupported frontmatter line {line_number}: {line}")
        key, value = stripped.split(":", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        if not key:
            raise ValueError(f"empty frontmatter key on line {line_number}")
        values[key] = value

    return values, raw_lines


def find_skills(selected: list[str]) -> tuple[list[Path], list[SkillIssue]]:
    issues: list[SkillIssue] = []
    if not SKILLS_DIR.exists():
        return [], [SkillIssue(SKILLS_DIR, "skills directory does not exist")]

    all_skills = {
        path.name: path
        for path in sorted(SKILLS_DIR.iterdir())
        if path.is_dir()
        and not path.name.startswith(".")
        and not path.name.startswith("_")
        and (path / "SKILL.md").is_file()
    }

    if selected:
        missing = sorted(set(selected) - set(all_skills))
        for name in missing:
            issues.append(SkillIssue(SKILLS_DIR / name, "selected skill does not exist"))
        return [all_skills[name] for name in selected if name in all_skills], issues

    return list(all_skills.values()), issues


def validate_skill(path: Path, strict_frontmatter: bool) -> list[SkillIssue]:
    issues: list[SkillIssue] = []
    skill_file = path / "SKILL.md"

    if not NAME_RE.fullmatch(path.name):
        issues.append(
            SkillIssue(path, "folder name must use lowercase letters, digits, and hyphens")
        )

    try:
        frontmatter, _ = parse_frontmatter(skill_file)
    except ValueError as exc:
        return [SkillIssue(skill_file, str(exc))]

    name = frontmatter.get("name", "")
    description = frontmatter.get("description", "")

    if not name:
        issues.append(SkillIssue(skill_file, "frontmatter is missing required name"))
    elif name != path.name:
        issues.append(
            SkillIssue(skill_file, f"frontmatter name {name!r} must match folder {path.name!r}")
        )

    if not description:
        issues.append(SkillIssue(skill_file, "frontmatter is missing required description"))

    extra_fields = sorted(set(frontmatter) - PORTABLE_FIELDS)
    if extra_fields:
        message = (
            "non-portable frontmatter fields: "
            + ", ".join(extra_fields)
            + "; keep canonical skills portable unless this is intentional"
        )
        issues.append(SkillIssue(skill_file, message, is_warning=not strict_frontmatter))

    return issues


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate portable skill folders in this repo."
    )
    parser.add_argument("--skill", action="append", default=[], help="Validate one skill name")
    parser.add_argument(
        "--strict-frontmatter",
        action="store_true",
        help="Fail when frontmatter includes fields beyond name and description",
    )
    args = parser.parse_args()

    skills, issues = find_skills(args.skill)
    for skill in skills:
        issues.extend(validate_skill(skill, args.strict_frontmatter))

    if not skills and not args.skill:
        print("No installable skills found in skills/.")
        return 0

    warnings = [issue for issue in issues if issue.is_warning]
    errors = [issue for issue in issues if not issue.is_warning]

    for issue in errors:
        print(f"ERROR {issue.path.relative_to(ROOT)}: {issue.message}", file=sys.stderr)
    for issue in warnings:
        print(f"WARN  {issue.path.relative_to(ROOT)}: {issue.message}")

    if errors:
        return 1

    print(f"Validated {len(skills)} skill(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
