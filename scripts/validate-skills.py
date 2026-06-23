#!/usr/bin/env python3
# scripts/validate-skills.py
# validate skill folders (portable in skills/, project-only in projects/<repo>/)

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import always_on


ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = ROOT / "skills"
PROJECTS_DIR = ROOT / "projects"
NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
PORTABLE_FIELDS = {"name", "description"}
INVALID_PLAIN_SCALAR_RE = re.compile(r":(?:[ \t]|$)")
# skill-local resource references in SKILL.md (references/... or assets/...),
# scoped so target-repo paths (convex/, src/, scripts/...) never match
RESOURCE_REF_RE = re.compile(r"(?<![\w./-])(references|assets)/[\w./-]*[\w-]")


def is_within(path: Path, parent: Path) -> bool:
    path = path.resolve()
    parent = parent.resolve()
    return path == parent or parent in path.parents


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
        value = parse_frontmatter_value(value.strip(), line_number)
        if not key:
            raise ValueError(f"empty frontmatter key on line {line_number}")
        values[key] = value

    return values, raw_lines


def parse_frontmatter_value(value: str, line_number: int) -> str:
    if not value:
        return ""

    quote = value[0]
    if quote in {"'", '"'}:
        if len(value) == 1 or value[-1] != quote:
            raise ValueError(f"unterminated quoted frontmatter value on line {line_number}")
        return value[1:-1]

    if INVALID_PLAIN_SCALAR_RE.search(value):
        raise ValueError(
            f"invalid YAML frontmatter value on line {line_number}: "
            "plain values cannot contain ': '; quote the value"
        )

    return value


def skill_dirs_in(base: Path) -> list[Path]:
    return [
        path
        for path in sorted(base.iterdir())
        if path.is_dir()
        and not path.name.startswith(".")
        and not path.name.startswith("_")
        and (path / "SKILL.md").is_file()
    ]


def discover_skills() -> list[Path]:
    # portable skills in skills/, plus project-only skills in projects/<repo>/
    dirs: list[Path] = []
    if SKILLS_DIR.exists():
        dirs.extend(skill_dirs_in(SKILLS_DIR))
    if PROJECTS_DIR.exists():
        for repo in sorted(PROJECTS_DIR.iterdir()):
            if repo.is_dir() and not repo.name.startswith(".") and not repo.name.startswith("_"):
                dirs.extend(skill_dirs_in(repo))
    return dirs


def find_skills(selected: list[str]) -> tuple[list[Path], list[SkillIssue]]:
    issues: list[SkillIssue] = []
    if not SKILLS_DIR.exists():
        return [], [SkillIssue(SKILLS_DIR, "skills directory does not exist")]

    all_dirs = discover_skills()

    if selected:
        wanted = set(selected)
        present = {path.name for path in all_dirs}
        for name in sorted(wanted - present):
            issues.append(SkillIssue(SKILLS_DIR / name, "selected skill does not exist"))
        return [path for path in all_dirs if path.name in wanted], issues

    return all_dirs, issues


def readme_issues(skill_dir: Path) -> list[SkillIssue]:
    # the repo contract bans per-skill README files; SKILL.md is the entry point
    issues: list[SkillIssue] = []
    for candidate in sorted(skill_dir.rglob("*")):
        if candidate.is_file() and candidate.name.lower() == "readme.md":
            issues.append(
                SkillIssue(candidate, "per-skill README is banned; keep instructions in SKILL.md & references/")
            )
    return issues


def resource_link_issues(skill_dir: Path, skill_file: Path) -> list[SkillIssue]:
    # flag references/... or assets/... paths in SKILL.md that do not exist;
    # only checked when the skill actually has that resource dir, so project
    # skills that point at a target repo are never touched
    issues: list[SkillIssue] = []
    text = skill_file.read_text(encoding="utf-8")
    seen: set[str] = set()
    for match in RESOURCE_REF_RE.finditer(text):
        rel = match.group(0)
        if rel in seen:
            continue
        seen.add(rel)
        top = match.group(1)
        if not (skill_dir / top).is_dir():
            continue
        if ".." in rel.split("/"):
            continue
        target = skill_dir / rel
        if not is_within(target, skill_dir):
            continue
        if not target.exists():
            issues.append(SkillIssue(skill_file, f"SKILL.md references missing resource {rel}"))
    return issues


def validate_skill(path: Path, strict_frontmatter: bool) -> list[SkillIssue]:
    issues: list[SkillIssue] = []
    skill_file = path / "SKILL.md"

    if not NAME_RE.fullmatch(path.name):
        issues.append(
            SkillIssue(path, "folder name must use lowercase letters, digits, and hyphens")
        )

    issues.extend(readme_issues(path))

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

    # malformed always-on blocks would silently break the generated region
    body = skill_file.read_text(encoding="utf-8")
    for message in always_on.marker_issues(body):
        issues.append(SkillIssue(skill_file, message))

    issues.extend(resource_link_issues(path, skill_file))

    return issues


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate skill folders (portable and project-only) in this repo."
    )
    parser.add_argument("--skill", action="append", default=[], help="Validate one skill name")
    parser.add_argument(
        "--strict-frontmatter",
        action="store_true",
        help="(default) fail when frontmatter includes fields beyond name and description",
    )
    parser.add_argument(
        "--lenient-frontmatter",
        action="store_true",
        help="Downgrade non-portable frontmatter to a warning instead of an error",
    )
    args = parser.parse_args()

    strict_frontmatter = not args.lenient_frontmatter
    skills, issues = find_skills(args.skill)
    for skill in skills:
        issues.extend(validate_skill(skill, strict_frontmatter))

    if not skills and not args.skill:
        print("No skills found in skills/ or projects/.")
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
