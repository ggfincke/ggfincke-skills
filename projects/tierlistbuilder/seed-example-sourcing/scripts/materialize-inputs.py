#!/usr/bin/env python3
# projects/tierlistbuilder/seed-example-sourcing/scripts/materialize-inputs.py
# copy declared hash-bound artifact inputs into isolated workspaces without replacing files

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import shutil
import stat
from contextlib import ExitStack
from pathlib import Path, PurePosixPath


DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def safe_parts(value: str) -> tuple[str, ...]:
	if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
		raise ValueError("artifact paths must be nonempty relative POSIX paths")
	parts = value.split("/")
	if PurePosixPath(value).is_absolute() or any(part in ("", ".", "..", ".git") for part in parts):
		raise ValueError(f"unsafe artifact path: {value}")
	return tuple(parts)


def directory_fd(root: Path) -> int:
	# pin every root component without following a redirected ancestor
	parts = root.absolute().parts
	if ".." in parts:
		raise ValueError(f"root must not contain parent traversal: {root}")
	fd = os.open(parts[0], DIRECTORY_FLAGS)
	try:
		for part in parts[1:]:
			next_fd = os.open(part, DIRECTORY_FLAGS, dir_fd=fd)
			os.close(fd)
			fd = next_fd
		return fd
	except BaseException:
		os.close(fd)
		raise


def identity(fd: int) -> dict:
	info = os.fstat(fd)
	return {"device": info.st_dev, "inode": info.st_ino}


def require_root_identity(root: Path, fd: int) -> None:
	try:
		current_fd = directory_fd(root)
	except OSError as exc:
		raise ValueError(f"root path changed or became inaccessible: {root}") from exc
	try:
		if identity(current_fd) != identity(fd):
			raise ValueError(f"root path changed identity: {root}")
	finally:
		os.close(current_fd)


def parent_fd(root_fd: int, parts: tuple[str, ...], create: bool = False) -> int:
	# relative traversal stays anchored to the pinned root even if its ancestors move
	fd = os.dup(root_fd)
	try:
		for part in parts[:-1]:
			if create:
				try:
					os.mkdir(part, mode=0o700, dir_fd=fd)
				except FileExistsError:
					pass
			next_fd = os.open(part, DIRECTORY_FLAGS, dir_fd=fd)
			os.close(fd)
			fd = next_fd
		return fd
	except BaseException:
		os.close(fd)
		raise


def source_file(root_fd: int, parts: tuple[str, ...]):
	fd = parent_fd(root_fd, parts)
	try:
		file_fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
	finally:
		os.close(fd)
	if not stat.S_ISREG(os.fstat(file_fd).st_mode):
		os.close(file_fd)
		raise ValueError("declared input must be a regular file")
	return os.fdopen(file_fd, "rb")


def new_file(root_fd: int, name: str):
	fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=root_fd)
	return os.fdopen(fd, "wb")


def check_destination(root_fd: int, parts: tuple[str, ...]) -> None:
	fd = os.dup(root_fd)
	try:
		for index, part in enumerate(parts):
			try:
				info = os.stat(part, dir_fd=fd, follow_symlinks=False)
			except FileNotFoundError:
				return
			if index == len(parts) - 1 or not stat.S_ISDIR(info.st_mode):
				raise ValueError(f"destination collision or unsafe parent: {'/'.join(parts)}")
			next_fd = os.open(part, DIRECTORY_FLAGS, dir_fd=fd)
			os.close(fd)
			fd = next_fd
	finally:
		os.close(fd)


def create_recovery(destination_fd: int) -> tuple[str, int]:
	while True:
		name = f".artifact-materialization-{secrets.token_hex(12)}"
		try:
			os.mkdir(name, mode=0o700, dir_fd=destination_fd)
			break
		except FileExistsError:
			pass
	return name, os.open(name, DIRECTORY_FLAGS, dir_fd=destination_fd)


def file_hash(file) -> str:
	digest = hashlib.sha256()
	for block in iter(lambda: file.read(1024 * 1024), b""):
		digest.update(block)
	return digest.hexdigest()


def write_receipt(recovery_fd: int, name: str, receipt: dict) -> None:
	with new_file(recovery_fd, name) as file:
		file.write((json.dumps(receipt, indent=2) + "\n").encode())


def publish(recovery_fd: int, name: str, destination_fd: int, parts: tuple[str, ...]) -> str:
	# the publication copy cannot share its inode with retained recovery evidence
	published = f"{name}.publish"
	with source_file(recovery_fd, (name,)) as source, new_file(recovery_fd, published) as target:
		shutil.copyfileobj(source, target)
	fd = parent_fd(destination_fd, parts, create=True)
	try:
		os.link(published, parts[-1], src_dir_fd=recovery_fd, dst_dir_fd=fd, follow_symlinks=False)
	finally:
		os.close(fd)
	return published


def materialize(
	manifest_path: Path, source_root: Path, destination: Path, receipt_name: str
) -> dict:
	source_root, destination = source_root.absolute(), destination.absolute()
	if (
		source_root == destination
		or source_root in destination.parents
		or destination in source_root.parents
	):
		raise ValueError("source and isolated destination roots must be disjoint")
	with ExitStack() as cleanup:
		source_fd = directory_fd(source_root)
		cleanup.callback(os.close, source_fd)
		destination_fd = directory_fd(destination)
		cleanup.callback(os.close, destination_fd)
		if identity(source_fd) == identity(destination_fd):
			raise ValueError("source and isolated destination roots must be disjoint")
		manifest_bytes = manifest_path.read_bytes()
		manifest = json.loads(manifest_bytes)
		if (
			not isinstance(manifest, dict)
			or manifest.get("schema_version") != 1
			or not isinstance(manifest.get("inputs"), list)
			or not manifest["inputs"]
		):
			raise ValueError("expected schema_version 1 and a nonempty inputs list")
		receipt_parts = safe_parts(receipt_name)
		rows = []
		paths = {receipt_parts}
		for entry in manifest["inputs"]:
			source_parts = safe_parts(entry["source"])
			target_parts = safe_parts(entry["destination"])
			expected = entry["sha256"]
			if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
				raise ValueError("each input needs a lowercase SHA-256")
			if any(
				target_parts[: len(path)] == path or path[: len(target_parts)] == target_parts
				for path in paths
			):
				raise ValueError("declared destinations conflict with each other or the receipt")
			paths.add(target_parts)
			with source_file(source_fd, source_parts) as file:
				if file_hash(file) != expected:
					raise ValueError(f"source hash mismatch: {entry['source']}")
			rows.append(
				{"source": entry["source"], "destination": entry["destination"], "sha256": expected}
			)
		for parts in paths:
			check_destination(destination_fd, parts)
		require_root_identity(source_root, source_fd)
		require_root_identity(destination, destination_fd)
		recovery_name, recovery_fd = create_recovery(destination_fd)
		cleanup.callback(os.close, recovery_fd)
		recovery = destination / recovery_name
		receipt = {
			"schema_version": 1,
			"manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
			"source_root": str(source_root),
			"source_identity": identity(source_fd),
			"destination_root": str(destination),
			"destination_identity": identity(destination_fd),
			"recovery": str(recovery),
			"recovery_identity": identity(recovery_fd),
			"status": "preparing",
			"requested": len(rows),
			"copied": [],
		}
		try:
			# stage every input and recheck its hash before publishing any destination
			for index, row in enumerate(rows):
				with (
					source_file(source_fd, safe_parts(row["source"])) as source,
					new_file(recovery_fd, str(index)) as target,
				):
					shutil.copyfileobj(source, target)
				with source_file(recovery_fd, (str(index),)) as file:
					if file_hash(file) != row["sha256"]:
						raise ValueError(f"source changed during copy: {row['source']}")
					row["bytes"] = os.fstat(file.fileno()).st_size
			for index, row in enumerate(rows):
				require_root_identity(source_root, source_fd)
				require_root_identity(destination, destination_fd)
				published = publish(
					recovery_fd, str(index), destination_fd, safe_parts(row["destination"])
				)
				receipt["copied"].append(row)
				os.unlink(published, dir_fd=recovery_fd)
			require_root_identity(destination, destination_fd)
			receipt["status"] = "complete"
			write_receipt(recovery_fd, "receipt.json", receipt)
			published = publish(recovery_fd, "receipt.json", destination_fd, receipt_parts)
			os.unlink(published, dir_fd=recovery_fd)
			require_root_identity(destination, destination_fd)
			return receipt
		except BaseException as exc:
			receipt["status"] = "failed"
			receipt["error"] = f"{type(exc).__name__}: {exc}"
			try:
				require_root_identity(recovery, recovery_fd)
				receipt["recovery_path_status"] = "current"
			except (OSError, ValueError):
				receipt["recovery_path_status"] = (
					"changed; locate the original directory by identity"
				)
			message = (
				f"{receipt['error']}; copied {len(receipt['copied'])}/{len(rows)}; "
				f"recovery {recovery} (device {receipt['recovery_identity']['device']}, "
				f"inode {receipt['recovery_identity']['inode']}; {receipt['recovery_path_status']})"
			)
			try:
				write_receipt(recovery_fd, "failure.json", receipt)
				message += "; inspect failure.json before retrying"
			except OSError as receipt_error:
				message += f"; failure receipt could not be written: {receipt_error}"
			raise ValueError(message) from exc


def main() -> int:
	parser = argparse.ArgumentParser(
		description="Materialize only declared, hash-verified artifact inputs."
	)
	parser.add_argument("--manifest", required=True, type=Path)
	parser.add_argument("--source-root", required=True, type=Path)
	parser.add_argument("--destination", required=True, type=Path)
	parser.add_argument("--receipt", default="materialization.json")
	args = parser.parse_args()
	try:
		print(
			json.dumps(
				materialize(args.manifest, args.source_root, args.destination, args.receipt),
				indent=2,
			)
		)
	except (OSError, ValueError, KeyError, TypeError) as exc:
		parser.exit(1, f"materialization refused: {exc}\n")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
