#!/usr/bin/env python3
# tools/check_comment_style.py
# cross-language comment style checker & fixer

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

# repo & language roots are resolved from CLI args in main(); see resolve_root()
ROOT = Path.cwd()
PYTHON_ROOTS: tuple[Path, ...] = (ROOT,)
SWIFT_ROOT = ROOT
MAX_COMMENT_RUN = 3
COMMENT_WORD_REPLACEMENTS = {
	"and": "&",
	"with": "w/",
	"without": "w/o",
	"calculate": "calc",
	"configuration": "config",
	"information": "info",
	"function": "func",
	"variable": "var",
	"parameters": "params",
}
COMMENT_WORD_RE = re.compile(
	r"\b(" + "|".join(re.escape(word) for word in COMMENT_WORD_REPLACEMENTS) + r")\b",
	re.IGNORECASE,
)
PYTHON_COMMENT_EXEMPTIONS = (
	"noqa",
	"type: ignore",
	"pragma: no cover",
	"pyright:",
	"mypy:",
)
SWIFT_COMMENT_EXEMPTIONS = ("swiftlint:",)
# PEP 263 encoding declaration; must stay on line 1 or 2, above the file header
PYTHON_ENCODING_RE = re.compile(r"coding[:=]\s*[-\w.]+")


@dataclass(frozen=True)
class Violation:
	path: Path
	line: int
	message: str

	def render(self) -> str:
		return f"{self.path.relative_to(ROOT)}:{self.line}: {self.message}"


def split_keepends(text: str) -> list[str]:
	if text == "":
		return []
	return text.splitlines(keepends=True)


def line_without_newline(line: str) -> tuple[str, str]:
	if line.endswith("\r\n"):
		return line[:-2], "\r\n"
	if line.endswith("\n"):
		return line[:-1], "\n"
	return line, ""


def leading_whitespace(value: str) -> str:
	return value[: len(value) - len(value.lstrip())]


def replace_comment_words(comment: str) -> str:
	comment = comment.replace("→", "->")

	def replace(match: re.Match[str]) -> str:
		return COMMENT_WORD_REPLACEMENTS[match.group(1).lower()]

	return COMMENT_WORD_RE.sub(replace, comment)


def is_python_tooling_comment(comment: str) -> bool:
	lower = comment.lower()
	return any(token in lower for token in PYTHON_COMMENT_EXEMPTIONS)


def is_swift_tooling_comment(comment: str) -> bool:
	lower = comment.lower()
	return any(token in lower for token in SWIFT_COMMENT_EXEMPTIONS)


def description_for_path(path: Path, language: str) -> str:
	name = path.name
	parent = path.parent.name.lower()
	stem = path.stem.lower()

	if name == "__init__.py":
		return "package marker"
	if name == "conftest.py":
		return "pytest config"
	if name == "apps.py":
		return "django app config"
	if name == "admin.py":
		return "django admin registration"
	if name == "models.py":
		return "django models"
	if name == "serializers.py":
		return "api serializers"
	if name == "views.py":
		return "api views"
	if name == "urls.py":
		return "url routes"
	if name == "tests.py" or stem.startswith("test_"):
		return "test coverage"
	if language == "swift":
		return "swift source"
	if parent == "tools" or path.parts[-2:-1] == ("tools",):
		return "developer tooling"
	return "module helpers"


def normalize_header_description(line: str, prefix: str, fallback: str) -> str:
	body, newline = line_without_newline(line)
	line_ending = newline or "\n"
	if not body.startswith(prefix):
		return f"{prefix}{fallback}{line_ending}"

	text = body[len(prefix) :].strip()
	if not text:
		text = fallback
	elif text[:1].isalpha():
		match = re.match(r"([A-Za-z]+)(.*)", text)
		if match and match.group(1).isupper():
			text = match.group(1).lower() + match.group(2)
		else:
			text = text[:1].lower() + text[1:]
	text = replace_comment_words(text).rstrip(".")
	return f"{prefix}{text}{line_ending}"


def is_within(path: Path, parent: Path) -> bool:
	path = path.resolve()
	parent = parent.resolve()
	return path == parent or parent in path.parents


def python_prelude_len(lines: list[str]) -> int:
	# count leading shebang & PEP 263 encoding lines the header must sit below
	count = 1 if lines and lines[0].startswith("#!") else 0
	if count < len(lines):
		candidate = lines[count]
		if candidate.lstrip().startswith("#") and PYTHON_ENCODING_RE.search(candidate):
			count += 1
	return count


def iter_python_paths() -> list[Path]:
	paths: list[Path] = []
	for root in PYTHON_ROOTS:
		if not root.exists():
			continue
		paths.extend(root.rglob("*.py"))
	conftest = ROOT / "conftest.py"
	if conftest.exists():
		paths.append(conftest)

	filtered: list[Path] = []
	for path in paths:
		rel_parts = path.relative_to(ROOT).parts
		if "migrations" in rel_parts or ".venv" in rel_parts or "__pycache__" in rel_parts:
			continue
		filtered.append(path)
	return sorted(set(filtered))


def iter_swift_paths() -> list[Path]:
	if not SWIFT_ROOT.exists() or not SWIFT_ROOT.is_dir():
		return []

	filtered: list[Path] = []
	for path in SWIFT_ROOT.rglob("*.swift"):
		rel_parts = path.relative_to(SWIFT_ROOT).parts
		if any(part in rel_parts for part in ("Pods", "Carthage", ".build", "DerivedData")):
			continue
		filtered.append(path)
	return sorted(filtered)


def normalize_python_header(path: Path, lines: list[str]) -> tuple[list[str], bool]:
	changed = False
	rel = path.relative_to(ROOT).as_posix()
	header_index = python_prelude_len(lines)
	fallback = description_for_path(path, "python")

	while len(lines) <= header_index + 1:
		lines.append("\n")
		changed = True

	expected_header = f"# {rel}\n"
	if lines[header_index] != expected_header:
		if lines[header_index].lstrip().startswith("#") or lines[header_index].strip() == "":
			lines[header_index] = expected_header
		else:
			lines.insert(header_index, expected_header)
		changed = True

	if header_index + 1 >= len(lines):
		lines.insert(header_index + 1, f"# {fallback}\n")
		return lines, True

	new_description = normalize_header_description(lines[header_index + 1], "# ", fallback)
	if lines[header_index + 1] != new_description:
		if (
			lines[header_index + 1].lstrip().startswith("#")
			or lines[header_index + 1].strip() == ""
		):
			lines[header_index + 1] = new_description
		else:
			lines.insert(header_index + 1, f"# {fallback}\n")
		changed = True

	return lines, changed


def normalize_python_comment_text(lines: list[str]) -> tuple[list[str], bool]:
	changed = False
	text = "".join(lines)
	try:
		tokens = list(tokenize.generate_tokens(io.StringIO(text).readline))
	except tokenize.TokenError:
		return lines, changed

	for token in tokens:
		if token.type != tokenize.COMMENT:
			continue
		line_index = token.start[0] - 1
		line = lines[line_index]
		body, newline = line_without_newline(line)
		comment = body[token.start[1] :]
		if is_python_tooling_comment(comment):
			continue
		normalized = replace_comment_words(comment)
		if normalized != comment:
			lines[line_index] = f"{body[: token.start[1]]}{normalized}{newline}"
			changed = True

	return lines, changed


def move_python_side_comments(lines: list[str]) -> tuple[list[str], bool]:
	changed = False
	text = "".join(lines)
	try:
		tokens = list(tokenize.generate_tokens(io.StringIO(text).readline))
	except tokenize.TokenError:
		return lines, changed

	comment_tokens = [token for token in tokens if token.type == tokenize.COMMENT]
	for token in sorted(comment_tokens, key=lambda item: item.start[0], reverse=True):
		line_index = token.start[0] - 1
		line = lines[line_index]
		body, newline = line_without_newline(line)
		prefix = body[: token.start[1]]
		comment = body[token.start[1] :].strip()
		if not prefix.strip() or is_python_tooling_comment(comment):
			continue

		indent = leading_whitespace(prefix)
		lines[line_index : line_index + 1] = [
			f"{indent}{comment}\n",
			f"{prefix.rstrip()}{newline}",
		]
		changed = True

	return lines, changed


def fix_python_file(path: Path) -> bool:
	original = path.read_text()
	lines = split_keepends(original)
	changed = False

	lines, did_change = normalize_python_header(path, lines)
	changed = changed or did_change
	lines, did_change = normalize_python_comment_text(lines)
	changed = changed or did_change
	lines, did_change = move_python_side_comments(lines)
	changed = changed or did_change

	if changed:
		path.write_text("".join(lines))
	return changed


def python_docstring_violations(path: Path) -> list[Violation]:
	try:
		tree = ast.parse(path.read_text())
	except SyntaxError:
		return []

	violations: list[Violation] = []
	for node in ast.walk(tree):
		if not isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
			continue
		body = getattr(node, "body", [])
		if not body:
			continue
		first = body[0]
		if (
			isinstance(first, ast.Expr)
			and isinstance(first.value, ast.Constant)
			and isinstance(
				first.value.value,
				str,
			)
		):
			violations.append(Violation(path, first.lineno, "use # comments, not docstrings"))
	return violations


def check_python_file(path: Path) -> list[Violation]:
	violations: list[Violation] = []
	text = path.read_text()
	lines = split_keepends(text)
	rel = path.relative_to(ROOT).as_posix()
	header_index = python_prelude_len(lines)

	if len(lines) <= header_index or line_without_newline(lines[header_index])[0] != f"# {rel}":
		violations.append(Violation(path, header_index + 1, f'file header must be "# {rel}"'))
	if len(lines) <= header_index + 1 or not re.match(
		r"^# [a-z0-9*!?]",
		line_without_newline(lines[header_index + 1])[0],
	):
		violations.append(
			Violation(path, header_index + 2, "file header description must be lowercase")
		)

	violations.extend(python_docstring_violations(path))

	try:
		tokens = list(tokenize.generate_tokens(io.StringIO(text).readline))
	except tokenize.TokenError as exc:
		return [Violation(path, exc.args[1][0], "could not tokenize python file")]

	for token in tokens:
		if token.type != tokenize.COMMENT:
			continue
		line = token.line
		prefix = line[: token.start[1]]
		comment = token.string
		if "→" in comment:
			violations.append(Violation(path, token.start[0], "use ASCII ->, not Unicode arrow"))
		if COMMENT_WORD_RE.search(comment) and not is_python_tooling_comment(comment):
			violations.append(
				Violation(
					path,
					token.start[0],
					"use comment abbreviations: &, w/, w/o, calc, config, info, func, var, params",
				),
			)
		if prefix.strip() and not is_python_tooling_comment(comment):
			violations.append(
				Violation(path, token.start[0], "move side comment above the code it describes")
			)

	violations.extend(check_comment_runs(path, lines, "#"))
	return violations


def find_swift_line_comment(line: str) -> int:
	in_string = False
	escaped = False
	index = 0

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
		if char == '"':
			in_string = not in_string
			index += 1
			continue
		if not in_string and line.startswith("//", index):
			return index
		index += 1
	return -1


def normalize_swift_header(path: Path, lines: list[str]) -> tuple[list[str], bool]:
	changed = False
	rel = path.relative_to(SWIFT_ROOT).as_posix()
	fallback = description_for_path(path, "swift")

	while len(lines) < 2:
		lines.append("\n")
		changed = True

	expected_header = f"// {rel}\n"
	if lines[0] != expected_header:
		if lines[0].lstrip().startswith("//") or lines[0].strip() == "":
			lines[0] = expected_header
		else:
			lines.insert(0, expected_header)
		changed = True

	new_description = normalize_header_description(lines[1], "// ", fallback)
	if lines[1] != new_description:
		if lines[1].lstrip().startswith("//") or lines[1].strip() == "":
			lines[1] = new_description
		else:
			lines.insert(1, f"// {fallback}\n")
		changed = True

	return lines, changed


def normalize_swift_comment_text(lines: list[str]) -> tuple[list[str], bool]:
	changed = False

	for index, line in enumerate(lines):
		body, newline = line_without_newline(line)
		comment_index = find_swift_line_comment(body)
		if comment_index == -1:
			continue
		comment = body[comment_index:]
		if comment.startswith("// MARK:") or is_swift_tooling_comment(comment):
			continue
		normalized = replace_comment_words(comment)
		if normalized != comment:
			lines[index] = f"{body[:comment_index]}{normalized}{newline}"
			changed = True

	return lines, changed


def move_swift_side_comments(lines: list[str]) -> tuple[list[str], bool]:
	changed = False

	for index in range(len(lines) - 1, -1, -1):
		body, newline = line_without_newline(lines[index])
		comment_index = find_swift_line_comment(body)
		if comment_index == -1:
			continue
		prefix = body[:comment_index]
		comment = body[comment_index:].strip()
		if not prefix.strip() or is_swift_tooling_comment(comment):
			continue
		indent = leading_whitespace(prefix)
		lines[index : index + 1] = [
			f"{indent}{comment}\n",
			f"{prefix.rstrip()}{newline}",
		]
		changed = True

	return lines, changed


def fix_swift_file(path: Path) -> bool:
	original = path.read_text()
	lines = split_keepends(original)
	changed = False

	lines, did_change = normalize_swift_header(path, lines)
	changed = changed or did_change
	lines, did_change = normalize_swift_comment_text(lines)
	changed = changed or did_change
	lines, did_change = move_swift_side_comments(lines)
	changed = changed or did_change

	if changed:
		path.write_text("".join(lines))
	return changed


def check_swift_file(path: Path) -> list[Violation]:
	violations: list[Violation] = []
	lines = split_keepends(path.read_text())
	rel = path.relative_to(SWIFT_ROOT).as_posix()

	if not lines or line_without_newline(lines[0])[0] != f"// {rel}":
		violations.append(Violation(path, 1, f'file header must be "// {rel}"'))
	if len(lines) < 2 or not re.match(r"^// [a-z0-9*!?]", line_without_newline(lines[1])[0]):
		violations.append(Violation(path, 2, "file header description must be lowercase"))

	for index, line in enumerate(lines, start=1):
		body, _ = line_without_newline(line)
		if "///" in body:
			violations.append(Violation(path, index, "use // comments, not /// doc comments"))
		if "/*" in body or "*/" in body:
			violations.append(
				Violation(path, index, "use single-line // comments, not block comments")
			)
		if "PreviewProvider" in body:
			violations.append(Violation(path, index, "use #Preview instead of PreviewProvider"))

		comment_index = find_swift_line_comment(body)
		if comment_index == -1:
			continue
		prefix = body[:comment_index]
		comment = body[comment_index:]
		if "→" in comment:
			violations.append(Violation(path, index, "use ASCII ->, not Unicode arrow"))
		if (
			COMMENT_WORD_RE.search(comment)
			and not comment.startswith("// MARK:")
			and not is_swift_tooling_comment(comment)
		):
			violations.append(
				Violation(
					path,
					index,
					"use comment abbreviations: &, w/, w/o, calc, config, info, func, var, params",
				),
			)
		if prefix.strip() and not is_swift_tooling_comment(comment):
			violations.append(
				Violation(path, index, "move side comment above the code it describes")
			)

	violations.extend(check_comment_runs(path, lines, "//"))
	return violations


def check_comment_runs(path: Path, lines: list[str], comment_prefix: str) -> list[Violation]:
	violations: list[Violation] = []
	run_start = 0
	run_length = 0

	for index, line in enumerate(lines, start=1):
		stripped = line.strip()
		if stripped.startswith(comment_prefix) and not stripped.startswith("#!"):
			if run_length == 0:
				run_start = index
			run_length += 1
			continue

		if stripped == "":
			if run_length > MAX_COMMENT_RUN:
				violations.append(
					Violation(path, run_start, f"comment block exceeds {MAX_COMMENT_RUN} lines")
				)
			run_length = 0
			continue

		if run_length > MAX_COMMENT_RUN:
			violations.append(
				Violation(path, run_start, f"comment block exceeds {MAX_COMMENT_RUN} lines")
			)
		run_length = 0

	if run_length > MAX_COMMENT_RUN:
		violations.append(
			Violation(path, run_start, f"comment block exceeds {MAX_COMMENT_RUN} lines")
		)

	return violations


def run_checks(paths: Iterable[Path], checker) -> list[Violation]:
	violations: list[Violation] = []
	for path in paths:
		violations.extend(checker(path))
	return violations


def run_fixes(paths: Iterable[Path], fixer) -> int:
	changed = 0
	for path in paths:
		if fixer(path):
			changed += 1
	return changed


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
	parser = argparse.ArgumentParser(description="check & fix low-noise comment style (python & swift)")
	parser.add_argument("--check", action="store_true", help="check only")
	parser.add_argument("--fix", action="store_true", help="apply safe mechanical fixes")
	parser.add_argument("--python", action="store_true", help="include Python files")
	parser.add_argument("--swift", action="store_true", help="include Swift files")
	parser.add_argument("--root", type=Path, default=None, help="repo root for header paths (default: git toplevel or cwd)")
	parser.add_argument("--python-root", action="append", type=Path, default=None, metavar="DIR", help="dir to scan for .py; repeatable (default: repo root)")
	parser.add_argument("--swift-root", type=Path, default=None, metavar="DIR", help="dir to scan for .swift (default: repo root)")
	return parser.parse_args()


def main() -> int:
	args = parse_args()
	global ROOT, PYTHON_ROOTS, SWIFT_ROOT
	ROOT = resolve_root(args.root)
	PYTHON_ROOTS = tuple(p.resolve() for p in args.python_root) if args.python_root else (ROOT,)
	SWIFT_ROOT = args.swift_root.resolve() if args.swift_root else ROOT
	fix = args.fix
	check = True
	include_python = args.python or not args.swift
	include_swift = args.swift or not args.python

	# headers are computed relative to ROOT; a scan root outside it would crash
	bad_roots: list[str] = []
	if include_python:
		bad_roots += [f"--python-root {r}" for r in PYTHON_ROOTS if not is_within(r, ROOT)]
	if include_swift and not is_within(SWIFT_ROOT, ROOT):
		bad_roots.append(f"--swift-root {SWIFT_ROOT}")
	if bad_roots:
		for entry in bad_roots:
			print(f"error: {entry} is outside --root {ROOT}", file=sys.stderr)
		return 2

	python_paths = iter_python_paths() if include_python else []
	swift_paths = iter_swift_paths() if include_swift else []

	if fix:
		changed_python = run_fixes(python_paths, fix_python_file)
		changed_swift = run_fixes(swift_paths, fix_swift_file)
		if changed_python or changed_swift:
			print(
				f"comment style fixed {changed_python} Python files & {changed_swift} Swift files"
			)

	if check:
		violations: list[Violation] = []
		violations.extend(run_checks(python_paths, check_python_file))
		violations.extend(run_checks(swift_paths, check_swift_file))
		if violations:
			for violation in violations:
				print(violation.render())
			return 1

	return 0


if __name__ == "__main__":
	raise SystemExit(main())
