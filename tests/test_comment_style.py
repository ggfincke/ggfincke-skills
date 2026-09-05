# tests/test_comment_style.py
# comment-style checker: prelude preservation, root checks, tooling exemptions

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import support

cs = support.load_module("check_comment_style", support.COMMENT_STYLE_CHECKER)
CHECKER = support.COMMENT_STYLE_CHECKER


class PreludeDetection(unittest.TestCase):
	def test_prelude_len(self) -> None:
		self.assertEqual(cs.python_prelude_len(["x = 1\n"]), 0)
		self.assertEqual(cs.python_prelude_len(["#!/usr/bin/env python3\n", "x=1\n"]), 1)
		self.assertEqual(cs.python_prelude_len(["# -*- coding: utf-8 -*-\n", "x=1\n"]), 1)
		self.assertEqual(
			cs.python_prelude_len(
				["#!/usr/bin/env python3\n", "# -*- coding: utf-8 -*-\n", "x=1\n"]
			),
			2,
		)


class EncodingPreserved(unittest.TestCase):
	# the fixer must not eat a PEP 263 encoding declaration as a header line
	def test_encoding_line_survives_fix(self) -> None:
		with tempfile.TemporaryDirectory() as d:
			# ROOT is module state shared by every in-process test; restore it on the way out
			self.addCleanup(setattr, cs, "ROOT", cs.ROOT)
			cs.ROOT = Path(d).resolve()
			path = cs.ROOT / "enc.py"
			lines = [
				"# -*- coding: latin-1 -*-\n",
				"# wrong.py\n",
				"# parse encoded fixtures\n",
				"x = 1\n",
			]
			fixed, changed = cs.normalize_python_header(path, list(lines))
			self.assertTrue(changed)
			self.assertEqual(fixed[0], "# -*- coding: latin-1 -*-\n")
			self.assertEqual(fixed[1], "# enc.py\n")

	def test_shebang_and_encoding_survive_fix_end_to_end(self) -> None:
		with tempfile.TemporaryDirectory() as d:
			root = Path(d)
			path = root / "both.py"
			path.write_text(
				"#!/usr/bin/env python3\n"
				"# -*- coding: utf-8 -*-\n"
				"# wrong.py\n"
				"# parse encoded fixtures\n"
				"x = 1\n"
			)
			result = support.run_script(
				CHECKER,
				["--fix", "--python", "--root", str(root), "--python-root", str(root)],
			)
			self.assertEqual(result.returncode, 0, result.stderr)
			out = path.read_text().splitlines()
			self.assertEqual(out[0], "#!/usr/bin/env python3")
			self.assertEqual(out[1], "# -*- coding: utf-8 -*-")
			self.assertEqual(out[2], "# both.py")


class OutsideRootRejected(unittest.TestCase):
	# a scan root outside --root must be a clean CLI error, not a traceback
	def test_python_scope_outside_root(self) -> None:
		with tempfile.TemporaryDirectory() as inside, tempfile.TemporaryDirectory() as outside:
			path = Path(outside) / "x.py"
			body = "# x.py\n# outside fixture\n"
			path.write_text(body, encoding="utf-8")
			root_result = support.run_script(
				CHECKER,
				["--check", "--python", "--root", inside, "--python-root", outside],
			)
			file_result = support.run_script(
				CHECKER,
				["--fix", "--python", "--root", inside, "--python-file", str(path)],
			)
			for result in (root_result, file_result):
				self.assertEqual(result.returncode, 2)
				self.assertIn("outside --root", result.stderr)
				self.assertNotIn("Traceback", result.stderr)
			self.assertEqual(path.read_text(encoding="utf-8"), body)

	# an outside symlink stays untouched while an ordinary in-root file still gets fixed
	def test_swift_fix_skips_symlink_outside_root(self) -> None:
		with tempfile.TemporaryDirectory() as d:
			base = Path(d)
			root = base / "selected"
			root.mkdir()
			outside = base / "Outside.swift"
			original = b"// Outside.swift\n// preserve external fixture\n\nlet value = 1\n"
			outside.write_bytes(original)
			link = root / "Linked.swift"
			link.symlink_to(outside)
			inside = root / "Inside.swift"
			inside.write_text("// stale.swift\n// in-scope fixture\n\nlet value = 1\n")
			scope = ["--swift", "--root", str(root), "--swift-root", str(root)]

			fixed = support.run_script(CHECKER, ["--fix", *scope])
			self.assertEqual(fixed.returncode, 0, fixed.stdout + fixed.stderr)
			self.assertEqual(outside.read_bytes(), original)
			self.assertTrue(link.is_symlink())
			self.assertEqual(
				inside.read_text(), "// Inside.swift\n// in-scope fixture\n\nlet value = 1\n"
			)
			checked = support.run_script(CHECKER, ["--check", *scope])
			self.assertEqual(checked.returncode, 0, checked.stdout + checked.stderr)


class SwiftToolingExemption(unittest.TestCase):
	# tooling comments remain exempt from ordinary prose checks
	def _run_swift(self, body: str, root: Path) -> object:
		path = root / "Sample.swift"
		path.write_text(body)
		return support.run_script(
			CHECKER,
			["--check", "--swift", "--root", str(root), "--swift-root", str(root)],
		)

	def test_swiftlint_comment_is_exempt(self) -> None:
		with tempfile.TemporaryDirectory() as d:
			root = Path(d)
			body = "// Sample.swift\n// does things\n\n// swiftlint:disable function_body_length\nlet x = 1\n"
			result = self._run_swift(body, root)
			self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
			self.assertEqual(result.stdout, "")

	def test_ordinary_comment_accepts_natural_words(self) -> None:
		with tempfile.TemporaryDirectory() as d:
			root = Path(d)
			body = "// Sample.swift\n// does things\n\n// the function runs with parameters\nlet x = 1\n"
			result = self._run_swift(body, root)
			self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

	def test_valid_swift_syntax_is_not_prose(self) -> None:
		cases = (
			('let delimiter = "/*"\nlet raw = #"/* // */"#\n', 0),
			("/// Owns view state.\n@MainActor\nfinal class Model {}\n", 0),
			("/* ordinary prose */\nlet value = 1\n", 1),
		)
		with tempfile.TemporaryDirectory() as d:
			for source, expected in cases:
				with self.subTest(source=source):
					result = self._run_swift(
						"// Sample.swift\n// check syntax boundaries\n\n" + source, Path(d)
					)
					self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
					if expected:
						self.assertIn("use line comments, not block comments", result.stdout)


class SwiftMultilineStringSafety(unittest.TestCase):
	# a """ literal is program data: --fix must never rewrite it & --check must not report it.
	# the /// line inside the literal is the interesting case - it is not documentation, so no
	# fixer could ever clear a violation reported against it
	LITERAL = 'let usage = """\nUsage: // Do not remove this line.\n/// usage: run the tool\n"""\n'

	def test_multiline_literal_is_untouched(self) -> None:
		with tempfile.TemporaryDirectory() as d:
			root = Path(d)
			path = root / "Sample.swift"
			fixture = (
				"// Sample.swift\n"
				"// render usage text\n"
				"\n"
				f"{self.LITERAL}"
				"\n"
				"// Renders the banner\n"
				"func render() {}\n"
			)
			path.write_text(fixture, encoding="utf-8")
			scope = ["--swift", "--root", str(root), "--swift-root", str(root)]

			fixed = support.run_script(CHECKER, ["--fix", *scope])
			self.assertEqual(fixed.stderr, "")
			after = path.read_text(encoding="utf-8")
			# the literal survives byte for byte while the comment below it is still normalized,
			# so this fails if the fixer is skipping the file rather than respecting the literal
			self.assertIn(self.LITERAL, after)
			self.assertIn("// renders the banner\n", after)

			checked = support.run_script(CHECKER, ["--check", *scope])
			self.assertEqual(checked.stdout, "")
			self.assertEqual(checked.returncode, 0, checked.stderr)

	# the counterpart assertion: suppressing /// inside literals must not disable the rule
	# outright. without this, silencing swift_doc_violations entirely still passes the gate
	def test_doc_comment_rule_still_fires_outside_a_literal(self) -> None:
		with tempfile.TemporaryDirectory() as d:
			root = Path(d)
			body = "// Sample.swift\n// render usage text\n\n/// Runs the tool.\n@MainActor\nfunc run() {}\n"
			(root / "Sample.swift").write_text(body, encoding="utf-8")
			result = support.run_script(
				CHECKER,
				["--check", "--swift", "--root", str(root), "--swift-root", str(root)],
			)
			self.assertIn("belongs on types", result.stdout)
			self.assertEqual(result.returncode, 1, result.stdout)


class SwiftRawStringScanning(unittest.TestCase):
	# a bare """ inside a single-line raw string must not open a literal; a phantom open never
	# closes, so every later line of the file would be skipped by both --check & --fix
	def test_raw_string_does_not_open_a_literal(self) -> None:
		quad = 'let s = #"a """" b"#'
		self.assertEqual(cs.scan_swift_line(quad, None), (-1, None))
		self.assertEqual(cs.scan_swift_line('let s = #"a """ b"#', None), (-1, None))
		# a raw string whose content merely starts w/ a quote is not an opener either; an
		# opening `"""` is always the last thing on its line
		self.assertEqual(cs.scan_swift_line('let q = #"""#', None), (-1, None))
		self.assertEqual(cs.scan_swift_line('let q = ##"""##', None), (-1, None))
		# genuine openers, raw & plain, still carry their closing delimiter forward
		self.assertEqual(cs.scan_swift_line('let x = """', None), (-1, '"""'))
		self.assertEqual(cs.scan_swift_line('let x = ##"""', None), (-1, '"""##'))


class SwiftPreviewProviderScope(unittest.TestCase):
	# choosing a preview API depends on the deployment target, not comment style
	def test_preview_api_choice_is_outside_comment_style(self) -> None:
		with tempfile.TemporaryDirectory() as d:
			root = Path(d)
			path = root / "Sample.swift"
			scope = ["--check", "--swift", "--root", str(root), "--swift-root", str(root)]

			path.write_text(
				"// Sample.swift\n// preview helpers\n\n// migrating off PreviewProvider here\nlet x = 1\n",
				encoding="utf-8",
			)
			self.assertEqual(support.run_script(CHECKER, scope).stdout, "")

			path.write_text(
				"// Sample.swift\n// preview helpers\n\nstruct P: PreviewProvider {}\n",
				encoding="utf-8",
			)
			result = support.run_script(CHECKER, scope)
			self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class TestPathMatching(unittest.TestCase):
	# is_test_path mirrors isTestFile in block-doc-comments.js; the two enforcers of one
	# convention must agree on which files are test files
	def test_matches_the_eslint_definition(self) -> None:
		self.addCleanup(setattr, cs, "ROOT", cs.ROOT)
		cs.ROOT = Path("/repo")
		for relative in ("test/helper.py", "tests/helper.py", "e2e/helper.py", "a/thing.spec.py"):
			self.assertTrue(cs.is_test_path(Path("/repo") / relative), relative)
		self.assertFalse(cs.is_test_path(Path("/repo/src/helper.py")))


class PythonShebangGuard(unittest.TestCase):
	# `#!` is a shebang only on line 1; below it the token is a mis-spaced `!` tag
	def _check(self, body: str) -> object:
		with tempfile.TemporaryDirectory() as d:
			root = Path(d)
			(root / "sample.py").write_text(body, encoding="utf-8")
			return support.run_script(
				CHECKER,
				["--check", "--python", "--root", str(root), "--python-root", str(root)],
			)

	def test_midfile_bang_comment_is_flagged(self) -> None:
		result = self._check("# sample.py\n# tag guard fixture\nx = 1\n#! warn\n")
		self.assertIn("sample.py:4", result.stdout)
		self.assertEqual(result.returncode, 1)

	def test_line_one_shebang_stays_exempt(self) -> None:
		result = self._check("#!/usr/bin/env python3\n# sample.py\n# tag guard fixture\nx = 1\n")
		self.assertEqual(result.stdout, "")
		self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
	unittest.main()
