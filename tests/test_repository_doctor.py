# tests/test_repository_doctor.py
# protect read-only diagnostics from malformed receipts, ambiguous launchers, and misleading probe results

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import support


doctor = support.load_module("repository_doctor", support.SCRIPTS_DIR / "doctor.py")


def write_package(root: Path, folder: str, name: str | None = None) -> Path:
	package = root / folder
	package.mkdir(parents=True)
	(package / "SKILL.md").write_text(
		f"---\nname: {name or folder}\ndescription: fixture\n---\n", encoding="utf-8"
	)
	return package


def write_receipt(root: Path, payload: dict) -> None:
	generation = hashlib.sha256(
		json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
	).hexdigest()
	(root / doctor.skill_deployment.GENERATION_FILE).write_text(
		json.dumps({**payload, "generation": generation}), encoding="utf-8"
	)


class RepositoryDoctorTests(unittest.TestCase):
	def test_receipts_validate_shapes_content_mode_and_discovery_names(self) -> None:
		with tempfile.TemporaryDirectory() as temporary:
			root = Path(temporary) / "installed"
			root.mkdir()
			sources = Path(temporary) / "sources"
			source = write_package(sources, "example")
			(root / "example").symlink_to(source, target_is_directory=True)
			digest = doctor.skill_deployment.package_digest(source)
			payload = {
				"schema_version": 1,
				"lanes": {
					str(sources): {
						"packages": {
							"example": {
								"source": str(source),
								"source_digest": digest,
								"installed_digest": digest,
								"mode": "link",
							}
						},
						"instructions": [],
					}
				},
			}
			write_receipt(root, payload)
			self.assertEqual(doctor.inspect_root(root, sources)["generation_status"], "verified")
			(source / "notes.txt").write_text("changed", encoding="utf-8")
			self.assertIn(
				"example: content changed since deployment",
				doctor.inspect_root(root, sources)["generation_issues"],
			)
			write_package(root, "duplicate-folder", "example")
			self.assertEqual(
				doctor.inspect_root(root, sources)["duplicate_names"],
				{"example": ["duplicate-folder", "example"]},
			)
			malformed_lanes = [
				None,
				[],
				{str(sources): None},
				{str(sources): {"packages": [], "instructions": []}},
				{str(sources): {"packages": {"example": None}, "instructions": []}},
				{str(sources): {"packages": {}, "instructions": [None]}},
				{str(sources): {"packages": {}, "instructions": [{"path": [], "agent": []}]}},
				{str(sources): {"packages": {"../escape": {}}, "instructions": {}}},
			]
			for lanes in malformed_lanes:
				with self.subTest(lanes=lanes):
					write_receipt(root, {"schema_version": 1, "lanes": lanes})
					report = doctor.inspect_root(root, sources)
					self.assertEqual(report["generation_status"], "drift")
					self.assertTrue(report["generation_issues"])
			(root / doctor.skill_deployment.GENERATION_FILE).write_text("{", encoding="utf-8")
			self.assertEqual(doctor.inspect_root(root, sources)["generation_status"], "drift")

	def test_launcher_requires_exact_registration_and_redacts_configured_secrets(self) -> None:
		with tempfile.TemporaryDirectory() as temporary:
			root = Path(temporary)
			bin_dir = root / "bin"
			bin_dir.mkdir()
			node = bin_dir / "node"
			node.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
			node.chmod(0o755)
			dist = root / "tools/worker-broker/dist/src"
			dist.mkdir(parents=True)
			server = dist / "server.js"
			server.touch()
			(dist / "cli.js").touch()
			config = root / ".claude.json"
			registration = {
				"command": "node",
				"args": [str(server)],
				"env": {
					"PATH": str(bin_dir),
					"PRIVATE_AUTH": "do-not-expose",
					"WORKER_BROKER_CODEX_MODEL": "fixture-model",
				},
			}
			with (
				mock.patch.object(doctor.tooling_paths, "claude_state_path", return_value=config),
				mock.patch.object(doctor.tooling_paths, "resolve_home", return_value=root),
				mock.patch.dict(os.environ, {"PATH": str(bin_dir)}),
			):
				config.write_text(json.dumps({"mcpServers": {"worker-broker": registration}}))
				launcher, environment, receipts = doctor.broker_launcher(root)
				self.assertEqual(launcher, [str(node), str(dist / "cli.js")])
				self.assertEqual(environment["WORKER_BROKER_CODEX_MODEL"], "fixture-model")
				self.assertNotIn("PRIVATE_AUTH", environment)
				self.assertNotIn("do-not-expose", json.dumps(receipts))
				self.assertTrue(receipts[0]["selected"])
				registration["args"] = ["--eval", "process.exit(0)", str(server)]
				config.write_text(json.dumps({"mcpServers": {"worker-broker": registration}}))
				_, _, receipts = doctor.broker_launcher(root)
				self.assertEqual(receipts[0]["status"], "unverified")
				self.assertFalse(receipts[0]["source_matches"])
				config.write_text(json.dumps({"mcpServers": []}))
				(root / "config.toml").write_text("mcp_servers = []\n", encoding="utf-8")
				self.assertIsNotNone(doctor.broker_launcher(root)[0])

	def test_broker_diagnostics_report_timeouts_and_invalid_output_without_smoke(self) -> None:
		launcher = ["fixture-node", "fixture-cli"]
		with mock.patch.object(doctor.subprocess, "run") as run:
			run.return_value = subprocess.CompletedProcess([], 0, '{"providers": []}', "secret")
			self.assertEqual(doctor.run_broker_diagnostics(launcher, {})["status"], "ok")
			self.assertNotIn("--smoke", run.call_args.args[0])
			run.return_value = subprocess.CompletedProcess([], 0, "[]", "secret")
			self.assertEqual(
				doctor.run_broker_diagnostics(launcher, {})["status"], "invalid_output"
			)
			run.side_effect = subprocess.TimeoutExpired([], 90, output="secret", stderr="secret")
			report = doctor.run_broker_diagnostics(launcher, {})
			self.assertEqual(report["status"], "timeout")
			self.assertEqual(report["timeout_seconds"], 90)
			self.assertNotIn("secret", json.dumps(report))
			run.side_effect = FileNotFoundError()
			self.assertEqual(doctor.run_broker_diagnostics(launcher, {})["status"], "unavailable")


if __name__ == "__main__":
	unittest.main()
