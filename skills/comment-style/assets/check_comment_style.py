#!/usr/bin/env python3
# tools/check_comment_style.py
# check Python & Swift headers, comments, & large-unit block docs

from __future__ import annotations

import argparse
import ast
import io
import re
import subprocess
import sys
import tokenize
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

ROOT = Path.cwd()
PYTHON_ROOTS: tuple[Path, ...] = (ROOT,)
SWIFT_ROOT = ROOT
PYTHON_ENCODING_RE = re.compile(r"coding[:=]\s*[-\w.]+")
PYTHON_TOOLING_RE = re.compile(
	r"^#\s*(?:noqa\b|type:\s*ignore\b|pragma:\s*no cover\b|pyright:|mypy:|ruff:|fmt:|isort:|coverage:)",
	re.IGNORECASE,
)
SWIFT_TOOLING_RE = re.compile(r"^//\s*swiftlint:", re.IGNORECASE)
# word-bounded so the rule cannot fire on a substring; callers pass only the code portion of a line
SWIFT_PREVIEW_PROVIDER_RE = re.compile(r"\bPreviewProvider\b")
TODO_PREFIX_RE = re.compile(r"^(?:#|//)\s*todo\b", re.IGNORECASE)
VALID_TODO_RE = re.compile(r"^(?:#|//) TODO(?:\([a-z0-9][a-z0-9._/-]*\):)?\s+\S")
TAG_PREFIX_RE = re.compile(r"^(?:#|//)\s*([*!?])")
VALID_TAG_RE = re.compile(r"^(?:#|//) [*!?] \S")
LEGACY_TAG_RE = re.compile(
	r"^(?:#|//)\s*(?:FOOTGUN|HACK|NOTE|WARN(?:ING)?|FIXME|XXX):\s*",
	re.IGNORECASE,
)
PLAIN_COMMENT_RE = re.compile(r"^(?:#|//)\s+([A-Z][^\s]*)")
SKIP_PARTS = {".venv", "__pycache__", "migrations", "node_modules"}
TEST_DIR_PARTS = {"test", "tests", "e2e"}
SWIFT_SKIP_PARTS = {"Pods", "Carthage", ".build", "DerivedData"}
UNDECODABLE_MESSAGE = "file is not valid UTF-8; skipped"
UNREADABLE_MESSAGE = "file could not be read; skipped"


@dataclass(frozen=True)
class Violation:
	path: Path
	line: int
	message: str

	def render(self) -> str:
		return f"{self.path.relative_to(ROOT)}:{self.line}: {self.message}"


def split_keepends(text: str) -> list[str]:
	return text.splitlines(keepends=True)


def line_without_newline(line: str) -> tuple[str, str]:
	if line.endswith("\r\n"):
		return line[:-2], "\r\n"
	if line.endswith("\n"):
		return line[:-1], "\n"
	return line, ""


# read a source file as UTF-8; on failure returns the reason instead of the text so one bad
# file is skipped & reported instead of aborting the run over the rest of the tree. unreadable
# is as common as undecodable in practice (permissions, a dangling symlink, a vanished file),
# so both land here rather than as a traceback that discards the results gathered so far
def read_source(path: Path) -> tuple[str | None, str | None]:
	try:
		return path.read_text(encoding="utf-8"), None
	except UnicodeDecodeError:
		return None, UNDECODABLE_MESSAGE
	except OSError as exc:
		return None, f"{UNREADABLE_MESSAGE} ({exc.strerror or exc})"


def is_within(path: Path, parent: Path) -> bool:
	resolved = path.resolve()
	root = parent.resolve()
	return resolved == root or root in resolved.parents


def python_prelude_len(lines: list[str]) -> int:
	count = 1 if lines and lines[0].startswith("#!") else 0
	if count < len(lines):
		candidate = lines[count]
		if candidate.lstrip().startswith("#") and PYTHON_ENCODING_RE.search(candidate):
			count += 1
	return count


def is_code_like_token(token: str) -> bool:
	return (
		token == "No."
		or any(char.isupper() for char in token[1:])
		or bool(re.search(r"[._\d]", token))
	)


def is_tagged_description(description: str) -> bool:
	return bool(re.match(r"^(?:[*!?](?:\s|$)|todo(?:\([^)]*\))?:?\s)", description, re.I))


def normalize_header_description(line: str, prefix: str) -> str:
	body, newline = line_without_newline(line)
	if not body.startswith(prefix):
		return line
	description = body[len(prefix) :].strip()
	if re.match(r"^[A-Z]", description):
		description = f"{description[0].lower()}{description[1:]}"
	description = description.rstrip(".")
	# hoisted out of the f-string: a backslash in an expression is a SyntaxError before 3.12
	ending = newline or "\n"
	return f"{prefix}{description}{ending}"


def normalize_python_header(path: Path, lines: list[str]) -> tuple[list[str], bool]:
	header_index = python_prelude_len(lines)
	if (
		len(lines) <= header_index + 1
		or not lines[header_index].lstrip().startswith("# ")
		or not lines[header_index + 1].lstrip().startswith("# ")
	):
		return lines, False

	changed = False
	expected = f"# {path.relative_to(ROOT).as_posix()}"
	body, newline = line_without_newline(lines[header_index])
	if body != expected:
		ending = newline or "\n"
		lines[header_index] = f"{expected}{ending}"
		changed = True
	normalized = normalize_header_description(lines[header_index + 1], "# ")
	if lines[header_index + 1] != normalized:
		lines[header_index + 1] = normalized
		changed = True
	return lines, changed


# mirrors isTestFile in assets/eslint-rules/block-doc-comments.js so one repo is judged
# the same way in Python & TypeScript
def is_test_path(path: Path) -> bool:
	relative = path.relative_to(ROOT)
	return (
		bool(TEST_DIR_PARTS.intersection(relative.parts))
		or path.stem.startswith("test_")
		or path.stem.endswith((".spec", ".test"))
	)


def docstring_expr(node: ast.AST) -> ast.Expr | None:
	body = getattr(node, "body", None)
	if not body:
		return None
	first = body[0]
	if (
		isinstance(first, ast.Expr)
		and isinstance(first.value, ast.Constant)
		and isinstance(first.value.value, str)
	):
		return first
	return None


def docstring_summary(expr: ast.Expr) -> str:
	value = expr.value.value
	paragraph = value.strip().split("\n\n", 1)[0]
	return " ".join(line.strip() for line in paragraph.splitlines()).strip()


def docstring_violations(path: Path, tree: ast.Module) -> list[Violation]:
	violations: list[Violation] = []
	# body is Module's only child-bearing field, so membership here answers "is this class
	# module-level?" without the extra whole-tree walk a parent map would cost
	toplevel = {id(child) for child in tree.body if isinstance(child, ast.ClassDef)}
	test_file = is_test_path(path)

	for node in ast.walk(tree):
		if not isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
			continue
		expr = docstring_expr(node)
		if expr is None:
			continue

		allowed = (
			isinstance(node, ast.ClassDef)
			and id(node) in toplevel
			and not node.name.startswith("_")
			and not test_file
		)
		if not allowed:
			if isinstance(node, ast.Module):
				message = "module docstrings are replaced by the two-line file header"
			elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
				message = (
					"docstrings are for classes; use a plain comment above ordinary functions"
				)
			elif test_file:
				message = "test files use plain comments, not docstrings"
			else:
				message = "docstrings are allowed only on module-level classes"
			violations.append(Violation(path, expr.lineno, message))
			continue

		summary = docstring_summary(expr)
		if not summary or not re.match(r"^(?:[A-Z0-9]|[`'\"(\[]|[a-z][A-Z])", summary):
			violations.append(
				Violation(
					path, expr.lineno, "class docstrings start with a capitalized sentence"
				)
			)
		if summary and not re.search(r"\.(?:[`'\"\])}]*)$", summary):
			violations.append(
				Violation(path, expr.lineno, "class docstring summaries end with a period")
			)
	return violations


def python_header_violations(path: Path, lines: list[str]) -> list[Violation]:
	violations: list[Violation] = []
	header_index = python_prelude_len(lines)
	expected = f"# {path.relative_to(ROOT).as_posix()}"
	if len(lines) <= header_index or line_without_newline(lines[header_index])[0] != expected:
		violations.append(Violation(path, header_index + 1, f'file header must be "{expected}"'))
	if len(lines) <= header_index + 1:
		violations.append(
			Violation(path, header_index + 2, "file header needs a lowercase purpose phrase")
		)
		return violations
	description_line = line_without_newline(lines[header_index + 1])[0]
	if not description_line.startswith("# ") or not description_line[2:].strip():
		violations.append(
			Violation(path, header_index + 2, "file header needs a lowercase purpose phrase")
		)
		return violations
	description = description_line[2:].strip()
	if not re.match(r"^[a-z0-9]", description):
		violations.append(
			Violation(path, header_index + 2, "file header purpose must begin lowercase")
		)
	if description.endswith("."):
		violations.append(
			Violation(path, header_index + 2, "file header purpose must not end with a period")
		)
	if is_tagged_description(description):
		violations.append(
			Violation(path, header_index + 2, "file header purpose must not use an annotation tag")
		)
	if len(lines) > header_index + 2 and lines[header_index + 2].startswith("#"):
		violations.append(
			Violation(
				path, header_index + 3, "file headers contain exactly two consecutive comment lines"
			)
		)
	return violations


def structured_comment_violations(path: Path, line: int, comment: str) -> list[Violation]:
	if LEGACY_TAG_RE.match(comment):
		return [Violation(path, line, "use a canonical `*`, `!`, `?`, or `TODO` annotation")]
	if TODO_PREFIX_RE.match(comment) and not VALID_TODO_RE.match(comment):
		return [
			Violation(
				path, line, "use `TODO action` or `TODO(scope): action` with a lowercase scope"
			)
		]
	if TAG_PREFIX_RE.match(comment) and not VALID_TAG_RE.match(comment):
		return [Violation(path, line, "use one space around the structured comment tag")]
	match = PLAIN_COMMENT_RE.match(comment)
	if match and not is_code_like_token(match.group(1)):
		return [
			Violation(path, line, "plain comments start lowercase; preserve exact code symbols")
		]
	return []


def normalize_comment(comment: str) -> str:
	normalized = comment.replace("→", "->")
	if (
		not TODO_PREFIX_RE.match(normalized)
		and not TAG_PREFIX_RE.match(normalized)
		and (match := PLAIN_COMMENT_RE.match(normalized))
		and not is_code_like_token(match.group(1))
	):
		marker = match.start(1)
		normalized = f"{normalized[:marker]}{normalized[marker].lower()}{normalized[marker + 1 :]}"
	return normalized


def fix_python_file(path: Path) -> bool:
	text, _ = read_source(path)
	if text is None:
		return False
	lines = split_keepends(text)
	lines, changed = normalize_python_header(path, lines)
	text = "".join(lines)
	header_index = python_prelude_len(lines)
	try:
		comments = [
			token
			for token in tokenize.generate_tokens(io.StringIO(text).readline)
			if token.type == tokenize.COMMENT
		]
	except tokenize.TokenError:
		comments = []
	for token in comments:
		if token.start[0] in {header_index + 1, header_index + 2} or PYTHON_TOOLING_RE.match(
			token.string
		):
			continue
		replacement = normalize_comment(token.string)
		if replacement == token.string:
			continue
		line_index = token.start[0] - 1
		line = lines[line_index]
		start = token.start[1]
		end = start + len(token.string)
		lines[line_index] = f"{line[:start]}{replacement}{line[end:]}"
		changed = True
	if changed:
		path.write_text("".join(lines), encoding="utf-8")
	return changed


def check_python_file(path: Path) -> list[Violation]:
	text, error = read_source(path)
	if text is None:
		return [Violation(path, 1, error or UNDECODABLE_MESSAGE)]
	lines = split_keepends(text)
	header_index = python_prelude_len(lines)
	violations = python_header_violations(path, lines)
	try:
		tree = ast.parse(text)
	except SyntaxError:
		tree = None
	if tree is not None:
		violations.extend(docstring_violations(path, tree))
	# generate_tokens is a generator, so it raises during iteration, never on the call itself
	tokens = tokenize.generate_tokens(io.StringIO(text).readline)
	try:
		for token in tokens:
			if token.type != tokenize.COMMENT:
				continue
			comment = token.string
			prefix = token.line[: token.start[1]]
			if "→" in comment:
				violations.append(
					Violation(path, token.start[0], "use ASCII ->, not the Unicode arrow")
				)
			# `#!` is a shebang only on line 1; anywhere else it is a mis-spaced `!` tag & is
			# held to the same rule comment-tags.js already applies to the `//!` form
			if (token.start[0] == 1 and comment.startswith("#!")) or PYTHON_ENCODING_RE.search(
				comment
			):
				continue
			if prefix.strip() and not PYTHON_TOOLING_RE.match(comment):
				violations.append(
					Violation(path, token.start[0], "move prose comments above the code")
				)
			if token.start[0] in {header_index + 1, header_index + 2} or PYTHON_TOOLING_RE.match(
				comment
			):
				continue
			violations.extend(structured_comment_violations(path, token.start[0], comment))
	except tokenize.TokenError as exc:
		violations.append(Violation(path, exc.args[1][0], "could not tokenize Python file"))
	return violations


# a raw-string opener: the `#` run immediately before the quote that starts the literal
SWIFT_RAW_STRING_OPEN_RE = re.compile(r'(#+)"')


# find a line comment on one Swift line while carrying `"""` literal state across lines.
# `pending` is the closing delimiter awaited from an earlier line, or None outside a literal;
# returns the comment index (-1 when none) & the delimiter still open at end of line
def scan_swift_line(line: str, pending: str | None = None) -> tuple[int, str | None]:
	# most lines hold neither a comment nor a literal delimiter; the C-level substring search
	# skips the character loop for them. `"""` is the only state a line can carry forward
	if pending is None and "//" not in line and '"""' not in line:
		return -1, None
	index = 0
	if pending is not None:
		close = line.find(pending)
		if close == -1:
			return -1, pending
		index = close + len(pending)
	in_string = False
	escaped = False
	while index < len(line):
		char = line[index]
		if escaped:
			escaped = False
			index += 1
			continue
		if char == "\\":
			escaped = True
			index += 1
			continue
		# a raw string owns every quote up to its own `"#` terminator, so the multi-line probe
		# has to run at this nesting level. probing blind would let the bare `"""` inside
		# `#"a """" b"#` open a literal that never closes & silently skip the rest of the file
		if not in_string and char == "#":
			raw = SWIFT_RAW_STRING_OPEN_RE.match(line, index)
			if raw:
				hashes = raw.group(1)
				# an opening `"""` must be followed by a newline, so anything trailing on the line
				# means this was a single-line raw string whose content merely starts w/ a quote,
				# e.g. `#"""#` -- treating that as an opener leaves a literal that never closes
				if line.startswith(f'{hashes}"""', index) and not line[index + len(hashes) + 3 :].strip():
					return -1, f'"""{hashes}'
				close = line.find(f'"{hashes}', index + len(hashes) + 1)
				# only the `"""` form spans lines, so an unterminated single-line raw string is
				# malformed; stop rather than guess at what the rest of the line means
				if close == -1:
					return -1, None
				index = close + len(hashes) + 1
				continue
			index += 1
			continue
		if not in_string and line.startswith('"""', index):
			return -1, '"""'
		if char == '"':
			in_string = not in_string
			index += 1
			continue
		if not in_string and line.startswith("//", index):
			return index, None
		index += 1
	return -1, None


# per-line scan of a whole Swift file: for each line its comment index (-1 when none) & whether
# the line sits wholly inside an open `"""` literal, plus the 1-based line that opened a literal
# still unclosed at EOF. Swift rejects an unterminated literal, so a leftover means a truncated
# file or a scanner bug; either way the tail went unchecked & the caller must say so
def scan_swift_lines(lines: list[str]) -> tuple[list[tuple[int, bool]], int | None]:
	scanned: list[tuple[int, bool]] = []
	pending: str | None = None
	opened_at: int | None = None
	for number, line in enumerate(lines, start=1):
		was_inside = pending is not None
		comment_index, pending = scan_swift_line(line_without_newline(line)[0], pending)
		if pending is not None and not was_inside:
			opened_at = number
		scanned.append((comment_index, was_inside and pending is not None))
	return scanned, opened_at if pending is not None else None


def normalize_swift_header(path: Path, lines: list[str]) -> tuple[list[str], bool]:
	if (
		len(lines) < 2
		or not lines[0].lstrip().startswith("// ")
		or not lines[1].lstrip().startswith("// ")
	):
		return lines, False
	changed = False
	expected = f"// {path.relative_to(ROOT).as_posix()}"
	body, newline = line_without_newline(lines[0])
	if body != expected:
		ending = newline or "\n"
		lines[0] = f"{expected}{ending}"
		changed = True
	normalized = normalize_header_description(lines[1], "// ")
	if lines[1] != normalized:
		lines[1] = normalized
		changed = True
	return lines, changed


def fix_swift_file(path: Path) -> bool:
	text, _ = read_source(path)
	if text is None:
		return False
	lines = split_keepends(text)
	lines, changed = normalize_swift_header(path, lines)
	scanned, _ = scan_swift_lines(lines)
	for index, line in enumerate(lines):
		body, newline = line_without_newline(line)
		comment_index, inside_literal = scanned[index]
		# a line wholly inside an open `"""` literal is runtime data, not source
		if inside_literal or comment_index == -1:
			continue
		comment = body[comment_index:]
		if (
			comment.startswith("///")
			or comment.startswith("// MARK:")
			or SWIFT_TOOLING_RE.match(comment)
		):
			continue
		normalized = normalize_comment(comment)
		if normalized != comment:
			lines[index] = f"{body[:comment_index]}{normalized}{newline}"
			changed = True
	if changed:
		path.write_text("".join(lines), encoding="utf-8")
	return changed


SWIFT_TYPE_DECL_RE = re.compile(
	r"^(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|open|internal|fileprivate|private|final|indirect)\s+)*"
	r"(?:class|struct|enum|actor|protocol)\b"
)


def next_swift_code_line(lines: list[str], start: int) -> str | None:
	index = start
	while index < len(lines):
		body = line_without_newline(lines[index])[0].strip()
		if not body or body.startswith("//"):
			index += 1
			continue
		return body
	return None


def swift_doc_violations(
	path: Path, lines: list[str], inside_literal: list[bool]
) -> list[Violation]:
	violations: list[Violation] = []

	# a `///` inside an open `"""` literal is literal text, not documentation, so no fixer
	# could ever clear a violation reported against it
	def is_doc_line(position: int) -> bool:
		if position >= len(lines) or inside_literal[position]:
			return False
		return line_without_newline(lines[position])[0].strip().startswith("///")

	index = 0
	while index < len(lines):
		if not is_doc_line(index):
			index += 1
			continue
		start = index
		paragraph: list[str] = []
		while is_doc_line(index):
			text = line_without_newline(lines[index])[0].strip()[3:].strip()
			if not text and paragraph:
				break
			if text:
				paragraph.append(text)
			index += 1
		# consume the rest of the contiguous /// run so a multi-paragraph block reports once,
		# not once per paragraph break
		while is_doc_line(index):
			index += 1
		target = next_swift_code_line(lines, index)
		if target is None or not SWIFT_TYPE_DECL_RE.match(target):
			violations.append(
				Violation(
					path,
					start + 1,
					"/// belongs on types (class/struct/enum/actor/protocol); "
					"use a plain // comment above ordinary functions",
				)
			)
			continue
		summary = " ".join(paragraph)
		if not summary or not re.match(r"^(?:[A-Z0-9]|[`'\"(\[]|[a-z][A-Z])", summary):
			violations.append(
				Violation(
					path, start + 1, "block documentation starts with a capitalized sentence"
				)
			)
		if summary and not re.search(r"\.(?:[`'\"\])}]*)$", summary):
			violations.append(
				Violation(path, start + 1, "block documentation summaries end with a period")
			)
	return violations


def check_swift_file(path: Path) -> list[Violation]:
	text, error = read_source(path)
	if text is None:
		return [Violation(path, 1, error or UNDECODABLE_MESSAGE)]
	lines = split_keepends(text)
	violations: list[Violation] = []
	expected = f"// {path.relative_to(ROOT).as_posix()}"
	if not lines or line_without_newline(lines[0])[0] != expected:
		violations.append(Violation(path, 1, f'file header must be "{expected}"'))
	if len(lines) < 2 or not re.match(r"^// [a-z0-9]", line_without_newline(lines[1])[0]):
		violations.append(Violation(path, 2, "file header needs a lowercase purpose phrase"))
	elif is_tagged_description(line_without_newline(lines[1])[0][3:].strip()):
		violations.append(Violation(path, 2, "file header purpose must not use an annotation tag"))
	elif line_without_newline(lines[1])[0].endswith("."):
		violations.append(Violation(path, 2, "file header purpose must not end with a period"))
	if len(lines) > 2 and lines[2].startswith("//"):
		violations.append(
			Violation(path, 3, "file headers contain exactly two consecutive comment lines")
		)

	scanned, unterminated = scan_swift_lines(lines)
	violations.extend(swift_doc_violations(path, lines, [inside for _, inside in scanned]))
	for index, line in enumerate(lines, start=1):
		body = line_without_newline(line)[0]
		comment_index, inside_literal = scanned[index - 1]
		# a line wholly inside an open `"""` literal is runtime data, not source
		if inside_literal:
			continue
		code = body if comment_index == -1 else body[:comment_index]
		if "/*" in body or "*/" in body:
			violations.append(Violation(path, index, "use line comments, not block comments"))
		if SWIFT_PREVIEW_PROVIDER_RE.search(code):
			violations.append(Violation(path, index, "use #Preview instead of PreviewProvider"))
		if comment_index == -1:
			continue
		prefix = body[:comment_index]
		comment = body[comment_index:]
		if (
			comment.startswith("///")
			or comment.startswith("// MARK:")
			or SWIFT_TOOLING_RE.match(comment)
		):
			continue
		if "→" in comment:
			violations.append(Violation(path, index, "use ASCII ->, not the Unicode arrow"))
		if prefix.strip():
			violations.append(Violation(path, index, "move prose comments above the code"))
		if index > 2:
			violations.extend(structured_comment_violations(path, index, comment))
	# every line after an unclosed literal was skipped as literal text. Swift does not compile
	# an unterminated `"""`, so this is a truncated file or a scanner bug, never valid source;
	# say so rather than let a whole file pass unchecked in silence
	if unterminated is not None:
		violations.append(
			Violation(
				path,
				unterminated,
				'unterminated `"""` literal; the rest of the file was not checked',
			)
		)
	return violations


def iter_python_paths() -> list[Path]:
	paths = [path for root in PYTHON_ROOTS if root.exists() for path in root.rglob("*.py")]
	# the cheap prune is tested first: is_within() resolves both operands, so running it on
	# everything under .venv/ & node_modules/ costs two realpath chains per discarded path
	return sorted(
		{
			path
			for path in paths
			if not SKIP_PARTS.intersection(path.relative_to(ROOT).parts) and is_within(path, ROOT)
		}
	)


def iter_swift_paths() -> list[Path]:
	if not SWIFT_ROOT.exists():
		return []
	return sorted(
		path
		for path in SWIFT_ROOT.rglob("*.swift")
		if not SWIFT_SKIP_PARTS.intersection(path.relative_to(SWIFT_ROOT).parts)
	)


def run_checks(paths: Iterable[Path], checker) -> list[Violation]:
	return [violation for path in paths for violation in checker(path)]


def run_fixes(paths: Iterable[Path], fixer) -> int:
	return sum(1 for path in paths if fixer(path))


def resolve_root(explicit: Path | None) -> Path:
	if explicit is not None:
		return explicit.resolve()
	try:
		result = subprocess.run(
			["git", "rev-parse", "--show-toplevel"],
			capture_output=True,
			text=True,
			check=True,
		)
	except (OSError, subprocess.CalledProcessError):
		return Path.cwd()
	return Path(result.stdout.strip() or ".").resolve()


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(description="check & fix comment style for Python & Swift")
	mode = parser.add_mutually_exclusive_group()
	mode.add_argument("--check", action="store_true", help="check only (default)")
	mode.add_argument("--fix", action="store_true", help="apply safe mechanical fixes")
	parser.add_argument("--python", action="store_true", help="include Python files")
	parser.add_argument("--swift", action="store_true", help="include Swift files")
	parser.add_argument("--root", type=Path, default=None, help="repo root for header paths")
	parser.add_argument("--python-root", action="append", type=Path, default=None, metavar="DIR")
	parser.add_argument("--swift-root", type=Path, default=None, metavar="DIR")
	return parser.parse_args()


def main() -> int:
	args = parse_args()
	global ROOT, PYTHON_ROOTS, SWIFT_ROOT
	ROOT = resolve_root(args.root)
	PYTHON_ROOTS = (
		tuple(path.resolve() for path in args.python_root) if args.python_root else (ROOT,)
	)
	SWIFT_ROOT = args.swift_root.resolve() if args.swift_root else ROOT
	include_python = args.python or not args.swift
	include_swift = args.swift or not args.python

	bad_roots: list[Path] = []
	if include_python:
		bad_roots.extend(root for root in PYTHON_ROOTS if not is_within(root, ROOT))
	if include_swift and not is_within(SWIFT_ROOT, ROOT):
		bad_roots.append(SWIFT_ROOT)
	if bad_roots:
		for path in bad_roots:
			print(f"error: {path} is outside --root {ROOT}", file=sys.stderr)
		return 2

	python_paths = iter_python_paths() if include_python else []
	swift_paths = iter_swift_paths() if include_swift else []
	# --fix only fixes; applying a fix is not a failure, so an explicit --check owns the exit code
	if args.fix:
		changed_python = run_fixes(python_paths, fix_python_file)
		changed_swift = run_fixes(swift_paths, fix_swift_file)
		if changed_python or changed_swift:
			print(
				f"comment style fixed {changed_python} Python files & {changed_swift} Swift files"
			)
		return 0

	violations = [
		*run_checks(python_paths, check_python_file),
		*run_checks(swift_paths, check_swift_file),
	]
	for violation in violations:
		print(violation.render())
	return 1 if violations else 0


if __name__ == "__main__":
	raise SystemExit(main())
