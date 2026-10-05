# tests/test_codex_install.py
# protect Codex TOML adoption and transactional preservation of user configuration

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import support

sync = support.load_module("sync-mcp", support.SCRIPTS_DIR / "sync-mcp.py")
mcp = sync.mcp_servers


class CodexInstall(unittest.TestCase):
	def test_adoption_preserves_comments_environment_and_symlink_then_is_idempotent(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			home = Path(directory)
			physical = home / "owned.toml"
			physical.write_text(
				'# keep this comment\nmodel = "chosen"\n'
				'[mcp_servers.foreign]\nurl = "https://example.invalid"\n'
				'[mcp_servers.worker-broker]\ncommand = "/bin/node-missing"\nargs = ["old"]\n'
				'[mcp_servers.worker-broker.env]\nWORKER_BROKER_HOME = "/private/state"\n',
				encoding="utf-8",
			)
			(home / "config.toml").symlink_to(physical)
			server = mcp.LocalServer(
				"worker-broker",
				"fixture",
				("node", "${REPO_ROOT}/broker.js"),
				(),
				frozenset({"codex"}),
			)
			plan = sync.build_tool_plan("codex", (server,), environ={"CODEX_HOME": directory})
			report = sync.sync_transaction.apply_plan(sync.build_run_plan([plan]))
			self.assertTrue(report.success)
			self.assertTrue((home / "config.toml").is_symlink())
			after = physical.read_text(encoding="utf-8")
			for retained in [
				"# keep this comment",
				'model = "chosen"',
				'WORKER_BROKER_HOME = "/private/state"',
				"https://example.invalid",
			]:
				self.assertIn(retained, after)
			self.assertIn(str(support.SCRIPTS_DIR.parent / "broker.js"), after)
			self.assertIsNone(
				sync.build_tool_plan(
					"codex", (server,), environ={"CODEX_HOME": directory}
				).replacement
			)

	def test_invalid_toml_and_concurrent_edit_do_not_replace_user_content(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			home = Path(directory)
			config = home / "config.toml"
			server = mcp.RemoteServer(
				"fixture", "fixture", "https://example.invalid", frozenset({"codex"})
			)
			config.write_text("bad = [", encoding="utf-8")
			with self.assertRaises(SystemExit):
				sync.build_tool_plan("codex", (server,), environ={"CODEX_HOME": directory})
			self.assertEqual(config.read_text(), "bad = [")
			config.write_text('model = "before"\n', encoding="utf-8")
			plan = sync.build_tool_plan("codex", (server,), environ={"CODEX_HOME": directory})
			config.write_text('model = "concurrent"\n', encoding="utf-8")
			report = sync.sync_transaction.apply_plan(sync.build_run_plan([plan]))
			self.assertFalse(report.success)
			self.assertEqual(config.read_text(), 'model = "concurrent"\n')

	def test_antigravity_agent_installs_without_replacing_a_collision(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			target = Path(directory) / "agents"
			agent = target / "ggfincke-worker-broker-readonly-v1.md"
			arguments = ["--tool", "agy", "--target", str(target)]
			first = support.run_script(support.SCRIPTS_DIR / "sync-agents.py", arguments)
			self.assertEqual(first.returncode, 0, first.stderr)
			self.assertTrue(agent.is_symlink())
			second = support.run_script(support.SCRIPTS_DIR / "sync-agents.py", arguments)
			self.assertEqual(second.returncode, 0, second.stderr)
			agent.unlink()
			agent.write_text("foreign definition", encoding="utf-8")
			collision = support.run_script(support.SCRIPTS_DIR / "sync-agents.py", arguments)
			self.assertNotEqual(collision.returncode, 0)
			self.assertEqual(agent.read_text(), "foreign definition")
