# Docs Freshness Audit - Usage

Ready-made prompts for the `docs-freshness-audit` skill. The first-turn variants kick off an audit with a concrete input - better than a bare "check the docs." The follow-ups steer the work after the first findings doc. Fill in the `[BRACKETED]` parts. Every variant is read-only until you approve fixes.

## Contents

- [First-turn variants by input](#first-turn-variants-by-input)
  - [A. A single README](#a-a-single-readme)
  - [B. The whole docs/ tree](#b-the-whole-docs-tree)
  - [C. Changelog / version from git](#c-changelog--version-from-git)
  - [D. A manifest / marketplace listing](#d-a-manifest--marketplace-listing)
  - [E. Screenshots look out of date](#e-screenshots-look-out-of-date)
  - [F. Pre-release docs sweep](#f-pre-release-docs-sweep)
- [Follow-up prompts after the first findings doc](#follow-up-prompts-after-the-first-findings-doc)
  - [Approve a subset to fix](#approve-a-subset-to-fix)
  - [Hand the fixes to phased-implementation](#hand-the-fixes-to-phased-implementation)
  - [Re-verify a verdict](#re-verify-a-verdict)
  - [Apply the changelog proposal](#apply-the-changelog-proposal)

## First-turn variants by input

### A. A single README

```
Audit [README.md] against the current code. Break it into atomic claims - features, CLI flags,
config keys, paths, setup steps, version numbers - and verify each against live code. Tell me
which are current, stale, wrong, or missing, with evidence. Read-only; propose fixes, do not edit.
```

### B. The whole docs/ tree

```
Audit the user-facing docs in [docs/ + README] for drift against the current code. Inventory
them, atomize the claims, verify each, and give me one findings doc with a per-claim table and a
recommended fix order. Skip dev-docs and AGENTS/CLAUDE. Read-only until I approve what to fix.
```

### C. Changelog / version from git

```
Reconcile [CHANGELOG.md] and the version strings against git history since [LAST TAG / RELEASE].
Walk the merged commits, map them to Keep a Changelog sections, derive the Unreleased entries the
changelog is missing, and propose the next version. Propose only - do not tag or publish.
```

### D. A manifest / marketplace listing

```
Audit [package.json / extension manifest / marketplace listing] against the code: description,
keywords, version, and any documented commands or capabilities. Flag anything stale, wrong, or
missing vs what the code actually does, with evidence. Read-only; propose corrected fields.
```

### E. Screenshots look out of date

```
The screenshots/GIFs in [DOC] look like they no longer match the current UI/CLI output. Check
each documented screen, command output, or flag against the live code, and tell me which images
or captions are stale and what they should show now. Read-only; propose the corrections.
```

### F. Pre-release docs sweep

```
We are about to cut [VERSION]. Sweep the user-facing docs (README, docs/, CLI --help, CHANGELOG,
manifest) for anything that drifted since the last release. Verify each finding against the code,
derive the changelog Unreleased entries and next version from git, and give me one findings doc
with a fix order. Read-only until I approve.
```

## Follow-up prompts after the first findings doc

### Approve a subset to fix

```
Fix [ALL / the stale and wrong ones / findings 2, 5, 7]. Edit in place - change only the drifted
lines, preserve each doc's structure and formatting, do not regenerate the file. Leave the others.
Summarize what changed and what you left.
```

### Hand the fixes to phased-implementation

```
The approved corrections are bigger than spot edits. Hand them to phased-implementation: one
group at a time, gate between, with the findings doc as the source of truth. Start with the
lowest-risk group.
```

### Re-verify a verdict

```
You marked [CLAIM / finding N] as [VERDICT], but I think it is [OTHER]. Re-verify against the
live code: show the exact symbol/flag/path and either change the verdict or hold it with stronger
evidence.
```

### Apply the changelog proposal

```
Apply the changelog proposal: write the derived Unreleased entries into [CHANGELOG.md] under the
right Keep a Changelog sections, preserving the existing format. Do not bump the version string,
tag, or publish - just the changelog edit.
```
