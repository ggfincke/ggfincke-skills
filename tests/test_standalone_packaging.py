# tests/test_standalone_packaging.py
# install consolidated packages alone and follow their complete local reference graphs

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from urllib.parse import unquote, urlsplit

import support

sync = support.load_module("standalone_sync", support.SCRIPTS_DIR / "sync-skills.py")
compiler = support.load_module(
	"reference_compiler", support.SCRIPTS_DIR / "compile-skill-references.py"
)


class StandalonePackaging(unittest.TestCase):
	def test_consolidated_and_review_skills_install_without_siblings(self) -> None:
		for name in (
			"react-best-practices",
			"frontend-workbench",
			"mega-review",
			"mega-review-core",
		):
			with self.subTest(skill=name), tempfile.TemporaryDirectory() as folder:
				root = Path(folder)
				sync.install_skill(support.REPO_ROOT / "skills" / name, root, "copy", False, False)
				inventory = sync.skill_inventory.inspect_candidates(
					sync.skill_inventory.discover_candidates(
						(sync.skill_inventory.SourceLane("portable", root),)
					)
				)
				self.assertFalse(inventory.issues, inventory.issues)
				self.assertEqual([package.name for package in inventory.packages], [name])
				package_root = root / name
				queue = [package_root / "SKILL.md"]
				visited = set()
				while queue:
					path = queue.pop().resolve()
					if path in visited:
						continue
					visited.add(path)
					self.assertIn(package_root.resolve(), path.parents)
					for destination, _ in sync.skill_inventory._explicit_destinations(
						path.read_text()
					):
						parts = urlsplit(destination.strip("<>"))
						if parts.scheme or parts.netloc or not parts.path:
							continue
						target = (path.parent / unquote(parts.path)).resolve()
						self.assertTrue(target.is_file(), target)
						self.assertIn(package_root.resolve(), target.parents)
						if target.suffix == ".md":
							queue.append(target)
				if name == "mega-review-core":
					self.assertTrue(any(path.name == "review-protocol.md" for path in visited))
					self.assertFalse(
						any(
							"security-remediation" in path.parts or "mega-review" in path.parts
							for path in visited
						)
					)

	def test_generated_collections_and_shared_protocol_match_authoritative_sources(self) -> None:
		package = support.REPO_ROOT / "skills/react-best-practices"
		for collection, title in compiler.COLLECTIONS.items():
			actual = (package / "references" / f"{collection}-rules.md").read_text()
			self.assertEqual(
				actual, compiler.compile_collection(package / "rules" / collection, title)
			)
		source = (
			support.REPO_ROOT / "skills/verify-review-findings/references/review-protocol.md"
		).read_text()
		for name in compiler.SHARED_REVIEW_CONSUMERS:
			copy = (
				support.REPO_ROOT / "skills" / name / "references/review-protocol.md"
			).read_text()
			self.assertEqual(copy.split("\n", 1)[1], source)


if __name__ == "__main__":
	unittest.main()
