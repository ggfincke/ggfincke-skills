# tests/test_sync_agents.py
# custom-agent sync safety: validate names, preserve user files, & refuse source overlap

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import support


sync = support.load_module("sync_agents", support.SCRIPTS_DIR / "sync-agents.py")


class AgentValidation(unittest.TestCase):
	def test_canonical_agents_have_matching_frontmatter_names(self) -> None:
		agents = sync.find_agents([])
		self.assertTrue(agents)
		self.assertEqual([sync.agent_name(path) for path in agents], [path.stem for path in agents])


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


if __name__ == "__main__":
	unittest.main()
