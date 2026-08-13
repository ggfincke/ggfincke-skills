# tests/test_branch_sweep.py
# branch sweep plan: complete read-only discovery, reasoned skips & worktree classes

from __future__ import annotations

import os
import shutil
import signal
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

import support

PLAN_HELPER = support.REPO_ROOT / "skills" / "branch-sweep" / "scripts" / "sweep-plan.sh"


class BranchSweepPlan(unittest.TestCase):
	def setUp(self) -> None:
		self.temp = tempfile.TemporaryDirectory()
		self.addCleanup(self.temp.cleanup)
		self.root = Path(self.temp.name)
		self.repo = self.root / "repo"
		self.origin = self.root / "origin.git"
		self.fake_bin = self.root / "bin"
		self.fake_bin.mkdir()
		real_git = shutil.which("git")
		real_sort = shutil.which("sort")
		if real_git is None:
			self.fail("git is unavailable")
		if real_sort is None:
			self.fail("sort is unavailable")
		self.real_git = real_git
		self.real_sort = real_sort
		self.bound_fetch_url = "https://github.com/origin-owner/origin-repo.git"
		self.bound_push_url = "git@github.com:origin-owner/origin-repo.git"
		self.git_log = self.root / "git-arguments.log"
		fake_git = self.fake_bin / "git"
		fake_git.write_text(
			"#!/bin/sh\n"
			'if [ -n "${FAKE_GIT_LOG:-}" ]; then printf \'%s\\n\' "$*" >> "$FAKE_GIT_LOG"; fi\n'
			'if [ "${FAKE_GIT_CURRENT_FAIL:-0}" = 1 ] && '
			'[ "$1" = branch ] && [ "$2" = --show-current ]; then\n'
			"  printf '%s\\n' 'fake current-branch query failure' >&2\n"
			"  exit 1\n"
			"fi\n"
			'if [ "${FAKE_GIT_WORKTREE_FAIL:-0}" = 1 ] && '
			'[ "$1" = worktree ] && [ "$2" = list ] && '
			'[ "$3" = --porcelain ] && [ "$4" = -z ]; then\n'
			"  printf '%s\\n' 'fake worktree inventory failure' >&2\n"
			"  exit 1\n"
			"fi\n"
			'if [ "${FAKE_GIT_DEFAULT_FAIL:-0}" = 1 ] && '
			'[ "$1" = ls-remote ] && [ "$2" = --symref ] && '
			'[ "$3" = "$FAKE_GIT_PUSH_URL" ] && [ "$4" = HEAD ]; then\n'
			"  printf '%s\\n' 'fake live default query failure' >&2\n"
			"  exit 1\n"
			"fi\n"
			'if [ "$1" = remote ] && [ "$2" = get-url ] && '
			'[ "$3" = --all ] && [ "$4" = origin ]; then\n'
			"  printf '%s\\n' \"$FAKE_GIT_FETCH_URL\"\n"
			"  exit 0\n"
			"fi\n"
			'if [ "$1" = remote ] && [ "$2" = get-url ] && '
			'[ "$3" = --push ] && [ "$4" = --all ] && [ "$5" = origin ]; then\n'
			"  printf '%s\\n' \"$FAKE_GIT_PUSH_URL\"\n"
			"  exit 0\n"
			"fi\n"
			'if [ "$1" = ls-remote ] && [ "$2" = --heads ] && '
			'[ "$3" = "$FAKE_GIT_PUSH_URL" ]; then\n'
			'  exec "$REAL_GIT" ls-remote --heads "$FAKE_GIT_LIVE_ORIGIN"\n'
			"fi\n"
			'if [ "$1" = ls-remote ] && [ "$2" = --symref ] && '
			'[ "$3" = "$FAKE_GIT_PUSH_URL" ] && [ "$4" = HEAD ]; then\n'
			'  exec "$REAL_GIT" ls-remote --symref "$FAKE_GIT_LIVE_ORIGIN" HEAD\n'
			"fi\n"
			'exec "$REAL_GIT" "$@"\n'
		)
		fake_git.chmod(0o755)
		fake_sort = self.fake_bin / "sort"
		fake_sort.write_text(
			"#!/bin/sh\n"
			'if [ "${FAKE_SORT_BLOCKED_FAIL:-0}" = 1 ]; then\n'
			'  for argument in "$@"; do\n'
			'    case "$argument" in */blocked-candidate-reasons)\n'
			"      printf '%s\\n' 'fake blocked-candidate sort failure' >&2\n"
			"      exit 71\n"
			"      ;;\n"
			"    esac\n"
			"  done\n"
			"fi\n"
			'exec "$REAL_SORT" "$@"\n'
		)
		fake_sort.chmod(0o755)

		self.run_command(["git", "init", "--bare", str(self.origin)], cwd=self.root)
		self.run_command(["git", "symbolic-ref", "HEAD", "refs/heads/main"], cwd=self.origin)
		self.run_command(["git", "init", "-b", "main", str(self.repo)], cwd=self.root)
		self.git("config", "user.name", "Branch Sweep Test")
		self.git("config", "user.email", "branch-sweep@example.test")
		(self.repo / "base.txt").write_text("base\n")
		self.git("add", "base.txt")
		self.git("commit", "-m", "base")
		self.git("remote", "add", "origin", str(self.origin))
		self.git("push", "-u", "origin", "main")

		for branch in (
			"advanced-reused",
			"current-work",
			"held-candidate",
			"local-merged",
			"newline-held-candidate",
			"release/spike",
			"remote-match-local-diverged",
			"remote-only",
			"remote-tag-collision",
			"stale-worktree",
			"tag-collision",
			"unmerged-local",
			"unmerged-remote",
		):
			self.git("branch", branch, "main")

		self.base_oid = self.git("rev-parse", "main").strip()
		self.git("switch", "advanced-reused")
		(self.repo / "advanced.txt").write_text("new work after the merged PR\n")
		self.git("add", "advanced.txt")
		self.git("commit", "-m", "advance reused branch")
		self.advanced_oid = self.git("rev-parse", "HEAD").strip()
		self.git("switch", "unmerged-local")
		(self.repo / "unmerged.txt").write_text("not landed\n")
		self.git("add", "unmerged.txt")
		self.git("commit", "-m", "unmerged work")
		self.git(
			"push",
			"origin",
			"advanced-reused",
			"current-work",
			"held-candidate",
			"local-merged",
			"newline-held-candidate",
			"release/spike",
			"remote-match-local-diverged",
			"remote-only",
			"remote-tag-collision",
			"stale-worktree",
			"tag-collision",
			"unmerged-local",
			"unmerged-remote",
		)
		self.git("switch", "current-work")
		self.git("branch", "-D", "remote-only", "remote-tag-collision", "unmerged-remote")

		self.held_worktree = self.root / "held-worktree"
		self.newline_held_worktree = self.root / "held\nnewline-worktree"
		self.remote_match_local_diverged_worktree = (
			self.root / "remote-match-local-diverged-worktree"
		)
		self.retained_worktree = self.root / "retained-worktree"
		self.stale_worktree = self.root / "stale-worktree"
		self.git("worktree", "add", str(self.held_worktree), "held-candidate")
		self.git(
			"worktree",
			"add",
			str(self.newline_held_worktree),
			"newline-held-candidate",
		)
		self.newline_held_worktree_display = (
			"$'" + str(self.newline_held_worktree.resolve()).replace("\n", "\\n") + "'"
		)
		self.newline_lock_reason = "maintenance\napproval required"
		self.newline_lock_reason_display = "$'maintenance\\napproval required'"
		self.git(
			"worktree",
			"lock",
			"--reason",
			self.newline_lock_reason,
			str(self.newline_held_worktree),
		)
		self.git(
			"worktree",
			"add",
			str(self.remote_match_local_diverged_worktree),
			"remote-match-local-diverged",
		)
		(self.remote_match_local_diverged_worktree / "diverged.txt").write_text(
			"local work after the merged remote tip\n"
		)
		self.run_command(
			["git", "add", "diverged.txt"], cwd=self.remote_match_local_diverged_worktree
		)
		self.run_command(
			["git", "commit", "-m", "advance only the local worktree"],
			cwd=self.remote_match_local_diverged_worktree,
		)
		self.remote_match_local_diverged_oid = self.run_command(
			["git", "rev-parse", "HEAD"], cwd=self.remote_match_local_diverged_worktree
		).stdout.strip()
		self.git("worktree", "add", str(self.retained_worktree), "unmerged-local")
		self.git("worktree", "add", str(self.stale_worktree), "stale-worktree")
		shutil.rmtree(self.stale_worktree)
		self.git("config", "gc.worktreePruneExpire", "now")
		self.git("tag", "tag-collision", self.advanced_oid)
		self.git("tag", "main", self.advanced_oid)
		self.git("tag", "remote-tag-collision", self.base_oid)
		self.git(
			"push",
			"origin",
			"refs/tags/remote-tag-collision:refs/tags/remote-tag-collision",
		)

		self.gh_output = self.root / "merged-pr-heads.tsv"
		merged = [f"gone-{number:03d}\t{self.base_oid}\t{number}" for number in range(1, 306)]
		merged.extend(
			[
				f"current-work\t{self.base_oid}\t901",
				f"held-candidate\t{self.base_oid}\t902",
				f"local-merged\t{self.base_oid}\t903",
				f"newline-held-candidate\t{self.base_oid}\t909",
				f"release/spike\t{self.base_oid}\t904",
				f"stale-worktree\t{self.base_oid}\t905",
				f"remote-only\t{self.base_oid}\t906",
				f"advanced-reused\t{self.base_oid}\t907",
				f"remote-match-local-diverged\t{self.base_oid}\t908",
				f"tag-collision\t{self.base_oid}\t911",
				f"remote-tag-collision\t{self.base_oid}\t912",
			]
		)
		self.gh_output.write_text("\n".join(merged) + "\n")
		self.gh_log = self.root / "gh-arguments.log"
		fake_gh = self.fake_bin / "gh"
		fake_gh.write_text(
			"#!/bin/sh\n"
			'printf \'%s\\n\' "$*" >> "$FAKE_GH_LOG"\n'
			'if [ "$1" != api ] || [ "$2" != --hostname ] || '
			'[ "$3" != github.com ]; then\n'
			"  printf '%s\\n' 'gh request was not bound to origin hostname' >&2\n"
			"  exit 64\n"
			"fi\n"
			'if [ "$4" = repos/origin-owner/origin-repo ]; then\n'
			'  if [ "${FAKE_GH_DEFAULT_FAIL:-0}" = 1 ]; then\n'
			"  printf '%s\\n' 'fake GitHub default query failure' >&2\n"
			"    exit 1\n"
			"  fi\n"
			"  printf '%s\\n' \"${FAKE_GH_DEFAULT:-main}\"\n"
			"  exit 0\n"
			"fi\n"
			'case "$4" in repos/origin-owner/origin-repo/pulls\\?state=closed\\&per_page=100) ;;\n'
			"*) printf '%s\\n' 'gh request was not bound to origin repository' >&2; exit 64 ;;\n"
			"esac\n"
			'if [ -n "${FAKE_GH_BLOCK_MARKER:-}" ]; then\n'
			'  : > "$FAKE_GH_BLOCK_MARKER"\n'
			"  sleep 30\n"
			"fi\n"
			'if [ "${FAKE_GH_FAIL:-0}" = 1 ]; then\n'
			'  head -n 1 "$FAKE_GH_OUTPUT"\n'
			"  printf '%s\\n' 'fake GitHub page failure' >&2\n"
			"  exit 1\n"
			"fi\n"
			'cat "$FAKE_GH_OUTPUT"\n'
		)
		fake_gh.chmod(0o755)

	def run_command(
		self, command: list[str], *, cwd: Path, env: dict[str, str] | None = None
	) -> subprocess.CompletedProcess[str]:
		result = subprocess.run(
			command,
			cwd=cwd,
			capture_output=True,
			text=True,
			env=env,
			check=False,
		)
		self.assertEqual(result.returncode, 0, result.stderr)
		return result

	def git(self, *args: str) -> str:
		return self.run_command(["git", *args], cwd=self.repo).stdout

	def repository_state(self) -> tuple[str, str]:
		refs = self.git(
			"for-each-ref",
			"--format=%(refname)%00%(objectname)%00%(symref)",
		)
		status = self.git("status", "--porcelain=v2", "--branch")
		return refs, status

	def plan_environment(self, *, github_failure: bool = False) -> dict[str, str]:
		environment = dict(
			os.environ,
			PATH=f"{self.fake_bin}{os.pathsep}{os.environ['PATH']}",
			REAL_GIT=self.real_git,
			REAL_SORT=self.real_sort,
			FAKE_GIT_FETCH_URL=self.bound_fetch_url,
			FAKE_GIT_PUSH_URL=self.bound_push_url,
			FAKE_GIT_LIVE_ORIGIN=str(self.origin),
			FAKE_GIT_LOG=str(self.git_log),
			FAKE_GH_OUTPUT=str(self.gh_output),
			FAKE_GH_LOG=str(self.gh_log),
			GH_REPO="elsewhere-owner/elsewhere-repo",
			LC_ALL="C",
		)
		if github_failure:
			environment["FAKE_GH_FAIL"] = "1"
		return environment

	def plan(self, *, github_failure: bool = False) -> subprocess.CompletedProcess[str]:
		return self.run_command(
			[str(PLAN_HELPER)],
			cwd=self.repo,
			env=self.plan_environment(github_failure=github_failure),
		)

	def output_section(self, output: str, title: str) -> str:
		body = output.split(f"=== {title} ===\n", 1)[1]
		return body.split("\n=== ", 1)[0]

	def test_complete_paginated_plan_classifies_candidates_skips_and_worktrees(self) -> None:
		before = self.repository_state()
		result = self.plan()

		self.assertEqual(self.repository_state(), before)
		self.assertIn("316 unique ref+SHA records from all gh api --paginate pages", result.stdout)
		self.assertIn(
			"origin binding  : complete (github.com/origin-owner/origin-repo",
			result.stdout,
		)
		self.assertIn("remote heads    : complete (live exact push target", result.stdout)
		self.assertIn("worktree records: complete", result.stdout)
		self.assertIn(f"local-merged  (OID {self.base_oid}; PR #903)", result.stdout)
		self.assertIn(f"tag-collision  (OID {self.base_oid}; PR #911)", result.stdout)
		self.assertIn(f"origin/remote-only  (OID {self.base_oid}; PR #906)", result.stdout)
		self.assertIn(f"origin/remote-tag-collision  (OID {self.base_oid}; PR #912)", result.stdout)
		self.assertNotIn("heads/tag-collision", result.stdout)
		self.assertFalse(self.git("branch", "--list", "remote-only").strip())

		self.assertIn("current-work  (current branch)", result.stdout)
		self.assertIn("main  (default branch)", result.stdout)
		self.assertIn("release/spike  (protected branch family)", result.stdout)
		self.assertIn("unmerged-local  (no merged PR found on GitHub)", result.stdout)
		self.assertIn("origin/unmerged-remote  (no merged PR found on GitHub)", result.stdout)
		advanced_reason = (
			f"merged PR history found, but current tip {self.advanced_oid[:12]} "
			"does not match a merged PR head"
		)
		self.assertIn(f"advanced-reused  ({advanced_reason})", result.stdout)
		self.assertIn(f"origin/advanced-reused  ({advanced_reason})", result.stdout)
		self.assertNotIn(f"advanced-reused  (OID {self.base_oid}; PR #907)", result.stdout)
		self.assertNotIn(f"origin/advanced-reused  (OID {self.base_oid}; PR #907)", result.stdout)

		self.assertIn("=== WORKTREES REMOVABLE AFTER APPROVAL ===", result.stdout)
		self.assertIn(
			f"{self.held_worktree}  "
			"(held-candidate; unlocked and proven clean; removable only after approval)",
			result.stdout,
		)
		blocking_worktrees = self.output_section(
			result.stdout, "WORKTREES BLOCKING LOCAL SWEEP CANDIDATES"
		)
		self.assertNotIn(str(self.newline_held_worktree), blocking_worktrees)
		self.assertNotIn(self.newline_lock_reason, blocking_worktrees)
		self.assertIn(
			f"{self.newline_held_worktree_display}  "
			"(newline-held-candidate; blocks local deletion; not removable: "
			"worktree is locked; locked: "
			f"{self.newline_lock_reason_display})",
			blocking_worktrees,
		)
		self.assertIn(
			"newline-held-candidate  (candidate worktree is not removable: worktree is locked)",
			result.stdout,
		)
		self.assertIn(
			"=== ALL PRUNABLE WORKTREE RECORDS ===",
			result.stdout,
		)
		self.assertIn(
			f"{self.stale_worktree}  (stale-worktree; local sweep candidate",
			result.stdout,
		)
		prunable_worktrees = self.output_section(result.stdout, "ALL PRUNABLE WORKTREE RECORDS")
		self.assertNotIn("gitdir file points to non-existent location", prunable_worktrees)
		self.assertIn(r"gitdir\ file\ points\ to\ non-existent\ location", prunable_worktrees)
		self.assertIn("=== WORKTREES RETAINED ===", result.stdout)
		self.assertIn(
			f"{self.retained_worktree}  (unmerged-local; not held by a local sweep candidate)",
			result.stdout,
		)
		gh_calls = self.gh_log.read_text()
		self.assertIn("--hostname github.com", gh_calls)
		self.assertIn("repos/origin-owner/origin-repo/pulls?state=closed&per_page=100", gh_calls)
		self.assertIn("--paginate", gh_calls)
		self.assertNotIn("elsewhere-owner/elsewhere-repo", gh_calls)
		self.assertNotIn("{owner}", gh_calls)
		self.assertIn(f"ls-remote --heads {self.bound_push_url}", self.git_log.read_text())

		worktree_failure_environment = self.plan_environment()
		worktree_failure_environment["FAKE_GIT_WORKTREE_FAIL"] = "1"
		worktree_failure_before = self.repository_state()
		worktree_failure = self.run_command(
			[str(PLAN_HELPER)], cwd=self.repo, env=worktree_failure_environment
		)
		self.assertEqual(self.repository_state(), worktree_failure_before)
		self.assertIn("worktree records: incomplete", worktree_failure.stdout)
		self.assertIn(
			"(none)",
			self.output_section(
				worktree_failure.stdout, "LOCAL CANDIDATES (merged branches to sweep)"
			),
		)
		self.assertIn(
			"local-merged  (worktree discovery incomplete; local deletion suppressed)",
			worktree_failure.stdout,
		)
		self.assertIn(
			f"origin/remote-only  (OID {self.base_oid}; PR #906)",
			worktree_failure.stdout,
		)

		held_sibling_worktree = self.root / "held-sibling-worktree"
		self.git(
			"worktree",
			"add",
			"--force",
			str(held_sibling_worktree),
			"held-candidate",
		)
		exclude_output = self.run_command(
			["git", "rev-parse", "--git-path", "info/exclude"], cwd=held_sibling_worktree
		).stdout.strip()
		exclude_path = Path(exclude_output)
		if not exclude_path.is_absolute():
			exclude_path = held_sibling_worktree / exclude_path
		with exclude_path.open("a") as exclude_file:
			exclude_file.write("ignored-secret.txt\n")
		ignored_file = held_sibling_worktree / "ignored-secret.txt"
		ignored_bytes = b"ignored user data must survive\n"
		ignored_file.write_bytes(ignored_bytes)
		ignored_before = self.repository_state()
		ignored_result = self.plan()
		self.assertEqual(self.repository_state(), ignored_before)
		self.assertTrue(self.held_worktree.is_dir())
		self.assertTrue(held_sibling_worktree.is_dir())
		self.assertEqual(ignored_file.read_bytes(), ignored_bytes)
		removable_after_ignored = self.output_section(
			ignored_result.stdout, "WORKTREES REMOVABLE AFTER APPROVAL"
		)
		self.assertNotIn(
			str(self.held_worktree),
			removable_after_ignored,
		)
		self.assertNotIn(str(held_sibling_worktree), removable_after_ignored)
		self.assertIn(
			f"{held_sibling_worktree}  "
			"(held-candidate; blocks local deletion; not removable: ignored files present)",
			ignored_result.stdout,
		)
		self.assertIn(
			f"{self.held_worktree}  "
			"(held-candidate; blocks local deletion; not removable: "
			"another worktree for this branch is not removable)",
			ignored_result.stdout,
		)
		self.assertNotIn(
			"held-candidate",
			self.output_section(
				ignored_result.stdout, "LOCAL CANDIDATES (merged branches to sweep)"
			),
		)
		self.assertIn(
			"held-candidate  (candidate worktree is not removable: ignored files present)",
			ignored_result.stdout,
		)
		self.assertIn(
			f"origin/held-candidate  (OID {self.base_oid}; PR #902)", ignored_result.stdout
		)

		transform_plan_temp = self.root / "transform-plan-temp"
		transform_plan_temp.mkdir()
		transform_environment = self.plan_environment()
		transform_environment["FAKE_SORT_BLOCKED_FAIL"] = "1"
		transform_environment["TMPDIR"] = str(transform_plan_temp)
		transform_before = self.repository_state()
		transform_failure = subprocess.run(
			[str(PLAN_HELPER)],
			cwd=self.repo,
			capture_output=True,
			text=True,
			env=transform_environment,
			check=False,
		)
		self.assertNotEqual(transform_failure.returncode, 0)
		self.assertEqual(transform_failure.stdout, "")
		self.assertIn("fake blocked-candidate sort failure", transform_failure.stderr)
		self.assertEqual(list(transform_plan_temp.glob("branch-sweep-plan.*")), [])
		self.assertEqual(self.repository_state(), transform_before)
		self.assertEqual(ignored_file.read_bytes(), ignored_bytes)

		divergent_environment = self.plan_environment()
		divergent_environment["FAKE_GIT_PUSH_URL"] = "git@github.com:other-owner/other-repo.git"
		divergent_before = self.repository_state()
		divergent = self.run_command([str(PLAN_HELPER)], cwd=self.repo, env=divergent_environment)
		self.assertEqual(self.repository_state(), divergent_before)
		self.assertIn(
			"origin binding  : incomplete "
			"(origin fetch and push URLs resolve to different repositories)",
			divergent.stdout,
		)
		self.assertIn(
			"(none)",
			self.output_section(divergent.stdout, "LOCAL CANDIDATES (merged branches to sweep)"),
		)
		self.assertIn(
			"(none)",
			self.output_section(divergent.stdout, "REMOTE CANDIDATES (live origin heads to sweep)"),
		)

	def test_failed_github_page_discards_partial_output_and_discloses_fallback(self) -> None:
		self.git("update-ref", "refs/heads/main", self.advanced_oid, self.base_oid)
		self.git(
			"update-ref",
			"refs/remotes/origin/main",
			self.advanced_oid,
			self.base_oid,
		)
		before = self.repository_state()
		result = self.plan(github_failure=True)

		self.assertEqual(self.repository_state(), before)
		self.assertIn("merged PR heads : incomplete", result.stdout)
		self.assertIn("any partial GitHub output was discarded", result.stdout)
		self.assertIn("local fallback  : complete commit-ancestry query", result.stdout)
		self.assertIn(f"against live default OID {self.base_oid}", result.stdout)
		self.assertIn(
			f"local-merged  (OID {self.base_oid}; merged into main; local fallback)",
			result.stdout,
		)
		self.assertIn(
			f"tag-collision  (OID {self.base_oid}; merged into main; local fallback)",
			result.stdout,
		)
		self.assertNotIn("heads/tag-collision", result.stdout)
		self.assertIn(
			"advanced-reused  (not merged into main; fallback cannot verify squash/rebase PRs)",
			result.stdout,
		)
		self.assertIn(
			"unmerged-local  (not merged into main; fallback cannot verify squash/rebase PRs)",
			result.stdout,
		)
		self.assertIn(
			"origin/remote-only  (remote merge status unconfirmed; GitHub discovery unavailable)",
			result.stdout,
		)
		self.assertNotIn(f"origin/remote-only  (OID {self.base_oid}; PR #906)", result.stdout)

	def test_remote_candidate_never_authorizes_divergent_local_worktree_cleanup(self) -> None:
		before = self.repository_state()
		result = self.plan()

		self.assertEqual(self.repository_state(), before)
		diverged_reason = (
			"merged PR history found, but current tip "
			f"{self.remote_match_local_diverged_oid[:12]} does not match a merged PR head"
		)
		self.assertIn(f"remote-match-local-diverged  ({diverged_reason})", result.stdout)
		self.assertIn(
			f"origin/remote-match-local-diverged  (OID {self.base_oid}; PR #908)",
			result.stdout,
		)
		removable = self.output_section(result.stdout, "WORKTREES REMOVABLE AFTER APPROVAL")
		blocking = self.output_section(result.stdout, "WORKTREES BLOCKING LOCAL SWEEP CANDIDATES")
		prunable = self.output_section(result.stdout, "ALL PRUNABLE WORKTREE RECORDS")
		retained = self.output_section(result.stdout, "WORKTREES RETAINED")
		self.assertNotIn(str(self.remote_match_local_diverged_worktree), removable)
		self.assertNotIn(str(self.remote_match_local_diverged_worktree), blocking)
		self.assertNotIn(str(self.remote_match_local_diverged_worktree), prunable)
		self.assertIn(
			f"{self.remote_match_local_diverged_worktree}  "
			"(remote-match-local-diverged; not held by a local sweep candidate)",
			retained,
		)

		shutil.rmtree(self.remote_match_local_diverged_worktree)
		stale_before = self.repository_state()
		stale_result = self.plan()
		self.assertEqual(self.repository_state(), stale_before)
		stale_removable = self.output_section(
			stale_result.stdout, "WORKTREES REMOVABLE AFTER APPROVAL"
		)
		stale_blocking = self.output_section(
			stale_result.stdout, "WORKTREES BLOCKING LOCAL SWEEP CANDIDATES"
		)
		stale_prunable = self.output_section(
			stale_result.stdout,
			"ALL PRUNABLE WORKTREE RECORDS",
		)
		stale_retained = self.output_section(stale_result.stdout, "WORKTREES RETAINED")
		self.assertNotIn(str(self.remote_match_local_diverged_worktree), stale_removable)
		self.assertNotIn(str(self.remote_match_local_diverged_worktree), stale_blocking)
		self.assertNotIn(str(self.remote_match_local_diverged_worktree), stale_retained)
		self.assertIn(
			f"{self.remote_match_local_diverged_worktree}  "
			"(remote-match-local-diverged; not a local sweep candidate; ",
			stale_prunable,
		)
		local_candidates = self.output_section(
			stale_result.stdout, "LOCAL CANDIDATES (merged branches to sweep)"
		)
		self.assertNotIn("remote-match-local-diverged", local_candidates)

		self.git(
			"update-ref",
			"refs/heads/local-merged",
			self.advanced_oid,
			self.base_oid,
		)
		local_delete = subprocess.run(
			[
				"git",
				"update-ref",
				"-d",
				"refs/heads/local-merged",
				self.base_oid,
			],
			cwd=self.repo,
			capture_output=True,
			text=True,
			check=False,
		)
		self.assertNotEqual(local_delete.returncode, 0)
		self.assertEqual(self.git("rev-parse", "local-merged").strip(), self.advanced_oid)

		self.git("push", "--force", "origin", "advanced-reused:remote-only")
		remote_delete = subprocess.run(
			[
				"git",
				"push",
				f"--force-with-lease=refs/heads/remote-only:{self.base_oid}",
				str(self.origin),
				":refs/heads/remote-only",
			],
			cwd=self.repo,
			capture_output=True,
			text=True,
			check=False,
		)
		self.assertNotEqual(remote_delete.returncode, 0)
		remote_only_oid = self.git(
			"ls-remote", "--heads", "origin", "refs/heads/remote-only"
		).split("\t", 1)[0]
		self.assertEqual(remote_only_oid, self.advanced_oid)

		remote_tag_delete = subprocess.run(
			[
				"git",
				"push",
				f"--force-with-lease=refs/heads/remote-tag-collision:{self.base_oid}",
				str(self.origin),
				":refs/heads/remote-tag-collision",
			],
			cwd=self.repo,
			capture_output=True,
			text=True,
			check=False,
		)
		self.assertEqual(remote_tag_delete.returncode, 0, remote_tag_delete.stderr)
		self.assertFalse(
			self.git("ls-remote", "--heads", "origin", "refs/heads/remote-tag-collision").strip()
		)
		remote_tag_oid = self.git(
			"ls-remote", "--tags", "origin", "refs/tags/remote-tag-collision"
		).split("\t", 1)[0]
		self.assertEqual(remote_tag_oid, self.base_oid)

	def test_unconfirmed_default_suppresses_candidates_and_explicit_default_is_safe(self) -> None:
		self.git("branch", "trunk", "refs/heads/main")
		self.git("push", "origin", "trunk")
		self.run_command(["git", "symbolic-ref", "HEAD", "refs/heads/trunk"], cwd=self.origin)
		with self.gh_output.open("a") as merged_prs:
			merged_prs.write(f"trunk\t{self.base_oid}\t910\n")
		before = self.repository_state()

		unconfirmed_environment = self.plan_environment()
		unconfirmed_environment["FAKE_GIT_DEFAULT_FAIL"] = "1"
		unconfirmed_environment["FAKE_GH_DEFAULT_FAIL"] = "1"
		unconfirmed = self.run_command(
			[str(PLAN_HELPER)], cwd=self.repo, env=unconfirmed_environment
		)
		self.assertEqual(self.repository_state(), before)
		self.assertIn("incomplete orientation only", unconfirmed.stdout)
		self.assertIn(
			"default branch unconfirmed; deletion planning suppressed; "
			"rerun with --default <branch>",
			unconfirmed.stdout,
		)
		self.assertIn(
			"(none)",
			self.output_section(unconfirmed.stdout, "LOCAL CANDIDATES (merged branches to sweep)"),
		)
		self.assertIn(
			"(none)",
			self.output_section(
				unconfirmed.stdout, "REMOTE CANDIDATES (live origin heads to sweep)"
			),
		)

		explicit = self.run_command(
			[str(PLAN_HELPER), "--default", "trunk"],
			cwd=self.repo,
			env=unconfirmed_environment,
		)
		self.assertEqual(self.repository_state(), before)
		self.assertIn("default branch : trunk", explicit.stdout)
		self.assertIn("complete (explicit --default", explicit.stdout)
		self.assertIn("trunk  (default branch)", explicit.stdout)
		self.assertIn(f"local-merged  (OID {self.base_oid}; PR #903)", explicit.stdout)
		self.assertNotIn(
			"trunk  (OID",
			self.output_section(explicit.stdout, "LOCAL CANDIDATES (merged branches to sweep)"),
		)

		conflict = subprocess.run(
			[str(PLAN_HELPER), "--default", "main"],
			cwd=self.repo,
			capture_output=True,
			text=True,
			env=self.plan_environment(),
			check=False,
		)
		self.assertNotEqual(conflict.returncode, 0)
		self.assertIn(
			"explicit default main conflicts with authoritative default trunk",
			conflict.stderr,
		)

		current_error_environment = dict(unconfirmed_environment, FAKE_GIT_CURRENT_FAIL="1")
		current_error = subprocess.run(
			[str(PLAN_HELPER), "--default", "trunk"],
			cwd=self.repo,
			capture_output=True,
			text=True,
			env=current_error_environment,
			check=False,
		)
		self.assertNotEqual(current_error.returncode, 0)
		self.assertIn("failed to read current branch", current_error.stderr)
		self.assertEqual(self.repository_state(), before)

	def test_signal_exit_is_nonzero_and_cleans_the_plan_directory(self) -> None:
		before = self.repository_state()
		plan_temp = self.root / "plan-temp"
		plan_temp.mkdir()
		block_marker = self.root / "gh-blocked"
		environment = self.plan_environment()
		environment["TMPDIR"] = str(plan_temp)
		environment["FAKE_GH_BLOCK_MARKER"] = str(block_marker)
		process = subprocess.Popen(
			[str(PLAN_HELPER)],
			cwd=self.repo,
			stdout=subprocess.PIPE,
			stderr=subprocess.PIPE,
			text=True,
			env=environment,
			start_new_session=True,
		)
		try:
			deadline = time.monotonic() + 5
			while not block_marker.exists() and time.monotonic() < deadline:
				time.sleep(0.02)
			self.assertTrue(block_marker.exists(), "fake gh did not reach its blocking point")
			os.killpg(process.pid, signal.SIGTERM)
			_stdout, stderr = process.communicate(timeout=5)
			self.assertEqual(process.returncode, 143, stderr)
		finally:
			if process.poll() is None:
				os.killpg(process.pid, signal.SIGKILL)
				process.communicate(timeout=5)

		self.assertEqual(list(plan_temp.glob("branch-sweep-plan.*")), [])
		self.assertEqual(self.repository_state(), before)


if __name__ == "__main__":
	unittest.main()
