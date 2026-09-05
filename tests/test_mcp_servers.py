# tests/test_mcp_servers.py
# registry validation, per-tool rendering, and merge semantics for the mcp lane

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import support

paths = support.load_module("tooling_paths", support.SCRIPTS_DIR / "tooling_paths.py")
mcp = support.load_module("mcp_servers", support.SCRIPTS_DIR / "mcp_servers.py")

FIGMA_ENTRY = {
	"description": "Official Figma remote MCP server.",
	"transport": "remote",
	"url": "https://mcp.figma.com/mcp",
	"tools": ["opencode", "claude-code"],
}


def write_registry(directory: str, document: object) -> Path:
	path = Path(directory) / "servers.json"
	path.write_text(json.dumps(document), encoding="utf-8")
	return path


def valid_registry() -> dict:
	return {"version": 1, "servers": {"figma": dict(FIGMA_ENTRY)}}


class RegistryValidation(unittest.TestCase):
	def assert_single_issue(self, document: object, fragment: str) -> None:
		with tempfile.TemporaryDirectory() as directory:
			path = write_registry(directory, document)
			issues = mcp.registry_issues(path)
		self.assertEqual(len(issues), 1, issues)
		self.assertIn(fragment, issues[0])

	def test_valid_registry_has_no_issues(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			self.assertEqual(mcp.registry_issues(write_registry(directory, valid_registry())), ())

	def test_comment_metadata_keys_are_ignored(self) -> None:
		registry = valid_registry()
		registry["$comment"] = "why"
		with tempfile.TemporaryDirectory() as directory:
			self.assertEqual(mcp.registry_issues(write_registry(directory, registry)), ())

	def test_unknown_top_level_key_is_flagged(self) -> None:
		self.assert_single_issue({**valid_registry(), "extra": True}, "unknown top-level key")

	def test_version_must_be_the_accepted_integer(self) -> None:
		self.assert_single_issue({**valid_registry(), "version": 2}, "version must be 1")
		self.assert_single_issue({**valid_registry(), "version": True}, "version must be 1")

	def test_servers_must_be_an_object(self) -> None:
		self.assert_single_issue({"version": 1, "servers": []}, "servers must be an object")

	def test_server_names_are_kebab_or_snake(self) -> None:
		for name in ("Figma", "fig ma", ""):
			registry = {"version": 1, "servers": {name: dict(FIGMA_ENTRY)}}
			self.assert_single_issue(registry, "server name")

	def test_entry_must_be_an_object(self) -> None:
		self.assert_single_issue(
			{"version": 1, "servers": {"figma": []}}, "entry must be an object"
		)

	def test_unknown_entry_key_is_flagged(self) -> None:
		entry = {**FIGMA_ENTRY, "priority": 1}
		self.assert_single_issue({"version": 1, "servers": {"figma": entry}}, "unknown key")

	def test_description_is_required(self) -> None:
		entry = {key: value for key, value in FIGMA_ENTRY.items() if key != "description"}
		self.assert_single_issue({"version": 1, "servers": {"figma": entry}}, "non-empty string")

	def test_transport_is_constrained(self) -> None:
		entry = {**FIGMA_ENTRY, "transport": "grpc"}
		self.assert_single_issue({"version": 1, "servers": {"figma": entry}}, "transport")

	def test_tools_must_name_known_targets_uniquely(self) -> None:
		base = {"description": "d", "transport": "remote", "url": "https://x.test/mcp"}
		cases = {
			"missing": {**base},
			"empty": {**base, "tools": []},
			"unknown": {**base, "tools": ["zed"]},
			"duplicate": {**base, "tools": ["opencode", "opencode"]},
		}
		for case in cases.values():
			self.assert_single_issue(
				{"version": 1, "servers": {"s": case}}, "tools must be a non-empty list"
			)

	def test_enabled_must_be_boolean(self) -> None:
		entry = {**FIGMA_ENTRY, "enabled": "yes"}
		self.assert_single_issue({"version": 1, "servers": {"figma": entry}}, "boolean")

	def test_remote_requires_http_url_and_forbids_local_fields(self) -> None:
		entry = {key: value for key, value in FIGMA_ENTRY.items() if key != "url"}
		self.assert_single_issue(
			{"version": 1, "servers": {"figma": entry}}, "requires an http(s) url"
		)
		entry = {**FIGMA_ENTRY, "url": "ftp://mcp.figma.com"}
		self.assert_single_issue(
			{"version": 1, "servers": {"figma": entry}}, "requires an http(s) url"
		)
		entry = {**FIGMA_ENTRY, "command": ["node"]}
		self.assert_single_issue({"version": 1, "servers": {"figma": entry}}, "forbids")

	def test_local_requires_command_and_forbids_url(self) -> None:
		local = {
			"description": "d",
			"transport": "local",
			"tools": ["claude-code"],
		}
		self.assert_single_issue({"version": 1, "servers": {"s": local}}, "command list")
		entry = {**local, "command": ["node", ""], "url": "https://x.test"}
		with tempfile.TemporaryDirectory() as directory:
			issues = mcp.registry_issues(
				write_registry(
					directory,
					{
						"version": 1,
						"servers": {
							"s": entry,
						},
					},
				)
			)
		self.assertEqual(len(issues), 2, issues)
		self.assertTrue(any("command list" in issue for issue in issues))
		self.assertTrue(any("forbids url" in issue for issue in issues))
		entry = {**local, "command": ["node"], "url": "https://x.test"}
		self.assert_single_issue({"version": 1, "servers": {"s": entry}}, "forbids url")

	def test_local_environment_must_map_strings_to_strings(self) -> None:
		entry = {
			"description": "d",
			"transport": "local",
			"command": ["node"],
			"environment": {"KEY": 3},
			"tools": ["claude-code"],
		}
		self.assert_single_issue({"version": 1, "servers": {"s": entry}}, "strings to strings")

	def test_missing_file_invalid_json_and_non_object_root_are_flagged(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			missing = Path(directory) / "absent.json"
			self.assertIn("cannot read", mcp.registry_issues(missing)[0])
			broken = Path(directory) / "broken.json"
			broken.write_text("{", encoding="utf-8")
			self.assertIn("invalid JSON", mcp.registry_issues(broken)[0])
			array = Path(directory) / "array.json"
			array.write_text("[]", encoding="utf-8")
			self.assertIn("root is not a JSON object", mcp.registry_issues(array)[0])


class Loaders(unittest.TestCase):
	def test_load_servers_returns_typed_specs(self) -> None:
		registry = {
			"version": 1,
			"servers": {
				"figma": dict(FIGMA_ENTRY),
				"broker": {
					"description": "stdio broker",
					"transport": "local",
					"command": ["node", "server.js"],
					"environment": {"B": "2", "A": "1"},
					"tools": ["claude-code"],
				},
			},
		}
		with tempfile.TemporaryDirectory() as directory:
			servers = mcp.load_servers(write_registry(directory, registry))
		by_name = {server.name: server for server in servers}
		self.assertIsInstance(by_name["figma"], mcp.RemoteServer)
		self.assertEqual(by_name["figma"].url, "https://mcp.figma.com/mcp")
		self.assertEqual(by_name["figma"].tools, frozenset({"opencode", "claude-code"}))
		self.assertTrue(by_name["figma"].enabled)
		broker = by_name["broker"]
		self.assertIsInstance(broker, mcp.LocalServer)
		self.assertEqual(broker.command, ("node", "server.js"))
		self.assertEqual(broker.environment, (("A", "1"), ("B", "2")))

	def test_disabled_entries_keep_their_flag(self) -> None:
		entry = {**FIGMA_ENTRY, "enabled": False}
		with tempfile.TemporaryDirectory() as directory:
			servers = mcp.load_servers(
				write_registry(
					directory,
					{
						"version": 1,
						"servers": {"figma": entry},
					},
				)
			)
		self.assertFalse(servers[0].enabled)


class TargetResolution(unittest.TestCase):
	def test_defaults_live_under_the_user_home(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			home = Path(directory)
			self.assertEqual(
				mcp.resolve_target("opencode", environ={}, user_home=home),
				(home / ".config/opencode/opencode.json").resolve(),
			)
			self.assertEqual(
				mcp.resolve_target("claude-code", environ={}, user_home=home),
				(home / ".claude.json").resolve(),
			)

	def test_env_overrides_redirect_whole_homes(self) -> None:
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			self.assertEqual(
				mcp.resolve_target("opencode", environ={"OPENCODE_HOME": str(root / "oc")}),
				(root / "oc/opencode.json").resolve(),
			)
			self.assertEqual(
				mcp.resolve_target("claude-code", environ={"CLAUDE_HOME": str(root / "cl")}),
				(root / "cl/.claude.json").resolve(),
			)
			self.assertEqual(
				mcp.resolve_target(
					"claude-code",
					environ={
						"CLAUDE_CONFIG_DIR": str(root / "native"),
						"CLAUDE_HOME": str(root / "cl"),
					},
				),
				(root / "native/.claude.json").resolve(),
			)


class DesiredSections(unittest.TestCase):
	def setUp(self) -> None:
		tmp = tempfile.TemporaryDirectory()
		self.addCleanup(tmp.cleanup)
		self.servers = mcp.load_servers(
			write_registry(
				tmp.name,
				{
					"version": 1,
					"servers": {
						"figma": dict(FIGMA_ENTRY),
						"web-only": {
							"description": "web only",
							"transport": "remote",
							"url": "https://mcp.example.com/mcp",
							"tools": ["opencode"],
						},
						"broker": {
							"description": "stdio broker",
							"transport": "local",
							"command": ["node", "server.js", "--quiet"],
							"environment": {"TOKEN": "t"},
							"tools": ["claude-code"],
						},
					},
				},
			)
		)

	def test_opencode_shape(self) -> None:
		self.assertEqual(
			mcp.desired_opencode(self.servers),
			{
				"figma": {"type": "remote", "url": "https://mcp.figma.com/mcp"},
				"web-only": {"type": "remote", "url": "https://mcp.example.com/mcp"},
			},
		)

	def test_claude_shape_splits_command_and_maps_environment(self) -> None:
		self.assertEqual(
			mcp.desired_claude(self.servers),
			{
				"figma": {"type": "http", "url": "https://mcp.figma.com/mcp"},
				"broker": {
					"command": "node",
					"args": ["server.js", "--quiet"],
					"env": {"TOKEN": "t"},
				},
			},
		)

	def test_local_entry_without_environment_omits_the_key(self) -> None:
		registry = {
			"version": 1,
			"servers": {
				"bare": {
					"description": "d",
					"transport": "local",
					"command": ["node"],
					"tools": ["opencode"],
				},
			},
		}
		with tempfile.TemporaryDirectory() as directory:
			servers = mcp.load_servers(write_registry(directory, registry))
		self.assertEqual(
			mcp.desired_opencode(servers),
			{"bare": {"type": "local", "command": ["node"]}},
		)


class MergeSection(unittest.TestCase):
	def test_creates_section_when_absent(self) -> None:
		merged, changed = mcp.merge_section({"other": 1}, "mcp", {"figma": {"a": 1}})
		self.assertTrue(changed)
		self.assertEqual(merged, {"other": 1, "mcp": {"figma": {"a": 1}}})

	def test_preserves_foreign_siblings_and_entries_in_place(self) -> None:
		document = {
			"model": "ollama/gemma4:31b-mlx",
			"mcp": {"manual": {"type": "remote", "url": "https://keep.test"}, "old": {"v": 1}},
		}
		merged, changed = mcp.merge_section(document, "mcp", {"new": {"n": 1}, "old": {"v": 2}})
		self.assertTrue(changed)
		self.assertEqual(list(merged["mcp"]), ["manual", "old", "new"])
		self.assertEqual(merged["mcp"]["manual"], {"type": "remote", "url": "https://keep.test"})
		self.assertEqual(merged["model"], "ollama/gemma4:31b-mlx")

	def test_identical_content_reports_no_change(self) -> None:
		document = {"mcp": {"figma": {"type": "remote", "url": "https://m"}}}
		merged, changed = mcp.merge_section(
			document, "mcp", {"figma": {"type": "remote", "url": "https://m"}}
		)
		self.assertFalse(changed)
		self.assertEqual(merged, document)

	def test_empty_desired_with_absent_section_is_a_noop(self) -> None:
		document: dict = {"model": "x"}
		merged, changed = mcp.merge_section(document, "mcp", {})
		self.assertFalse(changed)
		self.assertEqual(merged, document)

	def test_replaces_non_dict_section(self) -> None:
		merged, changed = mcp.merge_section({"mcp": "broken"}, "mcp", {"figma": {}})
		self.assertTrue(changed)
		self.assertEqual(merged["mcp"], {"figma": {}})


class SummariesAndSerialization(unittest.TestCase):
	def test_summarize_change_covers_add_update_and_noop(self) -> None:
		old = {"kept": {"same": 1}, "stale": {"old": 2}}
		desired = {"kept": {"same": 1}, "fresh": {"new": 3}}
		self.assertEqual(mcp.summarize_change(old, desired), "add fresh")
		old = {"figma": {"url": "https://old"}}
		self.assertEqual(
			mcp.summarize_change(old, {"figma": {"url": "https://new"}}), "update figma"
		)
		self.assertEqual(mcp.summarize_change({}, {}), "no changes")

	def test_serialize_round_trips_with_two_space_indent_and_newline(self) -> None:
		text = mcp.serialize({"mcp": {"figma": {"url": "https://m"}}}).decode("utf-8")
		self.assertTrue(text.endswith("\n"))
		self.assertIn('\n  "mcp"', text)
		self.assertEqual(json.loads(text), {"mcp": {"figma": {"url": "https://m"}}})


if __name__ == "__main__":
	unittest.main()
