#!/usr/bin/env python3
# skills/working-conventions/scripts/export-cursor-guard.py
# export the maintained task boundary block as a native Cursor user rule

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
START = '<!-- always-on:start title="Task authority and preservation" -->'
END = "<!-- always-on:end -->"


def main() -> int:
	parser = argparse.ArgumentParser(description="Export or check the canonical Cursor guard.")
	parser.add_argument("--check", action="store_true")
	args = parser.parse_args()
	source = (ROOT / "SKILL.md").read_text()
	if source.count(START) != 1:
		raise SystemExit("expected exactly one task authority block")
	body = source.split(START, 1)[1].split(END, 1)
	if len(body) != 2 or "<!-- always-on:" in body[0]:
		raise SystemExit("malformed task authority block")
	content = body[0].strip()
	digest = hashlib.sha256(content.encode()).hexdigest()
	output = (
		"---\nalwaysApply: true\n---\n\n"
		"<!-- Generated from working-conventions/SKILL.md; edit that source. -->\n"
		f"<!-- Source block SHA256: {digest} -->\n\n"
		"# Task authority and preservation\n\n"
		f"{content}\n"
	)
	target = ROOT / "assets" / "cursor-task-boundaries.mdc"
	if args.check:
		if not target.is_file() or target.read_text() != output:
			raise SystemExit("Cursor guard is stale; run this script without --check")
		print("Cursor guard matches its source block.")
		return 0
	target.parent.mkdir(parents=True, exist_ok=True)
	target.write_text(output)
	print(f"Generated {target}")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
