---
name: docs-freshness-audit
description: "Audit existing user-facing docs against the current code for drift and flag stale, wrong, or missing claims (features, CLI flags, config keys, paths, setup steps, screenshots, version numbers), verify each against live code, and reconcile the CHANGELOG and version strings with git history (Keep a Changelog). Produces one findings doc and stays read-only until you approve fixes. Use when asked whether the docs or README are still accurate or out of date, to audit docs against the code for staleness, or to sync the changelog and version from git. Not for authoring or updating docs in general (the documentation plugin), not code-vs-code drift (consolidation-audit), and not internal dev-docs or AGENTS.md/CLAUDE.md."
---

# Docs Freshness Audit

You are auditing existing, user-facing documentation against the current code to find where the docs have drifted, verifying each discrepancy against live code, aggregating into one findings doc, and staying read-only until the user approves which to fix. This is non-destructive: you correct what already exists, you do not regenerate it.

This skill's axis is docs-vs-code. It is the docs-vs-code cousin of consolidation-audit (which is code-vs-code), and it borrows the evidence-before-verdict discipline of verify-review-findings (keeping its own doc-specific verdict set). It is not the documentation plugin: that authors and generates new docs; this audits and corrects what is already shipped. Do not write fresh docs here - find drift, verify it, and propose corrections in place.

Two limbs, run whichever the input calls for (often both):

- **Prose accuracy** - verify the claims in prose docs against the current code and flag the drift: features, CLI commands/flags, config keys, file paths, setup/install steps, screenshots, version numbers, stats/counts. Find Stale / Wrong / Missing claims, verify each, propose corrected prose.
- **Changelog / version sync** - reconcile CHANGELOG and version strings against git history since the last release, following the public Keep a Changelog convention. Derive the Unreleased entries and the next version from merged commits. Propose only; never tag or publish a release.

## Hard rules

- Read the live code before judging any claim. Never classify from the doc text alone. Open the cited symbol, run the `--help`, confirm the file/flag/route/key exists, grep for the name.
- Every non-Current verdict carries evidence - the code that contradicts the doc, ideally the commit that moved it. No bare "looks out of date."
- Hold Current to a high bar. Current means you verified the claim still holds, not that it looks plausible. A weak Current is how a stale doc survives an audit - if you cannot confirm, mark it Unverifiable & say what would settle it.
- A claim is a hypothesis, confirmed in either direction. Do not mark a claim Stale because it sounds old, and do not call one Current because it sounds plausible.
- Read-only until approved. The audit produces a findings doc, not edits. Do not fix, regenerate, or reformat any doc during the audit.
- Scope to user-facing docs only (see Scope). Do not fold in internal dev-docs, agent instructions, or code-comment cleanup.
- Correct in place; never regenerate-and-drop. When fixes are approved, preserve each doc's structure, voice, & formatting - edit the drifted lines, do not rewrite the file.
- Changelog limb proposes only. Derive entries & the next version; never tag, bump-and-commit, or publish.
- Stay on the docs. This is not a code review - if you spot a real code bug while reading, note it out-of-scope; do not fold it into the audit.

## Scope

**Include**

- README and top-level project docs.
- `docs/` sites, usage guides, API/reference guides.
- User-facing CLI `--help` text and man pages.
- Package/extension manifests & marketplace listings: description, keywords, version.
- Website/marketing copy that makes factual product claims.
- CHANGELOG and version strings.

**Exclude**

- `dev-docs/`, roadmaps, internal planning notes.
- `AGENTS.md` / `CLAUDE.md` and other agent instructions.
- Inline code comments.
- Test fixtures.

## Procedure

Start by reading the repo's conventions (AGENTS.md / CLAUDE.md / README) for build & release intent, then:

1. **Inventory the in-scope docs.** List every user-facing doc in scope. Break each into atomic, checkable claims - one claim = one assertion about one thing (one flag, one path, one config key, one count).
2. **Verify each claim against live code.** Read the code, run the `--help`, confirm the file/flag/route/key exists, grep for the symbol. For the changelog limb, walk `git log` since the last release tag and map merged commits to Keep a Changelog sections (Added / Changed / Fixed / Removed / Deprecated / Security).
3. **Classify each claim** (see Classification) with cited evidence.
4. **Aggregate into one findings doc** using the template, and present it. Stay read-only until the user approves which to fix.
5. **After approval, hand off** (see After approval).

## Classification

Assign each claim exactly one verdict. Every verdict except Current carries evidence.

- **Current** - verified accurate against live code. The docs-vs-code analogue of consolidation-audit's "Considered & Rejected": record what you checked and found correct so it is not re-litigated next audit. Held to a high bar.
- **Stale** - was true once, the code moved on. Evidence: the current code that no longer matches, ideally the commit that changed it. Proposed fix: corrected prose.
- **Wrong** - never true; the doc misstates the code. Evidence: the exact code that contradicts it. Proposed fix: corrected prose.
- **Missing** - a user-facing feature, flag, config key, or behavior that exists in code but the docs omit. Evidence: the code/flag/route that is undocumented. Proposed fix: the prose to add.
- **Unverifiable** - needs runtime, an external system, or maintainer intent to settle. Evidence: what you checked and where the trail ended; state exactly what would resolve it.

For the changelog limb, frame findings as: entries to add to Unreleased (merged work the changelog omits), the next version derived from the change set (major/minor/patch per the commits), and any version string in code/manifest that disagrees with the release state.

## Required output before edits

One findings doc (use the template). It must contain:

- Scope and the doc inventory you audited.
- A per-claim findings table: claim, location, verdict, evidence, proposed fix.
- A Missing-from-docs section: undocumented user-facing surface.
- A Current / verified-correct section so accurate claims are not re-checked next time.
- For the changelog limb: derived Unreleased entries and the proposed next version, with the commits behind each.
- A recommended update sequence: which fixes to apply first, grouped and risk-ordered.

End with an approval request. Do not edit until the user picks which findings to fix.

## After approval

Once the user says which findings to address:

- For a small, self-contained correction, edit the doc in place: change the drifted lines only, preserve the doc's structure and formatting, never regenerate-and-drop.
- For several corrections approved together, hand to phased-implementation: one group at a time, gate between, with the findings doc as the living source of truth.
- For the changelog limb, write the proposed Unreleased entries & next version into the CHANGELOG only; leave tagging & publishing to the user.
- After editing, summarize: which claims were corrected, which docs changed, and which findings were intentionally left (Current, or declined) so the audit can be closed out.

Only claim what you verified. Do not assert the rest of the docs are accurate - only the claims you audited.

## Notes

- Siblings: consolidation-audit is the code-vs-code cousin and shares this doc shape and the Current/verified (Considered & Rejected) discipline; verify-review-findings supplies the evidence-before-verdict rule, though there you triage external claims and here you generate findings about the docs; mega-review is the multi-lens orchestrator, not this; phased-implementation is the after-approval handoff. The changelog limb follows the public Keep a Changelog standard (keepachangelog.com), not a skill in this repo.
- The documentation plugin authors new docs from scratch; this skill audits and corrects what already exists. If the user wants brand-new docs, that is the plugin's job, not this one.
- references/usage.md has first-turn invocation variants by input (a single README, the whole docs/ tree, changelog/version-from-git, a manifest/marketplace listing, stale screenshots, a pre-release sweep).
- assets/templates/docs-freshness-audit-template.md is the findings doc: scope, doc inventory, per-claim findings table, missing-from-docs, current/verified, and the recommended update sequence.
