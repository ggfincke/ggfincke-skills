# tests/test_sync_skills.py
# sync safety: refuses self-overlap & project-lane traversal, never deletes source

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import support

sync = support.load_module("sync_skills", support.SCRIPTS_DIR / "sync-skills.py")
always_on = sync.always_on
SYNC_PATH = support.SCRIPTS_DIR / "sync-skills.py"


class FailFourthReplaceOps(sync.sync_transaction.FileOps):
	def __init__(self) -> None:
		self.replaces = 0

	def before(self, action: str, path: Path) -> None:
		if action != "replace":
			return
		self.replaces += 1
		if self.replaces == 4:
			raise OSError(f"injected second-root promote failure at {path}")


class PathGuards(unittest.TestCase):
	def test_is_within_repo_paths(self) -> None:
		self.assertTrue(sync.is_within(sync.SKILLS_DIR, sync.ROOT))
		self.assertTrue(sync.is_within(sync.ROOT, sync.ROOT))
		self.assertFalse(sync.is_within(Path("/tmp"), sync.ROOT))

	def test_assert_target_outside_repo_refuses_source_tree(self) -> None:
		with self.assertRaises(SystemExit):
			sync.assert_target_outside_repo(sync.SKILLS_DIR)
		with self.assertRaises(SystemExit):
			sync.assert_target_outside_repo(sync.ROOT)

	def test_assert_target_outside_repo_allows_external(self) -> None:
		with tempfile.TemporaryDirectory() as d:
			sync.assert_target_outside_repo(Path(d) / "skills")


class SelfOverlapNeverDeletes(unittest.TestCase):
	# copy+force where dest IS the source must refuse, leaving source intact
	def test_install_skill_refuses_self_overlap(self) -> None:
		with tempfile.TemporaryDirectory() as d:
			target_root = Path(d) / "skills"
			src = target_root / "demo-skill"
			src.mkdir(parents=True)
			(src / "SKILL.md").write_text("---\nname: demo-skill\ndescription: d\n---\n")

			with self.assertRaises(SystemExit):
				sync.install_skill(src, target_root, mode="copy", force=True, dry_run=False)

			self.assertTrue((src / "SKILL.md").is_file(), "source skill was destroyed")

	def test_existing_correct_symlink_stays_ok(self) -> None:
		# the self-overlap guard must not disturb a legit existing link-mode symlink
		with tempfile.TemporaryDirectory() as d:
			src = Path(d) / "src" / "demo-skill"
			src.mkdir(parents=True)
			(src / "SKILL.md").write_text("---\nname: demo-skill\ndescription: d\n---\n")
			target_root = Path(d) / "target"
			target_root.mkdir()
			dest = target_root / "demo-skill"
			dest.symlink_to(src, target_is_directory=True)

			result = sync.install_skill(src, target_root, mode="link", force=False, dry_run=False)
			self.assertIn("ok existing link", result)
			self.assertTrue(dest.is_symlink())
			self.assertEqual(dest.resolve(), src.resolve())


class CliRefusesDangerousTargets(unittest.TestCase):
	def test_codex_home_equal_repo_is_refused(self) -> None:
		# end-to-end: a misset CODEX_HOME pointing at the repo aborts before any write
		env = dict(os.environ, CODEX_HOME=str(sync.ROOT))
		result = support.run_script(
			SYNC_PATH,
			["--target", "codex", "--mode", "copy", "--force", "--dry-run", "--skip-always-on"],
			env=env,
		)
		self.assertNotEqual(result.returncode, 0)
		self.assertIn("inside this repo", result.stderr)
		# source skills are untouched
		self.assertTrue((sync.SKILLS_DIR / "comment-style" / "SKILL.md").is_file())

	def test_codex_home_equal_repo_is_refused_on_the_always_on_lane(self) -> None:
		# expand_targets('all') never yields codex, so only the instruction-file
		# guard can catch a misset CODEX_HOME here
		env = dict(os.environ, CODEX_HOME=str(sync.ROOT))
		result = support.run_script(
			SYNC_PATH,
			["--target", "all", "--mode", "link", "--dry-run"],
			env=env,
		)
		self.assertNotEqual(result.returncode, 0)
		self.assertIn("inside this repo", result.stderr)
		self.assertNotIn("always-on region", result.stdout)

	def test_instruction_file_symlinked_into_repo_is_refused(self) -> None:
		# the home can sit outside the repo while the instruction file inside it
		# symlinks back in - a dotfile-manager layout. write_text follows symlinks,
		# so checking only the home lets the write land on the repo's own AGENTS.md
		with tempfile.TemporaryDirectory() as d:
			home = Path(d)
			(home / ".codex").mkdir()
			(home / ".codex" / "AGENTS.md").symlink_to(sync.ROOT / "AGENTS.md")
			env = dict(
				os.environ,
				HOME=str(home),
				CODEX_HOME=str(home / ".codex"),
				AGENTS_HOME=str(home / ".agents"),
				CLAUDE_HOME=str(home / ".claude"),
			)
			result = support.run_script(
				SYNC_PATH, ["--target", "all", "--mode", "link", "--dry-run"], env=env
			)
			self.assertNotEqual(result.returncode, 0)
			self.assertIn("inside this repo", result.stderr)
			self.assertNotIn("always-on region", result.stdout)

	def test_project_repo_traversal_refused(self) -> None:
		with tempfile.TemporaryDirectory() as project:
			result = support.run_script(
				SYNC_PATH,
				["--project-repo", "../skills", "--project", project, "--dry-run"],
			)
			self.assertNotEqual(result.returncode, 0)
			self.assertNotIn("would copy", result.stdout)

	def test_project_repo_absolute_refused(self) -> None:
		with tempfile.TemporaryDirectory() as project:
			result = support.run_script(
				SYNC_PATH,
				["--project-repo", "/tmp/evil", "--project", project, "--dry-run"],
			)
			self.assertNotEqual(result.returncode, 0)

	def test_valid_project_repo_still_works(self) -> None:
		with tempfile.TemporaryDirectory() as project:
			result = support.run_script(
				SYNC_PATH,
				["--project-repo", "tierlistbuilder", "--project", project],
			)
			self.assertEqual(result.returncode, 0, result.stderr)
			installed = Path(project) / ".agents" / "skills" / "seed-example-sourcing"
			self.assertTrue(installed.is_dir())
			self.assertFalse((Path(project) / ".claude" / "skills").exists())
			helper_names = [
				"batch-sourcing-wf.template.js",
				"cover-sourcing-wf.template.js",
				"simulate-cover-surfaces.py",
			]
			skill_text = (installed / "SKILL.md").read_text()
			for helper_name in helper_names:
				relative = Path("scripts") / helper_name
				self.assertIn(f"]({relative.as_posix()})", skill_text)
				self.assertTrue((installed / relative).is_file())
			self.assertTrue(
				(
					Path(project)
					/ ".agents"
					/ "skills"
					/ "seed-example-sourcing"
					/ "scripts"
					/ "simulate-cover-surfaces.py"
				).is_file()
			)


class PruneOnlyTouchesOrphanedInstalls(unittest.TestCase):
	# --prune deletes, so the boundary that matters is what it leaves alone:
	# a live install & anything the user placed by hand
	def seed(self, root: Path) -> None:
		root.mkdir(parents=True)
		(root / "comment-style").symlink_to(sync.SKILLS_DIR / "comment-style")
		(root / "gone-upstream").symlink_to(sync.SKILLS_DIR / "gone-upstream")
		copy = root / "gone-copy"
		copy.mkdir()
		(copy / sync.SYNC_MARKER).write_text(f"installed from {sync.SKILLS_DIR / 'gone-copy'}\n")
		(root / "my-own-skill").mkdir()
		(root / "my-own-skill" / "SKILL.md").write_text("---\n")

	def pruned(self, lines: list[str], prefix: str) -> list[str]:
		return sorted(
			line.split()[-1].rsplit("/", 1)[-1] for line in lines if line.startswith(prefix)
		)

	def test_dry_run_lists_only_orphans_and_deletes_nothing(self) -> None:
		with tempfile.TemporaryDirectory() as d:
			root = Path(d) / "skills"
			self.seed(root)
			lines = sync.prune_target(root, sync.SKILLS_DIR, {"comment-style"}, dry_run=True)
			self.assertEqual(self.pruned(lines, "would prune"), ["gone-copy", "gone-upstream"])
			self.assertEqual(len(list(root.iterdir())), 4)

	def test_prune_removes_orphans_and_keeps_the_rest(self) -> None:
		with tempfile.TemporaryDirectory() as d:
			root = Path(d) / "skills"
			self.seed(root)
			sync.prune_target(root, sync.SKILLS_DIR, {"comment-style"}, dry_run=False)
			self.assertEqual(
				sorted(path.name for path in root.iterdir()), ["comment-style", "my-own-skill"]
			)
			self.assertTrue((sync.SKILLS_DIR / "comment-style" / "SKILL.md").is_file())

	def test_unprunable_skill_dirs_are_reported_not_silently_skipped(self) -> None:
		# leaving an unmarked legacy copy in place is correct, but saying nothing
		# reads as "nothing to prune" - the opposite of what happened
		with tempfile.TemporaryDirectory() as d:
			root = Path(d) / "skills"
			self.seed(root)
			lines = sync.prune_target(root, sync.SKILLS_DIR, {"comment-style"}, dry_run=True)
			skipped = [line for line in lines if "left alone" in line]
			self.assertTrue(skipped, lines)
			self.assertIn("my-own-skill", skipped[0])
			self.assertTrue(any("sync-copy-force" in line for line in lines))

	def test_copies_from_another_source_tree_are_never_pruned(self) -> None:
		# --project-repo --mode copy stamps SYNC_MARKER too, so a later portable
		# run into the same target root would read those project-only copies as
		# marker-carrying orphans. the marker's recorded source is what saves them
		with tempfile.TemporaryDirectory() as d:
			root = Path(d) / "skills"
			root.mkdir(parents=True)
			project_copy = root / "contract-propagation"
			project_copy.mkdir()
			(project_copy / "SKILL.md").write_text("---\n")
			(project_copy / sync.SYNC_MARKER).write_text(
				f"installed from {sync.PROJECTS_DIR / 'tierlistbuilder' / 'contract-propagation'}\n"
			)

			lines = sync.prune_target(root, sync.SKILLS_DIR, {"comment-style"}, dry_run=False)

			self.assertTrue(
				project_copy.is_dir(), "project-lane copy was pruned by the portable lane"
			)
			self.assertEqual(self.pruned(lines, "pruned"), [])
			self.assertTrue(any("left alone" in line for line in lines), lines)


class AlwaysOnRemovalPass(unittest.TestCase):
	# deleting the last always-on block repo-wide must retire the rules, not
	# strand them in every agent's instruction file forever
	def test_zero_blocks_removes_region_and_keeps_user_content(self) -> None:
		with tempfile.TemporaryDirectory() as d:
			home = Path(d) / "claude"
			home.mkdir()
			path = home / "CLAUDE.md"
			region = always_on.render_region([("demo-skill", "Demo", "be terse")])
			path.write_text(f"my own preamble\n\n{region}\n\nmy own trailer\n", encoding="utf-8")

			with (
				mock.patch.dict(os.environ, {"CLAUDE_HOME": str(home)}),
				mock.patch.object(sync, "collect_always_on", return_value=[]),
			):
				sync.sync_always_on(["claude"], dry_run=False)

			text = path.read_text(encoding="utf-8")
			self.assertNotIn(always_on.REGION_BEGIN, text)
			self.assertNotIn(always_on.REGION_END, text)
			self.assertIn("my own preamble", text)
			self.assertIn("my own trailer", text)


class AlwaysOnUpdatesAreAllOrNothing(unittest.TestCase):
	# refusing mid-loop leaves earlier agents on the new rules & later ones stale,
	# naming only the first bad file; every file is validated before any is written
	def test_one_malformed_file_blocks_every_write(self) -> None:
		with tempfile.TemporaryDirectory() as d:
			home = Path(d)
			for name in (".codex", ".agents", ".claude"):
				(home / name).mkdir()
			codex = home / ".codex" / "AGENTS.md"
			agents = home / ".agents" / "AGENTS.md"
			codex.write_text("my codex notes\n", encoding="utf-8")
			agents.write_text("my agents notes\n", encoding="utf-8")
			(home / ".claude" / "CLAUDE.md").write_text(
				f"my claude notes\n\n{always_on.REGION_BEGIN}\norphan\n", encoding="utf-8"
			)

			env = {
				"CODEX_HOME": str(home / ".codex"),
				"AGENTS_HOME": str(home / ".agents"),
				"CLAUDE_HOME": str(home / ".claude"),
			}
			with (
				mock.patch.dict(os.environ, env),
				self.assertRaises(SystemExit) as caught,
			):
				sync.sync_always_on(["codex", "agents", "claude"], dry_run=False)

			self.assertIn("CLAUDE.md", str(caught.exception))
			self.assertNotIn(always_on.REGION_BEGIN, codex.read_text(encoding="utf-8"))
			self.assertNotIn(always_on.REGION_BEGIN, agents.read_text(encoding="utf-8"))

	def test_instruction_symlink_is_preserved_while_its_referent_updates(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			home = root / "claude"
			home.mkdir()
			physical = root / "managed" / "CLAUDE.md"
			physical.parent.mkdir()
			physical.write_text("my notes\n", encoding="utf-8")
			logical = home / "CLAUDE.md"
			logical.symlink_to(physical)

			with (
				mock.patch.dict(os.environ, {"CLAUDE_HOME": str(home)}),
				mock.patch.object(
					sync, "collect_always_on", return_value=[("demo", "Demo", "rule")]
				),
			):
				sync.sync_always_on(["claude"], dry_run=False)

			self.assertTrue(logical.is_symlink())
			self.assertEqual(logical.resolve(), physical.resolve())
			self.assertIn(always_on.REGION_BEGIN, physical.read_text(encoding="utf-8"))


class SourceAndZeroBlockPreflight(unittest.TestCase):
	def test_direct_sync_of_invalid_selected_package_creates_no_target(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			source = root / "skills"
			skill = source / "demo-skill"
			skill.mkdir(parents=True)
			(skill / "SKILL.md").write_text(
				"---\nname: demo-skill\ndescription: d\nmodel: opus\n---\n",
				encoding="utf-8",
			)
			home = root / "codex"
			with (
				mock.patch.object(sync, "SKILLS_DIR", source),
				mock.patch.dict(os.environ, {"CODEX_HOME": str(home)}),
				mock.patch.object(
					sys,
					"argv",
					[
						"sync-skills.py",
						"--target",
						"codex",
						"--skill",
						"demo-skill",
						"--skip-always-on",
					],
				),
				self.assertRaises(SystemExit),
			):
				sync.main()

			self.assertFalse((home / "skills").exists())

	def test_unselected_malformed_always_on_source_blocks_selected_inventory(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			base = Path(directory) / "skills"
			good = base / "good"
			bad = base / "bad"
			good.mkdir(parents=True)
			bad.mkdir(parents=True)
			(good / "SKILL.md").write_text(
				"---\nname: good\ndescription: d\n---\n", encoding="utf-8"
			)
			(bad / "SKILL.md").write_text(
				"---\nname: bad\ndescription: d\n---\n<!-- always-on:end -->\n",
				encoding="utf-8",
			)
			with self.assertRaises(SystemExit):
				sync._inspect_source(base, ["good"], require_all=True)

	def test_malformed_instruction_preflight_blocks_forced_skill_replacement(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			source = root / "skills"
			skill = source / "demo-skill"
			skill.mkdir(parents=True)
			(skill / "SKILL.md").write_text(
				"---\nname: demo-skill\ndescription: d\n---\nnew\n", encoding="utf-8"
			)
			home = root / "codex"
			destination = home / "skills" / "demo-skill"
			destination.mkdir(parents=True)
			(destination / "SKILL.md").write_text("old\n", encoding="utf-8")
			home.mkdir(exist_ok=True)
			(home / "AGENTS.md").write_text(
				f"notes\n{always_on.REGION_BEGIN}\norphan\n", encoding="utf-8"
			)

			with (
				mock.patch.object(sync, "SKILLS_DIR", source),
				mock.patch.dict(os.environ, {"CODEX_HOME": str(home)}),
				mock.patch.object(
					sys,
					"argv",
					[
						"sync-skills.py",
						"--target",
						"codex",
						"--skill",
						"demo-skill",
						"--force",
					],
				),
				self.assertRaises(SystemExit),
			):
				sync.main()

			self.assertEqual((destination / "SKILL.md").read_text(), "old\n")
			self.assertFalse(list((home / "skills").glob(".*.ggfincke-sync.*")))

	def test_empty_portable_catalog_still_removes_generated_region(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			source = root / "skills"
			source.mkdir()
			home = root / "codex"
			home.mkdir()
			instruction = home / "AGENTS.md"
			region = always_on.render_region([("old", "Old", "old rule")])
			instruction.write_text(f"my notes\n\n{region}\n", encoding="utf-8")

			with (
				mock.patch.object(sync, "SKILLS_DIR", source),
				mock.patch.dict(os.environ, {"CODEX_HOME": str(home)}),
				mock.patch.object(sys, "argv", ["sync-skills.py", "--target", "codex"]),
			):
				code = sync.main()

			self.assertEqual(code, 0)
			self.assertNotIn(always_on.REGION_BEGIN, instruction.read_text(encoding="utf-8"))
			self.assertIn("my notes", instruction.read_text(encoding="utf-8"))

	def test_empty_catalog_refuses_a_removed_source_artifact(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			source = root / "skills"
			source.mkdir()
			home = root / "codex"
			target = home / "skills"
			target.mkdir(parents=True)
			artifact = target / ".removed-skill.ggfincke-sync.crashed.stage"
			artifact.mkdir()
			(artifact / "partial").write_text("recover me\n", encoding="utf-8")

			with (
				mock.patch.object(sync, "SKILLS_DIR", source),
				mock.patch.dict(os.environ, {"CODEX_HOME": str(home)}),
				mock.patch.object(
					sys,
					"argv",
					["sync-skills.py", "--target", "codex", "--skip-always-on"],
				),
				self.assertRaises(SystemExit) as caught,
			):
				sync.main()

			self.assertIn(str(artifact), str(caught.exception))
			self.assertIn("manual recovery", str(caught.exception))
			self.assertEqual((artifact / "partial").read_text(encoding="utf-8"), "recover me\n")

	def test_equivalent_symlinked_instruction_refuses_a_physical_stale_artifact(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			home = root / "codex"
			home.mkdir()
			physical = root / "managed" / "instructions.md"
			physical.parent.mkdir()
			items = [("demo", "Demo", "rule")]
			desired = always_on.apply_region("", always_on.render_region(items))
			physical.write_text(desired, encoding="utf-8")
			logical = home / "AGENTS.md"
			logical.symlink_to(physical)
			artifact = physical.parent / (f".{physical.name}.ggfincke-sync.crashed.backup")
			artifact.write_text("recover me\n", encoding="utf-8")

			with (
				mock.patch.dict(os.environ, {"CODEX_HOME": str(home)}),
				self.assertRaises(SystemExit) as caught,
			):
				sync.build_sync_plan(
					[],
					root / "skills",
					[],
					"copy",
					force=False,
					instruction_agents=["codex"],
					always_on_items=items,
				)

			self.assertIn(str(artifact), str(caught.exception))
			self.assertIn("manual recovery", str(caught.exception))
			self.assertTrue(logical.is_symlink())
			self.assertEqual(logical.resolve(), physical.resolve())
			self.assertEqual(physical.read_text(encoding="utf-8"), desired)
			self.assertEqual(artifact.read_text(encoding="utf-8"), "recover me\n")


class ApplyReportingMatchesCommittedState(unittest.TestCase):
	def test_later_root_failure_never_prints_rolled_back_action_as_success(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			source = root / "source" / "demo-skill"
			source.mkdir(parents=True)
			(source / "SKILL.md").write_text(
				"---\nname: demo-skill\ndescription: d\n---\nnew\n", encoding="utf-8"
			)
			targets = []
			for label in ("first", "second"):
				target = root / label
				destination = target / "demo-skill"
				destination.mkdir(parents=True)
				(destination / "SKILL.md").write_text("old\n", encoding="utf-8")
				targets.append((label, target))
			plan = sync.build_sync_plan([source], source.parent, targets, "copy", force=True)

			report = sync.sync_transaction.apply_plan(
				plan.transaction, ops=FailFourthReplaceOps(), run_id="test"
			)
			output = "\n".join(sync._report_lines(plan, report))

			self.assertFalse(report.success)
			self.assertIn("[first] copied demo-skill", output)
			self.assertNotIn("[second] copied demo-skill", output)
			self.assertIn("[second] failed", output)
			self.assertIn("new", (root / "first" / "demo-skill" / "SKILL.md").read_text())
			self.assertEqual((root / "second" / "demo-skill" / "SKILL.md").read_text(), "old\n")


class DistinctSymlinkInstallsRemainDistinctDestinations(unittest.TestCase):
	def test_multi_root_force_copy_replaces_links_to_the_same_source(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			source = root / "source" / "demo-skill"
			source.mkdir(parents=True)
			(source / "SKILL.md").write_text(
				"---\nname: demo-skill\ndescription: d\n---\ncanonical\n",
				encoding="utf-8",
			)
			targets = []
			for label in ("first", "second"):
				target = root / label
				target.mkdir()
				(target / "demo-skill").symlink_to(source, target_is_directory=True)
				targets.append((label, target))

			plan = sync.build_sync_plan([source], source.parent, targets, "copy", force=True)
			report = sync.sync_transaction.apply_plan(plan.transaction, run_id="test")

			self.assertTrue(report.success, report.events)
			for _, target in targets:
				destination = target / "demo-skill"
				self.assertFalse(destination.is_symlink())
				self.assertIn("canonical", (destination / "SKILL.md").read_text(encoding="utf-8"))
			self.assertIn("canonical", (source / "SKILL.md").read_text(encoding="utf-8"))
			self.assertFalse(list(root.rglob(".*.ggfincke-sync.*")))

	def test_multi_root_prune_removes_links_to_the_same_deleted_source(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			base_dir = root / "source"
			base_dir.mkdir()
			deleted_source = base_dir / "gone-upstream"
			targets = []
			for label in ("first", "second"):
				target = root / label
				target.mkdir()
				(target / "gone-upstream").symlink_to(deleted_source, target_is_directory=True)
				targets.append((label, target))

			plan = sync.build_sync_plan(
				[],
				base_dir,
				targets,
				"copy",
				force=False,
				prune_enabled=True,
				source_names=set(),
			)
			report = sync.sync_transaction.apply_plan(plan.transaction, run_id="test")

			self.assertTrue(report.success, report.events)
			for _, target in targets:
				self.assertFalse((target / "gone-upstream").is_symlink())
			self.assertFalse(list(root.rglob(".*.ggfincke-sync.*")))


if __name__ == "__main__":
	unittest.main()
