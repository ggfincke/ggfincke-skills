# Local skills audit implementation

Initial implementation scope: all five groups in the September 4 implementation plan, including the named tests, generated outputs, existing verification commands, bounded native probes, and rollout to Agents/Codex and Claude. That phase excluded commits, publication, live seeding, and application-source changes.

Publication follow-up: the user authorized a new `feat/local-skills-audit-rollout` branch, Codex coauthor credit, publication, and a squash merge after green CI. The selected commit groups include existing work: installation/MCP tooling, broker safeguards, portable skills, project/artifact workflows, and CI/audit documentation. Recovery snapshots and the exact grouping manifest remain in the task's local evidence directory. Application-source changes and hosted seeding remain outside this publication scope.

Baseline: `4d6fd6a0913ad034d4417ebf95f3a186da3fb8ea`, with 89 modified tracked files and 13 untracked status entries before this implementation. Existing work was preserved and extended. Recovery evidence lives at `/Users/ggfincke/.codex/tmp/skills-audit-20260905T012053Z`: `source-before.tar.gz`, `inventory.json`, original index and staged/unstaged patches, plus `hosts-before-v2.tar.gz` and `hosts-before.json` for the external installation before sync. The earlier `hosts-before.tar.gz` was retained after its inventory step encountered an absent excluded-host directory; the v2 archive and JSON are the complete host snapshot.

Final inventory: **25 global skills and eight project skills**. Both managed global installations retain links to canonical sources. Claude additionally retains its unrelated `tldraw-offline` package. Antigravity and other repositories were not changed.

## Recommendation ledger

“Already addressed” identifies pre-existing fixes retained in this working tree. “Changed / verified” identifies completed implementation with the evidence below. “Unverified” is an explicit capability or provider limitation, not a successful guarantee.

### 1. Baseline and authorization

| ID | Recommendation | Status and evidence |
| --- | --- | --- |
| 1.1 | Update transitive qs without losing other lock changes | Changed / verified: only broker `node_modules/qs` changed from 6.15.3 to 6.16.0 relative to the preserved baseline lockfile. |
| 1.2 | Root/broker audits in the shared local and CI gate | Changed / verified: `audit-root`, `audit-broker`, and `audit` use `--audit-level=high`; `make check` and CI use those targets. Both audits report zero vulnerabilities. |
| 1.3 | Weekly npm maintenance for both trees | Changed / verified: Dependabot npm entries for `/` and `/tools/worker-broker`, alongside existing Actions maintenance. |
| 1.4 | One approval contract across action groups and handoffs | Changed / verified: source edits, generated outputs, named hand-written tests, existing checks, and Git/external actions are distinct fields in the neutral protocol, working conventions, templates, phased execution, and review-chain handoff. Entire-plan approval carries forward. |
| 1.5 | Align prior test, navigation, refutation, and publication fixes | Already addressed, reconciled: existing test-restraint rules, navigation-preserving animation guidance, evidence-based refutation, explicit destination leases, and dirty/index preservation were retained. Descriptions and handoffs now agree with them. |
| 1.6 | One maintained Git closeout procedure | Changed / verified: orchestrate defers history rewriting/publication to `git-history-surgery`; its competing reset recipe is removed. No Git closeout was performed here. |
| 1.7 | Preserve comment preferences with target/tooling exceptions | Changed / verified: always-on rules, body, house guide, and language references permit required target-project API docs and tooling-significant annotations. Default enforcers remain strict; target-specific exceptions must be narrow. |

### 2. Capabilities and doctor

| ID | Recommendation | Status and evidence |
| --- | --- | --- |
| 2.1 | Optional capability requirements and computed result evidence | Changed / verified: compatible optional request/result fields, normalization, schemas, summaries, admission, execution, and terminal results. Legacy requests still complete. |
| 2.2 | Exact capability scope and enforcement layer | Changed / verified: native delegation, broad nesting, read-only filesystem, worktree-only access, and tool/shell network controls state scope, status, layer, and evidence separately. Instructions and final-patch detection are not runtime containment. |
| 2.3 | Reject unsupported/unverified requirements before work | Changed / verified: required guarantees are checked before initialization/worktree/setup/provider execution and rechecked before execution. Setup and verification subprocesses are included in broad scopes. Rejection leaves the test state directory empty and launches no provider. |
| 2.4 | Avoid claiming unproven prevention | Unverified by design: no listed capability currently has sufficient installed-runtime enforcement evidence for admission as a required guarantee. Codex's requested native no-nesting flag is reported separately; flag support or a successful protocol smoke is insufficient. Legacy operation remains available without silently dropping requirements. |
| 2.5 | Read-only repository and broker doctors | Changed / verified: repository roots, duplicate discovery names, source/generation/mode drift, native binaries/versions/flags, registration, build records, and requested/observed model binding. Missing/malformed configuration and receipt shapes are reported rather than crashing. |
| 2.6 | Resolve configured launcher; bound/redact probes | Changed / verified: exact usable MCP registration takes priority, built local CLI is fallback, safe configuration fields are selected, and sensitive configuration is not emitted. Version/help probes are bounded; flags use token boundaries rather than prefix matching. Tests cover missing binaries, timeouts, and malformed output. |
| 2.7 | Explicit native smoke only | Changed / verified: ordinary doctor launches no model or daemon; `--smoke` creates disposable retained fixtures. Codex protocol smoke passed before its account limit; Claude protocol smoke passed before and after rollout. Smoke success does not certify containment. |
| 2.8 | Preserve unavailable provider/model outcomes | Unverified: Cursor and Coral binaries are unavailable in the configured MCP execution paths. Coral has configured model `gemma4:latest`, but was not executed. Codex did not emit an observed model; later Codex behavioral retries reached the account usage limit. Claude reported default `claude-sonnet-5`; no model override was invented. |

### 3. Installation coherence and standalone references

| ID | Recommendation | Status and evidence |
| --- | --- | --- |
| 3.1 | Content-bound deployment generations | Changed / verified: each root records actual package hashes, link/copy mode, instruction-region hashes, and a deterministic generation hash. Separate source lanes coexist; content identity does not depend on a clean Git revision. |
| 3.2 | Refuse divergent skipped copies and retained global rules | Changed / verified: selected divergent copies and retained rule contributors block instruction advancement. An instruction-only repair retains package observations even when receipt bytes would be unchanged. `--force` is never implicit. |
| 3.3 | Coupled rollback and alias preservation | Changed / verified: selected global packages, receipts, instructions, and prunes share one rollback unit. Aliased instruction destinations are coalesced; shared installation roots record every associated host. Failure tests preserve packages, receipts, manual text, and unrelated files. |
| 3.4 | Preserve source-lane ownership | Changed / verified: independent lanes retain their records. A same-name cross-lane takeover is refused, including with `--force`, rather than leaving contradictory ownership receipts. |
| 3.5 | One neutral protocol with self-contained consumer copies | Changed / verified: `verify-review-findings/references/review-protocol.md` is canonical; the compiler packages deterministic copies into 11 consuming skills. The protocol includes standalone fallback mechanics without adding lenses to a narrower task. |
| 3.6 | Independent full and core reviews | Changed / verified: each installs alone with a closed local reference graph. Full review has its own security baseline; core never reaches full/security material through local references and explicitly prohibits loading it. Optional sibling specialization is not an installation prerequisite. |
| 3.7 | Generated reference and repository-instruction checks | Changed / verified: `make generate` / `generated-check` cover both React collections, neutral protocol copies, repository `AGENTS.md`, and the Cursor guard asset. Repository instruction generation uses the shared renderer and a fixed local destination without weakening external installer guards. |

### 4. Routing and opt-in delivery

| ID | Recommendation | Status and evidence |
| --- | --- | --- |
| 4.1 | One React dispatcher | Changed / verified: `react-best-practices` routes core, TypeScript, performance, Next.js, and composition by target stack and task. Competing ownership and duplicate entrypoint summaries are removed. |
| 4.2 | Preserve detailed rules/provenance and separate compilers | Changed / verified: 70 performance and eight composition rules remain in separate collections, with metadata and generated references. All 84 moved rule/support/guideline/license files match their pre-implementation bytes; metadata paths changed intentionally. |
| 4.3 | One frontend build/audit entrypoint | Changed / verified: mode is selected before references. Audit produces findings without design/image/implementation guidance. Pinned guidelines and license are retained. Native audit fixture writes only its requested findings artifact. |
| 4.4 | Explicit action-first only | Changed / verified: removed the always-on block and obsolete interview exceptions, revised invocation wording, and added `agents/openai.yaml` with `policy.allow_implicit_invocation: false`. The bundled Codex skill-creator documentation confirms that policy. Global instruction regions no longer contain action-first. |
| 4.5 | Retain the separate transition playbook | Already addressed / preserved: existing navigation, history, focus, scroll, reduced-motion, and dependency approval safeguards remain. The narrow native animation fixture changes only the requested CSS file. |
| 4.6 | Update related documentation and entrypoints | Changed / verified: review references, templates, README, interop guidance, compiler paths, and sync defaults use the consolidated owners. Distinct review/test/Git/project workflows remain. |

### 5. Dedicated artifact workflow

| ID | Recommendation | Status and evidence |
| --- | --- | --- |
| 5.1 | Keep broker acceptance source-patch-only | Changed / verified: MCP contract and orchestration guidance exclude ignored media/seed/QC artifacts from Git-patch acceptance and prohibit force-adding them for transport. |
| 5.2 | Reuse maintained TierListBuilder validation/hashing | Changed / verified by current code inspection: removed the print-only orphan check; use the full-source validator that rejects missing definitions and orphan entries. Existing `build_source_inventory`, source-status, seal, verify, and restore ownership is documented. Application sources were not modified or seeded. |
| 5.3 | Task-local artifact receipt without application schema changes | Changed / verified: template and workflow record declared inputs/outputs, hashes/bytes/media, counts, provenance, source identity, recovery, and visual-QC evidence. Existing `_manifest.json`, template definitions, and sealed-artifact formats remain application-owned. |
| 5.4 | Manifest-driven isolated materialization | Changed / verified: only declared hash-verified inputs are copied independently of Git. Missing/changed/escaping inputs, symlinks, `.git`, overlapping destinations, and collisions are refused without overwriting work. |
| 5.5 | Preserve recovery and concurrent-path behavior | Changed / verified: source/destination roots and publication use pinned no-follow directory descriptors. Recovery files and receipts remain independent of delivered edits. Failure receipts include copied counts, original cause, and recovery path/device/inode. Tests exercise source/destination redirection and concurrent publication collisions. |
| 5.6 | Preserve execution and selection boundaries | Already addressed / retained: native or sequential fallbacks, task-owned candidates, user selection of covers, current target command/lifecycle inspection, and retained recovery material. Project contracts stay under `projects/`; no project skills were installed into other repositories. |

## Verification evidence

The final `make check` completed successfully (`make-check-final.log`):

- 33 validated packages: 25 global plus eight project skills.
- 194 Python tests discovered: **193 passed**, with the model-calling suite intentionally skipped in the ordinary gate.
- **93 broker tests passed**, including capability rejection and a fake native CLI proving advertised flags do not certify enforcement or launch a model.
- Both formatting/lint lanes, generated-content checks, and both npm dependency audits passed; audits reported zero vulnerabilities.
- The subsequent comment-reference wording alignment passed strict validation and generated checks, then refreshed deployment receipts. No executable code changed after the full gate.

The explicitly invoked native behavioral suite has passing evidence for all eight cases across configured providers. It evaluates executed reference reads, filesystem changes, produced artifacts, and runtime assertions rather than answer wording:

| Case | Passing evidence |
| --- | --- |
| Explicit orchestration proposal | Codex retry: `plan.md` only; orchestrate loaded; no worker launch. |
| Contextual/implicit orchestration mention | Codex initial run: `findings.md` only; orchestrate not loaded. |
| Source-only approval | Codex initial run: `clamp.js` only; existing test untouched; behavior assertion passed. |
| Named test approval | Claude: source and named regression changed; regression fails against the original bug. |
| React performance routing | Claude: React/performance references, no Next.js reference, findings artifact only. |
| Next.js routing | Codex initial run: dispatcher and Next.js reference loaded; findings artifact only. |
| Narrow animation | Codex initial run: `button.css` only; dependency/router files preserved. |
| Frontend audit mode | Claude: pinned guidelines loaded, design/image references excluded, findings artifact only. |

Native records are in `behavioral/`, `behavioral-retry/`, and `behavioral-claude/`. Three initial Codex cases reached the original 60-second limit. The fixture setup was corrected to include a real baseline commit and a bounded 120-second limit. Explicit orchestration then passed; later Codex retries reached the account usage limit. Those failed attempts remain retained and are not represented as passes. Remaining cases were exercised with the existing configured Claude provider.

Repeat native fixtures only explicitly, for example:

```bash
python3 scripts/check-native-behaviors.py --smoke --provider claude \
  --output /absolute/task-owned/evidence --case frontend-audit
```

## Local rollout and discovery

Reviewed `sync-plan.txt` and applied only Agents/Codex and Claude. Retired exactly `vercel-react-best-practices`, `vercel-composition-patterns`, and `web-design-guidelines` from each root; no other package was pruned. The unrelated Claude `tldraw-offline` package is unchanged. The default CLI/Make targets now select Agents and Claude; explicit agy/all targets remain available.

`host-preservation.json` records 63 successful checks covering manual instruction text, retained link identities, exact retirements, unrelated-package identity, and excluded-host state. At implementation closeout the original Git index hash remained `abfd12fec71ccde75a84a9a2127e63a7ac154111212efea1fbcb263e085c3aba`; that phase performed no staging, commits, publication, application-source edits, or live seeding. The separately authorized publication follow-up is recorded above.

Fresh Codex `app-server` `skills/list` discovery returned all 25 canonical names with zero errors without a model call (`fresh-codex-discovery.json`). Fresh Claude initialization found all 25 canonical names plus its preserved `tldraw-offline`, with no retired names (`fresh-claude-discovery.json`). Existing desktop conversations may retain an older catalog snapshot; fresh-session discovery is the verification boundary.

The repository doctor verifies both deployment receipts and source/instruction hashes (`doctor-deployment-final.json`). Broker source was rebuilt only after checking that active and queued job lists were empty; the final built runtime is `7e95183c06b03dc0`, and the final Claude smoke used that build with a matching daemon record. Codex/Claude MCP registrations resolve to the built local CLI through Node v26.7.0; this differs from the interactive shell's Node v24.20.0.

Dual-target project installation is documented in README with `--target project-agents --target project-claude` and a dry-run first. It was not applied to another repository.

## Explicit limitations

Filesystem/network/nesting prevention is not certified; required unverified guarantees fail closed. Cursor/Coral native execution is unavailable through the configured paths. Codex's observed model remains unavailable, and later native retries were blocked by its account usage limit. Claude reported its configured default as `claude-sonnet-5`. No automatic usage reset, model replacement, provider installation, or permission weakening was performed.
