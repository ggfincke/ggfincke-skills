# tests/test_sync_mcp.py
# plan building and transactional merging of the mcp registry into per-tool configs

from __future__ import annotations

import json
import os
import stat
import tempfile
import unittest
from pathlib import Path

import support

mcp = support.load_module("mcp_servers", support.SCRIPTS_DIR / "mcp_servers.py")
sync_mcp = support.load_module("sync-mcp", support.SCRIPTS_DIR / "sync-mcp.py")
transaction = sync_mcp.sync_transaction

FIGMA_URL = "https://mcp.figma.com/mcp"
LOCAL_URL = "http://127.0.0.1:3845/mcp"


def both_tools_entry(url: str = FIGMA_URL, *, enabled: bool = True) -> dict:
	entry = {
		"description": "figma fixture",
		"transport": "remote",
		"url": url,
		"tools": ["opencode", "claude-code"],
	}
	if not enabled:
		entry["enabled"] = False
	return {"version": 1, "servers": {"figma": entry}}


def write_registry(directory: Path, document: dict) -> Path:
	path = directory / "servers.json"
	path.write_text(json.dumps(document), encoding="utf-8")
	return path


def split_registry(path: Path) -> Path:
	path.write_text(
		json.dumps(
			{
				"version": 1,
				"servers": {
					"figma": {
						"description": "Figma remote",
						"transport": "remote",
						"url": FIGMA_URL,
						"tools": ["claude-code"],
					},
					"devmode": {
						"description": "Figma local dev mode",
						"transport": "remote",
						"url": LOCAL_URL,
						"tools": ["opencode"],
					},
				},
			}
		),
		encoding="utf-8",
	)
	return path


def seed_claude_document(home: Path) -> None:
	home.mkdir(parents=True, exist_ok=True)
	(home / ".claude.json").write_text(
		json.dumps(
			{
				"numStartups": 7,
				"mcpServers": {"worker-broker": {"command": "node", "args": ["x"]}},
			},
			indent=2,
		)
		+ "\n",
		encoding="utf-8",
	)


class InspectPrivateWrites(transaction.FileOps):
	def __init__(self) -> None:
		self.stage_modes: list[int] = []
		self.backup_modes: list[int] = []

	def write_bytes(self, destination: Path, content: bytes) -> None:
		self.stage_modes.append(stat.S_IMODE(destination.stat().st_mode))
		super().write_bytes(destination, content)

	def copy2(self, source: Path, destination: Path) -> None:
		self.backup_modes.append(stat.S_IMODE(destination.stat().st_mode))
		super().copy2(source, destination)


class SelectedServers(unittest.TestCase):
	def test_filters_by_tool_and_name_allowlist(self) -> None:
		servers = (
			mcp.RemoteServer("web", "d", "https://w.test", frozenset({"opencode"})),
			mcp.LocalServer("off", "d", ("n",), (), frozenset({"opencode"}), False),
			mcp.RemoteServer("both", "d", "https://b.test", frozenset({"opencode", "claude-code"})),
		)
		self.assertEqual(
			[server.name for server in sync_mcp.selected_servers(servers, "opencode", frozenset())],
			["web", "both"],
		)
		self.assertEqual(
			sync_mcp.selected_servers(servers, "opencode", frozenset({"both"}))[0].name,
			"both",
		)
		self.assertEqual(
			[
				server.name
				for server in sync_mcp.selected_servers(servers, "claude-code", frozenset())
			],
			["both"],
		)


class PlanBuilding(unittest.TestCase):
	def build(self, home: Path, *, enabled: bool = True) -> list:
		with tempfile.TemporaryDirectory() as directory:
			servers = mcp.load_servers(
				write_registry(Path(directory), both_tools_entry(enabled=enabled))
			)
		return [
			sync_mcp.build_tool_plan(tool, servers, repo_root=self.repo, environ={}, user_home=home)
			for tool in ("opencode", "claude-code")
		]

	def setUp(self) -> None:
		self.tmp = tempfile.TemporaryDirectory()
		self.addCleanup(self.tmp.cleanup)
		base = Path(self.tmp.name).resolve()
		self.repo = base / "repo"
		self.home = base / "home"
		self.home.mkdir(parents=True)
		self.repo.mkdir()

	def payload_document(self, plan) -> dict:
		assert plan.replacement is not None
		return json.loads(plan.replacement.payload.content.decode("utf-8"))

	def test_fresh_plans_target_both_configs_with_expected_content(self) -> None:
		opencode, claude = self.build(self.home)
		self.assertEqual(opencode.label, "mcp-opencode")
		self.assertEqual(
			self.payload_document(opencode),
			{"mcp": {"figma": {"type": "remote", "url": FIGMA_URL}}},
		)
		self.assertEqual(claude.replacement.logical_destination, self.home / ".claude.json")
		self.assertEqual(
			self.payload_document(claude)["mcpServers"]["figma"],
			{"type": "http", "url": FIGMA_URL},
		)

	def test_rebuilding_after_apply_reports_existing_configs(self) -> None:
		plans = self.build(self.home)
		report = transaction.apply_plan(sync_mcp.build_run_plan(plans))
		self.assertTrue(report.success)
		rebuilt = self.build(self.home)
		for plan in rebuilt:
			self.assertIsNone(plan.replacement)
			self.assertTrue(plan.messages[0].startswith("ok existing config"))

	def test_new_configs_are_private_before_bytes_with_a_permissive_umask(self) -> None:
		plans = self.build(self.home)
		ops = InspectPrivateWrites()
		previous_umask = os.umask(0)
		try:
			report = transaction.apply_plan(sync_mcp.build_run_plan(plans), ops=ops)
		finally:
			os.umask(previous_umask)
		self.assertTrue(report.success, report.events)
		self.assertEqual(ops.stage_modes, [0o600, 0o600])
		for plan in plans:
			self.assertEqual(stat.S_IMODE(plan.target.stat().st_mode), 0o600)

	def test_existing_metadata_and_symlink_survive_private_staging_and_backups(self) -> None:
		seed_claude_document(self.home)
		logical = self.home / ".claude.json"
		physical = self.home / "managed" / "claude.json"
		physical.parent.mkdir()
		logical.replace(physical)
		logical.symlink_to(physical)
		opencode = self.home / ".config/opencode/opencode.json"
		opencode.parent.mkdir(parents=True)
		opencode.write_text('{"theme": "fixture"}\n', encoding="utf-8")
		mtime_ns = 1_700_000_000_000_000_000
		for path, mode in ((opencode, 0o640), (physical, 0o600)):
			path.chmod(mode)
			os.utime(path, ns=(mtime_ns, mtime_ns))
		plans = self.build(self.home)
		self.assertEqual(plans[1].replacement.logical_destination, logical)
		ops = InspectPrivateWrites()
		report = transaction.apply_plan(sync_mcp.build_run_plan(plans), ops=ops)
		self.assertTrue(report.success, report.events)
		self.assertEqual(ops.stage_modes, [0o600, 0o600])
		self.assertEqual(ops.backup_modes, [0o600, 0o600])
		self.assertTrue(logical.is_symlink())
		for path, mode in ((opencode, 0o640), (physical, 0o600)):
			self.assertEqual(stat.S_IMODE(path.stat().st_mode), mode)
			self.assertEqual(path.stat().st_mtime_ns, mtime_ns)

	def test_failed_promotion_restores_private_original_without_artifacts(self) -> None:
		class FailAfterPromotion(transaction.FileOps):
			failed = False

			def before(self, action: str, path: Path) -> None:
				if action == "fsync-parent" and not self.failed:
					self.failed = True
					raise OSError("fixture promotion failure")

		seed_claude_document(self.home)
		target = self.home / ".claude.json"
		target.chmod(0o600)
		original = target.read_bytes()
		plan = self.build(self.home)[1]
		report = transaction.apply_plan(sync_mcp.build_run_plan([plan]), ops=FailAfterPromotion())
		self.assertFalse(report.success)
		self.assertEqual(target.read_bytes(), original)
		self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
		self.assertEqual(list(self.home.glob(".*.ggfincke-sync.*")), [])

	def test_malformed_existing_config_refuses_to_build(self) -> None:
		target = self.home / ".config/opencode/opencode.json"
		target.parent.mkdir(parents=True, exist_ok=True)
		target.write_text("{broken", encoding="utf-8")
		with self.assertRaises(SystemExit) as ctx:
			self.build(self.home)
		self.assertIn("invalid JSON", str(ctx.exception))

	def test_targets_inside_the_repo_are_refused(self) -> None:
		with self.assertRaises(SystemExit) as ctx:
			self.build(self.repo)
		self.assertIn("refusing", str(ctx.exception))

	def test_disabled_registry_entries_produce_skip_messages(self) -> None:
		plans = self.build(self.home, enabled=False)
		for plan in plans:
			self.assertIsNone(plan.replacement)
			self.assertTrue(plan.messages[0].startswith("skip: no enabled registry entries"))


class CliEndToEnd(unittest.TestCase):
	def setUp(self) -> None:
		self.tmp = tempfile.TemporaryDirectory()
		self.addCleanup(self.tmp.cleanup)
		base = Path(self.tmp.name).resolve()
		self.home = base / "home"
		self.registry = split_registry(base / "registry.json")

	def run_cli(self, args: list[str], home: Path, *, claude_config_dir: Path | None = None):
		env = dict(os.environ)
		env.pop("CLAUDE_CONFIG_DIR", None)
		env["OPENCODE_HOME"] = str(home / ".config/opencode")
		env["CLAUDE_HOME"] = str(home)
		if claude_config_dir is not None:
			env["CLAUDE_CONFIG_DIR"] = str(claude_config_dir)
		return support.run_script(
			support.SCRIPTS_DIR / "sync-mcp.py",
			["--registry", str(self.registry), *args],
			env=env,
		)

	def test_dry_run_reports_without_touching_files(self) -> None:
		seed_claude_document(self.home)
		result = self.run_cli(["--dry-run"], self.home)
		self.assertEqual(result.returncode, 0, result.stderr)
		self.assertIn(
			f"would update: {self.home / '.config/opencode/opencode.json'}", result.stdout
		)
		self.assertIn(f"[mcp-claude-code] {self.home / '.claude.json'}", result.stdout)
		claude_doc = json.loads((self.home / ".claude.json").read_text(encoding="utf-8"))
		self.assertNotIn("figma", claude_doc.get("mcpServers", {}))

	def test_apply_installs_both_and_preserves_unrelated_content(self) -> None:
		seed_claude_document(self.home)
		result = self.run_cli([], self.home)
		self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

		opencode_doc = json.loads(
			(self.home / ".config/opencode/opencode.json").read_text(encoding="utf-8")
		)
		self.assertEqual(opencode_doc, {"mcp": {"devmode": {"type": "remote", "url": LOCAL_URL}}})

		raw = (self.home / ".claude.json").read_text(encoding="utf-8")
		claude_doc = json.loads(raw)
		self.assertEqual(claude_doc["numStartups"], 7)
		self.assertEqual(
			claude_doc["mcpServers"]["worker-broker"], {"command": "node", "args": ["x"]}
		)
		self.assertEqual(claude_doc["mcpServers"]["figma"], {"type": "http", "url": FIGMA_URL})
		self.assertTrue(raw.startswith('{\n  "numStartups"'))

	def test_second_apply_is_an_idempotent_noop(self) -> None:
		self.run_cli([], self.home)
		before = (self.home / ".claude.json").read_bytes()
		result = self.run_cli([], self.home)
		self.assertEqual(result.returncode, 0, result.stdout)
		self.assertEqual(result.stdout.count("ok existing config"), 2)
		self.assertEqual((self.home / ".claude.json").read_bytes(), before)

	def test_native_profile_wins_without_touching_the_fallback_config(self) -> None:
		profile = self.home.parent / "native-profile"
		seed_claude_document(self.home)
		seed_claude_document(profile)
		fallback = self.home / ".claude.json"
		before = fallback.read_bytes()
		result = self.run_cli(["--tool", "claude-code"], self.home, claude_config_dir=profile)
		self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
		self.assertEqual(fallback.read_bytes(), before)
		profile_doc = json.loads((profile / ".claude.json").read_text(encoding="utf-8"))
		self.assertEqual(profile_doc["mcpServers"]["figma"], {"type": "http", "url": FIGMA_URL})
		self.assertIn(f"updated: {profile / '.claude.json'}", result.stdout)

	def test_invalid_existing_config_fails_closed(self) -> None:
		seed_claude_document(self.home)
		target = self.home / ".config/opencode/opencode.json"
		target.parent.mkdir(parents=True, exist_ok=True)
		target.write_text("{oops", encoding="utf-8")
		result = self.run_cli([], self.home)
		self.assertNotEqual(result.returncode, 0)
		self.assertIn("invalid JSON", result.stdout + result.stderr)
		claude_text = (self.home / ".claude.json").read_text(encoding="utf-8")
		self.assertNotIn(FIGMA_URL, claude_text)

	def test_unknown_server_names_are_refused(self) -> None:
		result = self.run_cli(["--server", "nope"], self.home)
		self.assertNotEqual(result.returncode, 0)
		self.assertIn("unknown server(s): nope", result.stdout + result.stderr)

	def test_tool_filter_never_touches_the_other_config(self) -> None:
		seed_claude_document(self.home)
		result = self.run_cli(["--tool", "opencode"], self.home)
		self.assertEqual(result.returncode, 0, result.stdout)
		opencode_doc = json.loads(
			(self.home / ".config/opencode/opencode.json").read_text(encoding="utf-8")
		)
		self.assertEqual(opencode_doc["mcp"]["devmode"]["url"], LOCAL_URL)
		claude_doc = json.loads((self.home / ".claude.json").read_text(encoding="utf-8"))
		self.assertNotIn("figma", claude_doc.get("mcpServers", {}))

	def test_server_filter_scopes_the_install_to_matching_tools(self) -> None:
		seed_claude_document(self.home)
		result = self.run_cli(["--server", "devmode", "--tool", "opencode"], self.home)
		self.assertEqual(result.returncode, 0, result.stdout)
		self.assertIn("updated:", result.stdout)
		claude_doc = json.loads((self.home / ".claude.json").read_text(encoding="utf-8"))
		self.assertNotIn("figma", claude_doc.get("mcpServers", {}))

	def test_server_filter_that_misses_the_tool_skips_cleanly(self) -> None:
		result = self.run_cli(["--server", "figma", "--tool", "opencode"], self.home)
		self.assertEqual(result.returncode, 0, result.stdout)
		self.assertIn("skip: filtered server(s) do not target opencode", result.stdout)
		self.assertFalse((self.home / ".config/opencode/opencode.json").exists())


if __name__ == "__main__":
	unittest.main()
