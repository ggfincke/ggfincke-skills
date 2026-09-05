#!/usr/bin/env python3
# scripts/check-native-behaviors.py
# run bounded opt-in behavioral fixtures through a configured native runtime

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import doctor


def main() -> int:
	parser = argparse.ArgumentParser(
		description="Run native skill behavioral fixtures only on explicit invocation."
	)
	parser.add_argument("--smoke", action="store_true")
	parser.add_argument("--provider", choices=("codex", "claude"), default="codex")
	parser.add_argument("--output", required=True, type=Path)
	parser.add_argument(
		"--case",
		action="append",
		default=[],
		help="Run only the named fixture; repeat to select several.",
	)
	args = parser.parse_args()
	if not args.smoke:
		parser.error("native fixtures require an explicit --smoke invocation")
	launcher, environment, _ = doctor.broker_launcher()
	if launcher is None:
		parser.exit(2, "broker launcher unavailable; native behavior remains unverified\n")
	result = subprocess.run(
		[*launcher, "doctor", "--json", "--provider", args.provider],
		env=environment,
		capture_output=True,
		text=True,
		timeout=30,
		check=True,
	)
	provider = json.loads(result.stdout)["providers"][0]
	if not provider.get("binary") or provider["help_status"] != "ok":
		parser.exit(
			2,
			f"configured {args.provider} binary unavailable; native behavior remains unverified\n",
		)
	environment.update(
		{
			"SKILLS_NATIVE_SMOKE": "1",
			"SKILLS_NATIVE_PROVIDER": args.provider,
			"SKILLS_NATIVE_OUTPUT_DIR": str(args.output.resolve()),
			"SKILLS_NATIVE_BINARY": provider["binary"],
			"SKILLS_NATIVE_MODEL": provider.get("configured_model") or "",
			"SKILLS_NATIVE_CASES": ",".join(args.case),
		}
	)
	return subprocess.run(
		[
			sys.executable,
			"-m",
			"unittest",
			"discover",
			"-s",
			"tests",
			"-p",
			"test_native_skill_behaviors.py",
		],
		cwd=doctor.ROOT,
		env=environment,
	).returncode


if __name__ == "__main__":
	raise SystemExit(main())
