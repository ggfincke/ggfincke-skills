# tests/test_deployment_coherence.py
# protect coupled skill deployments, retained lanes, and manual instruction content

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import support

sync = support.load_module("coherent_sync", support.SCRIPTS_DIR / "sync-skills.py")
doctor = support.load_module("deployment_doctor", support.SCRIPTS_DIR / "doctor.py")


class FailInstructionOps(sync.sync_transaction.FileOps):
	def before(self, action: str, path: Path) -> None:
		if action == "replace" and path.name == "CLAUDE.md":
			raise OSError("injected instruction promotion failure")


class DeploymentCoherence(unittest.TestCase):
	def setUp(self) -> None:
		self.temp = tempfile.TemporaryDirectory()
		self.addCleanup(self.temp.cleanup)
		self.root = Path(self.temp.name).resolve()
		self.sources = self.root / "source"
		self.home = self.root / "claude"
		self.target = self.home / "skills"
		self.home.mkdir()
		self.instructions = self.home / "CLAUDE.md"
		self.instructions.write_text("manual instructions stay\n")
		patcher = mock.patch.dict(
			"os.environ",
			{"CLAUDE_HOME": str(self.home), "CLAUDE_CONFIG_DIR": str(self.home)},
		)
		patcher.start()
		self.addCleanup(patcher.stop)
		self.rule = self.source("rule", True)
		self.other = self.source("other", False)
		self.items = [("rule", "Rule", "- source rule")]

	def source(self, name: str, convention: bool) -> Path:
		path = self.sources / name
		path.mkdir(parents=True)
		body = f"---\nname: {name}\ndescription: demo\n---\n"
		if convention:
			body += '<!-- always-on:start title="Rule" -->\n- source rule\n<!-- always-on:end -->\n'
		(path / "SKILL.md").write_text(body)
		return path

	def plan(self, sources: list[Path], force: bool = False):
		return sync.build_sync_plan(
			sources,
			sources[0].parent,
			[("claude", self.target)],
			"copy",
			force,
			instruction_agents=["claude"],
			always_on_items=self.items,
		)

	def apply(self, plan) -> None:
		report = sync.sync_transaction.apply_plan(plan.transaction)
		self.assertTrue(report.success, report.events)

	def test_divergent_selected_and_retained_rules_block_instruction_advance(self) -> None:
		self.apply(self.plan([self.rule, self.other]))
		before = self.instructions.read_bytes()
		receipt = self.target / sync.skill_deployment.GENERATION_FILE
		before_receipt = receipt.read_bytes()
		(self.target / "rule/SKILL.md").write_text("locally changed rule\n")
		for selected in ([self.rule], [self.other]):
			with (
				self.subTest(selected=selected),
				self.assertRaisesRegex(SystemExit, "mixed-generation"),
			):
				self.plan(selected)
		self.assertEqual(self.instructions.read_bytes(), before)
		self.assertEqual(receipt.read_bytes(), before_receipt)

	def test_instruction_only_repair_rechecks_retained_packages(self) -> None:
		self.apply(self.plan([self.rule, self.other]))
		unchanged = self.plan([self.other])
		self.assertFalse(
			any(group.replacements or group.prunes for group in unchanged.transaction.destinations)
		)
		self.instructions.write_text(sync.always_on.remove_region(self.instructions.read_text()))
		before_instructions = self.instructions.read_bytes()
		receipt = self.target / sync.skill_deployment.GENERATION_FILE
		before_receipt = receipt.read_bytes()
		plan = self.plan([self.other])
		retained = self.target / "rule/SKILL.md"
		retained.write_text("concurrent local rule\n")

		report = sync.sync_transaction.apply_plan(plan.transaction)

		self.assertFalse(report.success)
		self.assertEqual(self.instructions.read_bytes(), before_instructions)
		self.assertEqual(receipt.read_bytes(), before_receipt)
		self.assertEqual(retained.read_text(), "concurrent local rule\n")

	def test_shared_installation_root_records_every_associated_host(self) -> None:
		claude_alias = self.root / "claude-alias"
		claude_alias.symlink_to(self.home, target_is_directory=True)
		with mock.patch.dict(
			"os.environ",
			{
				"AGENTS_HOME": str(self.home),
				"CLAUDE_CONFIG_DIR": str(claude_alias),
				"CODEX_HOME": str(self.root / "codex"),
			},
		):
			names = ["agents", "claude"]
			targets = sync.expand_targets(names, None)
			self.assertEqual(len(targets), 1)
			plan = sync.build_sync_plan(
				[self.rule],
				self.sources,
				targets,
				"copy",
				False,
				instruction_agents=sync.instruction_agents_for_targets(names),
				always_on_items=self.items,
			)
			self.apply(plan)
			receipt = json.loads((self.target / sync.skill_deployment.GENERATION_FILE).read_text())
			records = receipt["lanes"][str(self.sources)]["instructions"]
			self.assertEqual({record["agent"] for record in records}, {"codex", "agents", "claude"})
			for record in records:
				self.assertTrue(sync.always_on.REGION_RE.search(Path(record["path"]).read_text()))
			self.assertEqual(
				doctor.inspect_root(self.target, self.sources)["generation_status"], "verified"
			)
			self.instructions.write_text(
				sync.always_on.remove_region(self.instructions.read_text())
			)
			self.assertEqual(
				doctor.inspect_root(self.target, self.sources)["generation_status"], "drift"
			)

	def test_cross_lane_takeover_is_rejected_without_blocking_unrelated_installs(self) -> None:
		self.apply(self.plan([self.rule, self.other]))
		project_root = self.root / "project-source"
		for name in ("other", "project-only"):
			path = project_root / name
			path.mkdir(parents=True)
			(path / "SKILL.md").write_text(f"---\nname: {name}\ndescription: project-local\n---\n")
		self.apply(
			sync.build_sync_plan(
				[project_root / "project-only"],
				project_root,
				[("claude", self.target)],
				"copy",
				False,
			)
		)
		receipt_path = self.target / sync.skill_deployment.GENERATION_FILE
		receipt = json.loads(receipt_path.read_text())
		self.assertEqual(set(receipt["lanes"][str(project_root)]["packages"]), {"project-only"})
		self.assertEqual(
			doctor.inspect_root(self.target, self.sources)["generation_status"], "verified"
		)
		before = {
			path: path.read_bytes()
			for path in (receipt_path, self.target / "other/SKILL.md", self.instructions)
		}
		with self.assertRaisesRegex(SystemExit, "cross-lane takeover"):
			sync.build_sync_plan(
				[project_root / "other"],
				project_root,
				[("claude", self.target)],
				"copy",
				True,
			)
		for path, content in before.items():
			self.assertEqual(path.read_bytes(), content, path)

	def test_instruction_failure_restores_packages_receipt_and_manual_text(self) -> None:
		self.apply(self.plan([self.rule, self.other]))
		unrelated = self.target / "unrelated.txt"
		unrelated.write_text("user content")
		before = {
			path: path.read_bytes()
			for path in (
				self.instructions,
				self.target / "rule/SKILL.md",
				self.target / sync.skill_deployment.GENERATION_FILE,
				unrelated,
			)
		}
		(self.rule / "SKILL.md").write_text(
			(self.rule / "SKILL.md").read_text().replace("source rule", "new rule")
		)
		self.items = [("rule", "Rule", "- new rule")]
		report = sync.sync_transaction.apply_plan(
			self.plan([self.rule], force=True).transaction, ops=FailInstructionOps()
		)
		self.assertFalse(report.success)
		for path, content in before.items():
			self.assertEqual(path.read_bytes(), content, path)

	def test_lanes_and_manual_text_survive_and_doctor_detects_link_drift(self) -> None:
		self.apply(self.plan([self.rule, self.other]))
		project = self.root / "project-source" / "project-only"
		project.mkdir(parents=True)
		(project / "SKILL.md").write_text("---\nname: project-only\ndescription: local\n---\n")
		plan = sync.build_sync_plan(
			[project], project.parent, [("claude", self.target)], "link", False
		)
		self.apply(plan)
		receipt = json.loads((self.target / sync.skill_deployment.GENERATION_FILE).read_text())
		self.assertEqual(set(receipt["lanes"]), {str(self.sources), str(project.parent)})
		self.assertIn("manual instructions stay", self.instructions.read_text())
		self.assertEqual(
			doctor.inspect_root(self.target, self.sources)["generation_status"], "verified"
		)
		(project / "SKILL.md").write_text((project / "SKILL.md").read_text() + "new source\n")
		self.assertEqual(
			doctor.inspect_root(self.target, self.sources)["generation_status"], "drift"
		)


if __name__ == "__main__":
	unittest.main()
