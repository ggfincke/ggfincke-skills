# scripts/sync_transaction.py
# stage filesystem sync changes and apply them with per-destination rollback

from __future__ import annotations

import hashlib
import os
import re
import shutil
import stat
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Union


@dataclass(frozen=True)
class PathFingerprint:
	exists: bool
	digest: str


@dataclass(frozen=True)
class ObservedPath:
	path: Path
	fingerprint: PathFingerprint


@dataclass(frozen=True)
class CopyTreePayload:
	source: Path
	source_fingerprint: PathFingerprint
	unsupported_symlink: Path | None = None
	ignored_names: tuple[str, ...] = ()
	generated_files: tuple[tuple[Path, bytes], ...] = ()


@dataclass(frozen=True)
class CopyFilePayload:
	source: Path
	source_fingerprint: PathFingerprint
	unsupported_symlink: Path | None = None


@dataclass(frozen=True)
class SymlinkPayload:
	target: Path
	target_is_directory: bool = False


@dataclass(frozen=True)
class BytesPayload:
	content: bytes
	preserve_metadata_from: Path | None = None


Payload = Union[CopyTreePayload, CopyFilePayload, SymlinkPayload, BytesPayload]

RESERVED_ARTIFACT_RE = re.compile(
	r"^\.(?P<destination>.+)\.ggfincke-sync\.(?P<run>.+)\.(?P<suffix>stage|backup)$"
)


@dataclass(frozen=True)
class Replacement:
	operation_id: str
	logical_destination: Path
	physical_destination: Path
	payload: Payload
	observed: tuple[ObservedPath, ...]
	atomic_file: bool = False


@dataclass(frozen=True)
class Prune:
	operation_id: str
	destination: Path
	observed: ObservedPath


@dataclass(frozen=True)
class PlanMessage:
	label: str
	message: str


@dataclass(frozen=True)
class DestinationPlan:
	label: str
	replacements: tuple[Replacement, ...] = ()
	prunes: tuple[Prune, ...] = ()


@dataclass(frozen=True)
class ArtifactScan:
	parent: Path
	destination_names: tuple[str, ...] | None = None


@dataclass(frozen=True)
class RunPlan:
	destinations: tuple[DestinationPlan, ...]
	noops: tuple[PlanMessage, ...] = ()
	skips: tuple[PlanMessage, ...] = ()
	artifact_scans: tuple[ArtifactScan, ...] = ()


@dataclass(frozen=True)
class ApplyEvent:
	operation_id: str
	status: str
	path: Path
	detail: str


@dataclass(frozen=True)
class ApplyReport:
	success: bool
	events: tuple[ApplyEvent, ...]


@dataclass
class _StagedReplacement:
	replacement: Replacement
	stage: Path
	backup: Path


@dataclass
class _AppliedReplacement:
	staged: _StagedReplacement
	had_original: bool
	backup_ready: bool = False
	original_moved: bool = False
	promoted: bool = False


@dataclass
class _AppliedPrune:
	prune: Prune
	backup: Path
	moved: bool = False


class TransactionFailure(RuntimeError):
	def __init__(self, operation_id: str, path: Path, message: str):
		super().__init__(message)
		self.operation_id = operation_id
		self.path = path


class FileOps:
	# one injectable boundary gives failure tests stable operation names
	def before(self, action: str, path: Path) -> None:
		pass

	def makedirs(self, path: Path) -> None:
		self.before("mkdir", path)
		path.mkdir(parents=True, exist_ok=True)

	def copytree(self, source: Path, destination: Path, ignored_names: tuple[str, ...]) -> None:
		self.before("copytree", destination)

		def ignore(_directory: str, names: list[str]) -> set[str]:
			return set(names).intersection(ignored_names)

		shutil.copytree(source, destination, ignore=ignore)

	def copy2(self, source: Path, destination: Path) -> None:
		self.before("copy2", destination)
		shutil.copy2(source, destination, follow_symlinks=False)

	def symlink(self, target: Path | str, destination: Path, target_is_directory: bool) -> None:
		self.before("symlink", destination)
		destination.symlink_to(target, target_is_directory=target_is_directory)

	def write_bytes(self, destination: Path, content: bytes) -> None:
		self.before("write", destination)
		with destination.open("wb") as handle:
			handle.write(content)
			handle.flush()
			os.fsync(handle.fileno())

	def copystat(self, source: Path, destination: Path) -> None:
		self.before("copystat", destination)
		shutil.copystat(source, destination, follow_symlinks=False)

	def replace(self, source: Path, destination: Path) -> None:
		self.before("replace", destination)
		os.replace(source, destination)

	def remove(self, path: Path) -> None:
		self.before("remove", path)
		remove_path(path)

	def fsync_parent(self, path: Path) -> None:
		self.before("fsync-parent", path.parent)
		descriptor = os.open(path.parent, os.O_RDONLY)
		try:
			os.fsync(descriptor)
		finally:
			os.close(descriptor)


def remove_path(path: Path) -> None:
	if path.is_symlink() or path.is_file():
		path.unlink()
	elif path.exists():
		shutil.rmtree(path)


def fingerprint_path(path: Path) -> PathFingerprint:
	if not path.exists() and not path.is_symlink():
		return PathFingerprint(False, "missing")

	hasher = hashlib.sha256()

	def visit(candidate: Path, relative: Path) -> None:
		metadata = candidate.lstat()
		mode = stat.S_IMODE(metadata.st_mode)
		prefix = f"{relative.as_posix()}\0{mode:o}\0".encode()
		if candidate.is_symlink():
			hasher.update(b"link\0" + prefix + os.readlink(candidate).encode() + b"\0")
			return
		if candidate.is_file():
			hasher.update(b"file\0" + prefix)
			with candidate.open("rb") as handle:
				for chunk in iter(lambda: handle.read(1024 * 1024), b""):
					hasher.update(chunk)
			hasher.update(b"\0")
			return
		if candidate.is_dir():
			hasher.update(b"dir\0" + prefix)
			for child in sorted(candidate.iterdir(), key=lambda item: item.name):
				visit(child, relative / child.name)
			return
		hasher.update(b"other\0" + prefix + str(metadata.st_mode).encode() + b"\0")

	visit(path, Path("."))
	return PathFingerprint(True, hasher.hexdigest())


def observe(path: Path) -> ObservedPath:
	return ObservedPath(path, fingerprint_path(path))


def copy_tree_payload(
	source: Path,
	*,
	ignored_names: tuple[str, ...] = (),
	generated_files: tuple[tuple[Path, bytes], ...] = (),
) -> CopyTreePayload:
	unsupported_symlink = source if source.is_symlink() else None
	if unsupported_symlink is None:
		for directory, names, filenames in os.walk(source, followlinks=False):
			for name in sorted((*names, *filenames)):
				candidate = Path(directory) / name
				if candidate.is_symlink():
					unsupported_symlink = candidate
					break
			if unsupported_symlink is not None:
				break
	return CopyTreePayload(
		source,
		fingerprint_path(source),
		unsupported_symlink,
		ignored_names,
		generated_files,
	)


def copy_file_payload(source: Path) -> CopyFilePayload:
	unsupported_symlink = source if source.is_symlink() else None
	return CopyFilePayload(source, fingerprint_path(source), unsupported_symlink)


def replacement(
	operation_id: str,
	destination: Path,
	payload: Payload,
	*,
	logical_destination: Path | None = None,
	additional_observed: tuple[Path, ...] = (),
	atomic_file: bool = False,
) -> Replacement:
	logical = destination if logical_destination is None else logical_destination
	paths = tuple(dict.fromkeys((destination, logical, *additional_observed)))
	return Replacement(
		operation_id,
		logical,
		destination,
		payload,
		tuple(observe(path) for path in paths),
		atomic_file,
	)


def prune(operation_id: str, destination: Path) -> Prune:
	return Prune(operation_id, destination, observe(destination))


def plan_issues(plan: RunPlan) -> tuple[str, ...]:
	issues: list[str] = []
	seen_destinations: dict[Path, str] = {}
	seen_source_symlinks: set[Path] = set()
	artifact_scans: dict[Path, set[str] | None] = {}

	def add_artifact_scan(scan: ArtifactScan) -> None:
		parent = scan.parent.resolve(strict=False)
		names = None if scan.destination_names is None else set(scan.destination_names)
		if parent not in artifact_scans:
			artifact_scans[parent] = names
			return
		if artifact_scans[parent] is None or names is None:
			artifact_scans[parent] = None
			return
		artifact_scans[parent].update(names)

	for scan in plan.artifact_scans:
		add_artifact_scan(scan)
	for destination in plan.destinations:
		for operation in (*destination.replacements, *destination.prunes):
			if (
				isinstance(operation, Replacement)
				and isinstance(operation.payload, (CopyTreePayload, CopyFilePayload))
				and operation.payload.unsupported_symlink is not None
				and operation.payload.unsupported_symlink not in seen_source_symlinks
			):
				symlink = operation.payload.unsupported_symlink
				seen_source_symlinks.add(symlink)
				issues.append(
					f"copy source contains a symlink and cannot be snapshotted safely: {symlink}"
				)
			path = (
				operation.physical_destination
				if isinstance(operation, Replacement)
				else operation.destination
			)
			identity = path.parent.resolve(strict=False) / path.name
			if identity in seen_destinations:
				issues.append(
					f"duplicate destination {path} in {seen_destinations[identity]} and "
					f"{destination.label}"
				)
			else:
				seen_destinations[identity] = destination.label
			add_artifact_scan(ArtifactScan(path.parent, (path.name,)))
			parent = path.parent
			while not parent.exists() and not parent.is_symlink() and parent.parent != parent:
				parent = parent.parent
			if not parent.is_dir():
				issues.append(f"destination parent is not a directory for {path}: {parent}")

	for parent, destination_names in sorted(artifact_scans.items(), key=lambda item: str(item[0])):
		if not parent.exists():
			continue
		if not parent.is_dir():
			issues.append(f"sync artifact scan parent is not a directory: {parent}")
			continue
		try:
			entries = sorted(parent.iterdir())
		except OSError as exc:
			issues.append(f"cannot inspect sync artifacts in {parent}: {exc}")
			continue
		for entry in entries:
			match = RESERVED_ARTIFACT_RE.fullmatch(entry.name)
			if match is None:
				continue
			if (
				destination_names is not None
				and match.group("destination") not in destination_names
			):
				continue
			suffix = match.group("suffix")
			issues.append(f"stale sync {suffix} requires manual recovery: {entry}")
	return tuple(issues)


def describe_plan(plan: RunPlan) -> tuple[str, ...]:
	lines: list[str] = []
	for destination in plan.destinations:
		lines.append(f"[{destination.label}]")
		for item in destination.replacements:
			lines.append(f"  would replace {item.logical_destination}")
		for item in destination.prunes:
			lines.append(f"  would prune {item.destination}")
	for item in plan.noops:
		lines.append(f"[{item.label}] {item.message}")
	for item in plan.skips:
		lines.append(f"[{item.label}] {item.message}")
	return tuple(lines)


def _artifact_path(destination: Path, run_id: str, suffix: str) -> Path:
	return destination.with_name(f".{destination.name}.ggfincke-sync.{run_id}.{suffix}")


def _validate_observed(observed: tuple[ObservedPath, ...], operation_id: str) -> None:
	for item in observed:
		if fingerprint_path(item.path) != item.fingerprint:
			raise TransactionFailure(
				operation_id,
				item.path,
				f"path changed after planning: {item.path}",
			)


def _planned_fingerprint(observed: tuple[ObservedPath, ...], path: Path) -> PathFingerprint:
	for item in observed:
		if item.path == path:
			return item.fingerprint
	raise AssertionError(f"missing planned fingerprint for {path}")


def _validate_backup(
	backup: Path,
	planned: PathFingerprint,
	operation_id: str,
) -> None:
	if fingerprint_path(backup) != planned:
		raise TransactionFailure(
			operation_id,
			backup,
			f"backup does not match planned destination state: {backup}",
		)


def _rollback_destination_detail(
	destination: Path,
	planned: PathFingerprint,
	error: Exception,
) -> str:
	try:
		restored = fingerprint_path(destination) == planned
	except OSError:
		restored = False
	if restored:
		return "rollback restore completed, but destination durability is uncertain: " + str(error)
	return "rollback failed with no retained backup; inspect destination state: " + str(error)


def _validate_plan_state(plan: RunPlan) -> None:
	for destination in plan.destinations:
		for item in destination.replacements:
			_validate_observed(item.observed, item.operation_id)
		for item in destination.prunes:
			_validate_observed((item.observed,), item.operation_id)


def _created_parents(path: Path) -> tuple[Path, ...]:
	created: list[Path] = []
	candidate = path
	while not candidate.exists():
		created.append(candidate)
		if candidate.parent == candidate:
			break
		candidate = candidate.parent
	return tuple(created)


def _remove_empty_parents(paths: set[Path], *, protected_paths: tuple[Path, ...] = ()) -> None:
	for parent in sorted(paths, key=lambda item: len(item.parts), reverse=True):
		if any(parent == protected or parent in protected.parents for protected in protected_paths):
			continue
		try:
			parent.rmdir()
		except OSError:
			# pre-existing contents, retained recovery artifacts, & shared roots win
			pass


def _stage_replacement(item: Replacement, stage: Path, ops: FileOps) -> None:
	payload = item.payload
	if isinstance(payload, CopyTreePayload):
		if fingerprint_path(payload.source) != payload.source_fingerprint:
			raise TransactionFailure(
				item.operation_id, payload.source, "source changed after planning"
			)
		ops.copytree(payload.source, stage, payload.ignored_names)
		for relative, content in payload.generated_files:
			target = stage / relative
			target.parent.mkdir(parents=True, exist_ok=True)
			ops.write_bytes(target, content)
		if fingerprint_path(payload.source) != payload.source_fingerprint:
			raise TransactionFailure(
				item.operation_id, payload.source, "source changed while staging"
			)
		return
	if isinstance(payload, CopyFilePayload):
		if fingerprint_path(payload.source) != payload.source_fingerprint:
			raise TransactionFailure(
				item.operation_id, payload.source, "source changed after planning"
			)
		ops.copy2(payload.source, stage)
		if fingerprint_path(payload.source) != payload.source_fingerprint:
			raise TransactionFailure(
				item.operation_id, payload.source, "source changed while staging"
			)
		return
	if isinstance(payload, SymlinkPayload):
		ops.symlink(payload.target, stage, payload.target_is_directory)
		return
	if isinstance(payload, BytesPayload):
		ops.write_bytes(stage, payload.content)
		if payload.preserve_metadata_from is not None and payload.preserve_metadata_from.exists():
			ops.copystat(payload.preserve_metadata_from, stage)
		return
	raise AssertionError(f"unknown payload for {item.operation_id}")


def _clone_backup(source: Path, backup: Path, ops: FileOps) -> None:
	if source.is_symlink():
		ops.symlink(os.readlink(source), backup, source.resolve(strict=False).is_dir())
	else:
		ops.copy2(source, backup)


def _rollback_replacement(applied: _AppliedReplacement, ops: FileOps) -> None:
	item = applied.staged.replacement
	destination = item.physical_destination
	if applied.had_original and applied.promoted:
		if destination.exists() or destination.is_symlink():
			ops.remove(destination)
		ops.replace(applied.staged.backup, destination)
		ops.fsync_parent(destination)
		return
	if applied.original_moved:
		ops.replace(applied.staged.backup, destination)
		ops.fsync_parent(destination)
		return
	if applied.backup_ready:
		ops.remove(applied.staged.backup)
		return
	if not applied.had_original and applied.promoted:
		ops.remove(destination)
		ops.fsync_parent(destination)


def _apply_destination(
	plan: DestinationPlan,
	staged: tuple[_StagedReplacement, ...],
	run_id: str,
	ops: FileOps,
) -> tuple[list[ApplyEvent], bool]:
	applied_replacements: list[_AppliedReplacement] = []
	applied_prunes: list[_AppliedPrune] = []
	events: list[ApplyEvent] = []
	current_id = plan.label
	current_path = Path(plan.label)
	try:
		for staged_item in staged:
			item = staged_item.replacement
			current_id = item.operation_id
			current_path = item.logical_destination
			_validate_observed(item.observed, item.operation_id)
			destination = item.physical_destination
			planned = _planned_fingerprint(item.observed, destination)
			had_original = destination.exists() or destination.is_symlink()
			applied = _AppliedReplacement(staged_item, had_original)
			applied_replacements.append(applied)
			if had_original:
				if item.atomic_file and not destination.is_dir():
					_clone_backup(destination, staged_item.backup, ops)
					applied.backup_ready = True
					_validate_observed(item.observed, item.operation_id)
					_validate_backup(staged_item.backup, planned, item.operation_id)
				else:
					ops.replace(destination, staged_item.backup)
					applied.backup_ready = True
					applied.original_moved = True
					_validate_backup(staged_item.backup, planned, item.operation_id)
			ops.replace(staged_item.stage, destination)
			applied.promoted = True
			ops.fsync_parent(destination)

		for item in plan.prunes:
			current_id = item.operation_id
			current_path = item.destination
			_validate_observed((item.observed,), item.operation_id)
			backup = _artifact_path(item.destination, run_id, "backup")
			applied = _AppliedPrune(item, backup)
			applied_prunes.append(applied)
			ops.replace(item.destination, backup)
			applied.moved = True
			_validate_backup(backup, item.observed.fingerprint, item.operation_id)
			ops.fsync_parent(item.destination)
	except Exception as exc:
		rollback_errors: list[str] = []
		protected_artifacts: list[tuple[str, Path, str]] = []
		uncertain_destinations: list[tuple[str, Path, str]] = []
		for item in reversed(applied_prunes):
			if not item.moved:
				continue
			try:
				ops.replace(item.backup, item.prune.destination)
				ops.fsync_parent(item.prune.destination)
				events.append(
					ApplyEvent(
						item.prune.operation_id,
						"rolled_back",
						item.prune.destination,
						"restored after destination failure",
					)
				)
			except Exception as rollback_exc:
				if item.backup.exists() or item.backup.is_symlink():
					rollback_errors.append(f"{item.backup}: {rollback_exc}")
					protected_artifacts.append(
						(item.prune.operation_id, item.backup, str(rollback_exc))
					)
				else:
					rollback_errors.append(f"{item.prune.destination}: {rollback_exc}")
					uncertain_destinations.append(
						(
							item.prune.operation_id,
							item.prune.destination,
							_rollback_destination_detail(
								item.prune.destination,
								item.prune.observed.fingerprint,
								rollback_exc,
							),
						)
					)
		for item in reversed(applied_replacements):
			try:
				_rollback_replacement(item, ops)
				if item.promoted or item.original_moved:
					events.append(
						ApplyEvent(
							item.staged.replacement.operation_id,
							"rolled_back",
							item.staged.replacement.logical_destination,
							"restored after destination failure",
						)
					)
			except Exception as rollback_exc:
				operation_id = item.staged.replacement.operation_id
				if item.staged.backup.exists() or item.staged.backup.is_symlink():
					rollback_errors.append(f"{item.staged.backup}: {rollback_exc}")
					protected_artifacts.append(
						(operation_id, item.staged.backup, str(rollback_exc))
					)
				else:
					destination = item.staged.replacement.physical_destination
					rollback_errors.append(f"{destination}: {rollback_exc}")
					uncertain_destinations.append(
						(
							operation_id,
							destination,
							_rollback_destination_detail(
								destination,
								_planned_fingerprint(item.staged.replacement.observed, destination),
								rollback_exc,
							),
						)
					)
		protected_paths = {path for _, path, _ in protected_artifacts}
		for staged_item in staged:
			for artifact in (staged_item.stage, staged_item.backup):
				if artifact in protected_paths:
					continue
				try:
					if artifact.exists() or artifact.is_symlink():
						ops.remove(artifact)
				except Exception as cleanup_exc:
					rollback_errors.append(f"{artifact}: {cleanup_exc}")
		detail = str(exc)
		if rollback_errors:
			detail += "; recovery required: " + "; ".join(rollback_errors)
		events.append(ApplyEvent(current_id, "failed", current_path, detail))
		for operation_id, artifact, rollback_error in protected_artifacts:
			events.append(
				ApplyEvent(
					operation_id,
					"cleanup_required",
					artifact,
					f"rollback failed; backup retained: {rollback_error}",
				)
			)
		for operation_id, destination, rollback_detail in uncertain_destinations:
			events.append(
				ApplyEvent(
					operation_id,
					"cleanup_required",
					destination,
					rollback_detail,
				)
			)
		reported = {event.operation_id for event in events}
		for item in (*plan.replacements, *plan.prunes):
			if item.operation_id in reported:
				continue
			path = item.logical_destination if isinstance(item, Replacement) else item.destination
			events.append(ApplyEvent(item.operation_id, "unapplied", path, "destination failed"))
		return events, False

	cleanup_failed = False
	for item in applied_replacements:
		if not item.had_original:
			continue
		try:
			ops.remove(item.staged.backup)
		except Exception as exc:
			cleanup_failed = True
			events.append(
				ApplyEvent(
					item.staged.replacement.operation_id,
					"cleanup_required",
					item.staged.backup,
					str(exc),
				)
			)
	for item in applied_prunes:
		try:
			ops.remove(item.backup)
		except Exception as exc:
			cleanup_failed = True
			events.append(
				ApplyEvent(
					item.prune.operation_id,
					"cleanup_required",
					item.backup,
					str(exc),
				)
			)

	for item in plan.replacements:
		events.append(
			ApplyEvent(item.operation_id, "applied", item.logical_destination, plan.label)
		)
	for item in plan.prunes:
		events.append(ApplyEvent(item.operation_id, "applied", item.destination, plan.label))
	return events, not cleanup_failed


def apply_plan(
	plan: RunPlan, *, ops: FileOps | None = None, run_id: str | None = None
) -> ApplyReport:
	operations = FileOps() if ops is None else ops
	identifier = run_id or f"{os.getpid()}-{uuid.uuid4().hex[:12]}"
	issues = plan_issues(plan)
	if issues:
		return ApplyReport(
			False,
			tuple(ApplyEvent("preflight", "failed", Path("."), issue) for issue in issues),
		)

	staged_by_destination: list[
		tuple[DestinationPlan, tuple[_StagedReplacement, ...], frozenset[Path]]
	] = []
	all_stages: list[tuple[Path, str]] = []
	all_created_parents: set[Path] = set()
	current_id = "preflight"
	current_path = Path(".")
	try:
		_validate_plan_state(plan)
		for destination_plan in plan.destinations:
			staged: list[_StagedReplacement] = []
			created_parents: set[Path] = set()
			for item in destination_plan.replacements:
				current_id = item.operation_id
				current_path = item.logical_destination
				stage = _artifact_path(item.physical_destination, identifier, "stage")
				backup = _artifact_path(item.physical_destination, identifier, "backup")
				for parent in _created_parents(stage.parent):
					created_parents.add(parent)
					all_created_parents.add(parent)
				operations.makedirs(stage.parent)
				all_stages.append((stage, item.operation_id))
				_stage_replacement(item, stage, operations)
				staged.append(_StagedReplacement(item, stage, backup))
			staged_by_destination.append(
				(destination_plan, tuple(staged), frozenset(created_parents))
			)
		_validate_plan_state(plan)
	except Exception as exc:
		cleanup_errors: list[tuple[str, Path, str]] = []
		for stage, operation_id in reversed(all_stages):
			try:
				if stage.exists() or stage.is_symlink():
					operations.remove(stage)
			except Exception as cleanup_exc:
				cleanup_errors.append((operation_id, stage, str(cleanup_exc)))
		_remove_empty_parents(
			all_created_parents,
			protected_paths=tuple(path for _, path, _ in cleanup_errors),
		)
		detail = str(exc)
		if cleanup_errors:
			detail += "; cleanup required: " + "; ".join(
				f"{path}: {error}" for _, path, error in cleanup_errors
			)
		events = [ApplyEvent(current_id, "failed", current_path, detail)]
		for operation_id, path, cleanup_error in cleanup_errors:
			events.append(ApplyEvent(operation_id, "cleanup_required", path, cleanup_error))
		for destination in plan.destinations:
			for item in (*destination.replacements, *destination.prunes):
				if item.operation_id != current_id:
					path = (
						item.logical_destination
						if isinstance(item, Replacement)
						else item.destination
					)
					events.append(
						ApplyEvent(item.operation_id, "unapplied", path, "staging failed")
					)
		return ApplyReport(False, tuple(events))

	events: list[ApplyEvent] = []
	all_success = True
	for index, (destination_plan, staged, _created) in enumerate(staged_by_destination):
		destination_events, success = _apply_destination(
			destination_plan, staged, identifier, operations
		)
		events.extend(destination_events)
		if success:
			continue
		all_success = False
		for later_plan, later_staged, _later_created in staged_by_destination[index + 1 :]:
			for staged_item in later_staged:
				try:
					if staged_item.stage.exists() or staged_item.stage.is_symlink():
						operations.remove(staged_item.stage)
				except Exception as exc:
					events.append(
						ApplyEvent(
							staged_item.replacement.operation_id,
							"cleanup_required",
							staged_item.stage,
							str(exc),
						)
					)
				events.append(
					ApplyEvent(
						staged_item.replacement.operation_id,
						"unapplied",
						staged_item.replacement.logical_destination,
						"earlier destination failed",
					)
				)
			for prune_item in later_plan.prunes:
				events.append(
					ApplyEvent(
						prune_item.operation_id,
						"unapplied",
						prune_item.destination,
						"earlier destination failed",
					)
				)
		failed_and_unapplied_parents: set[Path] = set()
		for _plan, _staged, created in staged_by_destination[index:]:
			failed_and_unapplied_parents.update(created)
		_remove_empty_parents(
			failed_and_unapplied_parents,
			protected_paths=tuple(
				event.path for event in events if event.status == "cleanup_required"
			),
		)
		break

	if any(event.status == "cleanup_required" for event in events):
		all_success = False
	return ApplyReport(all_success, tuple(events))
