# tests/test_artifact_materialization.py
# preserve ignored artifact inputs and refuse changed or conflicting materializations

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import support

helper = support.load_module(
	"materialize_inputs",
	support.REPO_ROOT
	/ "projects/tierlistbuilder/seed-example-sourcing/scripts/materialize-inputs.py",
)


class ArtifactMaterialization(unittest.TestCase):
	def setUp(self) -> None:
		self.temp = tempfile.TemporaryDirectory()
		self.addCleanup(self.temp.cleanup)
		self.root = Path(self.temp.name).resolve()
		self.source = self.root / "source"
		self.destination = self.root / "isolated"
		self.source.mkdir()
		self.destination.mkdir()
		(self.source / "examples").mkdir()
		self.input = self.source / "examples/art.png"
		self.input.write_bytes(b"original artifact bytes")
		self.row = {
			"source": "examples/art.png",
			"destination": "examples/art.png",
			"sha256": hashlib.sha256(self.input.read_bytes()).hexdigest(),
		}
		self.manifest = self.root / "inputs.json"

	def run_materializer(self, rows=None):
		self.manifest.write_text(
			json.dumps({"schema_version": 1, "inputs": rows if rows is not None else [self.row]})
		)
		return helper.materialize(
			self.manifest, self.source, self.destination, "materialization.json"
		)

	def test_ignored_input_copies_without_git_and_recovery_survives_edits(self) -> None:
		subprocess.run(["git", "init", "-q", str(self.source)], check=True)
		(self.source / ".gitignore").write_text("examples/\n")
		subprocess.run(["git", "-C", str(self.source), "add", ".gitignore"], check=True)
		index = (self.source / ".git/index").read_bytes()
		ignored = subprocess.run(
			["git", "-C", str(self.source), "check-ignore", "examples/art.png"],
			capture_output=True,
			check=True,
		)
		self.assertTrue(ignored.stdout)
		receipt = self.run_materializer()
		self.assertEqual(receipt["status"], "complete")
		self.assertEqual(len(receipt["copied"]), 1)
		output = self.destination / "examples/art.png"
		self.assertEqual(output.read_bytes(), self.input.read_bytes())
		self.assertFalse((self.destination / ".gitignore").exists())
		self.assertEqual((self.source / ".git/index").read_bytes(), index)
		output.write_bytes(b"edited candidate")
		self.assertEqual((Path(receipt["recovery"]) / "0").read_bytes(), self.input.read_bytes())
		(self.destination / "materialization.json").write_text("edited task receipt")
		self.assertEqual(
			json.loads((Path(receipt["recovery"]) / "receipt.json").read_text()), receipt
		)

	def test_invalid_inputs_and_collisions_fail_before_copying(self) -> None:
		for updates in (
			{"source": "missing.png"},
			{"sha256": "0" * 64},
			{"source": "../inputs.json"},
			{"destination": "../escape.png"},
			{"destination": ".git/index"},
		):
			with self.subTest(updates=updates), self.assertRaises((OSError, ValueError)):
				self.run_materializer([{**self.row, **updates}])
			self.assertEqual(list(self.destination.iterdir()), [])
		with self.assertRaises(ValueError):
			self.run_materializer([self.row, self.row])
		(self.destination / "examples").symlink_to(
			self.source / "examples", target_is_directory=True
		)
		with self.assertRaises(ValueError):
			self.run_materializer()
		(self.destination / "examples").unlink()
		(self.destination / "examples").mkdir()
		output = self.destination / "examples/art.png"
		output.write_bytes(b"user work")
		with self.assertRaises(ValueError):
			self.run_materializer()
		self.assertEqual(output.read_bytes(), b"user work")

	def test_changed_source_during_staging_retains_recovery_without_publishing(self) -> None:
		original_open = helper.source_file
		calls = 0

		def change_on_second_open(root, parts):
			nonlocal calls
			calls += 1
			if calls == 2:
				self.input.write_bytes(b"concurrent change")
			return original_open(root, parts)

		with (
			mock.patch.object(helper, "source_file", side_effect=change_on_second_open),
			self.assertRaisesRegex(ValueError, "changed during copy"),
		):
			self.run_materializer()
		self.assertFalse((self.destination / "examples").exists())
		failures = list(self.destination.glob(".artifact-materialization-*/failure.json"))
		self.assertEqual(len(failures), 1)
		self.assertEqual(json.loads(failures[0].read_text())["copied"], [])

	def test_redirected_ancestor_preserves_original_root_and_reports_recovery(self) -> None:
		container = self.root / "container"
		container.mkdir()
		self.destination.rename(container / "isolated")
		self.destination = container / "isolated"
		outside = self.root / "outside"
		(outside / "isolated").mkdir(parents=True)
		original_container = self.root / "original-container"
		original_create = helper.create_recovery

		def redirect_before_staging(destination_fd):
			container.rename(original_container)
			container.symlink_to(outside, target_is_directory=True)
			return original_create(destination_fd)

		with (
			mock.patch.object(helper, "create_recovery", side_effect=redirect_before_staging),
			self.assertRaisesRegex(ValueError, "root path changed.*copied 0/1") as failure,
		):
			self.run_materializer()
		self.assertEqual(list((outside / "isolated").iterdir()), [])
		retained = list((original_container / "isolated").glob(".artifact-materialization-*"))
		self.assertEqual(len(retained), 1)
		self.assertEqual((retained[0] / "0").read_bytes(), self.input.read_bytes())
		receipt = json.loads((retained[0] / "failure.json").read_text())
		self.assertEqual(receipt["copied"], [])
		self.assertIn("changed", receipt["recovery_path_status"])
		self.assertEqual(receipt["recovery_identity"]["inode"], retained[0].stat().st_ino)
		self.assertIn(receipt["recovery"], str(failure.exception))
		self.assertIn(str(retained[0].stat().st_ino), str(failure.exception))
		self.assertIsInstance(failure.exception.__cause__, ValueError)

	def test_source_redirect_during_read_uses_pinned_input_and_prevents_publication(self) -> None:
		original_source = self.root / "original-source"
		replacement = self.root / "replacement-source"
		(replacement / "examples").mkdir(parents=True)
		(replacement / "examples/art.png").write_bytes(b"redirected input")
		original_open = helper.source_file
		calls = 0

		def redirect_on_second_open(root_fd, parts):
			nonlocal calls
			calls += 1
			if calls == 2:
				self.source.rename(original_source)
				self.source.symlink_to(replacement, target_is_directory=True)
			return original_open(root_fd, parts)

		with (
			mock.patch.object(helper, "source_file", side_effect=redirect_on_second_open),
			self.assertRaisesRegex(ValueError, "root path changed"),
		):
			self.run_materializer()
		self.assertFalse((self.destination / "examples").exists())
		retained = next(self.destination.glob(".artifact-materialization-*"))
		self.assertEqual(
			(retained / "0").read_bytes(), (original_source / "examples/art.png").read_bytes()
		)
		self.assertEqual(json.loads((retained / "failure.json").read_text())["copied"], [])

	def test_concurrent_collision_retains_partial_receipt_and_existing_work(self) -> None:
		original_link = helper.os.link
		calls = 0

		def create_concurrent_file(source, destination, **kwargs):
			nonlocal calls
			calls += 1
			if calls == 2:
				fd = os.open(
					destination,
					os.O_WRONLY | os.O_CREAT | os.O_EXCL,
					0o600,
					dir_fd=kwargs["dst_dir_fd"],
				)
				with os.fdopen(fd, "wb") as file:
					file.write(b"concurrent user work")
			return original_link(source, destination, **kwargs)

		rows = [self.row, {**self.row, "destination": "examples/second.png"}]
		with (
			mock.patch.object(helper.os, "link", side_effect=create_concurrent_file),
			self.assertRaisesRegex(ValueError, "FileExistsError:.*copied 1/2") as failure,
		):
			self.run_materializer(rows)
		self.assertEqual(
			(self.destination / "examples/second.png").read_bytes(), b"concurrent user work"
		)
		self.assertEqual(
			(self.destination / "examples/art.png").read_bytes(), self.input.read_bytes()
		)
		retained = next(self.destination.glob(".artifact-materialization-*"))
		receipt = json.loads((retained / "failure.json").read_text())
		self.assertEqual(
			[row["destination"] for row in receipt["copied"]], [self.row["destination"]]
		)
		self.assertEqual(receipt["status"], "failed")
		self.assertIsInstance(failure.exception.__cause__, FileExistsError)
		self.assertIn(str(retained), str(failure.exception))


if __name__ == "__main__":
	unittest.main()
