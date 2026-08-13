# tests/test_skill_inventory.py
# pure skill inventory discovery, selection, package policy & Markdown links

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import support

inventory = support.load_module("skill_inventory", support.SCRIPTS_DIR / "skill_inventory.py")


def make_skill(root: Path, name: str, body: str | None = None) -> Path:
	skill = root / name
	skill.mkdir(parents=True, exist_ok=True)
	if body is not None:
		(skill / "SKILL.md").write_text(body, encoding="utf-8")
	return skill


def valid_body(name: str, content: str = "") -> str:
	return f"---\nname: {name}\ndescription: test skill\n---\n{content}"


def codes(result: inventory.SkillInventory) -> set[str]:
	return {issue.code for issue in result.issues if not issue.is_warning}


class CandidateDiscoveryAndSelection(unittest.TestCase):
	def test_visible_candidates_precede_entrypoint_validation_and_keep_lane_identity(self) -> None:
		with tempfile.TemporaryDirectory() as temporary:
			root = Path(temporary)
			portable_root = root / "skills"
			project_root = root / "projects" / "demo"
			make_skill(portable_root, "shared", valid_body("shared"))
			make_skill(portable_root, "missing")
			make_skill(portable_root, ".hidden", valid_body("hidden"))
			make_skill(project_root, "shared", valid_body("shared"))

			lanes = (
				inventory.SourceLane("portable", portable_root),
				inventory.SourceLane("project", project_root, "demo"),
			)
			candidates = inventory.discover_candidates(lanes)

			self.assertEqual(
				[(item.key.lane_kind, item.key.project_repo, item.key.name) for item in candidates],
				[
					("portable", None, "missing"),
					("portable", None, "shared"),
					("project", "demo", "shared"),
				],
			)
			inspected = inventory.inspect_candidates(candidates)
			missing = next(item for item in inspected.issues if item.code == "missing-entrypoint")
			self.assertEqual(missing.key.name, "missing")

			selected = inventory.select_inventory(inspected, ["shared", "absent"], portable_root)
			self.assertEqual(len(selected.candidates), 2)
			self.assertEqual(
				{item.candidate.key.lane_kind for item in selected.packages},
				{"portable", "project"},
			)
			self.assertIn("missing-selection", codes(selected))
			self.assertNotIn("missing-entrypoint", codes(selected))


class PackagePolicy(unittest.TestCase):
	def test_strictness_name_readme_and_always_on_policy_share_one_inspection(self) -> None:
		with tempfile.TemporaryDirectory() as temporary:
			project_root = Path(temporary) / "projects" / "demo"
			skill = make_skill(
				project_root,
				"demo-skill",
				valid_body(
					"wrong-name",
					"model: ignored\n"
					'<!-- always-on:start title="Project rule" -->\nrule\n'
					"<!-- always-on:end -->\n",
				).replace("description: test skill\n", "description: test skill\nmodel: opus\n"),
			)
			(skill / "references").mkdir()
			(skill / "references" / "README.md").write_text("# banned", encoding="utf-8")
			candidate = inventory.discover_candidates(
				(inventory.SourceLane("project", project_root, "demo"),)
			)[0]

			strict = inventory.inspect_candidates((candidate,), strict_frontmatter=True)
			self.assertTrue({"frontmatter", "banned-readme"}.issubset(codes(strict)))
			self.assertTrue(
				any(
					issue.code == "project-always-on" and issue.is_warning
					for issue in strict.issues
				)
			)

			lenient = inventory.inspect_candidates((candidate,), strict_frontmatter=False)
			extra_field = [
				issue
				for issue in lenient.issues
				if issue.code == "frontmatter" and "non-portable" in issue.message
			]
			self.assertTrue(extra_field and all(issue.is_warning for issue in extra_field))

	def test_malformed_always_on_marker_blocks_a_package(self) -> None:
		with tempfile.TemporaryDirectory() as temporary:
			root = Path(temporary) / "skills"
			make_skill(root, "demo-skill", valid_body("demo-skill", "<!-- always-on:end -->\n"))
			candidate = inventory.discover_candidates((inventory.SourceLane("portable", root),))[0]

			result = inventory.inspect_candidates((candidate,))

			self.assertIn("always-on-marker", codes(result))
			self.assertEqual(result.packages, ())

	def test_invalid_folder_name_is_reported_even_when_frontmatter_matches(self) -> None:
		with tempfile.TemporaryDirectory() as temporary:
			root = Path(temporary) / "skills"
			make_skill(root, "Bad_Name", valid_body("Bad_Name"))
			candidate = inventory.discover_candidates((inventory.SourceLane("portable", root),))[0]

			result = inventory.inspect_candidates((candidate,))

			self.assertIn("invalid-name", codes(result))

	def test_package_symlinks_are_blocking_and_not_followed(self) -> None:
		with tempfile.TemporaryDirectory() as temporary:
			root = Path(temporary)
			secret_text = "UNIQUE_SECRET_PAYLOAD_do_not_surface"
			outside = root / "outside"
			outside.mkdir()
			secret = outside / "secret.md"
			secret.write_text(f"[leak]({secret_text})\n", encoding="utf-8")
			nested = outside / "nested"
			nested.mkdir()
			(nested / "README.md").write_text(f"[leak]({secret_text})\n", encoding="utf-8")

			skills = root / "skills"
			skill = make_skill(skills, "demo-skill", valid_body("demo-skill"))
			references = skill / "references"
			references.mkdir()
			(references / "leaked.md").symlink_to(secret)
			(references / "leaked-dir").symlink_to(nested)

			candidate = inventory.discover_candidates((inventory.SourceLane("portable", skills),))[
				0
			]
			result = inventory.inspect_candidates((candidate,))

			symlink_issues = [issue for issue in result.issues if issue.code == "package-symlink"]
			self.assertIn("package-symlink", codes(result))
			self.assertEqual(
				{issue.path.name for issue in symlink_issues}, {"leaked.md", "leaked-dir"}
			)
			self.assertNotIn("banned-readme", codes(result))
			rendered = "\n".join(
				f"{issue.path}:{issue.line}:{issue.code}:{issue.message}" for issue in result.issues
			)
			self.assertNotIn(secret_text, rendered)


class MarkdownLinks(unittest.TestCase):
	def test_all_package_markdown_accepts_files_helpers_images_and_anchors(self) -> None:
		with tempfile.TemporaryDirectory() as temporary:
			root = Path(temporary) / "skills"
			skill = make_skill(
				root,
				"demo-skill",
				valid_body(
					"demo-skill",
					"[Guide](references/guide.md#repeat-1)\n"
					"[Spaces](references/guide.md#multi--space)\n"
					"![Image](assets/image.png)\n"
					"[Parentheses](scripts/helper(test).py)\n"
					"[helper]: scripts/helper.py\n",
				),
			)
			(skill / "references").mkdir()
			(skill / "references" / "guide.md").write_text(
				'# Repeat\n# Repeat\n# Multi  Space\n<a name="manual-anchor"></a>\n'
				"[Helper](../scripts/helper.py)\n[Self](#manual-anchor)\n",
				encoding="utf-8",
			)
			(skill / "scripts").mkdir()
			(skill / "scripts" / "helper.py").write_text("print('ok')\n", encoding="utf-8")
			(skill / "scripts" / "helper(test).py").write_text("print('ok')\n", encoding="utf-8")
			(skill / "assets").mkdir()
			(skill / "assets" / "image.png").write_bytes(b"image")
			candidate = inventory.discover_candidates((inventory.SourceLane("portable", root),))[0]

			result = inventory.inspect_candidates((candidate,))

			self.assertEqual(inventory.blocking_issues(result), ())
			self.assertEqual(len(result.packages), 1)

	def test_missing_files_anchors_and_package_escapes_are_reported_with_lines(self) -> None:
		with tempfile.TemporaryDirectory() as temporary:
			root = Path(temporary) / "skills"
			skill = make_skill(
				root,
				"demo-skill",
				valid_body(
					"demo-skill",
					"[Missing](references/missing.md)\n"
					"[Anchor](references/guide.md#absent)\n"
					"[Escape](../../outside.md)\n",
				),
			)
			(skill / "references").mkdir()
			(skill / "references" / "guide.md").write_text("# Present\n", encoding="utf-8")
			(skill / "references" / "nested.md").write_text(
				"[Missing helper]: ../scripts/missing.py\n", encoding="utf-8"
			)
			candidate = inventory.discover_candidates((inventory.SourceLane("portable", root),))[0]

			result = inventory.inspect_candidates((candidate,))

			self.assertEqual(codes(result), {"broken-local-link", "missing-anchor", "link-escape"})
			self.assertTrue(all(issue.line is not None for issue in result.issues))
			self.assertTrue(any(issue.path.name == "nested.md" for issue in result.issues))

	def test_setext_headings_resolve_both_levels_and_duplicates_but_not_indented_code(
		self,
	) -> None:
		with tempfile.TemporaryDirectory() as temporary:
			root = Path(temporary) / "skills"
			skill = make_skill(
				root,
				"demo-skill",
				valid_body(
					"demo-skill",
					"[Level one](references/guide.md#level-one)\n"
					"[Level two](references/guide.md#level-two)\n"
					"[Duplicate](references/guide.md#level-one-1)\n"
					"[Quoted ATX](references/guide.md#quoted-atx)\n"
					"[List ATX](references/guide.md#list-atx)\n"
					"[Quoted Setext](references/guide.md#quoted-setext)\n"
					"[Space indented](references/guide.md#space-indented)\n"
					"[Tab indented](references/guide.md#tab-indented)\n",
				),
			)
			(skill / "references").mkdir()
			(skill / "references" / "guide.md").write_text(
				"Level one\n===\nLevel two\n---\nLevel one\n===\n\n"
				"> # Quoted ATX\n\n- # List ATX\n\n> Quoted Setext\n> ---\n\n"
				"    Space indented\n---\n\tTab indented\n---\n",
				encoding="utf-8",
			)
			candidate = inventory.discover_candidates((inventory.SourceLane("portable", root),))[0]

			result = inventory.inspect_candidates((candidate,))

			missing_anchors = [issue for issue in result.issues if issue.code == "missing-anchor"]
			self.assertEqual(codes(result), {"missing-anchor"})
			self.assertEqual(len(missing_anchors), 2)
			self.assertTrue(any("#space-indented" in issue.message for issue in missing_anchors))
			self.assertTrue(any("#tab-indented" in issue.message for issue in missing_anchors))
			boundary_guide = skill / "references" / "container-boundaries.md"
			boundary_guide.write_text(
				"Top quote\n> ---\n\n"
				"> Quote top\n---\n\n"
				"Top list\n- ---\n\n"
				"Top item\n- -\n\n"
				"Top thematic\n- - -\n",
				encoding="utf-8",
			)
			anchors, error = inventory._anchors_for(boundary_guide, {})
			self.assertIsNone(error)
			self.assertEqual(anchors, set())
			list_guide = skill / "references" / "list-boundaries.md"
			list_guide.write_text(
				"-    # Four Spaces\n"
				"-     # Five Spaces\n"
				"-\t # Four Columns\n"
				"-\t  # Five Columns\n\n"
				"paragraph\n2. # Ordered Ghost\n\n"
				"paragraph\n1. # Ordered Real\n",
				encoding="utf-8",
			)
			list_anchors, list_error = inventory._anchors_for(list_guide, {})
			self.assertIsNone(list_error)
			self.assertEqual(list_anchors, {"four-spaces", "four-columns", "ordered-real"})

	def test_code_external_absolute_and_unlinked_target_repo_text_are_ignored(self) -> None:
		with tempfile.TemporaryDirectory() as temporary:
			root = Path(temporary) / "skills"
			make_skill(
				root,
				"demo-skill",
				valid_body(
					"demo-skill",
					"`[inline](scripts/missing.py)`\n"
					"```markdown\n[fenced](references/missing.md)\n```\n"
					"\\[Escaped](scripts/missing.py)\n"
					"[^note]: explanatory text is not a link destination\n"
					"[External](https://example.com/missing.md)\n"
					"[Absolute](/target/repo/file.md)\n"
					"Edit scripts/missing.py and references/missing.md in the target repo.\n",
				),
			)
			candidate = inventory.discover_candidates((inventory.SourceLane("portable", root),))[0]

			result = inventory.inspect_candidates((candidate,))

			self.assertEqual(inventory.blocking_issues(result), ())

	def test_html_blocks_and_reference_definitions_do_not_create_heading_anchors(self) -> None:
		with tempfile.TemporaryDirectory() as temporary:
			root = Path(temporary) / "skills"
			skill = make_skill(
				root,
				"demo-skill",
				valid_body(
					"demo-skill",
					"[Block id](references/guide.md#block-anchor)\n"
					"[Inline id](references/guide.md#inline-anchor)\n"
					"[Script id](references/guide.md#script-anchor)\n"
					"[After reference](references/guide.md#after-reference)\n"
					"[Interrupting block](references/guide.md#interrupted-html-atx)\n"
					"[Self-closing block](references/guide.md#self-closing-html-atx)\n"
					"[HTML Setext](references/guide.md#html-setext)\n"
					"[HTML ATX](references/guide.md#html-atx)\n"
					"[Comment Setext](references/guide.md#comment-setext)\n"
					"[Comment ATX](references/guide.md#comment-atx)\n"
					"[Reference](references/guide.md#reference-title)\n"
					"[Inline code id](references/guide.md#inline-code-id)\n"
					"[Comment id](references/guide.md#comment-id)\n"
					"[Script content id](references/guide.md#script-content-id)\n"
					"[Space-indented id](references/guide.md#space-indented-id)\n"
					"[Tab-indented id](references/guide.md#tab-indented-id)\n"
					"[Escaped id](references/guide.md#escaped-id)\n"
					"[Link label id](references/guide.md#link-label-id)\n"
					"[Valid inline id](references/guide.md#valid-inline)\n"
					"[Reference ghost](references/guide.md#reference-ghost)\n"
					"[Continued ghost](references/guide.md#continued-ghost)\n"
					"[Inline ghost](references/guide.md#inline-ghost)\n"
					"[Image ghost](references/guide.md#image-ghost)\n"
					"[Invalid equals](references/guide.md#invalid-equals)\n"
					"[Invalid slash](references/guide.md#invalid-slash)\n"
					"[Invalid quote](references/guide.md#invalid-quote)\n"
					"[Multiline reference ghost](references/guide.md#multiline-ref-ghost)\n"
					"[Matched full image](references/guide.md#matched-full-image)\n"
					"[Unmatched full image](references/guide.md#unmatched-full-image)\n"
					"[Matched collapsed image](references/guide.md#matched-collapsed-image)\n"
					"[Unmatched collapsed image](references/guide.md#unmatched-collapsed-image)\n"
					"[Matched shortcut image](references/guide.md#matched-shortcut-image)\n"
					"[Unmatched shortcut image](references/guide.md#unmatched-shortcut-image)\n"
					"[Matched reference suffix](references/guide.md#matched-ref-suffix)\n"
					"[Unmatched reference suffix](references/guide.md#unmatched-ref-suffix)\n"
					"[First duplicate id](references/guide.md#first-duplicate-id)\n"
					"[Second duplicate id](references/guide.md#second-duplicate-id)\n"
					"[First duplicate name](references/guide.md#first-duplicate-name)\n"
					"[Second duplicate name](references/guide.md#second-duplicate-name)\n"
					"[Iframe outer](references/guide.md#iframe-outer)\n"
					"[Iframe ghost](references/guide.md#iframe-ghost)\n"
					"[Title outer](references/guide.md#title-outer)\n"
					"[Title ghost](references/guide.md#title-ghost)\n"
					"[Even escaped id](references/guide.md#even-escaped-id)\n"
					"[Quote boundary](references/guide.md#quote-boundary-visible)\n"
					"[List boundary](references/guide.md#list-boundary-visible)\n"
					"[Backslash reference](references/guide.md#backslash-ref-visible)\n"
					"[Backslash image](references/guide.md#backslash-image-visible)\n"
					"[Entity reference](references/guide.md#entity-ref-visible)\n"
					"[Quoted fence ghost](references/guide.md#quoted-fence-ghost)\n"
					"[List fence ghost](references/guide.md#list-fence-ghost)\n"
					"[Quoted code ghost](references/guide.md#quoted-code-ghost)\n"
					"[Quoted HTML ghost](references/guide.md#quoted-html-ghost)\n"
					"[Self-closing script outer](references/guide.md#self-script-outer)\n"
					"[Self-closing script ghost](references/guide.md#self-script-ghost)\n"
					"[Self-closing textarea outer](references/guide.md#self-textarea-outer)\n"
					"[Self-closing textarea ghost](references/guide.md#self-textarea-ghost)\n",
				),
			)
			(skill / "references").mkdir()
			(skill / "references" / "guide.md").write_text(
				'<div id="block-anchor">\nHTML Setext\n---\n</div>\n\n'
				"Paragraph\n<hgroup>\n# Interrupted HTML ATX\n</hgroup>\n\n"
				"<script/>\n# Self-closing HTML ATX\n\n"
				"<div>\n# HTML ATX\n</div>\n\n"
				'<!--\nComment Setext\n---\n# Comment ATX\n<a id="comment-id"></a>\n-->\n\n'
				"[Reference title]: /target\n---\n\n"
				"[Other reference]: /target\nAfter reference\n---\n\n"
				'<p>Text <span id="inline-anchor"></span></p>\n\n'
				'`<span id="inline-code-id"></span>`\n\n'
				'<script id="script-anchor">\n<a id="script-content-id"></a>\n</script>\n'
				'    <a id="space-indented-id"></a>\n'
				'\t<a id="tab-indented-id"></a>\n'
				'\\<a id="escaped-id"></a>\n\n'
				"[ghost]: /target \"<a id='reference-ghost'></a>\"\n"
				"[continued]:\n  /target\n  '<a id=\"continued-ghost\"></a>'\n\n"
				'[<span id="link-label-id">label</span>]'
				"(/target \"<span id='inline-ghost'></span>\")\n"
				'![<span id="image-ghost">alt</span>](/image.png)\n'
				'<a id="valid-inline"></a>\n'
				'<a id="invalid-equals" foo==>\n'
				'<a id="invalid-slash" / garbage>\n'
				'<a id="invalid-quote" "bad">\n\n'
				'[multiline]: /target "title\n'
				'  <a id=multiline-ref-ghost></a>"\n\n'
				"[image]: /image\n\n"
				'![<span id="matched-full-image"></span>][image]\n'
				'![<span id="unmatched-full-image"></span>][missing-image]\n\n'
				'[<span id="matched-collapsed-image"></span>]: /image\n\n'
				'![<span id="matched-collapsed-image"></span>][]\n'
				'![<span id="unmatched-collapsed-image"></span>][]\n\n'
				'[<span id="matched-shortcut-image"></span>]: /image\n\n'
				'![<span id="matched-shortcut-image"></span>]\n'
				'![<span id="unmatched-shortcut-image"></span>]\n\n'
				'[body][<span id="matched-ref-suffix"></span>]\n\n'
				'[<span id="matched-ref-suffix"></span>]: /target\n\n'
				'[body][<span id="unmatched-ref-suffix"></span>]\n\n'
				'<a id="first-duplicate-id" id="second-duplicate-id"></a>\n'
				'<a name="first-duplicate-name" NAME="second-duplicate-name"></a>\n\n'
				'<iframe id="iframe-outer">\n<a id="iframe-ghost"></a>\n</iframe>\n\n'
				'<title id="title-outer"><a id="title-ghost"></a></title>\n\n'
				'\\\\<a id="even-escaped-id"></a>\n\n'
				'> [quote-bound]: /target "title\n'
				'<a id="quote-boundary-visible"></a>"\n\n'
				'- [list-bound]: /target "title\n'
				'<a id="list-boundary-visible"></a>"\n\n'
				'[foo! <span id="backslash-ref-visible"></span>]: /target\n\n'
				'[bar][foo\\! <span id="backslash-ref-visible"></span>]\n\n'
				"[foo!]: /image\n\n"
				'![<span id="backslash-image-visible"></span>][foo\\!]\n\n'
				'[foo&<span id="entity-ref-visible"></span>]: /target\n\n'
				'[bar][foo&amp;<span id="entity-ref-visible"></span>]\n\n'
				"> ```markdown\n> # Quoted Fence Ghost\n> ```\n\n"
				"- ```markdown\n  # List Fence Ghost\n  ```\n\n"
				">     # Quoted Code Ghost\n\n"
				"> <div>\n> # Quoted HTML Ghost\n> </div>\n\n"
				'<script id="self-script-outer"/>\n'
				"<a id=self-script-ghost></a>\n</script>\n\n"
				'<textarea id="self-textarea-outer"/>\n'
				"<a id=self-textarea-ghost></a>\n</textarea>\n",
				encoding="utf-8",
			)
			candidate = inventory.discover_candidates((inventory.SourceLane("portable", root),))[0]

			result = inventory.inspect_candidates((candidate,))

			missing_anchors = [issue for issue in result.issues if issue.code == "missing-anchor"]
			self.assertEqual(codes(result), {"missing-anchor"})
			self.assertEqual(
				{
					issue.message.split("anchor #", 1)[1].split(" in ", 1)[0]
					for issue in missing_anchors
				},
				{
					"interrupted-html-atx",
					"self-closing-html-atx",
					"html-setext",
					"html-atx",
					"comment-setext",
					"comment-atx",
					"reference-title",
					"inline-code-id",
					"comment-id",
					"script-content-id",
					"space-indented-id",
					"tab-indented-id",
					"escaped-id",
					"reference-ghost",
					"continued-ghost",
					"inline-ghost",
					"image-ghost",
					"invalid-equals",
					"invalid-slash",
					"invalid-quote",
					"multiline-ref-ghost",
					"matched-full-image",
					"matched-collapsed-image",
					"matched-shortcut-image",
					"matched-ref-suffix",
					"second-duplicate-id",
					"second-duplicate-name",
					"iframe-ghost",
					"title-ghost",
					"quoted-fence-ghost",
					"list-fence-ghost",
					"quoted-code-ghost",
					"quoted-html-ghost",
					"self-script-ghost",
					"self-textarea-ghost",
				},
			)
			outside_guide = skill / "references" / "container-outside.md"
			outside_guide.write_text(
				"> ```markdown\n# Quote Fence Outside\n\n"
				"> <div>\n# Quote Div Outside\n\n"
				"> <script>\n# Quote Script Outside\n\n"
				"- ```markdown\n# List Fence Outside\n\n"
				"- <div>\n# List Div Outside\n\n"
				"- <script>\n# List Script Outside\n",
				encoding="utf-8",
			)
			outside_anchors, outside_error = inventory._anchors_for(outside_guide, {})
			self.assertIsNone(outside_error)
			self.assertEqual(
				outside_anchors,
				{
					"quote-fence-outside",
					"quote-div-outside",
					"quote-script-outside",
					"list-fence-outside",
					"list-div-outside",
					"list-script-outside",
				},
			)

	def test_explicit_links_only_validate_rendered_markdown_contexts(self) -> None:
		with tempfile.TemporaryDirectory() as temporary:
			root = Path(temporary) / "skills"
			body = (
				"---\nname: demo-skill\n"
				"description: '[YAML](scripts/missing-yaml.py)'\n---\n"
				"    [Indented](scripts/missing-indented.py)\n\n"
				"`[Inline code](scripts/missing-inline.py)`\n\n"
				"```markdown\n[Fenced](scripts/missing-fenced.py)\n```\n\n"
				"~~~markdown\n[Tilde fenced](scripts/missing-tilde.py)\n~~~\n\n"
				"- ```markdown\n  [List fence](scripts/list-fence-ignored.py)\n  ```\n\n"
				">     [Quoted code](scripts/quoted-code-ignored.py)\n\n"
				"> <div>\n> [Quoted HTML](scripts/quoted-html-ignored.py)\n> </div>\n\n"
				"<div>\n[Raw HTML](scripts/missing-html.py)\n</div>\n\n"
				"<!-- [Comment](scripts/missing-comment.py) -->\n\n"
				"Text <!--\n[Inline comment](scripts/missing-inline-comment.py)\n--> tail\n\n"
				"Text <?raw [PI](scripts/missing-pi.py) ?> tail\n\n"
				"Text <![CDATA[[CDATA](scripts/missing-cdata.py)]]> tail\n\n"
				"Text <!DOCTYPE [Declaration](scripts/missing-declaration.py)> tail\n\n"
				'<span title="[Attribute](scripts/missing-attribute.py)">text</span>\n\n'
				"<span>[Inline HTML](scripts/inline-html-missing.py)</span>\n\n"
				"[continued]:\n  scripts/continued-missing.py\n  'title'\n\n"
				'[bad-quote-title]: scripts/base-quote-missing.py\n"title" ok\n\n'
				"[bad-paren-title]: scripts/base-paren-missing.py\n(title) ok\n\n"
				"[valid-paren-title]: scripts/valid-paren-title-missing.py (title)\n"
				"[nested-paren-title]: scripts/nested-paren-title-ignored.py (foo(bar)\n\n"
				"[Foo\n  bar]: scripts/multiline-label-missing.py\n\n"
				"[   ]: scripts/whitespace-label-ignored.py\n"
				"[ref[]: scripts/bracket-label-ignored.py\n"
				f"[{'a' * 1000}]: scripts/long-label-ignored.py\n\n"
				"paragraph text\n[interrupt]: scripts/paragraph-interrupt-ignored.py\n\n"
				"[not a definition] paragraph\n"
				"    [Paragraph continuation](scripts/paragraph-continuation-missing.py)\n\n"
				"[also not a definition] paragraph\n"
				"<span>\n[Type seven continuation](scripts/type-seven-missing.py)\n</span>\n\n"
				"<div>\n\u00a0\n[HTML NBSP](scripts/html-nbsp-ignored.py)\n</div>\n\n"
				"paragraph\n\u00a0\n"
				"    [NBSP paragraph](scripts/nbsp-paragraph-missing.py)\n\n"
				"paragraph\n\u00a0\n[nbsp-ref]: scripts/nbsp-ref-ignored.py\n\n"
				"> [quoted]: scripts/quoted-ref-missing.py\n\n"
				"- [listed]: scripts/list-ref-missing.py\n\n"
				"- - [nested-list]:\n    scripts/nested-list-ref-missing.py\n\n"
				"- > [nested-quote]:\n    > scripts/nested-quote-ref-missing.py\n\n"
				"[outer [inner] label](scripts/nested-label-missing.py)\n"
				"[escaped \\] label](scripts/escaped-label-missing.py)\n"
				"[nested](scripts/missing_(one(two)).py)\n"
				"[[inner](scripts/inner-link-missing.py)](scripts/outer-ignored.py)\n"
				"[foo][[bar](scripts/inactive-suffix-missing.py)]\n"
				"[foo<https://example.com/?search=](scripts/autolink-ignored.py)>\n\n"
				"<https://example.com/[uri](scripts/uri-autolink-ignored.py)>\n"
				"<user@example.com>\n"
				"<foo@[pseudo](scripts/pseudo-email-one-missing.py)>\n"
				"<a@[pseudo](scripts/pseudo-email-two-missing.py).com>\n\n"
				"[Blank separator](\n\nscripts/blank-separator-ignored.py)\n"
				"[Blank label\n\ncontinued](scripts/blank-label-ignored.py)\n"
				"[CRLF label\r\n \r\ncontinued](scripts/crlf-label-ignored.py)\r\n"
				"`open\n\n[After code](scripts/after-code-missing.py) `\n"
				"[Soft\nline](scripts/soft-line-missing.py)\n"
				"[NBSP destination](\u00a0scripts/nbsp-missing.py)\n"
				"[Control](scripts/control-ignored\x00.py)\n"
				'[Blank title](scripts/blank-title-ignored.py "title\n\ncontinued")\n'
				"[Bad escape](scripts/bad\\ escape-ignored.py)\n"
				"[Valid paren title](scripts/valid-inline-title-missing.py (title))\n"
				"[Nested paren title](scripts/nested-inline-title-ignored.py (foo(bar))\n"
				"[One newline](\n scripts/one-newline-missing.py)\n\n"
				"[Entity path](scripts/entity&amp;.py)\n"
				"[Entity fragment](references/entity.md#entity&amp;fragment)\n"
				"[Entity scheme](https&#x3a;//example.com/missing.py)\n\n"
				"```bad`info\n[Visible](scripts/visible-missing.py)\n```\n"
			)
			skill = make_skill(
				root,
				"demo-skill",
				body,
			)
			(skill / "scripts").mkdir()
			(skill / "scripts" / "entity&.py").write_text("print('ok')\n", encoding="utf-8")
			(skill / "references").mkdir()
			(skill / "references" / "entity.md").write_text(
				'<a id="entity&fragment"></a>\n', encoding="utf-8"
			)
			(skill / "references" / "escaped-code.md").write_text(
				"\\` [Escaped code opener](../scripts/escaped-code-missing.py) `\n",
				encoding="utf-8",
			)
			candidate = inventory.discover_candidates((inventory.SourceLane("portable", root),))[0]

			result = inventory.inspect_candidates((candidate,))

			broken_links = [issue for issue in result.issues if issue.code == "broken-local-link"]
			self.assertEqual(codes(result), {"broken-local-link"})
			self.assertEqual(
				{issue.message.rsplit("/", 1)[-1] for issue in broken_links},
				{
					"inline-html-missing.py",
					"continued-missing.py",
					"base-quote-missing.py",
					"base-paren-missing.py",
					"valid-paren-title-missing.py",
					"multiline-label-missing.py",
					"quoted-ref-missing.py",
					"list-ref-missing.py",
					"paragraph-continuation-missing.py",
					"type-seven-missing.py",
					"nbsp-paragraph-missing.py",
					"nested-list-ref-missing.py",
					"nested-quote-ref-missing.py",
					"nested-label-missing.py",
					"escaped-label-missing.py",
					"missing_(one(two)).py",
					"inner-link-missing.py",
					"inactive-suffix-missing.py",
					"pseudo-email-one-missing.py",
					"pseudo-email-two-missing.py",
					"after-code-missing.py",
					"soft-line-missing.py",
					"nbsp-missing.py",
					"valid-inline-title-missing.py",
					"escaped-code-missing.py",
					"one-newline-missing.py",
					"visible-missing.py",
				},
			)
			continued = next(
				issue for issue in broken_links if "continued-missing.py" in issue.message
			)
			self.assertEqual(
				continued.line,
				body.count("\n", 0, body.index("scripts/continued-missing.py")) + 1,
			)
			multiline_label = next(
				issue for issue in broken_links if "multiline-label-missing.py" in issue.message
			)
			self.assertEqual(
				multiline_label.line,
				body.count("\n", 0, body.index("scripts/multiline-label-missing.py")) + 1,
			)
			backtick_destinations = inventory._explicit_destinations(
				"[Inline](scripts/`inline`.py)\n"
				"[Angle](<scripts/`angle`.py>)\n\n"
				"[Plain angle](<missing>)\n"
				"<standalone>\n\n"
				"[reference]: scripts/`reference`.py\n"
				"[angle-reference]: <scripts/`reference-angle`.py>\n\n"
				"`[Code](scripts/ignored.py)`\n"
			)
			self.assertEqual(
				{destination for destination, _ in backtick_destinations},
				{
					"scripts/`inline`.py",
					"<scripts/`angle`.py>",
					"<missing>",
					"scripts/`reference`.py",
					"<scripts/`reference-angle`.py>",
				},
			)
			linked_image_destinations = inventory._explicit_destinations(
				"[![Inline image](assets/inline.png)](scripts/outer.py)\n"
				"[![Reference image][image-ref]](scripts/reference-outer.py)\n"
				"[![Nested image](assets/nested.png)][outer-ref]\n\n"
				"[image-ref]: assets/reference.png\n"
				"[outer-ref]: scripts/reference-outer.py\n"
			)
			self.assertEqual(
				{destination for destination, _ in linked_image_destinations},
				{
					"assets/inline.png",
					"scripts/outer.py",
					"assets/reference.png",
					"scripts/reference-outer.py",
					"assets/nested.png",
				},
			)
			deep_label = "[" * 1_100 + "label" + "]" * 1_100
			self.assertEqual(
				inventory._explicit_destinations(f"{deep_label}(scripts/deep.py)\n"), ()
			)
			container_outside = inventory._explicit_destinations(
				"> ```markdown\n[Quote fence](scripts/quote-fence-outside.py)\n\n"
				"> <div>\n[Quote div](scripts/quote-div-outside.py)\n\n"
				"> <script>\n[Quote script](scripts/quote-script-outside.py)\n\n"
				"- ```markdown\n[List fence](scripts/list-fence-outside.py)\n\n"
				"- <div>\n[List div](scripts/list-div-outside.py)\n\n"
				"- <script>\n[List script](scripts/list-script-outside.py)\n"
			)
			self.assertEqual(
				{destination for destination, _ in container_outside},
				{
					"scripts/quote-fence-outside.py",
					"scripts/quote-div-outside.py",
					"scripts/quote-script-outside.py",
					"scripts/list-fence-outside.py",
					"scripts/list-div-outside.py",
					"scripts/list-script-outside.py",
				},
			)
			list_padding = inventory._explicit_destinations(
				"-    [Four spaces](scripts/four-spaces.py)\n"
				"-     [Five spaces](scripts/five-spaces.py)\n"
				"-\t [Four columns](scripts/four-columns.py)\n"
				"-\t  [Five columns](scripts/five-columns.py)\n"
			)
			self.assertEqual(
				{destination for destination, _ in list_padding},
				{"scripts/four-spaces.py", "scripts/four-columns.py"},
			)
			paragraph_definitions = inventory._explicit_destinations(
				"paragraph\n2. [two]: scripts/two-ignored.py\n\n"
				"paragraph\n1. [one]: scripts/one-active.py\n\n"
				"- paragraph\n  [inactive]: scripts/list-inactive.py\n\n"
				"- paragraph\n\n  [active]: scripts/list-active.py\n"
			)
			self.assertEqual(
				{destination for destination, _ in paragraph_definitions},
				{"scripts/one-active.py", "scripts/list-active.py"},
			)

	def test_github_heading_slugs_normalize_symbols_unicode_and_rendered_inline_text(self) -> None:
		with tempfile.TemporaryDirectory() as temporary:
			root = Path(temporary) / "skills"
			skill = make_skill(
				root,
				"demo-skill",
				valid_body(
					"demo-skill",
					"[Emoji](references/guide.md#-emoji)\n"
					"[Plus](references/guide.md#c-api)\n"
					"[Unicode](references/guide.md#straße)\n"
					"[Unicode duplicate](references/guide.md#straße-1)\n"
					"[Emphasis](references/guide.md#install)\n"
					"[Reference](references/guide.md#install-1)\n"
					"[URI](references/guide.md#httpsexamplecom)\n"
					"[Email](references/guide.md#userexamplecom)\n"
					"[Literal underscores](references/guide.md#_literal_)\n"
					"[Intraword underscore](references/guide.md#foo_bar_baz)\n"
					"[Intraword strong](references/guide.md#foo__bar__baz)\n"
					"[Asterisk](references/guide.md#asterisk)\n"
					"[Nested inline](references/guide.md#outer-inner-label)\n"
					"[Nested reference](references/guide.md#outer-inner-label-1)\n"
					"[Escaped label](references/guide.md#escaped--label)\n"
					"[Code span](references/guide.md#foo-bar)\n"
					"[Multi code span](references/guide.md#foo-bar-1)\n"
					"[Invalid HTML](references/guide.md#a-foo-title)\n"
					"[Valid HTML](references/guide.md#title)\n"
					"[Unmatched reference](references/guide.md#unmatchedmissing)\n"
					"[Nested precedence](references/guide.md#innerscriptsouterpy)\n"
					"[Short comment](references/guide.md#title-1)\n"
					"[Shorter comment](references/guide.md#title-2)\n"
					"[Even escaped HTML](references/guide.md#parity)\n"
					"[Even escaped autolink](references/guide.md#httpsexampleorg)\n",
				),
			)
			(skill / "references").mkdir()
			(skill / "references" / "guide.md").write_text(
				"# 😄 Emoji\n# C++ API\n# Straße\n# Straße\n"
				"# _Install_\n# [Install][docs]\n"
				"# <https://example.com>\n# <user@example.com>\n"
				"# \\_Literal\\_\n# foo_bar_baz\n# foo__bar__baz\n# *Asterisk*\n\n"
				"# [outer [inner] label](/url)\n"
				"# [outer [inner] label][nested-docs]\n"
				"# [escaped \\] label](/url)\n"
				"# `foo   bar`\n# `` foo ` bar ``\n"
				"# <a foo==> Title\n# <span>Title</span>\n"
				"# [Unmatched][missing]\n"
				"# [[inner](scripts/inner.py)](scripts/outer.py)\n"
				"# <!--> Title\n# <!---> Title\n"
				"# \\\\<span>Parity</span>\n"
				"# \\\\<https://example.org>\n\n"
				"[docs]: /target\n[nested-docs]: /target\n",
				encoding="utf-8",
			)
			(skill / "references" / "scripts").mkdir()
			(skill / "references" / "scripts" / "inner.py").write_text(
				"print('ok')\n", encoding="utf-8"
			)
			candidate = inventory.discover_candidates((inventory.SourceLane("portable", root),))[0]

			result = inventory.inspect_candidates((candidate,))

			self.assertEqual(inventory.blocking_issues(result), ())
			self.assertEqual(inventory._github_like_slug(r"\_foo_"), "_foo_")
			self.assertEqual(inventory._github_like_slug(r"\\_foo_"), "foo")
			self.assertEqual(inventory._github_like_slug(r"_foo\_"), "_foo_")
			self.assertEqual(inventory._github_like_slug(r"_foo\\_"), "foo")
			self.assertEqual(inventory._github_like_slug("😄_foo_"), "_foo_")

	def test_legacy_bare_references_and_assets_remain_narrow(self) -> None:
		with tempfile.TemporaryDirectory() as temporary:
			root = Path(temporary) / "skills"
			skill = make_skill(
				root,
				"demo-skill",
				valid_body(
					"demo-skill",
					"Read references/missing.md; target scripts/missing.py is not local.\n",
				),
			)
			(skill / "references").mkdir()
			candidate = inventory.discover_candidates((inventory.SourceLane("portable", root),))[0]

			result = inventory.inspect_candidates((candidate,))

			legacy = [issue for issue in result.issues if issue.code == "legacy-resource"]
			self.assertEqual(len(legacy), 1)
			self.assertIn("references/missing.md", legacy[0].message)


class RealCatalog(unittest.TestCase):
	def test_current_portable_and_project_catalog_has_no_blocking_inventory_issues(self) -> None:
		lanes = [inventory.SourceLane("portable", support.REPO_ROOT / "skills")]
		projects = support.REPO_ROOT / "projects"
		for project in sorted(projects.iterdir()):
			if project.is_dir() and not project.name.startswith((".", "_")):
				lanes.append(inventory.SourceLane("project", project, project.name))
		candidates = inventory.discover_candidates(tuple(lanes))

		result = inventory.inspect_candidates(candidates)

		messages = "\n".join(
			f"{issue.path}:{issue.line or 0}: {issue.code}: {issue.message}"
			for issue in inventory.blocking_issues(result)
		)
		self.assertEqual(messages, "")


if __name__ == "__main__":
	unittest.main()
