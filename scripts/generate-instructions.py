#!/usr/bin/env python3
# scripts/generate-instructions.py
# refresh only the repository-owned generated instruction region from canonical skills

from __future__ import annotations

import argparse
from pathlib import Path

import always_on
import sync_transaction

ROOT = Path(__file__).resolve().parents[1]


def desired_instructions(root: Path = ROOT) -> str:
	path = root / "AGENTS.md"
	if path.is_symlink():
		raise ValueError("repository AGENTS.md must not redirect this source-generation command")
	existing = path.read_text(encoding="utf-8")
	error = always_on.region_marker_error(existing)
	if error:
		raise ValueError(error)
	items = []
	for skill in sorted((root / "skills").glob("*/SKILL.md")):
		blocks, errors = always_on.parse_blocks(skill.read_text(encoding="utf-8"))
		if errors:
			raise ValueError(f"{skill}: {'; '.join(errors)}")
		items.extend((skill.parent.name, title, content) for title, content in blocks)
	return (
		always_on.apply_region(existing, always_on.render_region(sorted(items)))
		if items
		else always_on.remove_region(existing)
	)


def main() -> int:
	parser = argparse.ArgumentParser(
		description="Regenerate the repository AGENTS.md region, preserving manual content."
	)
	parser.add_argument("--check", action="store_true")
	args = parser.parse_args()
	path = ROOT / "AGENTS.md"
	content = desired_instructions()
	if path.read_text(encoding="utf-8") == content:
		print("current: AGENTS.md generated region")
		return 0
	if args.check:
		print("outdated: AGENTS.md generated region")
		return 1
	item = sync_transaction.replacement(
		"repo-instructions",
		path,
		sync_transaction.BytesPayload(content.encode(), preserve_metadata_from=path),
		atomic_file=True,
	)
	report = sync_transaction.apply_plan(
		sync_transaction.RunPlan((sync_transaction.DestinationPlan("repo-instructions", (item,)),))
	)
	if not report.success:
		raise RuntimeError(str(report.events))
	print("generated: AGENTS.md region")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
