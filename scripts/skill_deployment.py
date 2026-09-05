# scripts/skill_deployment.py
# hash installed skill payloads independently of source revisions and sync markers

from __future__ import annotations

import hashlib
import os
from pathlib import Path

GENERATION_FILE = ".ggfincke-skills-generation.json"
IGNORED_NAMES = frozenset({".DS_Store", "__pycache__", ".git", ".ggfincke-skills-sync"})


def package_digest(directory: Path) -> str:
	root = directory.resolve(strict=True)
	digest = hashlib.sha256()
	files: list[Path] = []
	for current, directories, names in os.walk(root, followlinks=False):
		directories[:] = sorted(name for name in directories if name not in IGNORED_NAMES)
		for name in [*directories, *names]:
			candidate = Path(current) / name
			if name in IGNORED_NAMES:
				continue
			if candidate.is_symlink():
				raise ValueError(f"skill payload contains a symlink: {candidate}")
			if candidate.is_file():
				files.append(candidate)
	for candidate in sorted(files):
		digest.update(candidate.relative_to(root).as_posix().encode() + b"\0")
		digest.update(str(candidate.stat().st_mode & 0o111).encode() + b"\0")
		digest.update(candidate.read_bytes())
	return digest.hexdigest()
