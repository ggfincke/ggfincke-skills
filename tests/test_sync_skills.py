# tests/test_sync_skills.py
# sync safety: refuses self-overlap & project-lane traversal, never deletes source

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import support

sync = support.load_module("sync_skills", support.SCRIPTS_DIR / "sync-skills.py")
always_on = sync.always_on
SYNC_PATH = support.SCRIPTS_DIR / "sync-skills.py"


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
				["--project-repo", "tierlistbuilder", "--project", project, "--dry-run"],
			)
			self.assertEqual(result.returncode, 0, result.stderr)
			self.assertIn("would copy", result.stdout)


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


if __name__ == "__main__":
	unittest.main()
