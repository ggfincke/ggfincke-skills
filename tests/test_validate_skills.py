# tests/test_validate_skills.py
# skill validation: layout contract & strict frontmatter

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import support

vs = support.load_module("validate_skills", support.SCRIPTS_DIR / "validate-skills.py")
VALIDATE_PATH = support.SCRIPTS_DIR / "validate-skills.py"


def make_skill(root: Path, name: str, body: str) -> Path:
    skill = root / name
    skill.mkdir(parents=True, exist_ok=True)
    (skill / "SKILL.md").write_text(body)
    return skill


def errors(issues) -> list[str]:
    return [i.message for i in issues if not i.is_warning]


class FrontmatterStrictness(unittest.TestCase):
    BODY = "---\nname: demo-skill\ndescription: d\nmodel: opus\n---\nbody\n"

    def test_extra_field_is_error_under_strict(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            skill = make_skill(Path(d), "demo-skill", self.BODY)
            msgs = errors(vs.validate_skill(skill, strict_frontmatter=True))
            self.assertTrue(any("non-portable frontmatter" in m for m in msgs))

    def test_extra_field_is_warning_under_lenient(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            skill = make_skill(Path(d), "demo-skill", self.BODY)
            issues = vs.validate_skill(skill, strict_frontmatter=False)
            fm = [i for i in issues if "non-portable" in i.message]
            self.assertTrue(fm and all(i.is_warning for i in fm))


class BannedReadme(unittest.TestCase):
    def test_readme_in_skill_folder_is_error(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            skill = make_skill(Path(d), "demo-skill", "---\nname: demo-skill\ndescription: d\n---\n")
            (skill / "README.md").write_text("# nope")
            msgs = errors(vs.readme_issues(skill))
            self.assertTrue(any("README" in m for m in msgs))

    def test_nested_readme_is_error(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            skill = make_skill(Path(d), "demo-skill", "---\nname: demo-skill\ndescription: d\n---\n")
            (skill / "references").mkdir()
            (skill / "references" / "readme.md").write_text("# nope")
            self.assertTrue(errors(vs.readme_issues(skill)))


class ResourceLinks(unittest.TestCase):
    def test_missing_reference_is_flagged(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            skill = make_skill(
                Path(d),
                "demo-skill",
                "---\nname: demo-skill\ndescription: d\n---\nSee references/missing.md\n",
            )
            (skill / "references").mkdir()
            (skill / "references" / "present.md").write_text("ok")
            msgs = errors(vs.resource_link_issues(skill, skill / "SKILL.md"))
            self.assertTrue(any("references/missing.md" in m for m in msgs))

    def test_present_reference_is_ok(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            skill = make_skill(
                Path(d),
                "demo-skill",
                "---\nname: demo-skill\ndescription: d\n---\nSee references/present.md\n",
            )
            (skill / "references").mkdir()
            (skill / "references" / "present.md").write_text("ok")
            self.assertEqual(errors(vs.resource_link_issues(skill, skill / "SKILL.md")), [])

    def test_target_repo_paths_are_not_checked(self) -> None:
        # a project skill pointing at a target repo (no local references/assets dir)
        # must never be flagged, even when it mentions references/ or assets/ words
        with tempfile.TemporaryDirectory() as d:
            skill = make_skill(
                Path(d),
                "demo-skill",
                "---\nname: demo-skill\ndescription: d\n---\n"
                "Edit convex/schema.ts and references/whatever.md and assets/thing.js\n",
            )
            self.assertEqual(errors(vs.resource_link_issues(skill, skill / "SKILL.md")), [])


class RealRepoStaysClean(unittest.TestCase):
    def test_strict_default_passes(self) -> None:
        result = support.run_script(VALIDATE_PATH, [])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Validated", result.stdout)


if __name__ == "__main__":
    unittest.main()
