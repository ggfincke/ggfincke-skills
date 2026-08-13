# scripts/skill_inventory.py
# discover & validate portable and project skill packages without side effects

from __future__ import annotations

import html
import os
import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

import always_on

NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
INVALID_PLAIN_SCALAR_RE = re.compile(r":(?:[ \t]|$)")
RESOURCE_REF_RE = re.compile(r"(?<![\w./-])(references|assets)/[\w./-]*[\w-]")
REFERENCE_DEFINITION_CANDIDATE_RE = re.compile(r"^[ ]{0,3}\[(?!\^)")
FENCE_RE = re.compile(r"^[ ]{0,3}(?P<fence>`{3,}|~{3,})")
ATX_HEADING_RE = re.compile(r"^[ ]{0,3}#{1,6}(?:[ \t]+(?P<title>.*?)[ \t]*#*[ \t]*|[ \t]*)$")
SETEXT_HEADING_RE = re.compile(r"^[ ]{0,3}(?P<underline>=+|-+)[ \t]*$")
INDENTED_CODE_RE = re.compile(r"^(?: {4}| {0,3}\t)")
SETEXT_NON_PARAGRAPH_RE = re.compile(
	r"^[ ]{0,3}(?:#{1,6}(?:[ \t]|$)|>|[-+*][ \t]+|\d{1,9}[.)][ \t]+|"
	r"(?:[-*_][ \t]*){3,})"
)
YAML_FRONTMATTER_DELIMITER_RE = re.compile(r"^---[ \t]*$")
HTML_BLOCK_LITERAL_START_RE = re.compile(
	r"^[ ]{0,3}<(?:pre|script|style|textarea)(?:[ \t>]|$)", re.IGNORECASE
)
HTML_BLOCK_LITERAL_END_RE = re.compile(r"</(?:pre|script|style|textarea)>", re.IGNORECASE)
HTML_BLOCK_COMMENT_START_RE = re.compile(r"^[ ]{0,3}<!--")
HTML_BLOCK_COMMENT_END_RE = re.compile(r"-->")
HTML_BLOCK_PROCESSING_START_RE = re.compile(r"^[ ]{0,3}<\?")
HTML_BLOCK_PROCESSING_END_RE = re.compile(r"\?>")
HTML_BLOCK_DECLARATION_START_RE = re.compile(r"^[ ]{0,3}<![A-Za-z]")
HTML_BLOCK_DECLARATION_END_RE = re.compile(r">")
HTML_BLOCK_CDATA_START_RE = re.compile(r"^[ ]{0,3}<!\[CDATA\[")
HTML_BLOCK_CDATA_END_RE = re.compile(r"\]\]>")
HTML_BLOCK_TAG_NAMES = (
	"address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|"
	"details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|"
	"h1|h2|h3|h4|h5|h6|head|header|hgroup|hr|html|iframe|legend|li|link|main|menu|"
	"menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|source|summary|"
	"table|tbody|td|tfoot|th|thead|title|tr|track|ul"
)
HTML_BLOCK_TAG_START_RE = re.compile(
	rf"^[ ]{{0,3}}</?(?:{HTML_BLOCK_TAG_NAMES})(?:[ \t]|/?>|$)", re.IGNORECASE
)
HTML_BLOCK_COMPLETE_TAG_RE = re.compile(
	r"^[ ]{0,3}(?:"
	r"</[A-Za-z][A-Za-z0-9-]*[ \t]*>|"
	r"<(?!(?:pre|script|style|textarea)(?:[ \t>]|$))[A-Za-z][A-Za-z0-9-]*"
	r"(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*"
	r"(?:[ \t]*=[ \t]*(?:[^\s\"'=<>`]+|'[^']*'|\"[^\"]*\"))?)*[ \t]*/?>"
	r")[ \t]*$",
	re.IGNORECASE,
)
AUTOLINK_RE = re.compile(
	r"<(?P<label>(?:"
	r"[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\x00-\x20]*|"
	r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@"
	r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
	r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*"
	r"))>"
)
ASTERISK_EMPHASIS_RE = re.compile(r"(?P<delimiter>\*{1,3})(?=\S)(?P<label>.*?\S)(?P=delimiter)")
UNDERSCORE_EMPHASIS_RE = re.compile(r"(?P<delimiter>_{1,3})(?=\S)(?P<label>.*?\S)(?P=delimiter)")
INLINE_RAW_HTML_TOKEN_RE = re.compile(
	r"(?:"
	r"<!--(?:>|->|(?:[^-]|-(?!-))*-->)|<\?.*?\?>|<!\[CDATA\[.*?\]\]>|<![A-Za-z][^>]*>|"
	r"</[A-Za-z][A-Za-z0-9-]*[ \t\r\n\f]*>|"
	r"<[A-Za-z][A-Za-z0-9-]*"
	r"(?:[ \t\r\n\f]+[A-Za-z_:][A-Za-z0-9_.:-]*"
	r"(?:[ \t\r\n\f]*=[ \t\r\n\f]*"
	r"(?:[^\s\"'=<>`]+|'[^']*'|\"[^\"]*\"))?)*[ \t\r\n\f]*/?>"
	r")",
	re.DOTALL,
)
MARKDOWN_ESCAPE_RE = re.compile(r"\\([!\"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~])")
PARAGRAPH_BREAK_RE = re.compile(r"(?:\r\n?|\n)[ \t]*(?:\r\n?|\n)")
SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
MAX_LINK_LABEL_DEPTH = 128

PORTABLE_FIELDS = frozenset({"name", "description"})
HTML_RAW_TEXT_TAGS = frozenset(
	{"iframe", "noembed", "noframes", "script", "style", "textarea", "title", "xmp"}
)


@dataclass(frozen=True)
class SourceLane:
	kind: str
	root: Path
	project_repo: str | None = None

	def __post_init__(self) -> None:
		if self.kind not in {"portable", "project"}:
			raise ValueError(f"unsupported skill source lane {self.kind!r}")
		if self.kind == "portable" and self.project_repo is not None:
			raise ValueError("portable skill lanes cannot have a project repository")
		if self.kind == "project" and not self.project_repo:
			raise ValueError("project skill lanes require a project repository")


@dataclass(frozen=True)
class SkillKey:
	lane_kind: str
	project_repo: str | None
	name: str


@dataclass(frozen=True)
class SkillCandidate:
	key: SkillKey
	directory: Path
	entrypoint: Path


@dataclass(frozen=True)
class AlwaysOnBlock:
	title: str
	content: str


@dataclass(frozen=True)
class SkillPackage:
	candidate: SkillCandidate
	name: str
	description: str
	frontmatter: dict[str, str]
	always_on: tuple[AlwaysOnBlock, ...]


@dataclass(frozen=True)
class SkillIssue:
	key: SkillKey | None
	path: Path
	line: int | None
	code: str
	message: str
	is_warning: bool = False


@dataclass(frozen=True)
class SkillInventory:
	candidates: tuple[SkillCandidate, ...]
	packages: tuple[SkillPackage, ...]
	issues: tuple[SkillIssue, ...]


@dataclass(frozen=True)
class _MarkdownLink:
	start: int
	end: int
	label_start: int
	label_end: int
	suffix_start: int
	destination: str | None
	destination_start: int | None
	is_image: bool


@dataclass(frozen=True)
class _ReferenceDefinition:
	start: int
	end: int
	destination: str
	destination_start: int
	destination_line: int
	normalized_label: str


@dataclass(frozen=True)
class _ContainerPart:
	kind: str
	start: int
	end: int
	columns: int


# collect explicit anchors from rendered raw HTML start tags
class _AnchorHTMLParser(HTMLParser):
	def __init__(self) -> None:
		super().__init__(convert_charrefs=True)
		self.anchors: set[str] = set()
		self._raw_text_tag: str | None = None

	def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
		if self._raw_text_tag is not None:
			return
		seen_names: set[str] = set()
		for name, value in attrs:
			normalized_name = name.casefold()
			if normalized_name in seen_names:
				continue
			seen_names.add(normalized_name)
			if value and (normalized_name == "id" or (normalized_name == "name" and tag == "a")):
				self.anchors.add(value)
		if tag == "plaintext":
			self._raw_text_tag = tag
		elif tag in HTML_RAW_TEXT_TAGS:
			self._raw_text_tag = tag

	def handle_endtag(self, tag: str) -> None:
		if self._raw_text_tag != "plaintext" and tag == self._raw_text_tag:
			self._raw_text_tag = None

	def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
		self.handle_starttag(tag, attrs)
		if tag not in HTML_RAW_TEXT_TAGS and tag != "plaintext":
			self.handle_endtag(tag)


def discover_candidates(lanes: Iterable[SourceLane]) -> tuple[SkillCandidate, ...]:
	candidates: list[SkillCandidate] = []
	for lane in lanes:
		if not lane.root.is_dir():
			continue
		for directory in sorted(lane.root.iterdir()):
			if not _is_visible_directory(directory):
				continue
			key = SkillKey(lane.kind, lane.project_repo, directory.name)
			candidates.append(SkillCandidate(key, directory, directory / "SKILL.md"))
	return tuple(candidates)


def select_candidates(
	candidates: Iterable[SkillCandidate],
	names: Iterable[str],
	missing_root: Path | None = None,
) -> tuple[tuple[SkillCandidate, ...], tuple[SkillIssue, ...]]:
	candidate_tuple = tuple(candidates)
	wanted = set(names)
	if not wanted:
		return candidate_tuple, ()

	selected = tuple(candidate for candidate in candidate_tuple if candidate.key.name in wanted)
	present = {candidate.key.name for candidate in candidate_tuple}
	issue_root = missing_root or _selection_issue_root(candidate_tuple)
	issues = tuple(
		SkillIssue(
			None,
			issue_root / name,
			None,
			"missing-selection",
			"selected skill does not exist",
		)
		for name in sorted(wanted - present)
	)
	return selected, issues


def inspect_candidates(
	candidates: Iterable[SkillCandidate], strict_frontmatter: bool = True
) -> SkillInventory:
	candidate_tuple = tuple(candidates)
	packages: list[SkillPackage] = []
	issues: list[SkillIssue] = []
	for candidate in candidate_tuple:
		package, candidate_issues = _inspect_candidate(candidate, strict_frontmatter)
		issues.extend(candidate_issues)
		if package is not None:
			packages.append(package)
	return SkillInventory(candidate_tuple, tuple(packages), tuple(issues))


def select_inventory(
	inventory: SkillInventory,
	names: Iterable[str],
	missing_root: Path | None = None,
) -> SkillInventory:
	wanted = tuple(names)
	if not wanted:
		return inventory

	selected_candidates, selection_issues = select_candidates(
		inventory.candidates, wanted, missing_root
	)
	selected_keys = {candidate.key for candidate in selected_candidates}
	packages = tuple(
		package for package in inventory.packages if package.candidate.key in selected_keys
	)
	issues = tuple(issue for issue in inventory.issues if issue.key in selected_keys)
	return SkillInventory(selected_candidates, packages, issues + selection_issues)


def blocking_issues(inventory: SkillInventory) -> tuple[SkillIssue, ...]:
	return tuple(issue for issue in inventory.issues if not issue.is_warning)


def parse_frontmatter(path: Path) -> dict[str, str]:
	return parse_frontmatter_text(path.read_text(encoding="utf-8"))


def parse_frontmatter_text(text: str) -> dict[str, str]:
	lines = text.splitlines()
	if not lines or lines[0] != "---":
		raise ValueError("missing opening YAML frontmatter marker")

	try:
		end_index = lines[1:].index("---") + 1
	except ValueError as exc:
		raise ValueError("missing closing YAML frontmatter marker") from exc

	values: dict[str, str] = {}
	for line_number, line in enumerate(lines[1:end_index], start=2):
		stripped = line.strip()
		if not stripped or stripped.startswith("#"):
			continue
		if ":" not in stripped:
			raise ValueError(f"unsupported frontmatter line {line_number}: {line}")
		key, value = stripped.split(":", 1)
		key = key.strip()
		value = parse_frontmatter_value(value.strip(), line_number)
		if not key:
			raise ValueError(f"empty frontmatter key on line {line_number}")
		values[key] = value

	return values


def parse_frontmatter_value(value: str, line_number: int) -> str:
	if not value:
		return ""

	quote = value[0]
	if quote in {"'", '"'}:
		if len(value) == 1 or value[-1] != quote:
			raise ValueError(f"unterminated quoted frontmatter value on line {line_number}")
		return value[1:-1]

	if INVALID_PLAIN_SCALAR_RE.search(value):
		raise ValueError(
			f"invalid YAML frontmatter value on line {line_number}: "
			"plain values cannot contain ': '; quote the value"
		)

	return value


def _inspect_candidate(
	candidate: SkillCandidate, strict_frontmatter: bool
) -> tuple[SkillPackage | None, list[SkillIssue]]:
	issues: list[SkillIssue] = []
	if not NAME_RE.fullmatch(candidate.key.name):
		issues.append(
			_issue(
				candidate,
				candidate.directory,
				"invalid-name",
				"folder name must use lowercase letters, digits, and hyphens",
			)
		)

	symlinks, package_files = _walk_package(candidate.directory)
	issues.extend(_package_symlink_issues(candidate, symlinks))
	issues.extend(_readme_issues(candidate, package_files))
	if not candidate.entrypoint.is_file():
		issues.append(
			_issue(
				candidate,
				candidate.entrypoint,
				"missing-entrypoint",
				"skill directory is missing SKILL.md",
			)
		)
		issues.extend(_markdown_link_issues(candidate, package_files))
		return None, issues

	try:
		body = candidate.entrypoint.read_text(encoding="utf-8")
	except (OSError, UnicodeError) as exc:
		issues.append(
			_issue(
				candidate,
				candidate.entrypoint,
				"entrypoint-read",
				f"cannot read SKILL.md as UTF-8: {exc}",
			)
		)
		return None, issues

	try:
		frontmatter = parse_frontmatter_text(body)
	except ValueError as exc:
		issues.append(_issue(candidate, candidate.entrypoint, "frontmatter", str(exc)))
		issues.extend(_markdown_link_issues(candidate, package_files))
		return None, issues

	name = frontmatter.get("name", "")
	description = frontmatter.get("description", "")
	if not name:
		issues.append(
			_issue(
				candidate,
				candidate.entrypoint,
				"frontmatter",
				"frontmatter is missing required name",
			)
		)
	elif name != candidate.key.name:
		issues.append(
			_issue(
				candidate,
				candidate.entrypoint,
				"frontmatter",
				f"frontmatter name {name!r} must match folder {candidate.key.name!r}",
			)
		)
	if not description:
		issues.append(
			_issue(
				candidate,
				candidate.entrypoint,
				"frontmatter",
				"frontmatter is missing required description",
			)
		)

	extra_fields = sorted(set(frontmatter) - PORTABLE_FIELDS)
	if extra_fields:
		message = (
			"non-portable frontmatter fields: "
			+ ", ".join(extra_fields)
			+ "; keep canonical skills portable unless this is intentional"
		)
		issues.append(
			_issue(
				candidate,
				candidate.entrypoint,
				"frontmatter",
				message,
				is_warning=not strict_frontmatter,
			)
		)

	parsed_blocks, marker_errors = always_on.parse_blocks(body)
	for message in marker_errors:
		issues.append(_issue(candidate, candidate.entrypoint, "always-on-marker", message))
	blocks = tuple(AlwaysOnBlock(title, content) for title, content in parsed_blocks)
	if candidate.key.lane_kind == "project" and blocks:
		issues.append(
			_issue(
				candidate,
				candidate.entrypoint,
				"project-always-on",
				"always-on blocks only take effect for skills under skills/; this "
				"project-only block never reaches an instruction file",
				is_warning=True,
			)
		)

	issues.extend(_legacy_resource_issues(candidate, body))
	issues.extend(_markdown_link_issues(candidate, package_files))
	if any(not issue.is_warning for issue in issues):
		return None, issues

	package = SkillPackage(candidate, name, description, dict(frontmatter), blocks)
	return package, issues


# walk without following links; fail closed on any symlink like sync_transaction copy
def _walk_package(root: Path) -> tuple[tuple[Path, ...], tuple[Path, ...]]:
	symlinks: list[Path] = []
	files: list[Path] = []
	for directory, dirnames, filenames in os.walk(root, followlinks=False):
		dirnames.sort()
		for name in sorted((*dirnames, *filenames)):
			path = Path(directory) / name
			if path.is_symlink():
				symlinks.append(path)
			elif path.is_file():
				files.append(path)
	return tuple(sorted(symlinks)), tuple(sorted(files))


def _package_symlink_issues(
	candidate: SkillCandidate, symlinks: Iterable[Path]
) -> list[SkillIssue]:
	return [
		_issue(
			candidate,
			path,
			"package-symlink",
			"skill package contains a symlink and cannot be inspected safely",
		)
		for path in symlinks
	]


def _readme_issues(candidate: SkillCandidate, files: Iterable[Path]) -> list[SkillIssue]:
	issues: list[SkillIssue] = []
	for path in files:
		if path.name.lower() == "readme.md":
			issues.append(
				_issue(
					candidate,
					path,
					"banned-readme",
					"per-skill README is banned; keep instructions in SKILL.md & references/",
				)
			)
	return issues


def _legacy_resource_issues(candidate: SkillCandidate, body: str) -> list[SkillIssue]:
	issues: list[SkillIssue] = []
	seen: set[str] = set()
	bare_body = _mask_explicit_links(body)
	for match in RESOURCE_REF_RE.finditer(bare_body):
		relative = match.group(0)
		if relative in seen:
			continue
		seen.add(relative)
		top = match.group(1)
		if not (candidate.directory / top).is_dir():
			continue
		if ".." in relative.split("/"):
			continue
		target = candidate.directory / relative
		if not _is_within(target, candidate.directory):
			continue
		if not target.exists():
			issues.append(
				_issue(
					candidate,
					candidate.entrypoint,
					"legacy-resource",
					f"SKILL.md references missing resource {relative}",
				)
			)
	return issues


def _markdown_link_issues(candidate: SkillCandidate, files: Iterable[Path]) -> list[SkillIssue]:
	issues: list[SkillIssue] = []
	anchor_cache: dict[Path, tuple[set[str] | None, str | None]] = {}
	root = candidate.directory.resolve()
	markdown_files = tuple(path for path in files if path.suffix.lower() == ".md")
	for source in markdown_files:
		try:
			text = source.read_text(encoding="utf-8")
		except (OSError, UnicodeError) as exc:
			issues.append(
				_issue(
					candidate,
					source,
					"markdown-read",
					f"cannot read Markdown as UTF-8: {exc}",
				)
			)
			continue

		seen: set[tuple[Path, str, str]] = set()
		for raw_destination, line in _explicit_destinations(text):
			destination = html.unescape(_markdown_unescape(_unwrap_destination(raw_destination)))
			if _is_ignored_destination(destination):
				continue
			try:
				parts = urlsplit(destination)
			except ValueError as exc:
				issues.append(
					_issue(
						candidate,
						source,
						"broken-local-link",
						f"cannot parse local Markdown link {destination!r}: {exc}",
						line,
					)
				)
				continue
			path_text = unquote(parts.path)
			fragment = html.unescape(unquote(parts.fragment))
			try:
				target = (
					source.resolve() if not path_text else (source.parent / path_text).resolve()
				)
			except (OSError, RuntimeError, ValueError) as exc:
				issues.append(
					_issue(
						candidate,
						source,
						"broken-local-link",
						f"cannot resolve local Markdown link {destination!r}: {exc}",
						line,
					)
				)
				continue
			identity = (target, fragment, destination)
			if identity in seen:
				continue
			seen.add(identity)

			if not _is_within(target, root):
				issues.append(
					_issue(
						candidate,
						source,
						"link-escape",
						f"Markdown link leaves the skill package: {destination}",
						line,
					)
				)
				continue
			if not target.is_file():
				issues.append(
					_issue(
						candidate,
						source,
						"broken-local-link",
						f"Markdown link targets missing local file {destination}",
						line,
					)
				)
				continue
			if not fragment or target.suffix.lower() != ".md":
				continue

			anchors, read_error = _anchors_for(target, anchor_cache)
			if read_error is not None:
				issues.append(
					_issue(
						candidate,
						source,
						"markdown-read",
						read_error,
						line,
					)
				)
				continue
			if anchors is not None and fragment not in anchors:
				display_target = _relative_display(target, candidate.directory)
				issues.append(
					_issue(
						candidate,
						source,
						"missing-anchor",
						f"Markdown link targets missing anchor #{fragment} in {display_target}",
						line,
					)
				)
	return issues


def _explicit_destinations(text: str) -> tuple[tuple[str, int], ...]:
	masked = _mask_yaml_frontmatter(text)
	masked = _mask_container_block_lines(masked, include_indented=False, include_html=False)
	definitions = _scan_reference_definitions(masked)
	reference_labels = frozenset(definition.normalized_label for definition in definitions)
	link_visible = _mask_spans(
		masked, ((definition.start, definition.end) for definition in definitions)
	)
	link_visible = _mask_container_block_lines(link_visible)
	link_visible = _mask_container_prefixes(link_visible)
	matches: list[tuple[int, str, int]] = []
	for link in _scan_markdown_links(link_visible, reference_labels):
		if link.destination is None or link.destination_start is None:
			continue
		line = text.count("\n", 0, link.destination_start) + 1
		matches.append((link.destination_start, link.destination, line))
	for definition in definitions:
		matches.append(
			(
				definition.destination_start,
				definition.destination,
				definition.destination_line,
			)
		)
	matches.sort(key=lambda item: item[0])
	return tuple((destination, line) for _, destination, line in matches)


def _mask_explicit_links(text: str) -> str:
	definitions = _scan_reference_definitions(text)
	reference_labels = frozenset(definition.normalized_label for definition in definitions)
	spans = [(link.start, link.end) for link in _scan_markdown_links(text, reference_labels)]
	spans.extend((definition.start, definition.end) for definition in definitions)
	return _mask_spans(text, spans)


def _mask_reference_definitions(text: str) -> str:
	return _mask_spans(
		text,
		((definition.start, definition.end) for definition in _scan_reference_definitions(text)),
	)


def _scan_markdown_links(
	text: str, reference_labels: frozenset[str] = frozenset()
) -> tuple[_MarkdownLink, ...]:
	links: list[_MarkdownLink] = []
	for start, end in _paragraph_ranges(text):
		links.extend(_scan_markdown_links_range(text, start, end, reference_labels))
	return tuple(links)


def _scan_markdown_links_range(
	text: str, start_index: int, limit: int, reference_labels: frozenset[str]
) -> tuple[_MarkdownLink, ...]:
	links: list[_MarkdownLink] = []
	index = start_index
	while index < limit:
		if text[index] == "`" and not _is_escaped(text, index):
			code_end = _code_span_end(text, index, limit)
			if code_end is not None and code_end <= limit:
				index = code_end
				continue
		if text[index] == "<" and not _is_escaped(text, index):
			autolink_match = AUTOLINK_RE.match(text, index)
			if autolink_match is not None and autolink_match.end() <= limit:
				index = autolink_match.end()
				continue
			tag_match = INLINE_RAW_HTML_TOKEN_RE.match(text, index)
			if tag_match is not None and tag_match.end() <= limit:
				index = tag_match.end()
				continue
		is_image = text.startswith("![", index) and not _is_escaped(text, index)
		if is_image:
			open_index = index + 1
			start = index
		elif text[index] == "[" and not _is_escaped(text, index):
			open_index = index
			start = index
		else:
			index += 1
			continue

		label_end = _closing_label_index(text, open_index, limit)
		if label_end is None:
			index = open_index + 1
			continue
		label_start = open_index + 1
		label = text[label_start:label_end]
		suffix_start = label_end + 1
		end = suffix_start
		destination: str | None = None
		destination_start: int | None = None
		active = False
		if suffix_start < limit and text[suffix_start] == "(":
			parsed = _parse_inline_link_suffix(text, suffix_start)
			if parsed is not None and parsed[0] <= limit:
				end, destination, destination_start = parsed
				active = True
		elif suffix_start < limit and text[suffix_start] == "[":
			reference_end = _closing_label_index(text, suffix_start, limit)
			if reference_end is not None:
				end = reference_end + 1
				reference = text[suffix_start + 1 : reference_end]
				if not reference:
					reference = label
				normalized = _normalize_reference_label(reference)
				active = _is_valid_reference_label(reference) and normalized in reference_labels
		else:
			normalized = _normalize_reference_label(label)
			active = _is_valid_reference_label(label) and normalized in reference_labels

		inner_links = _scan_markdown_links_range(text, label_start, label_end, reference_labels)
		inner_active_links = tuple(link for link in inner_links if not link.is_image)
		if active and (is_image or not inner_active_links):
			if not is_image:
				links.extend(link for link in inner_links if link.is_image)
			links.append(
				_MarkdownLink(
					start,
					end,
					label_start,
					label_end,
					suffix_start,
					destination,
					destination_start,
					is_image,
				)
			)
		else:
			links.extend(inner_links)
			if not active and suffix_start < end:
				links.extend(_scan_markdown_links_range(text, suffix_start, end, reference_labels))
		index = end
	return tuple(links)


def _closing_label_index(text: str, open_index: int, limit: int | None = None) -> int | None:
	limit = len(text) if limit is None else limit
	depth = 1
	index = open_index + 1
	while index < limit:
		if text[index] == "\\":
			index += 2 if index + 1 < limit else 1
			continue
		if text[index] == "`" and not _is_escaped(text, index):
			code_end = _code_span_end(text, index, limit)
			if code_end is not None and code_end <= limit:
				index = code_end
				continue
		if text[index] == "<" and not _is_escaped(text, index):
			autolink_match = AUTOLINK_RE.match(text, index)
			if autolink_match is not None and autolink_match.end() <= limit:
				index = autolink_match.end()
				continue
			tag_match = INLINE_RAW_HTML_TOKEN_RE.match(text, index)
			if tag_match is not None and tag_match.end() <= limit:
				index = tag_match.end()
				continue
		if text[index] == "[":
			depth += 1
			if depth > MAX_LINK_LABEL_DEPTH:
				return None
		elif text[index] == "]":
			depth -= 1
			if depth == 0:
				return index
		index += 1
	return None


def _parse_inline_link_suffix(text: str, open_index: int) -> tuple[int, str, int] | None:
	index = _skip_link_whitespace(text, open_index + 1)
	destination_start = index
	if index < len(text) and text[index] == "<":
		index += 1
		while index < len(text) and text[index] not in {">", "\n", "\r"}:
			if text[index] == "<" or _is_ascii_control(text[index]):
				return None
			if _is_escapable_at(text, index):
				index += 2
			else:
				index += 1
		if index >= len(text) or text[index] != ">":
			return None
		index += 1
		destination_end = index
	else:
		depth = 0
		while index < len(text):
			character = text[index]
			if _is_escapable_at(text, index):
				index += 2
				continue
			if character == "<":
				return None
			if character == "(":
				depth += 1
			elif character == ")":
				if depth == 0:
					destination_end = index
					return index + 1, text[destination_start:destination_end], destination_start
				depth -= 1
			elif character in {" ", "\t", "\r", "\n"}:
				if depth != 0:
					return None
				break
			elif _is_ascii_control(character):
				return None
			index += 1
		if depth != 0:
			return None
		destination_end = index

	whitespace_start = index
	index = _skip_link_whitespace(text, index)
	if index < len(text) and text[index] == ")":
		return index + 1, text[destination_start:destination_end], destination_start
	if index == whitespace_start:
		return None
	title_end = _link_title_end(text, index)
	if title_end is None:
		return None
	index = title_end
	index = _skip_link_whitespace(text, index)
	if index >= len(text) or text[index] != ")":
		return None
	return index + 1, text[destination_start:destination_end], destination_start


def _link_title_end(text: str, start: int) -> int | None:
	if start >= len(text) or text[start] not in {'"', "'", "("}:
		return None
	closing = ")" if text[start] == "(" else text[start]
	index = start + 1
	while index < len(text):
		if _is_escapable_at(text, index):
			index += 2
			continue
		if text[start] == "(" and text[index] == "(":
			return None
		if text[index] == closing:
			if re.search(r"(?:\r\n?|\n)[ \t]*(?:\r\n?|\n)", text[start + 1 : index]):
				return None
			return index + 1
		index += 1
	return None


def _skip_link_whitespace(text: str, start: int) -> int:
	index = start
	while index < len(text) and text[index] in {" ", "\t"}:
		index += 1
	if index < len(text) and text[index] in {"\r", "\n"}:
		if text[index] == "\r" and index + 1 < len(text) and text[index + 1] == "\n":
			index += 2
		else:
			index += 1
		while index < len(text) and text[index] in {" ", "\t"}:
			index += 1
	return index


def _is_ascii_control(character: str) -> bool:
	return ord(character) < 32 or ord(character) == 127


def _is_escapable_at(text: str, index: int) -> bool:
	return (
		index + 1 < len(text)
		and text[index] == "\\"
		and text[index + 1] in "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"
	)


def _scan_reference_definitions(text: str) -> tuple[_ReferenceDefinition, ...]:
	lines = text.splitlines(keepends=True)
	projected, contexts = _container_context_projection(text)
	projected_lines = projected.splitlines(keepends=True)
	block_visible = _mask_container_block_lines(
		text, include_indented=False, include_html=True
	).splitlines(keepends=True)
	offsets: list[int] = []
	position = 0
	for line in lines:
		offsets.append(position)
		position += len(line)
	definitions: list[_ReferenceDefinition] = []
	index = 0
	paragraph_open = False
	previous_context: tuple[tuple[str, int], ...] | None = None
	while index < len(lines):
		projected_line = projected_lines[index].rstrip("\r\n")
		content = projected_line
		context = contexts[index]
		if context != previous_context:
			paragraph_open = False
		if _is_blank_line(content):
			paragraph_open = False
			previous_context = context
			index += 1
			continue

		parsed: tuple[int, str, int, str] | None = None
		logical = ""
		source_positions: tuple[int, ...] = ()
		inside_html_block = _is_blank_line(block_visible[index])
		if (
			not paragraph_open
			and not inside_html_block
			and REFERENCE_DEFINITION_CANDIDATE_RE.match(content)
		):
			logical, source_positions = _reference_block_projection(lines, offsets, index)
			parsed = _parse_reference_definition_block(logical)
		if parsed is None:
			paragraph_open = not _starts_block_line(content)
			previous_context = context
			index += 1
			continue

		logical_end, destination, destination_index, normalized_label = parsed
		consumed = logical[:logical_end]
		consumed_lines = consumed.count("\n")
		end_line = index + consumed_lines
		if not consumed.endswith("\n"):
			end_line += 1
		destination_offset = source_positions[destination_index]
		definitions.append(
			_ReferenceDefinition(
				offsets[index],
				position if end_line == len(lines) else offsets[end_line],
				destination,
				destination_offset,
				text.count("\n", 0, destination_offset) + 1,
				normalized_label,
			)
		)
		index = end_line
		paragraph_open = False
		previous_context = None
	return tuple(definitions)


def _parse_reference_definition_block(value: str) -> tuple[int, str, int, str] | None:
	index = 0
	while index < len(value) and value[index] == " " and index < 3:
		index += 1
	if index >= len(value) or value[index] != "[" or value.startswith("[^", index):
		return None
	label_start = index + 1
	index = label_start
	while index < len(value):
		if _is_escapable_at(value, index):
			index += 2
			continue
		if value[index] == "[":
			return None
		if value[index] == "]":
			if index + 1 < len(value) and value[index + 1] == ":":
				break
			return None
		index += 1
	label = value[label_start:index]
	if index >= len(value) or len(label) > 999 or not _is_valid_reference_label(label):
		return None
	index += 2
	while index < len(value) and value[index] in {" ", "\t"}:
		index += 1
	if index < len(value) and value[index] == "\n":
		index += 1
		indent = 0
		while index < len(value) and value[index] == " " and indent < 3:
			index += 1
			indent += 1
	destination_start = index
	destination_end = _reference_destination_end(value, destination_start)
	if destination_end is None:
		return None

	index = destination_end
	while index < len(value) and value[index] in {" ", "\t"}:
		index += 1
	if index >= len(value):
		return (
			len(value),
			value[destination_start:destination_end],
			destination_start,
			_normalize_reference_label(label),
		)

	title_on_next_line = value[index] == "\n"
	base_end: int | None = index + 1 if title_on_next_line else None
	if title_on_next_line:
		index += 1
		indent = 0
		while index < len(value) and value[index] == " " and indent < 3:
			index += 1
			indent += 1
	if index >= len(value) or value[index] not in {'"', "'", "("}:
		if base_end is None:
			return None
		return (
			base_end,
			value[destination_start:destination_end],
			destination_start,
			_normalize_reference_label(label),
		)
	title_end = _link_title_end(value, index)
	if title_end is None:
		if base_end is not None:
			return (
				base_end,
				value[destination_start:destination_end],
				destination_start,
				_normalize_reference_label(label),
			)
		return None
	definition_end = _definition_line_end(value, title_end)
	if definition_end is None:
		if base_end is not None:
			return (
				base_end,
				value[destination_start:destination_end],
				destination_start,
				_normalize_reference_label(label),
			)
		return None
	return (
		definition_end,
		value[destination_start:destination_end],
		destination_start,
		_normalize_reference_label(label),
	)


def _reference_destination_end(value: str, start: int) -> int | None:
	if start >= len(value):
		return None
	if value[start] == "<":
		index = start + 1
		while index < len(value) and value[index] != ">":
			if value[index] in {"<", "\r", "\n"} or _is_ascii_control(value[index]):
				return None
			if _is_escapable_at(value, index):
				index += 2
			else:
				index += 1
		return index + 1 if index < len(value) else None

	depth = 0
	index = start
	while index < len(value):
		character = value[index]
		if _is_escapable_at(value, index):
			index += 2
			continue
		if character == "<":
			return None
		if character == "(":
			depth += 1
		elif character == ")":
			if depth == 0:
				return None
			depth -= 1
		elif character in {" ", "\t", "\r", "\n"}:
			break
		elif _is_ascii_control(character):
			return None
		index += 1
	return index if index > start and depth == 0 else None


def _definition_line_end(value: str, start: int) -> int | None:
	index = start
	while index < len(value) and value[index] in {" ", "\t"}:
		index += 1
	if index == len(value):
		return index
	return index + 1 if value[index] == "\n" else None


def _reference_block_projection(
	lines: list[str], offsets: list[int], start_line: int
) -> tuple[str, tuple[int, ...]]:
	characters: list[str] = []
	source_positions: list[int] = []
	start_text = lines[start_line].rstrip("\r\n")
	start_parts = _container_prefix_parts(start_text)
	for line_index in range(start_line, len(lines)):
		line = lines[line_index]
		line_text = line.rstrip("\r\n")
		prefix_end = _reference_content_start(line_text, start_parts, line_index == start_line)
		if prefix_end is None:
			break
		content = line_text[prefix_end:]
		if not content.strip(" \t"):
			break
		content_start = offsets[line_index] + prefix_end
		characters.extend(content)
		source_positions.extend(range(content_start, content_start + len(content)))
		if line.endswith(("\n", "\r")):
			characters.append("\n")
			source_positions.append(offsets[line_index] + len(line_text))
	return "".join(characters), tuple(source_positions)


def _normalize_reference_label(label: str) -> str:
	return re.sub(r"[ \t\r\n]+", " ", label).strip(" \t\r\n").casefold()


def _is_valid_reference_label(label: str) -> bool:
	if not 1 <= len(label) <= 999 or not label.strip(" \t\r\n"):
		return False
	index = 0
	while index < len(label):
		if _is_escapable_at(label, index):
			index += 2
			continue
		if label[index] in {"[", "]"}:
			return False
		index += 1
	return True


def _container_prefix(line: str) -> tuple[int, tuple[str, ...], bool]:
	parts = _container_prefix_parts(line)
	end = parts[-1].end if parts else 0
	container = tuple(part.kind for part in parts)
	return end, container, "list" in container


def _container_prefix_parts(line: str) -> tuple[_ContainerPart, ...]:
	index = 0
	parts: list[_ContainerPart] = []
	while index < len(line):
		part_start = index
		indent = 0
		while index < len(line) and line[index] == " " and indent < 3:
			index += 1
			indent += 1
		if index < len(line) and line[index] == ">":
			index += 1
			if index < len(line) and line[index] in {" ", "\t"}:
				index += 1
			parts.append(
				_ContainerPart(">", part_start, index, _visual_width(line, part_start, index))
			)
			continue
		list_match = re.match(r"(?:[-+*]|\d{1,9}[.)])", line[index:])
		if (
			list_match is not None
			and index + list_match.end() < len(line)
			and line[index + list_match.end()] in {" ", "\t"}
		):
			marker_end = index + list_match.end()
			index = _list_padding_end(line, marker_end)
			parts.append(
				_ContainerPart("list", part_start, index, _visual_width(line, part_start, index))
			)
			continue
		break
	return tuple(parts)


def _list_padding_end(line: str, marker_end: int) -> int:
	whitespace_end = marker_end
	while whitespace_end < len(line) and line[whitespace_end] in {" ", "\t"}:
		whitespace_end += 1
	if whitespace_end == len(line):
		return whitespace_end
	padding_columns = _visual_width(line, marker_end, whitespace_end)
	if padding_columns <= 4:
		return whitespace_end
	return marker_end + 1 if line[marker_end] == " " else marker_end


def _visual_width(line: str, start: int, end: int) -> int:
	column = 0
	start_column = 0
	for index, character in enumerate(line[:end]):
		if index == start:
			start_column = column
		column += 4 - (column % 4) if character == "\t" else 1
	if start == end:
		start_column = column
	return column - start_column


def _reference_content_start(
	line: str, start_parts: tuple[_ContainerPart, ...], first_line: bool
) -> int | None:
	if first_line:
		return start_parts[-1].end if start_parts else 0
	index = 0
	for part in start_parts:
		if part.kind == "list":
			index = _consume_indent(line, index, part.columns)
			if index is None:
				return None
			continue
		indent = 0
		while index < len(line) and line[index] == " " and indent < 3:
			index += 1
			indent += 1
		if index >= len(line) or line[index] != ">":
			return None
		index += 1
		if index < len(line) and line[index] in {" ", "\t"}:
			index += 1
	return index


def _consume_indent(line: str, start: int, required_columns: int) -> int | None:
	index = start
	columns = 0
	while index < len(line) and columns < required_columns:
		if line[index] == " ":
			columns += 1
		elif line[index] == "\t":
			columns += 4 - (columns % 4)
		else:
			return None
		index += 1
	return index if columns >= required_columns else None


def _mask_container_prefixes(text: str) -> str:
	characters = list(text)
	position = 0
	for line in text.splitlines(keepends=True):
		prefix_end, _, _ = _container_prefix(line.rstrip("\r\n"))
		for index in range(position, position + prefix_end):
			if characters[index] not in {"\r", "\n"}:
				characters[index] = " "
		position += len(line)
	return "".join(characters)


def _container_context_projection(
	text: str,
) -> tuple[str, tuple[tuple[tuple[str, int], ...], ...]]:
	projected: list[str] = []
	contexts: list[tuple[tuple[str, int], ...]] = []
	active_parts: tuple[_ContainerPart, ...] = ()
	active_context: tuple[tuple[str, int], ...] = ()
	next_list_id = 0
	paragraph_open = False
	for line in text.splitlines(keepends=True):
		line_text = line.rstrip("\r\n")
		line_ending = line[len(line_text) :]
		prefix_end = 0
		parts: tuple[_ContainerPart, ...] = ()
		context: list[tuple[str, int]] = []
		if active_parts:
			continuation_end = _reference_content_start(line_text, active_parts, False)
			if continuation_end is not None:
				prefix_end = continuation_end
				parts = active_parts
				context.extend(active_context)
			elif _is_blank_line(line_text):
				parts = active_parts
				context.extend(active_context)

		additional = _container_prefix_parts(line_text[prefix_end:])
		if (
			paragraph_open
			and prefix_end == 0
			and _noninterrupting_ordered_list(line_text, additional)
		):
			additional = ()
		if additional:
			adjusted = tuple(
				_ContainerPart(
					part.kind,
					part.start + prefix_end,
					part.end + prefix_end,
					part.columns,
				)
				for part in additional
			)
			parts += adjusted
			prefix_end = adjusted[-1].end
			for part in adjusted:
				if part.kind == "list":
					context.append((part.kind, next_list_id))
					next_list_id += 1
				else:
					context.append((part.kind, len(context)))

		if any(part.kind == "list" for part in parts):
			active_parts = parts
			active_context = tuple(context)
		elif not _is_blank_line(line_text[prefix_end:]):
			active_parts = ()
			active_context = ()

		projected.append(line_text[prefix_end:] + line_ending)
		contexts.append(tuple(context))
		content = line_text[prefix_end:]
		if _is_blank_line(content):
			paragraph_open = False
		else:
			paragraph_open = not _starts_block_line(content)
	return "".join(projected), tuple(contexts)


def _noninterrupting_ordered_list(line: str, parts: tuple[_ContainerPart, ...]) -> bool:
	if not parts or parts[0].kind != "list":
		return False
	marker = line[parts[0].start : parts[0].end]
	match = re.search(r"(?P<start>\d{1,9})[.)](?=[ \t])", marker)
	return match is not None and int(match.group("start")) != 1


def _mask_container_block_lines(
	text: str, *, include_indented: bool = True, include_html: bool = True
) -> str:
	projected, contexts = _container_context_projection(text)
	masked = _mask_projected_blocks(projected, contexts, include_indented, include_html)
	original_lines = text.splitlines(keepends=True)
	projected_lines = projected.splitlines(keepends=True)
	masked_lines = masked.splitlines(keepends=True)
	for index, (projected_line, masked_line) in enumerate(zip(projected_lines, masked_lines)):
		if not _is_blank_line(projected_line) and _is_blank_line(masked_line):
			original_lines[index] = "".join(
				"\n" if character == "\n" else " " for character in original_lines[index]
			)
	return "".join(original_lines)


def _mask_projected_blocks(
	text: str,
	contexts: tuple[tuple[tuple[str, int], ...], ...],
	include_indented: bool,
	include_html: bool,
) -> str:
	masked_segments: list[str] = []
	for segment in _container_segments(text, contexts):
		masked = _mask_fenced_code(segment)
		if include_indented:
			masked = _mask_indented_code(masked)
		if include_html:
			masked = _mask_html_blocks(masked)
		masked_segments.append(masked)
	return "".join(masked_segments)


def _container_segments(
	text: str, contexts: tuple[tuple[tuple[str, int], ...], ...]
) -> tuple[str, ...]:
	lines = text.splitlines(keepends=True)
	if not lines:
		return ()
	segments: list[str] = []
	start = 0
	for index in range(1, len(lines)):
		if contexts[index] != contexts[index - 1]:
			segments.append("".join(lines[start:index]))
			start = index
	segments.append("".join(lines[start:]))
	return tuple(segments)


def _starts_block_line(content: str) -> bool:
	return bool(
		ATX_HEADING_RE.match(content)
		or SETEXT_HEADING_RE.match(content)
		or INDENTED_CODE_RE.match(content)
		or SETEXT_NON_PARAGRAPH_RE.match(content)
		or FENCE_RE.match(content)
		or _html_block_end_condition(content, False)
	)


def _is_blank_line(line: str) -> bool:
	return not line.strip(" \t\r\n")


def _mask_spans(text: str, spans: Iterable[tuple[int, int]]) -> str:
	characters = list(text)
	for start, end in spans:
		for index in range(start, end):
			if characters[index] != "\n":
				characters[index] = " "
	return "".join(characters)


def _paragraph_ranges(text: str) -> tuple[tuple[int, int], ...]:
	ranges: list[tuple[int, int]] = []
	position = 0
	for match in PARAGRAPH_BREAK_RE.finditer(text):
		ranges.append((position, match.start()))
		position = match.end()
	ranges.append((position, len(text)))
	return tuple(ranges)


def _code_span_end(text: str, start: int, limit: int | None = None) -> int | None:
	limit = len(text) if limit is None else limit
	run_end = start
	while run_end < limit and text[run_end] == "`":
		run_end += 1
	run_length = run_end - start
	search = run_end
	while search < limit:
		if text[search] != "`":
			search += 1
			continue
		candidate_end = search
		while candidate_end < limit and text[candidate_end] == "`":
			candidate_end += 1
		if candidate_end - search == run_length:
			return candidate_end
		search = candidate_end
	return None


def _mask_fenced_code(text: str) -> str:
	characters = list(text)
	position = 0
	open_character: str | None = None
	open_length = 0
	for line in text.splitlines(keepends=True):
		match = FENCE_RE.match(line)
		was_open = open_character is not None
		opening = False
		closing = False
		if match and not was_open and _is_valid_fence_opener(line, match):
			fence = match.group("fence")
			open_character = fence[0]
			open_length = len(fence)
			opening = True
		elif match and was_open:
			fence = match.group("fence")
			closing = (
				fence[0] == open_character
				and len(fence) >= open_length
				and _is_blank_line(line[match.end() :])
			)

		if was_open or opening:
			for index in range(position, position + len(line)):
				if characters[index] != "\n":
					characters[index] = " "
		if closing:
			open_character = None
			open_length = 0
		position += len(line)
	return "".join(characters)


def _mask_inline_code(text: str) -> str:
	characters = list(text)
	for start, limit in _paragraph_ranges(text):
		index = start
		while index < limit:
			if text[index] != "`" or _is_escaped(text, index):
				index += 1
				continue
			closing_end = _code_span_end(text, index, limit)
			if closing_end is None:
				index += 1
				continue
			for masked_index in range(index, closing_end):
				if characters[masked_index] != "\n":
					characters[masked_index] = " "
			index = closing_end
	return "".join(characters)


def _anchors_for(
	path: Path, cache: dict[Path, tuple[set[str] | None, str | None]]
) -> tuple[set[str] | None, str | None]:
	if path in cache:
		return cache[path]
	try:
		text = path.read_text(encoding="utf-8")
	except (OSError, UnicodeError) as exc:
		result = (None, f"cannot read linked Markdown as UTF-8: {exc}")
		cache[path] = result
		return result

	visible = _mask_yaml_frontmatter(text)
	definition_visible = _mask_container_block_lines(
		visible, include_indented=False, include_html=False
	)
	heading_definitions = _scan_reference_definitions(definition_visible)
	reference_labels = frozenset(definition.normalized_label for definition in heading_definitions)
	visible = _mask_spans(
		definition_visible,
		((definition.start, definition.end) for definition in heading_definitions),
	)
	projected_visible, heading_contexts = _container_context_projection(visible)
	visible = _mask_projected_blocks(
		projected_visible, heading_contexts, include_indented=True, include_html=False
	)
	heading_visible = _mask_projected_blocks(
		projected_visible, heading_contexts, include_indented=True, include_html=True
	)
	anchors: set[str] = set()
	lines = heading_visible.splitlines()
	for index, line in enumerate(lines):
		match = ATX_HEADING_RE.match(line)
		if match and match.group("title"):
			_add_heading_anchor(anchors, match.group("title"), reference_labels)
			continue

		setext_match = SETEXT_HEADING_RE.match(line)
		if not setext_match:
			continue
		title = _setext_heading_title(lines, heading_contexts, index)
		if title:
			_add_heading_anchor(anchors, title, reference_labels)

	for segment in _container_segments(visible, heading_contexts):
		for start, end in _html_block_spans(segment):
			anchors.update(_html_anchors_for(segment[start:end]))

	inline_html_visible = _mask_projected_blocks(
		visible, heading_contexts, include_indented=False, include_html=True
	)
	inline_html_visible = _mask_inline_code(inline_html_visible)
	links = _scan_markdown_links(inline_html_visible, reference_labels)
	inline_html_visible = _mask_spans(
		inline_html_visible,
		(
			(link.start, link.end) if link.is_image else (link.suffix_start, link.end)
			for link in links
		),
	)
	inline_html_visible = _mask_escaped_html(inline_html_visible)
	anchors.update(_inline_html_anchors_for(inline_html_visible))

	result = (anchors, None)
	cache[path] = result
	return result


def _setext_heading_title(
	lines: list[str], contexts: tuple[tuple[tuple[str, int], ...], ...], underline_index: int
) -> str | None:
	if underline_index == 0:
		return None
	start = underline_index - 1
	while (
		start > 0
		and lines[start - 1].strip(" \t")
		and not ATX_HEADING_RE.match(lines[start - 1])
		and not SETEXT_HEADING_RE.match(lines[start - 1])
	):
		start -= 1
	title_lines = lines[start:underline_index]
	if not title_lines or any(
		INDENTED_CODE_RE.match(line)
		or SETEXT_NON_PARAGRAPH_RE.match(line)
		or SETEXT_HEADING_RE.match(line)
		for line in title_lines
	):
		return None
	if any(contexts[index] != contexts[underline_index] for index in range(start, underline_index)):
		return None
	title = " ".join(line.strip(" \t") for line in title_lines)
	return title or None


def _add_heading_anchor(anchors: set[str], title: str, reference_labels: frozenset[str]) -> None:
	base = _github_like_slug(title, reference_labels)
	if not base:
		return
	anchor = base
	suffix = 1
	while anchor in anchors:
		anchor = f"{base}-{suffix}"
		suffix += 1
	anchors.add(anchor)


def _html_anchors_for(text: str) -> set[str]:
	parser = _AnchorHTMLParser()
	parser.feed(text)
	parser.close()
	return parser.anchors


def _inline_html_anchors_for(text: str) -> set[str]:
	parser = _AnchorHTMLParser()
	for match in INLINE_RAW_HTML_TOKEN_RE.finditer(text):
		if _is_escaped(text, match.start()):
			continue
		parser.feed(match.group(0))
	parser.close()
	return parser.anchors


def _mask_yaml_frontmatter(text: str) -> str:
	lines = text.splitlines(keepends=True)
	if not lines or not YAML_FRONTMATTER_DELIMITER_RE.fullmatch(lines[0].rstrip("\r\n")):
		return text
	try:
		closing_index = next(
			index
			for index, line in enumerate(lines[1:], start=1)
			if YAML_FRONTMATTER_DELIMITER_RE.fullmatch(line.rstrip("\r\n"))
		)
	except StopIteration:
		return text
	characters = list(text)
	for index in range(sum(len(line) for line in lines[: closing_index + 1])):
		if characters[index] != "\n":
			characters[index] = " "
	return "".join(characters)


def _mask_html_blocks(text: str) -> str:
	return _mask_spans(text, _html_block_spans(text))


def _html_block_spans(text: str) -> tuple[tuple[int, int], ...]:
	lines = text.splitlines(keepends=True)
	offsets: list[int] = []
	position = 0
	for line in lines:
		offsets.append(position)
		position += len(line)
	spans: list[tuple[int, int]] = []
	index = 0
	paragraph_open = False
	open_fence_character: str | None = None
	open_fence_length = 0
	while index < len(lines):
		line = lines[index]
		fence_match = FENCE_RE.match(line)
		if open_fence_character is not None:
			if fence_match:
				fence = fence_match.group("fence")
				if (
					fence[0] == open_fence_character
					and len(fence) >= open_fence_length
					and _is_blank_line(line[fence_match.end() :])
				):
					open_fence_character = None
					open_fence_length = 0
			index += 1
			paragraph_open = False
			continue
		if fence_match and _is_valid_fence_opener(line, fence_match):
			fence = fence_match.group("fence")
			open_fence_character = fence[0]
			open_fence_length = len(fence)
			index += 1
			paragraph_open = False
			continue

		condition = _html_block_end_condition(line, paragraph_open)
		if condition is not None:
			end_index = _html_block_end_index(lines, index, condition)
			spans.append(
				(
					offsets[index],
					position if end_index == len(lines) else offsets[end_index],
				)
			)
			index = end_index
			paragraph_open = False
			continue

		if _is_blank_line(line):
			paragraph_open = False
		elif (
			ATX_HEADING_RE.match(line)
			or SETEXT_HEADING_RE.match(line)
			or INDENTED_CODE_RE.match(line)
			or SETEXT_NON_PARAGRAPH_RE.match(line)
		):
			paragraph_open = False
		else:
			paragraph_open = True
		index += 1
	return tuple(spans)


def _mask_indented_code(text: str) -> str:
	lines = text.splitlines(keepends=True)
	masked_lines = list(lines)
	index = 0
	paragraph_open = False
	code_open = False
	while index < len(lines):
		line = lines[index]
		if code_open:
			if _is_blank_line(line) or INDENTED_CODE_RE.match(line):
				masked_lines[index] = "".join(
					"\n" if character == "\n" else " " for character in line
				)
				index += 1
				continue
			code_open = False

		condition = _html_block_end_condition(line, paragraph_open)
		if condition is not None:
			index = _html_block_end_index(lines, index, condition)
			paragraph_open = False
			continue

		if _is_blank_line(line):
			paragraph_open = False
		elif INDENTED_CODE_RE.match(line) and not paragraph_open:
			masked_lines[index] = "".join("\n" if character == "\n" else " " for character in line)
			code_open = True
			paragraph_open = False
		elif (
			ATX_HEADING_RE.match(line)
			or SETEXT_HEADING_RE.match(line)
			or SETEXT_NON_PARAGRAPH_RE.match(line)
		):
			paragraph_open = False
		else:
			paragraph_open = True
		index += 1
	return "".join(masked_lines)


def _mask_escaped_html(text: str) -> str:
	characters = list(text)
	for index, character in enumerate(text):
		if character == "<" and _is_escaped(text, index):
			characters[index] = " "
	return "".join(characters)


def _mask_inline_raw_html_tokens(text: str) -> str:
	characters = list(text)
	for match in INLINE_RAW_HTML_TOKEN_RE.finditer(text):
		if _is_escaped(text, match.start()):
			continue
		for index in range(match.start(), match.end()):
			if characters[index] != "\n":
				characters[index] = " "
	return "".join(characters)


def _is_valid_fence_opener(line: str, match: re.Match[str]) -> bool:
	fence = match.group("fence")
	return fence[0] == "~" or "`" not in line[match.end() :]


def _html_block_end_condition(
	line: str, paragraph_open: bool
) -> tuple[re.Pattern[str] | None, bool] | None:
	for start_pattern, end_pattern in (
		(HTML_BLOCK_LITERAL_START_RE, HTML_BLOCK_LITERAL_END_RE),
		(HTML_BLOCK_COMMENT_START_RE, HTML_BLOCK_COMMENT_END_RE),
		(HTML_BLOCK_PROCESSING_START_RE, HTML_BLOCK_PROCESSING_END_RE),
		(HTML_BLOCK_DECLARATION_START_RE, HTML_BLOCK_DECLARATION_END_RE),
		(HTML_BLOCK_CDATA_START_RE, HTML_BLOCK_CDATA_END_RE),
	):
		if start_pattern.match(line):
			return end_pattern, False
	if HTML_BLOCK_TAG_START_RE.match(line):
		return None, True
	if not paragraph_open and HTML_BLOCK_COMPLETE_TAG_RE.match(line):
		return None, True
	return None


def _html_block_end_index(
	lines: list[str], start_index: int, condition: tuple[re.Pattern[str] | None, bool]
) -> int:
	end_pattern, blank_terminated = condition
	end_index = start_index + 1
	if blank_terminated:
		while end_index < len(lines) and not _is_blank_line(lines[end_index]):
			end_index += 1
		return end_index
	while end_pattern is not None and not end_pattern.search(lines[end_index - 1]):
		if end_index == len(lines):
			break
		end_index += 1
	return end_index


def _github_like_slug(title: str, reference_labels: frozenset[str] = frozenset()) -> str:
	value = _project_link_labels(title, reference_labels)
	value, code_spans = _protect_code_spans(value)
	previous = None
	while value != previous:
		previous = value
		value = _strip_emphasis(value, ASTERISK_EMPHASIS_RE, "*")
		value = _strip_emphasis(value, UNDERSCORE_EMPHASIS_RE, "_")
	value = _replace_autolinks(value)
	value = _remove_inline_raw_html_tokens(value)
	value = _markdown_unescape(value)
	value = html.unescape(value)
	for placeholder, content in code_spans:
		value = value.replace(placeholder, content)
	value = value.lower().strip()
	parts: list[str] = []
	for character in value:
		category = unicodedata.category(character)
		if character.isspace():
			parts.append("-")
		elif character in {"-", "_"} or category[0] in {"L", "M", "N"}:
			parts.append(character)
	return "".join(parts)


def _strip_emphasis(text: str, pattern: re.Pattern[str], delimiter: str) -> str:
	def replace(match: re.Match[str]) -> str:
		closing_start = match.end("label")
		if _is_escaped(text, match.start()) or _is_escaped(text, closing_start):
			return match.group(0)
		opening_left, opening_right = _delimiter_flanking(
			text, match.start(), match.end("delimiter")
		)
		closing_left, closing_right = _delimiter_flanking(text, closing_start, match.end())
		if delimiter == "_":
			before_open = text[match.start() - 1] if match.start() else None
			after_close = text[match.end()] if match.end() < len(text) else None
			can_open = opening_left and (not opening_right or _is_unicode_punctuation(before_open))
			can_close = closing_right and (not closing_left or _is_unicode_punctuation(after_close))
		else:
			can_open = opening_left
			can_close = closing_right
		return match.group("label") if can_open and can_close else match.group(0)

	return pattern.sub(replace, text)


def _delimiter_flanking(text: str, start: int, end: int) -> tuple[bool, bool]:
	before = text[start - 1] if start else None
	after = text[end] if end < len(text) else None
	before_whitespace = before is None or before.isspace()
	after_whitespace = after is None or after.isspace()
	before_punctuation = _is_unicode_punctuation(before)
	after_punctuation = _is_unicode_punctuation(after)
	left_flanking = not after_whitespace and (
		not after_punctuation or before_whitespace or before_punctuation
	)
	right_flanking = not before_whitespace and (
		not before_punctuation or after_whitespace or after_punctuation
	)
	return left_flanking, right_flanking


def _is_unicode_punctuation(character: str | None) -> bool:
	return character is not None and unicodedata.category(character).startswith("P")


def _project_link_labels(text: str, reference_labels: frozenset[str]) -> str:
	value = text
	for link in reversed(_scan_markdown_links(text, reference_labels)):
		value = value[: link.start] + text[link.label_start : link.label_end] + value[link.end :]
	return value


def _replace_autolinks(text: str) -> str:
	parts: list[str] = []
	position = 0
	for match in AUTOLINK_RE.finditer(text):
		if _is_escaped(text, match.start()):
			continue
		parts.extend((text[position : match.start()], match.group("label")))
		position = match.end()
	parts.append(text[position:])
	return "".join(parts)


def _protect_code_spans(text: str) -> tuple[str, tuple[tuple[str, str], ...]]:
	parts: list[str] = []
	protected: list[tuple[str, str]] = []
	position = 0
	index = 0
	while index < len(text):
		if text[index] != "`" or _is_escaped(text, index):
			index += 1
			continue
		end = _code_span_end(text, index)
		if end is None:
			index += 1
			continue
		run_end = index
		while run_end < len(text) and text[run_end] == "`":
			run_end += 1
		run_length = run_end - index
		content = text[run_end : end - run_length]
		normalized = re.sub(r"\s+", " ", content)
		if normalized.startswith(" ") and normalized.endswith(" ") and normalized.strip():
			normalized = normalized[1:-1]
		normalized = re.sub(r"\s+", " ", normalized.replace("`", "")).strip()
		placeholder = f"\x00code-span-{len(protected)}\x00"
		parts.extend((text[position:index], placeholder))
		protected.append((placeholder, normalized))
		position = end
		index = end
	parts.append(text[position:])
	return "".join(parts), tuple(protected)


def _remove_inline_raw_html_tokens(text: str) -> str:
	parts: list[str] = []
	position = 0
	for match in INLINE_RAW_HTML_TOKEN_RE.finditer(text):
		if _is_escaped(text, match.start()):
			continue
		parts.append(text[position : match.start()])
		position = match.end()
	parts.append(text[position:])
	return "".join(parts)


def _is_visible_directory(path: Path) -> bool:
	return path.is_dir() and not path.name.startswith(".") and not path.name.startswith("_")


def _selection_issue_root(candidates: tuple[SkillCandidate, ...]) -> Path:
	if candidates:
		return candidates[0].directory.parent
	return Path("skills")


def _issue(
	candidate: SkillCandidate,
	path: Path,
	code: str,
	message: str,
	line: int | None = None,
	is_warning: bool = False,
) -> SkillIssue:
	return SkillIssue(candidate.key, path, line, code, message, is_warning)


def _unwrap_destination(destination: str) -> str:
	destination = destination.strip(" \t\r\n")
	if destination.startswith("<") and destination.endswith(">"):
		return destination[1:-1]
	return destination


def _markdown_unescape(value: str) -> str:
	return MARKDOWN_ESCAPE_RE.sub(lambda match: match.group(1), value)


def _is_ignored_destination(destination: str) -> bool:
	return (
		not destination
		or bool(SCHEME_RE.match(destination))
		or destination.startswith("//")
		or destination.startswith("/")
	)


def _is_within(path: Path, parent: Path) -> bool:
	resolved_path = path.resolve()
	resolved_parent = parent.resolve()
	return resolved_path == resolved_parent or resolved_parent in resolved_path.parents


def _relative_display(path: Path, root: Path) -> str:
	try:
		return str(path.relative_to(root.resolve()))
	except ValueError:
		return str(path)


def _is_escaped(text: str, index: int) -> bool:
	backslashes = 0
	index -= 1
	while index >= 0 and text[index] == "\\":
		backslashes += 1
		index -= 1
	return backslashes % 2 == 1
