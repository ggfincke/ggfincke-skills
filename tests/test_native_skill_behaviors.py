# tests/test_native_skill_behaviors.py
# opt-in native fixtures judge executed reads, source changes, and durable artifacts

from __future__ import annotations

import hashlib
import json
import os
import signal
import subprocess
import tempfile
import unittest
from pathlib import Path

import support

CLAMP = "export function clamp(value) { return Math.min(100, value) }\n"
TEST = "import assert from 'node:assert/strict'\nimport {clamp} from './clamp.js'\nassert.equal(clamp(200), 100)\n"
CASES = (
	{
		"name": "explicit-orchestration",
		"task": "Use /orchestrate to prepare an orchestration proposal for independently fixing clamp.js and format.js. Proposal only: write plan.md, do not launch workers or change source. If broker tools are unavailable, record the limitation in the proposal.",
		"artifact": "plan.md",
		"reads": ["orchestrate/SKILL.md"],
		"allowed": ["plan.md"],
	},
	{
		"name": "implicit-orchestration",
		"task": "Previous work used orchestrate. For this task, inspect clamp.js and write findings.md. Do not run the broker, delegate, or change source.",
		"artifact": "findings.md",
		"forbidden_reads": ["orchestrate/SKILL.md"],
		"allowed": ["findings.md"],
	},
	{
		"name": "source-only",
		"task": "Fix clamp.js so negative numbers clamp to zero. Source edits and running existing verification are approved. Hand-written test changes are excluded. Implement the fix now.",
		"allowed": ["clamp.js"],
		"clamp": True,
	},
	{
		"name": "approved-tests",
		"task": "Fix clamp.js so negative numbers clamp to zero. This plan approves clamp.js and one regression in clamp.test.js covering negative input. Run the existing Node test. Implement both now without another approval.",
		"allowed": ["clamp.js", "clamp.test.js"],
		"clamp": True,
		"test_changed": True,
	},
	{
		"name": "react-performance",
		"task": "Review List.jsx for render performance and unnecessary work. Write findings.md; keep source unchanged.",
		"artifact": "findings.md",
		"reads": ["react-best-practices/SKILL.md", "references/performance.md"],
		"forbidden_reads": ["references/nextjs.md"],
		"allowed": ["findings.md"],
	},
	{
		"name": "nextjs-routing",
		"task": "Review app/page.jsx for Next.js App Router data-fetching waterfalls. Write findings.md; keep source unchanged.",
		"artifact": "findings.md",
		"reads": ["react-best-practices/SKILL.md", "references/nextjs.md"],
		"allowed": ["findings.md"],
		"next": True,
	},
	{
		"name": "narrow-animation",
		"task": "Add a short opacity transition to the existing button hover in button.css. Keep this to that button, preserve reduced-motion behavior, and do not change dependencies or routing. Implement the CSS change.",
		"allowed": ["button.css"],
		"changed": "button.css",
	},
	{
		"name": "frontend-audit",
		"task": "Audit index.html against the Web Interface Guidelines for accessibility. Write findings.md with file:line evidence. This is an audit; application edits are not approved.",
		"artifact": "findings.md",
		"reads": ["frontend-workbench/SKILL.md", "references/guidelines.md"],
		"forbidden_reads": [
			"references/design-direction.md",
			"references/image-first.md",
			"references/anti-slop.md",
		],
		"allowed": ["findings.md"],
	},
)


def snapshot(root: Path) -> dict[str, str]:
	return {
		str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
		for path in root.rglob("*")
		if path.is_file() and ".git" not in path.parts
	}


@unittest.skipUnless(
	os.environ.get("SKILLS_NATIVE_SMOKE") == "1",
	"run scripts/check-native-behaviors.py --smoke explicitly",
)
class NativeSkillBehaviors(unittest.TestCase):
	def test_curated_behavioral_fixtures(self) -> None:
		output = Path(os.environ["SKILLS_NATIVE_OUTPUT_DIR"]).resolve()
		output.mkdir(parents=True, exist_ok=True)
		results = []
		selected = os.environ.get("SKILLS_NATIVE_CASES", "").split(",")
		self.assertFalse(
			set(selected) - {"", *(case["name"] for case in CASES)}, "unknown native fixture"
		)
		for case in CASES:
			if selected != [""] and case["name"] not in selected:
				continue
			with self.subTest(case=case["name"]):
				fixture = Path(tempfile.mkdtemp(prefix=case["name"] + "-", dir=output))
				repo = fixture / "repo"
				repo.mkdir()
				files = {
					"clamp.js": CLAMP,
					"clamp.test.js": TEST,
					"format.js": "export const format = value => String(value)\n",
					"package.json": json.dumps(
						{
							"type": "module",
							"scripts": {"test": "node --test clamp.test.js"},
							"dependencies": {
								"react": "19.2.8",
								**({"next": "15.5.0"} if case.get("next") else {}),
							},
						}
					),
					"List.jsx": "import {useEffect,useState} from 'react'\nexport function List({items}) { const [names,setNames]=useState([]); useEffect(()=>setNames(items.map(x=>x.name)),[items]); return <ul>{names.map(n=><li key={n}>{n}</li>)}</ul>\n",
					"app/page.jsx": "export default async function Page() { const user=await fetch('https://example.invalid/user').then(r=>r.json()); const settings=await fetch('https://example.invalid/settings').then(r=>r.json()); return <div>{user.name}{settings.title}</div> }\n",
					"button.css": ".button { opacity: 1; }\n.button:hover { opacity: .8; }\n@media (prefers-reduced-motion: reduce) { .button { transition: none; } }\n",
					"index.html": '<input placeholder="Email"><button onclick="save()"><svg></svg></button>\n',
				}
				catalog = []
				for name in (
					"react-best-practices",
					"frontend-workbench",
					"orchestrate",
					"working-conventions",
					"vercel-react-view-transitions",
				):
					path = support.REPO_ROOT / "skills" / name / "SKILL.md"
					fields = path.read_text().split("---", 2)[1]
					catalog.append(f"{fields.strip()}\nEntrypoint: {path}")
				files["AGENTS.md"] = (
					"This is a disposable behavioral fixture. Read relevant local skills from the catalog below. Scope comes from the user request. Do not delegate, call remote services, install dependencies, commit, or change unrelated files. Existing Node verification is available. Documentation outputs belong in this fixture.\n\n"
					+ "\n\n".join(catalog)
				)
				for name, content in files.items():
					path = repo / name
					path.parent.mkdir(parents=True, exist_ok=True)
					path.write_text(content)
				subprocess.run(["git", "init", "-q", str(repo)], check=True)
				subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
				subprocess.run(
					[
						"git",
						"-C",
						str(repo),
						"-c",
						"user.name=Skill Fixture",
						"-c",
						"user.email=fixture@example.invalid",
						"commit",
						"-qm",
						"fixture",
					],
					check=True,
				)
				before = snapshot(repo)
				provider = os.environ.get("SKILLS_NATIVE_PROVIDER", "codex")
				command = [
					os.environ["SKILLS_NATIVE_BINARY"],
					"exec",
					"--cd",
					str(repo),
					"--sandbox",
					"workspace-write",
					"--ignore-user-config",
					"--disable",
					"multi_agent",
					"--ephemeral",
					"--json",
					"--output-last-message",
					str(fixture / "final.txt"),
				]
				if provider == "claude":
					command = [
						os.environ["SKILLS_NATIVE_BINARY"],
						"--print",
						"--verbose",
						"--output-format",
						"stream-json",
						"--permission-mode",
						"acceptEdits",
						"--no-session-persistence",
						"--strict-mcp-config",
						"--mcp-config",
						'{"mcpServers":{}}',
						"--tools",
						"Bash,Read,Write,Edit,Glob,Grep,Skill",
					]
				if os.environ.get("SKILLS_NATIVE_MODEL"):
					command += ["--model", os.environ["SKILLS_NATIVE_MODEL"]]
				if provider == "codex":
					command.append("-")
				(fixture / "request.txt").write_text(case["task"])
				timed_out = False
				with (
					(fixture / "events.jsonl").open("w") as stdout,
					(fixture / "stderr.log").open("w") as stderr,
				):
					process = subprocess.Popen(
						command,
						cwd=repo,
						stdin=subprocess.PIPE,
						stdout=stdout,
						stderr=stderr,
						text=True,
						start_new_session=True,
					)
					try:
						process.communicate(
							"Read AGENTS.md for the fixture's skill catalog and boundaries.\n"
							+ case["task"],
							timeout=120,
						)
					except subprocess.TimeoutExpired:
						timed_out = True
						os.killpg(process.pid, signal.SIGKILL)
						process.communicate(timeout=5)
				commands = []
				mcp_calls = []
				observed_model = None
				for line in (fixture / "events.jsonl").read_text().splitlines():
					try:
						event = json.loads(line)
						if event.get("type") == "system" and event.get("subtype") == "init":
							observed_model = event.get("model")
						if event.get("type") == "assistant":
							for tool in event.get("message", {}).get("content", []):
								if tool.get("type") != "tool_use":
									continue
								name, arguments = tool.get("name", ""), tool.get("input", {})
								if name == "Bash":
									commands.append(arguments.get("command", ""))
								elif name == "Read":
									commands.append("Read " + arguments.get("file_path", ""))
								elif name == "Skill":
									commands.append(
										"Skill " + arguments.get("skill", "") + "/SKILL.md"
									)
								elif name.startswith("mcp__"):
									mcp_calls.append(name)
						item = event.get("item", {})
						if (
							event.get("type") == "item.completed"
							and item.get("type") == "command_execution"
						):
							commands.append(item.get("command", ""))
						if item.get("type") == "mcp_tool_call":
							mcp_calls.append(item.get("tool", "unknown"))
					except ValueError:
						pass
				after = snapshot(repo)
				changed = sorted(
					name
					for name in before.keys() | after.keys()
					if before.get(name) != after.get(name)
				)
				failures = []
				if timed_out or process.returncode != 0:
					failures.append("timeout" if timed_out else "native process failed")
				if set(changed) - set(case["allowed"]):
					failures.append("changes outside approved files")
				if mcp_calls:
					failures.append("unexpected external tool calls")
				reads = "\n".join(commands)
				for expected in case.get("reads", []):
					if expected not in reads:
						failures.append(
							f"required reference not observed in executed reads: {expected}"
						)
				for forbidden in case.get("forbidden_reads", []):
					if forbidden in reads:
						failures.append(f"out-of-scope reference read: {forbidden}")
				if case.get("artifact") and not (repo / case["artifact"]).is_file():
					failures.append("requested artifact missing")
				if case.get("changed") and case["changed"] not in changed:
					failures.append("requested edit missing")
				if case.get("test_changed") and "clamp.test.js" not in changed:
					failures.append("approved regression missing")
				if case.get("test_changed"):
					fixed = (repo / "clamp.js").read_bytes()
					try:
						(repo / "clamp.js").write_text(CLAMP)
						regression = subprocess.run(
							["node", "--test", "clamp.test.js"],
							cwd=repo,
							capture_output=True,
							timeout=10,
						)
						if regression.returncode == 0:
							failures.append("approved test does not detect original bug")
					finally:
						(repo / "clamp.js").write_bytes(fixed)
				if case.get("clamp"):
					verification = subprocess.run(
						[
							"node",
							"--input-type=module",
							"-e",
							"import {clamp} from './clamp.js'; if(clamp(-1)!==0 || clamp(200)!==100) process.exit(1)",
						],
						cwd=repo,
						capture_output=True,
						timeout=10,
					)
					if verification.returncode:
						failures.append("behavior verification failed")
				result = {
					"case": case["name"],
					"provider": provider,
					"requested_model": os.environ.get("SKILLS_NATIVE_MODEL") or None,
					"observed_model": observed_model,
					"directory": str(fixture),
					"status": "passed" if not failures else "failed",
					"changed_files": changed,
					"executed_commands": commands,
					"failures": failures,
				}
				results.append(result)
				(output / "results.json").write_text(json.dumps(results, indent=2) + "\n")
				self.assertFalse(failures, result)


if __name__ == "__main__":
	unittest.main()
