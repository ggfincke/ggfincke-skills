# tests/test_sync_agents.py
# custom-agent sync safety: validate names, preserve user files, & refuse source overlap

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import support

sync = support.load_module("sync_agents", support.SCRIPTS_DIR / "sync-agents.py")
SYNC_PATH = support.SCRIPTS_DIR / "sync-agents.py"


class PromoteFailureOps(sync.sync_transaction.FileOps):
	def before(self, action: str, path: Path) -> None:
		if action == "replace":
			raise OSError(f"injected promote failure at {path}")


class AgentValidation(unittest.TestCase):
	def test_canonical_agents_have_matching_frontmatter_names(self) -> None:
		agents = sync.find_agents([])
		self.assertTrue(agents)


class AgentInstallSafety(unittest.TestCase):
	def test_target_inside_repo_is_refused(self) -> None:
		with self.assertRaises(SystemExit):
			sync.assert_target_outside_repo(sync.ROOT / "installed-agents")

	def test_link_install_is_idempotent(self) -> None:
		source = sync.AGENTS_DIR / "fable-orchestrator.md"
		with tempfile.TemporaryDirectory() as directory:
			target = Path(directory) / "agents"
			sync.install_agent(source, target, "link", force=False, dry_run=False)
			result = sync.install_agent(source, target, "link", force=False, dry_run=False)
			destination = target / source.name
			self.assertIn("ok existing link", result)
			self.assertTrue(destination.is_symlink())
			self.assertEqual(destination.resolve(), source.resolve())

	def test_noop_refuses_a_stale_transaction_artifact(self) -> None:
		source = sync.AGENTS_DIR / "fable-orchestrator.md"
		with tempfile.TemporaryDirectory() as directory:
			target = Path(directory) / "agents"
			target.mkdir()
			destination = target / source.name
			destination.write_bytes(source.read_bytes())
			artifact = target / f".{destination.name}.ggfincke-sync.crashed.backup"
			artifact.write_text("recover me\n", encoding="utf-8")

			with self.assertRaises(SystemExit) as caught:
				sync.install_agent(source, target, "copy", force=False, dry_run=False)

			self.assertIn(str(artifact), str(caught.exception))
			self.assertIn("manual recovery", str(caught.exception))
			self.assertEqual(destination.read_bytes(), source.read_bytes())
			self.assertEqual(artifact.read_text(encoding="utf-8"), "recover me\n")

	def test_copy_rejects_a_canonical_source_symlink_but_link_mode_stays_live(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			referent = root / "canonical.md"
			referent.write_text("canonical\n", encoding="utf-8")
			source = root / "agent.md"
			source.symlink_to(referent)
			source_before = sync.sync_transaction.fingerprint_path(source)
			target = root / "copy-target"

			with self.assertRaisesRegex(SystemExit, "copy source contains a symlink"):
				sync.install_agent(source, target, "copy", force=False, dry_run=False)

			self.assertFalse(target.exists())
			self.assertEqual(sync.sync_transaction.fingerprint_path(source), source_before)
			self.assertEqual(referent.read_text(encoding="utf-8"), "canonical\n")
			self.assertFalse(list(root.rglob(".*.ggfincke-sync.*")))

			link_target = root / "link-target"
			sync.install_agent(source, link_target, "link", force=False, dry_run=False)
			destination = link_target / source.name
			self.assertTrue(destination.is_symlink())
			self.assertEqual(destination.resolve(), referent.resolve())

	def test_existing_user_file_requires_force(self) -> None:
		source = sync.AGENTS_DIR / "fable-orchestrator.md"
		with tempfile.TemporaryDirectory() as directory:
			target = Path(directory) / "agents"
			target.mkdir(parents=True)
			destination = target / source.name
			destination.write_text("user-owned\n", encoding="utf-8")

			skipped = sync.install_agent(source, target, "copy", force=False, dry_run=False)
			self.assertIn("skip existing", skipped)
			self.assertEqual(destination.read_text(encoding="utf-8"), "user-owned\n")

			sync.install_agent(source, target, "copy", force=True, dry_run=False)
			self.assertEqual(destination.read_bytes(), source.read_bytes())

	def test_forced_replacement_failure_retains_the_user_file(self) -> None:
		source = sync.AGENTS_DIR / "fable-orchestrator.md"
		with tempfile.TemporaryDirectory() as directory:
			target = Path(directory) / "agents"
			target.mkdir(parents=True)
			destination = target / source.name
			destination.write_text("user-owned\n", encoding="utf-8")

			with (
				mock.patch.object(
					sync.sync_transaction, "FileOps", return_value=PromoteFailureOps()
				),
				self.assertRaises(SystemExit),
			):
				sync.install_agent(source, target, "copy", force=True, dry_run=False)

			self.assertEqual(destination.read_text(encoding="utf-8"), "user-owned\n")
			self.assertFalse(list(target.glob(".*.ggfincke-sync.*")))


class AgentHomeCli(unittest.TestCase):
	def test_empty_claude_home_uses_the_default_home(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			home = Path(directory)
			env = dict(os.environ, HOME=str(home), CLAUDE_HOME="")
			result = support.run_script(
				SYNC_PATH,
				["--agent", "fable-orchestrator", "--dry-run"],
				env=env,
			)

			self.assertEqual(result.returncode, 0, result.stderr)
			self.assertEqual(
				result.stdout.splitlines()[0],
				f"[claude-agents] {(home / '.claude' / 'agents').resolve()}",
			)


if __name__ == "__main__":
	unittest.main()
