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
            cs.python_prelude_len(["#!/usr/bin/env python3\n", "# -*- coding: utf-8 -*-\n", "x=1\n"]),
            2,
        )


class EncodingPreserved(unittest.TestCase):
    # the fixer must not eat a PEP 263 encoding declaration as a header line
    def test_encoding_line_survives_fix(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            cs.ROOT = Path(d).resolve()
            path = cs.ROOT / "enc.py"
            lines = ["# -*- coding: latin-1 -*-\n", "x = 1\n"]
            fixed, changed = cs.normalize_python_header(path, list(lines))
            self.assertTrue(changed)
            self.assertEqual(fixed[0], "# -*- coding: latin-1 -*-\n")
            self.assertEqual(fixed[1], "# enc.py\n")

    def test_shebang_and_encoding_survive_fix_end_to_end(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            path = root / "both.py"
            path.write_text("#!/usr/bin/env python3\n# -*- coding: utf-8 -*-\nx = 1\n")
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
    def test_python_root_outside_root(self) -> None:
        with tempfile.TemporaryDirectory() as inside, tempfile.TemporaryDirectory() as outside:
            (Path(outside) / "x.py").write_text("# x\nprint(1)\n")
            result = support.run_script(
                CHECKER,
                ["--check", "--python", "--root", inside, "--python-root", outside],
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("outside --root", result.stderr)
            self.assertNotIn("Traceback", result.stderr)


class SwiftToolingExemption(unittest.TestCase):
    # tooling comments must be exempt from the abbreviation check, like Python
    def _run_swift(self, body: str, root: Path) -> object:
        path = root / "Sample.swift"
        path.write_text(body)
        return support.run_script(
            CHECKER,
            ["--check", "--swift", "--root", str(root), "--swift-root", str(root)],
        )

    def test_swiftlint_comment_not_flagged_for_abbreviations(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            body = "// Sample.swift\n// does things\n// swiftlint:disable function_body_length\nlet x = 1\n"
            result = self._run_swift(body, root)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertNotIn("abbreviations", result.stdout)

    def test_ordinary_comment_still_flagged_for_abbreviations(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            body = "// Sample.swift\n// does things\n// the function runs\nlet x = 1\n"
            result = self._run_swift(body, root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("abbreviations", result.stdout)


if __name__ == "__main__":
    unittest.main()
