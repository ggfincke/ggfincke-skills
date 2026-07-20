# tests/test_always_on.py
# ordered always-on parser: rejects malformed & delimiter-bearing blocks

from __future__ import annotations

import unittest

import support

always_on = support.load_module("always_on", support.SCRIPTS_DIR / "always_on.py")


class WellFormedBlock(unittest.TestCase):
    def test_valid_block_extracts_and_has_no_errors(self) -> None:
        text = (
            '<!-- always-on:start title="Comment style" -->\n'
            "- rule one\n- rule two\n"
            "<!-- always-on:end -->"
        )
        blocks, errors = always_on.parse_blocks(text)
        self.assertEqual(blocks, [("Comment style", "- rule one\n- rule two")])
        self.assertEqual(errors, [])

    def test_extract_and_marker_issues_share_one_parser(self) -> None:
        text = '<!-- always-on:start title="X" -->body<!-- always-on:end -->'
        # malformed -> no extracted block & a surfaced issue, never one w/o the other
        self.assertEqual(always_on.extract_blocks(text), [])
        self.assertTrue(always_on.marker_issues(text))


class MalformedFailsClosed(unittest.TestCase):
    # each case must emit at least one error & extract zero blocks
    def assert_fails_closed(self, text: str) -> None:
        blocks, errors = always_on.parse_blocks(text)
        self.assertEqual(blocks, [], f"unexpectedly extracted {blocks!r}")
        self.assertTrue(errors, "expected a marker error but got none")

    def test_same_line_body(self) -> None:
        self.assert_fails_closed('<!-- always-on:start title="X" -->body<!-- always-on:end -->')

    def test_end_before_start(self) -> None:
        self.assert_fails_closed('<!-- always-on:end -->\n<!-- always-on:start title="X" -->')

    def test_nested_starts(self) -> None:
        self.assert_fails_closed(
            '<!-- always-on:start title="A" -->\nb1\n'
            '<!-- always-on:start title="B" -->\nb2\n'
            "<!-- always-on:end -->\n<!-- always-on:end -->"
        )

    def test_missing_title(self) -> None:
        self.assert_fails_closed("<!-- always-on:start -->\nbody\n<!-- always-on:end -->")

    def test_unclosed_start(self) -> None:
        self.assert_fails_closed('<!-- always-on:start title="X" -->\nbody')

    def test_stray_end(self) -> None:
        self.assert_fails_closed("text\n<!-- always-on:end -->\nmore")


class GeneratedDelimiterRejection(unittest.TestCase):
    # region delimiters smuggled into content would corrupt later syncs
    def test_region_end_in_content(self) -> None:
        text = (
            '<!-- always-on:start title="X" -->\n'
            f"good\n{always_on.REGION_END}\n"
            "<!-- always-on:end -->"
        )
        blocks, errors = always_on.parse_blocks(text)
        self.assertEqual(blocks, [])
        self.assertTrue(any("generated-region" in e for e in errors))

    def test_region_begin_in_content(self) -> None:
        text = (
            '<!-- always-on:start title="X" -->\n'
            f"{always_on.REGION_BEGIN}\nbody\n"
            "<!-- always-on:end -->"
        )
        blocks, errors = always_on.parse_blocks(text)
        self.assertEqual(blocks, [])
        self.assertTrue(any("generated-region" in e for e in errors))


class ApplyRegionStaysIdempotent(unittest.TestCase):
    # w/ malformed blocks excluded, a clean render stays stable across syncs
    def test_double_apply_is_stable(self) -> None:
        # a block whose content carries the delimiter never reaches render via
        # extract_blocks; a clean region must round-trip to one begin/end pair
        clean = [("good-skill", "Good", "be terse")]
        region = always_on.render_region(clean)
        out1 = always_on.apply_region("preamble\n", region)
        out2 = always_on.apply_region(out1, region)
        self.assertEqual(out2.count(always_on.REGION_BEGIN), 1)
        self.assertEqual(out2.count(always_on.REGION_END), 1)
        self.assertEqual(out1, out2)
        # the malformed item is filtered out of extraction entirely
        bad_text = (
            '<!-- always-on:start title="Bad" -->\n'
            f"good\n{always_on.REGION_END}\ntrailing\n"
            "<!-- always-on:end -->"
        )
        self.assertEqual(always_on.extract_blocks(bad_text), [])


class RemoveRegionLeavesSurroundingContentIntact(unittest.TestCase):
    # a blanket .strip() de-indents the user's first line; where that line is a
    # 4-space Markdown code block it silently becomes a paragraph
    def test_leading_indent_survives_and_matches_apply_region(self) -> None:
        region = always_on.render_region([("demo-skill", "Demo", "be terse")])
        source = f"    indented code block\n\n{region}\n\nmy own trailer\n"

        removed = always_on.remove_region(source)
        applied = always_on.apply_region(source, region)

        self.assertTrue(removed.startswith("    indented code block"), repr(removed[:40]))
        self.assertTrue(applied.startswith("    indented code block"), repr(applied[:40]))
        self.assertNotIn(always_on.REGION_BEGIN, removed)
        self.assertIn("my own trailer", removed)


class ApplyRegionRefusesBrokenMarkers(unittest.TestCase):
    # a stray marker makes REGION_RE span the user's own prose, so substituting
    # would delete it; every unbalanced shape must refuse instead of writing
    def setUp(self) -> None:
        self.region = always_on.render_region([("good-skill", "Good", "be terse")])

    def assert_refuses(self, existing: str) -> None:
        with self.assertRaises(SystemExit):
            always_on.apply_region(existing, self.region)

    def test_orphan_begin(self) -> None:
        self.assert_refuses(
            f"{always_on.REGION_BEGIN}\nmy own notes\n\n{self.region}\n"
        )

    def test_two_complete_regions(self) -> None:
        self.assert_refuses(f"{self.region}\n\nmy own notes\n\n{self.region}\n")

    def test_begin_after_end(self) -> None:
        self.assert_refuses(
            f"{always_on.REGION_END}\nmy own notes\n{always_on.REGION_BEGIN}\n"
        )


if __name__ == "__main__":
    unittest.main()
