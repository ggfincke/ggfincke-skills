# Docs Freshness Audit ([Project Name])

**Last Updated:** [Date]
**Scope:** [Docs surface audited: README / docs/ / CHANGELOG / manifest / --help]
**Code Baseline:** [Branch / commit the docs were checked against]
**Mode:** [Read-only audit / proposed corrections only]

## Executive Summary

- **Claims audited:** [N] across [M] docs - [X] current, [S] stale, [W] wrong, [Mi] missing, [U] unverifiable.
- **Most important drift:** [Short list of the findings that most mislead users].
- **Changelog / version:** [Behind by N entries / in sync / version string disagrees - one line].
- **Recommended next move:** [First fix group or decision to make].

## Doc Inventory

| Doc | Type | In Scope | Notes |
| --- | ---- | -------- | ----- |
| `README.md` | Prose | Yes | [Sections covered] |
| `docs/[guide].md` | Usage guide | Yes | [Notes] |
| `CHANGELOG.md` | Changelog | Yes | [Last release / tag] |
| `[manifest]` | Manifest/listing | Yes | [description, keywords, version] |
| `dev-docs/[x].md` | Internal | No | Out of scope (dev-docs) |

---

## Findings

_One row per atomic claim. Verdict is one of: Current / Stale / Wrong / Missing / Unverifiable. Every non-Current row carries evidence._

| ID | Doc / Location | Claim | Verdict | Evidence (code / commit) | Proposed Fix |
| -- | -------------- | ----- | ------- | ------------------------ | ------------ |
| D1 | `README.md` install | [Asserted claim] | Stale | `[path:symbol]` - [what the code says now], moved in [commit] | [Corrected prose] |
| D2 | `docs/cli.md` flags | `--[flag]` does [X] | Wrong | `--help` / `[path]` - [flag does Y / does not exist] | [Corrected prose] |
| D3 | `README.md` config | [Config key] | Current | `[path]` - matches | - |

### Detail (for findings that need more than a row)

#### D1. [Finding title]

**Verdict:** Stale
**Location:** `[doc:section]`
**Claim:** [Quote or tight paraphrase of the doc].
**Evidence:** `[path/to/code]` - [the current code that contradicts the doc; the commit that moved it].
**Proposed fix:** [The corrected prose, matching the doc's voice and format].

#### D2. [Finding title]

**Verdict:** Wrong
**Location:** `[doc:section]`
**Claim:** [Quote].
**Evidence:** `[--help output / path:symbol]` - [exact contradiction].
**Proposed fix:** [Corrected prose].

---

## Missing from Docs

_User-facing surface that exists in code but no in-scope doc covers._

| ID | Surface (flag / feature / config / route) | Evidence (code) | Where it should be documented |
| -- | ----------------------------------------- | --------------- | ----------------------------- |
| M1 | `--[flag]` | `[path:symbol]` | `docs/cli.md` flags section |
| M2 | [Feature] | `[path]` | `README.md` features |

---

## Current / Verified Correct

_Claims checked against live code and found accurate, recorded so they are not re-litigated next audit._

- **[Claim]** - matches `[path:symbol]`.
- **[Claim]** - `--help` confirms the documented flags.

---

## Changelog / Version Sync

_Only if the changelog limb ran. Follows Keep a Changelog._

**Last release:** [version / tag]
**Commits since:** [N merged commits walked]

### Proposed Unreleased entries

```
## [Unreleased]

### Added
- [Entry] ([commit / PR])

### Changed
- [Entry] ([commit / PR])

### Fixed
- [Entry] ([commit / PR])
```

### Proposed next version

- **[X.Y.Z]** - [major / minor / patch], because [the change set: breaking / feature / fix].
- **Version strings to reconcile:** `[path]` says `[A]`, release state implies `[B]`.

---

## Recommended Update Sequence

_Group the approved-able fixes and order them by risk. Lowest-risk, self-contained corrections first. Before approval, reconcile group IDs with verdicts: Current rows stay outside correction groups unless a separate evidenced change is stated._

### Group 1: [Theme] ([Low risk])

**Authorization:** [source concerns; generated outputs; named hand-written tests; existing verification commands; Git/external actions; approval source]

- Findings: [D1]
- [Self-contained prose corrections; edit in place]

### Group 2: [Theme] ([Med risk])

**Authorization:** [source concerns; generated outputs; named hand-written tests; existing verification commands; Git/external actions; approval source]

- Findings: [D2, M1]
- [Needs new prose / a screenshot recapture / coordination with a release]

### Group 3: Changelog & version

**Authorization:** [source concerns; generated outputs; named hand-written tests; existing verification commands; Git/external actions; approval source]

- [Apply Unreleased entries; reconcile version strings - propose only, no tag/publish]

---

## Verification Performed

- [Commands run: `--help`, `git log [tag]..HEAD`, greps, file/route checks]
- [Docs read and atomized]

## Not Run / Limitations

- [Unverifiable claims and what would settle them]
- [Anything intentionally out of scope: dev-docs, agent instructions, comments]
