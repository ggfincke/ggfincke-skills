# tests/test_tooling_paths.py
# shared home and containment policy across skill and custom-agent sync

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import support

paths = support.load_module("tooling_paths", support.SCRIPTS_DIR / "tooling_paths.py")


class HomeResolution(unittest.TestCase):
	def test_absent_and_empty_values_use_the_default_home(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			home = Path(directory)
			self.assertEqual(
				paths.resolve_home("claude", environ={}, user_home=home),
				(home / ".claude").resolve(),
			)
			self.assertEqual(
				paths.resolve_home("claude", environ={"CLAUDE_HOME": ""}, user_home=home),
				(home / ".claude").resolve(),
			)

	def test_nonempty_values_expand_and_resolve(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			relative = Path.cwd() / "relative-home"
			self.assertEqual(
				paths.resolve_home("claude", environ={"CLAUDE_HOME": "relative-home"}),
				relative.resolve(),
			)
			self.assertEqual(
				paths.resolve_home("claude", environ={"CLAUDE_HOME": str(root / "absolute")}),
				(root / "absolute").resolve(),
			)

	def test_whitespace_is_a_literal_value(self) -> None:
		self.assertEqual(
			paths.resolve_home("claude", environ={"CLAUDE_HOME": "   "}),
			(Path.cwd() / "   ").resolve(),
		)

	def test_tilde_value_expands_from_the_process_home(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			home = Path(directory)
			with mock.patch.dict("os.environ", {"HOME": str(home)}):
				self.assertEqual(
					paths.resolve_home("claude", environ={"CLAUDE_HOME": "~/custom"}),
					(home / "custom").resolve(),
				)

	def test_claude_profile_precedence_keeps_instruction_and_state_paths_consistent(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			home = Path(directory).resolve()
			native = home / "native"
			legacy = home / "legacy"
			cases = (
				({"CLAUDE_CONFIG_DIR": str(native), "CLAUDE_HOME": str(legacy)}, native, native),
				({"CLAUDE_CONFIG_DIR": "", "CLAUDE_HOME": str(legacy)}, legacy, legacy),
				({"CLAUDE_CONFIG_DIR": "", "CLAUDE_HOME": ""}, home / ".claude", home),
			)
			for environ, config_home, state_home in cases:
				with self.subTest(environ=environ):
					self.assertEqual(
						paths.resolve_home("claude", environ=environ, user_home=home), config_home
					)
					self.assertEqual(
						paths.instruction_path("claude", environ=environ, user_home=home),
						config_home / "CLAUDE.md",
					)
					self.assertEqual(
						paths.claude_state_path(environ=environ, user_home=home),
						state_home / ".claude.json",
					)

	def test_agy_and_gemini_resolution(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			home = Path(directory).resolve()
			custom_agy = home / "custom-agy"
			custom_gemini = home / "custom-gemini"

			# default resolution
			self.assertEqual(
				paths.resolve_home("agy", environ={}, user_home=home),
				home / ".gemini" / "antigravity-cli",
			)
			self.assertEqual(
				paths.resolve_gemini_home(environ={}, user_home=home), home / ".gemini"
			)
			self.assertEqual(
				paths.instruction_path("agy", environ={}, user_home=home),
				home / ".gemini" / "GEMINI.md",
			)

			# AGY_HOME override
			self.assertEqual(
				paths.resolve_home("agy", environ={"AGY_HOME": str(custom_agy)}, user_home=home),
				custom_agy,
			)

			# GEMINI_HOME override propagates to agy home and instruction path
			self.assertEqual(
				paths.resolve_gemini_home(
					environ={"GEMINI_HOME": str(custom_gemini)}, user_home=home
				),
				custom_gemini,
			)
			self.assertEqual(
				paths.resolve_home(
					"agy", environ={"GEMINI_HOME": str(custom_gemini)}, user_home=home
				),
				custom_gemini / "antigravity-cli",
			)
			self.assertEqual(
				paths.instruction_path(
					"agy", environ={"GEMINI_HOME": str(custom_gemini)}, user_home=home
				),
				custom_gemini / "GEMINI.md",
			)


class TargetResolution(unittest.TestCase):
	def test_containment_uses_resolved_paths(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			outside = root / "outside"
			outside.mkdir()
			link = root / "link"
			link.symlink_to(outside, target_is_directory=True)
			self.assertTrue(paths.is_within(link / "child", outside))

	def test_instruction_write_target_preserves_the_logical_symlink(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			physical = root / "managed" / "AGENTS.md"
			physical.parent.mkdir()
			physical.write_text("notes\n", encoding="utf-8")
			logical = root / "AGENTS.md"
			logical.symlink_to(physical)

			self.assertEqual(paths.resolve_write_target(logical), physical.resolve())
			self.assertTrue(logical.is_symlink())


if __name__ == "__main__":
	unittest.main()
