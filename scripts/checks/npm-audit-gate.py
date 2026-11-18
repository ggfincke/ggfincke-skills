#!/usr/bin/env python3
# scripts/checks/npm-audit-gate.py
# fail on high or critical npm advisories, minus dated exceptions w/ no upstream fix

from __future__ import annotations

import argparse
import datetime
import json
import subprocess
import sys

FAILING_SEVERITIES = {"high", "critical"}

# advisory id -> (last day the exception holds, why it is tolerated)
# * every entry needs an expiry so the gate goes red again if upstream never ships a fix
EXCEPTIONS = {
	"GHSA-fc5q-39xc-vjpf": (
		datetime.date(2026, 12, 17),
		"picomatch ReDoS: every published version is affected, reached only via dev tooling",
	),
}


def advisory_ids(report: dict) -> dict[str, str]:
	"""Map each failing-severity advisory id in an `npm audit --json` report to its package."""
	found = {}
	for vulnerability in report.get("vulnerabilities", {}).values():
		for via in vulnerability.get("via", []):
			# string entries name a vulnerable dependency, whose own advisories appear separately
			if isinstance(via, dict) and via.get("severity") in FAILING_SEVERITIES:
				found[via.get("url", "").rsplit("/", 1)[-1]] = via.get("name", "?")
	return found


def main() -> int:
	argparse.ArgumentParser(
		description="Audit root npm dependencies with dated exceptions."
	).parse_args()
	result = subprocess.run(["npm", "audit", "--json"], capture_output=True, text=True)
	report = json.loads(result.stdout or "{}")
	# a failed audit (network, registry) must not read as a clean one
	if "vulnerabilities" not in report:
		print(f"npm audit returned no report: {result.stderr.strip()}", file=sys.stderr)
		return 1
	today = datetime.date.today()
	failures = []
	for advisory, package in sorted(advisory_ids(report).items()):
		expiry, reason = EXCEPTIONS.get(advisory, (None, ""))
		if expiry is not None and today <= expiry:
			print(f"allowed until {expiry}: {advisory} ({package}) - {reason}")
		elif expiry is not None:
			failures.append(f"{advisory} ({package}): exception expired {expiry}")
		else:
			failures.append(f"{advisory} ({package})")
	for failure in failures:
		print(f"high/critical advisory: {failure}", file=sys.stderr)
	return 1 if failures else 0


if __name__ == "__main__":
	raise SystemExit(main())
