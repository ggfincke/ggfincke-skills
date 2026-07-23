#!/usr/bin/env python3
# scripts/sync-agents.py
# install canonical Claude custom agents into one explicit personal target

from __future__ import annotations

import argparse
import os
import re
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AGENTS_DIR = ROOT / "agents"
AGENT_NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
FRONTMATTER_NAME_RE = re.compile(r"^name:\s*(?P<name>[^\s]+)\s*$", re.MULTILINE)


def is_within(path: Path, parent: Path) -> bool:
    path = path.resolve()
    parent = parent.resolve()
    return path == parent or parent in path.parents


def assert_target_outside_repo(target: Path) -> None:
    # never let --force turn the canonical agent source into its own destination
    if is_within(target, ROOT):
        raise SystemExit(
            f"refusing agent target {target}: it resolves inside this repo ({ROOT})"
        )


def default_target() -> Path:
    claude_home = Path(os.environ.get("CLAUDE_HOME", Path.home() / ".claude"))
    return claude_home / "agents"


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


def install_agent(
    source: Path,
    target: Path,
    mode: str,
    force: bool,
    dry_run: bool,
) -> str:
    destination = target / source.name
    if same_install(source, destination, mode):
        return f"ok existing {mode}: {destination}"
    if destination.exists() or destination.is_symlink():
        if destination.is_dir() and not destination.is_symlink():
            raise SystemExit(f"refusing to replace agent directory: {destination}")
        if not force:
            return f"skip existing (use --force): {destination}"

    action = "link" if mode == "link" else "copy"
    if dry_run:
        return f"would {action}: {source} -> {destination}"

    target.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.{os.getpid()}.tmp")
    if temporary.exists() or temporary.is_symlink():
        temporary.unlink()
    if mode == "link":
        temporary.symlink_to(source)
    else:
        shutil.copy2(source, temporary)
    temporary.replace(destination)
    return f"{action}ed: {source} -> {destination}"


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

    target = args.target.expanduser()
    assert_target_outside_repo(target)
    print(f"[claude-agents] {target}")
    for source in find_agents(args.agent):
        print("  " + install_agent(source, target, args.mode, args.force, args.dry_run))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
