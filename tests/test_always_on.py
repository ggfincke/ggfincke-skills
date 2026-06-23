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


if __name__ == "__main__":
    unittest.main()
