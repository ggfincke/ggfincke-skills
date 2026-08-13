# tests/test_pre_commit_hook.py
# pre-commit formatting scope and final-index snapshot regression

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import support

HOOK_FILES = (
	".prettierrc.json",
	"eslint.config.js",
	"lint-staged.config.js",
	"pyproject.toml",
	"scripts/checks/check-python-style.sh",
	"scripts/hooks/pre-commit",
	"skills/comment-style/assets/check_comment_style.py",
)


# run fixture commands without inheriting this repository's working directory
def run(
	cwd: Path, args: list[str], env: dict[str, str] | None = None
) -> subprocess.CompletedProcess[str]:
	return subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True, check=False)


def write(path: Path, body: str, executable: bool = False) -> None:
	path.parent.mkdir(parents=True, exist_ok=True)
	path.write_text(body, encoding="utf-8")
	if executable:
		path.chmod(0o755)


class PreCommitSnapshot(unittest.TestCase):
	# this is the one end-to-end fixture: lint-staged hides the unstaged hunk, the exact-file
	# wrapper normalizes only the staged Python file, and the hook tests the updated index
	def test_partial_stage_is_preserved_and_snapshot_is_tested(self) -> None:
		root_node_modules = support.REPO_ROOT / "node_modules"
		lint_staged = root_node_modules / "lint-staged" / "bin" / "lint-staged.js"
		if not lint_staged.is_file():
			self.skipTest("root lint-staged install is required for the hook integration fixture")

		with tempfile.TemporaryDirectory() as d:
			temp_root = Path(d)
			fixture = temp_root / "fixture"
			fixture.mkdir()
			for relative in HOOK_FILES:
				destination = fixture / relative
				destination.parent.mkdir(parents=True, exist_ok=True)
				shutil.copy2(support.REPO_ROOT / relative, destination)
			shutil.copytree(
				support.REPO_ROOT / "skills" / "comment-style" / "assets" / "eslint-rules",
				fixture / "skills" / "comment-style" / "assets" / "eslint-rules",
			)

			write(fixture / "package.json", '{"type":"module"}\n')
			write(fixture / ".gitignore", "node_modules\n")
			(fixture / "node_modules").symlink_to(root_node_modules, target_is_directory=True)

			ruff_log = temp_root / "ruff.log"
			write(
				fixture / "bin" / "uv",
				"#!/usr/bin/env python3\n"
				"# bin/uv\n"
				"# verify the wrapper's exact Ruff launch without network access\n"
				"\n"
				"import os\n"
				"import sys\n"
				"from pathlib import Path\n"
				"\n"
				"expected = ['run', '--with', 'ruff==0.16.2', '--no-project', 'ruff']\n"
				"if sys.argv[1:6] != expected:\n"
				"\tprint(f'unexpected uv invocation: {sys.argv[1:]}', file=sys.stderr)\n"
				"\traise SystemExit(2)\n"
				"with Path(os.environ['RUFF_LOG']).open('a', encoding='utf-8') as stream:\n"
				"\tstream.write(' '.join(sys.argv[1:]) + '\\n')\n",
				executable=True,
			)

			write(
				fixture / "scripts" / "validate-skills.py",
				"#!/usr/bin/env python3\n"
				"# scripts/validate-skills.py\n"
				"# validate the hook integration fixture\n",
			)
			write(
				fixture / "tests" / "test_snapshot.py",
				"# tests/test_snapshot.py\n"
				"# final-index snapshot observation fixture\n"
				"\n"
				"import os\n"
				"import subprocess\n"
				"import unittest\n"
				"from pathlib import Path\n"
				"\n"
				"\n"
				"class SnapshotState(unittest.TestCase):\n"
				"\tdef test_normalized_index_is_materialized(self) -> None:\n"
				"\t\troot = Path(__file__).resolve().parents[1]\n"
				"\t\tbody = (root / 'scripts' / 'example.py').read_text(encoding='utf-8')\n"
				"\t\tself.assertIn('# staged purpose\\n', body)\n"
				"\t\tself.assertIn('VALUE = \\\"staged\\\"\\n', body)\n"
				"\t\tself.assertNotEqual(root, Path(os.environ['FIXTURE_WORKTREE']))\n"
				"\t\tPath(os.environ['HOOK_OBSERVATION']).write_text(\n"
				"\t\t\tf'{root}\\n{body}', encoding='utf-8'\n"
				"\t\t)\n"
				"\n"
				"\t# leaked GIT_INDEX_FILE=.git/index makes worktree add treat .git as a directory\n"
				"\tdef test_worktree_add_is_not_blocked_by_hook_env(self) -> None:\n"
				"\t\tfixture = Path(os.environ['FIXTURE_WORKTREE'])\n"
				"\t\tdest = fixture.parent / 'linked-worktree'\n"
				"\t\tresult = subprocess.run(\n"
				"\t\t\t['git', 'worktree', 'add', '--detach', str(dest), 'HEAD'],\n"
				"\t\t\tcwd=fixture,\n"
				"\t\t\tcapture_output=True,\n"
				"\t\t\ttext=True,\n"
				"\t\t)\n"
				"\t\tself.assertEqual(result.returncode, 0, result.stderr)\n",
			)

			baseline = '# scripts/example.py\n# baseline purpose\nVALUE = "base"\n'
			write(fixture / "scripts" / "example.py", baseline)
			write(
				fixture / "scripts" / "unrelated.py",
				'# scripts/unrelated.py\n# unrelated baseline\nVALUE = "base"\n',
			)
			portable_helper = (
				"# skills/example/scripts/helper.py\n"
				"# portable helper outside root formatter ownership\n"
				'VALUE  =  "base"\n'
			)
			write(fixture / "skills" / "example" / "scripts" / "helper.py", portable_helper)
			write(
				fixture / "fixture.cjs",
				"// fixture.cjs\n"
				"// staged CommonJS formatter ownership\n"
				"module.exports = { value: 'base' }\n",
			)

			self.assertEqual(run(fixture, ["git", "init", "-q"]).returncode, 0)
			run(fixture, ["git", "config", "user.name", "Hook Fixture"])
			run(fixture, ["git", "config", "user.email", "hook@example.invalid"])
			self.assertEqual(run(fixture, ["git", "add", "."]).returncode, 0)
			commit = run(fixture, ["git", "commit", "-qm", "fixture baseline"])
			self.assertEqual(commit.returncode, 0, commit.stderr)

			staged = '# scripts/example.py\n# Staged purpose.\nVALUE = "staged"\n'
			write(fixture / "scripts" / "example.py", staged)
			self.assertEqual(
				run(fixture, ["git", "add", "scripts/example.py"]).returncode,
				0,
			)
			write(
				fixture / "scripts" / "example.py",
				'# scripts/example.py\n# Staged purpose.\nVALUE = "unstaged"\n',
			)
			write(
				fixture / "fixture.cjs",
				"// fixture.cjs\n"
				"// staged CommonJS formatter ownership\n"
				'module.exports  =  {value:"staged"};\n',
			)
			self.assertEqual(run(fixture, ["git", "add", "fixture.cjs"]).returncode, 0)
			unrelated_body = '# scripts/unrelated.py\n# Unrelated dirty purpose.\nVALUE = "dirty"\n'
			write(fixture / "scripts" / "unrelated.py", unrelated_body)
			untracked_body = "# scripts/untracked.py\n# Untracked dirty purpose.\n"
			write(fixture / "scripts" / "untracked.py", untracked_body)
			portable_staged = portable_helper.replace('"base"', '"staged"')
			write(
				fixture / "skills" / "example" / "scripts" / "helper.py",
				portable_staged,
			)
			self.assertEqual(
				run(
					fixture,
					[
						"git",
						"add",
						"skills/example/scripts/helper.py",
					],
				).returncode,
				0,
			)
			# dirty worktree config omits python; the indexed copy must still format it
			write(
				fixture / "lint-staged.config.js",
				"// lint-staged.config.js\n"
				"// dirty worktree config that skips python formatting\n"
				"\n"
				"export default {\n"
				"  '*.{js,mjs,cjs,ts,tsx}': ['eslint --fix', 'prettier --write'],\n"
				"}\n",
			)

			observation = temp_root / "hook-observation.txt"
			env = os.environ.copy()
			env.update(
				{
					"FIXTURE_WORKTREE": str(fixture),
					"HOOK_OBSERVATION": str(observation),
					"PATH": f"{fixture / 'bin'}:{env['PATH']}",
					"RUFF_LOG": str(ruff_log),
					"GIT_INDEX_FILE": ".git/index",
				}
			)
			hook = run(fixture, ["sh", "scripts/hooks/pre-commit"], env=env)
			self.assertEqual(hook.returncode, 0, hook.stdout + hook.stderr)

			indexed = run(fixture, ["git", "show", ":scripts/example.py"])
			self.assertEqual(indexed.returncode, 0, indexed.stderr)
			self.assertEqual(
				indexed.stdout,
				'# scripts/example.py\n# staged purpose\nVALUE = "staged"\n',
			)
			self.assertEqual(
				(fixture / "scripts" / "example.py").read_text(encoding="utf-8"),
				'# scripts/example.py\n# staged purpose\nVALUE = "unstaged"\n',
			)
			self.assertEqual(
				(fixture / "scripts" / "unrelated.py").read_text(encoding="utf-8"),
				unrelated_body,
			)
			self.assertEqual(
				(fixture / "scripts" / "untracked.py").read_text(encoding="utf-8"),
				untracked_body,
			)
			indexed_cjs = run(fixture, ["git", "show", ":fixture.cjs"])
			self.assertEqual(indexed_cjs.returncode, 0, indexed_cjs.stderr)
			self.assertEqual(
				indexed_cjs.stdout,
				"// fixture.cjs\n"
				"// staged CommonJS formatter ownership\n"
				"module.exports = { value: 'staged' }\n",
			)
			indexed_portable = run(
				fixture,
				["git", "show", ":skills/example/scripts/helper.py"],
			)
			self.assertEqual(indexed_portable.returncode, 0, indexed_portable.stderr)
			self.assertEqual(indexed_portable.stdout, portable_staged)
			self.assertEqual(
				(fixture / "skills" / "example" / "scripts" / "helper.py").read_text(
					encoding="utf-8"
				),
				portable_staged,
			)

			observed = observation.read_text(encoding="utf-8")
			observed_root = Path(observed.splitlines()[0])
			self.assertNotEqual(observed_root, fixture)
			self.assertFalse(observed_root.exists(), "hook snapshot was not cleaned up")
			invocations = ruff_log.read_text(encoding="utf-8").splitlines()
			self.assertEqual(len(invocations), 2)
			self.assertTrue(all("--with ruff==0.16.2" in line for line in invocations))
			selected_path = str(fixture / "scripts" / "example.py")
			self.assertTrue(all(line.endswith(selected_path) for line in invocations))
			self.assertTrue(all("unrelated.py" not in line for line in invocations))

			owned = str(fixture / "scripts" / "example.py")
			formatted = run(
				fixture,
				[
					"bash",
					"scripts/checks/check-python-style.sh",
					"--format-files",
					owned,
				],
				env=env,
			)
			self.assertEqual(formatted.returncode, 0, formatted.stdout + formatted.stderr)

			outside = temp_root / "outside.py"
			outside_body = "# outside.py\n# preserve symlink target\n"
			write(outside, outside_body)
			(fixture / "scripts" / "external.py").symlink_to(outside)
			rejected = run(
				fixture,
				[
					"bash",
					"scripts/checks/check-python-style.sh",
					"--format-files",
					"scripts/external.py",
				],
				env=env,
			)
			self.assertEqual(rejected.returncode, 2)
			self.assertIn("not an existing Python file", rejected.stderr)
			self.assertEqual(outside.read_text(encoding="utf-8"), outside_body)


if __name__ == "__main__":
	unittest.main()
