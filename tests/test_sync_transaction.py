# tests/test_sync_transaction.py
# staged sync transactions preserve prior destinations across injected failures

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import support

transaction = support.load_module("sync_transaction", support.SCRIPTS_DIR / "sync_transaction.py")


class FaultingOps(transaction.FileOps):
	def __init__(self, action: str, occurrence: int = 1):
		self.action = action
		self.occurrence = occurrence
		self.seen = 0

	def before(self, action: str, path: Path) -> None:
		if action != self.action:
			return
		self.seen += 1
		if self.seen == self.occurrence:
			raise OSError(f"injected {action} failure at {path}")


class PartialStageOps(transaction.FileOps):
	def copy2(self, _source: Path, destination: Path) -> None:
		destination.write_bytes(b"partial stage")
		raise OSError(f"injected mid-copy failure at {destination}")


class MutateAtomicBackupOps(transaction.FileOps):
	def __init__(self, replacement: bytes, *, restore_planned: bytes | None = None):
		self.replacement = replacement
		self.restore_planned = restore_planned

	def copy2(self, source: Path, destination: Path) -> None:
		if destination.name.endswith(".backup"):
			source.write_bytes(self.replacement)
		super().copy2(source, destination)
		if destination.name.endswith(".backup") and self.restore_planned is not None:
			source.write_bytes(self.restore_planned)


class MutateMovedBackupOps(transaction.FileOps):
	def __init__(self, replacement: bytes):
		self.replacement = replacement

	def replace(self, source: Path, destination: Path) -> None:
		super().replace(source, destination)
		if not destination.name.endswith(".backup"):
			return
		if destination.is_dir():
			(destination / "state.txt").write_bytes(self.replacement)
		else:
			destination.write_bytes(self.replacement)


class PersistentFsyncFailureOps(transaction.FileOps):
	def before(self, action: str, path: Path) -> None:
		if action == "fsync-parent":
			raise OSError(f"injected persistent fsync failure at {path}")


def file_replacement(operation_id: str, source: Path, destination: Path):
	return transaction.replacement(
		operation_id,
		destination,
		transaction.copy_file_payload(source),
		atomic_file=True,
	)


class AllRunStaging(unittest.TestCase):
	def test_copy_stage_failure_preserves_every_destination(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			source_a, source_b = root / "source-a", root / "source-b"
			destination_a, destination_b = root / "a", root / "b"
			for path, content in (
				(source_a, "new-a"),
				(source_b, "new-b"),
				(destination_a, "old-a"),
				(destination_b, "old-b"),
			):
				path.write_text(content, encoding="utf-8")
			plan = transaction.RunPlan(
				(
					transaction.DestinationPlan(
						"first", (file_replacement("a", source_a, destination_a),)
					),
					transaction.DestinationPlan(
						"second", (file_replacement("b", source_b, destination_b),)
					),
				)
			)

			report = transaction.apply_plan(
				plan, ops=FaultingOps("copy2", occurrence=2), run_id="test"
			)

			self.assertFalse(report.success)
			self.assertEqual(destination_a.read_text(), "old-a")
			self.assertEqual(destination_b.read_text(), "old-b")
			self.assertFalse(list(root.glob(".*.ggfincke-sync.*")))

	def test_mid_copy_partial_stage_is_registered_and_removed(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			source = root / "source"
			destination = root / "destination"
			source.write_text("new", encoding="utf-8")
			destination.write_text("old", encoding="utf-8")
			plan = transaction.RunPlan(
				(
					transaction.DestinationPlan(
						"root", (file_replacement("replace", source, destination),)
					),
				)
			)

			report = transaction.apply_plan(plan, ops=PartialStageOps(), run_id="test")

			self.assertFalse(report.success)
			self.assertEqual(destination.read_text(), "old")
			self.assertFalse(list(root.glob(".*.ggfincke-sync.*")))


class DestinationRollback(unittest.TestCase):
	def test_second_promote_failure_rolls_back_the_first_replacement(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			replacements = []
			for name in ("a", "b"):
				source = root / f"source-{name}"
				destination = root / name
				source.write_text(f"new-{name}", encoding="utf-8")
				destination.write_text(f"old-{name}", encoding="utf-8")
				replacements.append(file_replacement(name, source, destination))
			plan = transaction.RunPlan((transaction.DestinationPlan("root", tuple(replacements)),))

			# each atomic file creates a backup with copy2, then replace promotes it
			report = transaction.apply_plan(
				plan, ops=FaultingOps("replace", occurrence=2), run_id="test"
			)

			self.assertFalse(report.success)
			self.assertEqual((root / "a").read_text(), "old-a")
			self.assertEqual((root / "b").read_text(), "old-b")
			self.assertTrue(any(event.status == "rolled_back" for event in report.events))

	def test_prune_failure_rolls_back_replacement(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			source = root / "source"
			destination = root / "destination"
			orphan = root / "orphan"
			source.write_text("new", encoding="utf-8")
			destination.write_text("old", encoding="utf-8")
			orphan.write_text("keep", encoding="utf-8")
			plan = transaction.RunPlan(
				(
					transaction.DestinationPlan(
						"root",
						(file_replacement("replace", source, destination),),
						(transaction.prune("prune", orphan),),
					),
				)
			)

			# replacement promote is first replace call; prune quarantine is second
			report = transaction.apply_plan(
				plan, ops=FaultingOps("replace", occurrence=2), run_id="test"
			)

			self.assertFalse(report.success)
			self.assertEqual(destination.read_text(), "old")
			self.assertEqual(orphan.read_text(), "keep")


class InFlightMutationRollback(unittest.TestCase):
	def assert_no_residue(self, root: Path) -> None:
		self.assertFalse(list(root.rglob(".*.ggfincke-sync.*")))

	def test_directory_promote_and_post_rename_fsync_failures_restore_exact_state(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)

			with self.subTest("directory promote after backup"):
				source = root / "tree-source"
				destination = root / "tree-destination"
				(source / "nested").mkdir(parents=True)
				(source / "nested" / "new.txt").write_text("new", encoding="utf-8")
				(destination / "nested").mkdir(parents=True)
				(destination / "nested" / "old.txt").write_text("old", encoding="utf-8")
				before = transaction.fingerprint_path(destination)
				item = transaction.replacement(
					"tree",
					destination,
					transaction.copy_tree_payload(source),
				)
				report = transaction.apply_plan(
					transaction.RunPlan((transaction.DestinationPlan("tree", (item,)),)),
					ops=FaultingOps("replace", occurrence=2),
					run_id="tree",
				)
				self.assertFalse(report.success)
				self.assertEqual(transaction.fingerprint_path(destination), before)
				self.assert_no_residue(root)

			with self.subTest("replacement fsync after promote"):
				source = root / "file-source"
				destination = root / "file-destination"
				source.write_text("new", encoding="utf-8")
				destination.write_text("old", encoding="utf-8")
				before = transaction.fingerprint_path(destination)
				report = transaction.apply_plan(
					transaction.RunPlan(
						(
							transaction.DestinationPlan(
								"file", (file_replacement("file", source, destination),)
							),
						)
					),
					ops=FaultingOps("fsync-parent"),
					run_id="file",
				)
				self.assertFalse(report.success)
				self.assertEqual(transaction.fingerprint_path(destination), before)
				self.assert_no_residue(root)

			with self.subTest("prune fsync after quarantine"):
				orphan = root / "orphan"
				orphan.write_text("old", encoding="utf-8")
				before = transaction.fingerprint_path(orphan)
				report = transaction.apply_plan(
					transaction.RunPlan(
						(
							transaction.DestinationPlan(
								"prune", prunes=(transaction.prune("prune", orphan),)
							),
						)
					),
					ops=FaultingOps("fsync-parent"),
					run_id="prune",
				)
				self.assertFalse(report.success)
				self.assertEqual(transaction.fingerprint_path(orphan), before)
				self.assert_no_residue(root)


class BackupStateValidation(unittest.TestCase):
	def assert_no_residue(self, root: Path) -> None:
		self.assertFalse(list(root.rglob(".*.ggfincke-sync.*")))

	def test_atomic_backup_rechecks_destination_and_captured_bytes(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			for name, restore_planned, expected, detail in (
				("destination-changed", None, b"concurrent", "path changed after planning"),
				("backup-changed", b"old", b"old", "backup does not match"),
			):
				with self.subTest(name):
					source = root / f"{name}-source"
					destination = root / f"{name}-destination"
					source.write_bytes(b"new")
					destination.write_bytes(b"old")
					plan = transaction.RunPlan(
						(
							transaction.DestinationPlan(
								name,
								(file_replacement(name, source, destination),),
							),
						)
					)

					report = transaction.apply_plan(
						plan,
						ops=MutateAtomicBackupOps(b"concurrent", restore_planned=restore_planned),
						run_id=name,
					)

					self.assertFalse(report.success)
					self.assertEqual(destination.read_bytes(), expected)
					self.assertTrue(any(detail in event.detail for event in report.events))
					self.assert_no_residue(root)

	def test_moved_directory_and_prune_backups_are_validated_before_continue(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)

			with self.subTest("directory replacement"):
				source = root / "tree-source"
				destination = root / "tree-destination"
				source.mkdir()
				destination.mkdir()
				(source / "state.txt").write_bytes(b"new")
				(destination / "state.txt").write_bytes(b"old")
				item = transaction.replacement(
					"tree", destination, transaction.copy_tree_payload(source)
				)

				report = transaction.apply_plan(
					transaction.RunPlan((transaction.DestinationPlan("tree", (item,)),)),
					ops=MutateMovedBackupOps(b"concurrent"),
					run_id="tree",
				)

				self.assertFalse(report.success)
				self.assertEqual((destination / "state.txt").read_bytes(), b"concurrent")
				self.assertTrue(
					any("backup does not match" in event.detail for event in report.events)
				)
				self.assert_no_residue(root)

			with self.subTest("prune quarantine"):
				orphan = root / "orphan"
				orphan.write_bytes(b"old")
				report = transaction.apply_plan(
					transaction.RunPlan(
						(
							transaction.DestinationPlan(
								"prune", prunes=(transaction.prune("prune", orphan),)
							),
						)
					),
					ops=MutateMovedBackupOps(b"concurrent"),
					run_id="prune",
				)

				self.assertFalse(report.success)
				self.assertEqual(orphan.read_bytes(), b"concurrent")
				self.assertTrue(
					any("backup does not match" in event.detail for event in report.events)
				)
				self.assert_no_residue(root)


class TreeSymlinkSemantics(unittest.TestCase):
	def test_copy_plan_rejects_out_of_tree_symlink_before_creating_a_target(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			referent = root / "referent.txt"
			referent.write_text("planned", encoding="utf-8")
			source = root / "source"
			source.mkdir()
			(source / "linked.txt").symlink_to(referent)
			destination = root / "destination"
			item = transaction.replacement(
				"tree", destination, transaction.copy_tree_payload(source)
			)

			report = transaction.apply_plan(
				transaction.RunPlan((transaction.DestinationPlan("tree", (item,)),)),
				run_id="tree",
			)

			self.assertFalse(report.success)
			self.assertFalse(destination.exists())
			self.assertEqual(referent.read_text(encoding="utf-8"), "planned")
			self.assertTrue(
				any(
					"copy source contains a symlink" in event.detail
					and "linked.txt" in event.detail
					for event in report.events
				)
			)
			self.assertFalse(list(root.rglob(".*.ggfincke-sync.*")))


class RollbackDurabilityReporting(unittest.TestCase):
	def test_persistent_fsync_failure_reports_destination_not_missing_backup(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			cases = []

			source = root / "source"
			destination = root / "destination"
			source.write_bytes(b"new")
			destination.write_bytes(b"old")
			cases.append(
				(
					"replacement",
					destination,
					transaction.RunPlan(
						(
							transaction.DestinationPlan(
								"replacement",
								(file_replacement("replacement", source, destination),),
							),
						)
					),
				)
			)

			orphan = root / "orphan"
			orphan.write_bytes(b"old")
			cases.append(
				(
					"prune",
					orphan,
					transaction.RunPlan(
						(
							transaction.DestinationPlan(
								"prune", prunes=(transaction.prune("prune", orphan),)
							),
						)
					),
				)
			)

			for name, path, plan in cases:
				with self.subTest(name):
					report = transaction.apply_plan(
						plan, ops=PersistentFsyncFailureOps(), run_id=name
					)

					self.assertFalse(report.success)
					self.assertEqual(path.read_bytes(), b"old")
					cleanup = [
						event for event in report.events if event.status == "cleanup_required"
					]
					self.assertEqual([event.path for event in cleanup], [path])
					self.assertIn("destination durability is uncertain", cleanup[0].detail)
					self.assertFalse(
						any("backup retained" in event.detail for event in report.events)
					)
					self.assertFalse(list(root.rglob(".*.ggfincke-sync.*")))


class PartialApplicationIsExplicit(unittest.TestCase):
	def test_failed_first_destination_removes_all_new_target_roots(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			sources = root / "sources"
			sources.mkdir()
			plans = []
			before = {}
			for name in ("a", "b"):
				source = sources / name
				source.write_text(f"new-{name}", encoding="utf-8")
				before[source] = transaction.fingerprint_path(source)
				destination = root / f"target-{name}" / "nested" / "agent.md"
				plans.append(
					transaction.DestinationPlan(
						name, (file_replacement(name, source, destination),)
					)
				)

			report = transaction.apply_plan(
				transaction.RunPlan(tuple(plans)),
				ops=FaultingOps("replace"),
				run_id="test",
			)

			self.assertFalse(report.success)
			self.assertFalse((root / "target-a").exists())
			self.assertFalse((root / "target-b").exists())
			self.assertEqual({path: transaction.fingerprint_path(path) for path in before}, before)
			self.assertFalse(list(root.rglob(".*.ggfincke-sync.*")))

	def test_later_destination_failure_reports_prior_destination_applied(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			plans = []
			for name in ("a", "b"):
				source = root / f"source-{name}"
				destination = root / name
				source.write_text(f"new-{name}", encoding="utf-8")
				destination.write_text(f"old-{name}", encoding="utf-8")
				plans.append(
					transaction.DestinationPlan(
						name, (file_replacement(name, source, destination),)
					)
				)

			report = transaction.apply_plan(
				transaction.RunPlan(tuple(plans)),
				ops=FaultingOps("replace", occurrence=2),
				run_id="test",
			)

			self.assertFalse(report.success)
			self.assertEqual((root / "a").read_text(), "new-a")
			self.assertEqual((root / "b").read_text(), "old-b")
			statuses = {(event.operation_id, event.status) for event in report.events}
			self.assertIn(("a", "applied"), statuses)
			self.assertIn(("b", "failed"), statuses)


class StaleArtifactsFailClosed(unittest.TestCase):
	def test_existing_backup_blocks_the_run_without_mutation(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			source = root / "source"
			destination = root / "destination"
			source.write_text("new", encoding="utf-8")
			destination.write_text("old", encoding="utf-8")
			(root / ".destination.ggfincke-sync.crashed.backup").write_text("prior")
			plan = transaction.RunPlan(
				(
					transaction.DestinationPlan(
						"root", (file_replacement("replace", source, destination),)
					),
				)
			)

			report = transaction.apply_plan(plan, run_id="test")

			self.assertFalse(report.success)
			self.assertEqual(destination.read_text(), "old")
			self.assertTrue(any("manual recovery" in event.detail for event in report.events))

	def test_non_directory_destination_parent_is_a_preflight_error(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			parent = root / "target"
			parent.write_text("user-owned", encoding="utf-8")
			destination = parent / "child"
			item = transaction.replacement("replace", destination, transaction.BytesPayload(b"new"))

			report = transaction.apply_plan(
				transaction.RunPlan((transaction.DestinationPlan("root", (item,)),)),
				run_id="test",
			)

			self.assertFalse(report.success)
			self.assertEqual(parent.read_text(encoding="utf-8"), "user-owned")
			self.assertTrue(
				any("parent is not a directory" in event.detail for event in report.events)
			)


if __name__ == "__main__":
	unittest.main()
