# tests/support.py
# shared helpers: locate repo files & import the hyphenated CLI scripts

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path
from types import ModuleType

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = REPO_ROOT / "scripts"
COMMENT_STYLE_CHECKER = REPO_ROOT / "skills" / "comment-style" / "assets" / "check_comment_style.py"


def load_module(name: str, path: Path) -> ModuleType:
	# import a script by file path; register in sys.modules so dataclass &
	# annotation resolution works for files whose names are not importable
	if str(SCRIPTS_DIR) not in sys.path:
		sys.path.insert(0, str(SCRIPTS_DIR))
	spec = importlib.util.spec_from_file_location(name, path)
	assert spec and spec.loader
	module = importlib.util.module_from_spec(spec)
	sys.modules[name] = module
	spec.loader.exec_module(module)
	return module


def run_script(
	path: Path, args: list[str], env: dict[str, str] | None = None
) -> subprocess.CompletedProcess[str]:
	return subprocess.run(
		[sys.executable, str(path), *args],
		capture_output=True,
		text=True,
		env=env,
		check=False,
	)
