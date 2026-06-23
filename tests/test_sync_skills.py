# tests/test_sync_skills.py
# sync safety: refuses self-overlap & project-lane traversal, never deletes source

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

import support

sync = support.load_module("sync_skills", support.SCRIPTS_DIR / "sync-skills.py")
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


if __name__ == "__main__":
    unittest.main()
