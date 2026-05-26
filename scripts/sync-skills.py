#!/usr/bin/env python3
# scripts/sync-skills.py
# install canonical skills into local agent dirs

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

import always_on


ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = ROOT / "skills"
PROJECTS_DIR = ROOT / "projects"
GLOBAL_AGENTS = ("codex", "agents", "claude")


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
            expanded.extend(["codex", "agents", "claude"])
        else:
            expanded.append(name)

    result: list[tuple[str, Path]] = []
    for name in expanded:
        if name.startswith("project-") and project is None:
            raise SystemExit(f"--target {name} requires --project")
        if name not in available:
            allowed = ", ".join(sorted({"all", "project-claude", "project-agents", *available.keys()}))
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


def install_skill(src: Path, target_root: Path, mode: str, force: bool, dry_run: bool) -> str:
    dest = target_root / src.name
    action = "link" if mode == "link" else "copy"

    if dest.exists() or dest.is_symlink():
        if dest.is_symlink() and dest.resolve() == src.resolve() and mode == "link":
            return f"ok existing link {dest}"
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
    # write the generated region into each global agent's instruction file
    items = collect_always_on()
    if not items:
        print("  no always-on blocks found; nothing to write")
        return

    region = always_on.render_region(items)
    seen: set[Path] = set()
    for agent in agents:
        path = always_on.instruction_file(agent)
        if path in seen:
            continue
        seen.add(path)

        existing = path.read_text(encoding="utf-8") if path.exists() else ""
        if dry_run:
            verb = "would update" if always_on.REGION_RE.search(existing) else "would write"
            print(f"  {verb} always-on region in {path}")
            continue

        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(always_on.apply_region(existing, region), encoding="utf-8")
        verb = "updated" if always_on.REGION_RE.search(existing) else "wrote"
        print(f"  {verb} always-on region in {path}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Install canonical skills into local agent skill directories."
    )
    parser.add_argument(
        "--target",
        action="append",
        default=[],
        help="Install target: codex, agents, claude, project-claude, project-agents, or all. Can be repeated.",
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
        requested = args.target or ["project-agents"]
        leaked = [name for name in requested if not name.startswith("project-")]
        if leaked:
            raise SystemExit(
                "--project-repo installs project-only skills; refusing non-project target(s): "
                + ", ".join(leaked)
                + ". Use project-agents or project-claude."
            )
        base_dir = PROJECTS_DIR / args.project_repo
        if not base_dir.is_dir():
            raise SystemExit(f"unknown project repo {args.project_repo!r}: {base_dir} does not exist")
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

    for target_name, target_root in targets:
        print(f"[{target_name}] {target_root}")
        for skill in skills:
            print("  " + install_skill(skill, target_root, args.mode, args.force, args.dry_run))

    # global lane only: keep each agent's instruction file's always-on region current
    if not args.project_repo and not args.skip_always_on:
        global_agents = [name for name, _ in targets if name in GLOBAL_AGENTS]
        if global_agents:
            print("[always-on] global instruction files")
            sync_always_on(global_agents, args.dry_run)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
