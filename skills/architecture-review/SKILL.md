---
name: architecture-review
description: Review a codebase's architecture and produce one evidence-based plan for improving subsystem boundaries, dependency direction, responsibility and state ownership, runtime and data flow, packages, modules, files, and directories. Use when asked for an architecture review or audit, codebase restructuring, module or package reorganization, file/folder reorganization, layer or boundary evaluation, or a target architecture and migration plan. Not for local behavior-preserving cleanup alone (use simplification-review) or duplication-first consolidation work (use consolidation-audit).
---

# Architecture Review

Produce one comprehensive, read-only architecture review. Determine whether the system's decomposition, dependencies, ownership, runtime flows, and physical layout fit its current responsibilities and likely evolution. Treat reorganization as a remedy, not the goal.

Copy [the packaged template](assets/templates/architecture-review-template.md) to one concrete dated document, normally `dev-docs/architecture-review-YYYY-MM-DD.md`. Never edit or overwrite the packaged template; update an existing review only when the user points to the same scope. The concrete review is the sole permitted write during the otherwise source-read-only review. Keep the current architecture, verified findings, target architecture, action groups, migration sequence, and implementation ledger together there as the single source of truth. Do not create separate plan or action-group documents unless the user asks.

## Scope & boundaries

Default to the whole codebase when the user asks for an unqualified architecture review. Honor narrower module, subsystem, branch, or diff scopes explicitly. Map enough surrounding architecture to judge the requested surface in context.

Review:

- subsystem, domain, layer, package, module, file, and directory boundaries;
- responsibility, policy, orchestration, state, persistence, and lifecycle ownership;
- dependency direction, cycles, cross-boundary imports, entry points, and encapsulation;
- runtime initialization, request/event flows, background work, integrations, and data transformations;
- public contracts versus internal APIs, including package exports and compatibility surfaces;
- placement and colocation of implementation, tests, fixtures, config, generated code, migrations, scripts, and docs;
- structural fitness for observed change patterns and stated roadmap needs.

Do not turn the review into a general bug, security, performance, or test-coverage audit. Include those concerns only when the architecture creates or materially amplifies them, then state which focused review should examine them further.

## Hard rules

- Stay read-only until the user approves action groups.
- Do not recommend a fashionable pattern without repo-specific evidence.
- Do not treat file size alone as proof that a file should split; prove distinct responsibilities or change boundaries.
- Do not treat directory symmetry, nesting depth, or naming taste alone as an architectural problem.
- Do not propose a new layer, abstraction, package, service, or interface without identifying the boundary it protects and the dependency it improves.
- Do not propose microservices, queues, repositories, service layers, domain layers, or feature folders by default.
- Prefer the smallest structural change that establishes the intended ownership and dependency rules.
- Preserve deliberate framework conventions unless concrete costs outweigh them.
- Make public-contract, persistent-data, deployment, and operational changes explicit; never hide them inside a "reorganization" group.

## Workflow

Start by reading repository instructions, architecture and roadmap docs, package manifests, build and test config, and deployment/runtime config. Treat live code and current configuration as authoritative when prose has drifted.

1. **Establish scope and intent.** Record the requested surface, explicit constraints, compatibility posture, current pain, roadmap pressures, and gates. Distinguish documented intent from inferred intent.
2. **Inventory the physical system.** Map source roots, workspaces/packages, entry points, generated/vendor areas, tests, scripts, config, migrations, and docs. Name exclusions and count the reviewed surface.
3. **Trace the logical system.** Follow bootstrap plus representative request, event, UI, background-job, persistence, and integration flows. Identify components, contracts, state owners, data transformations, and side-effect boundaries.
4. **Map dependencies and change boundaries.** Inspect imports, exports, package edges, aliases, dynamic loading, registries, framework discovery, and shared types. Use repository-native graph or dead-code tools when available. Compare dependency direction with actual ownership and with files that tend to change together when history is available and relevant.
5. **Develop candidates through independent lenses.** Examine boundary fitness, responsibility cohesion, dependency direction, runtime/data flow, contract ownership, physical organization, and operability/testability. When the user authorizes subagents and the harness supports them, assign area readers plus cross-cutting dependency and topology reviewers; otherwise cover the lenses sequentially.
6. **Verify and refute.** Recheck every candidate against live references, runtime wiring, build/package rules, dynamic conventions, tests, docs, and deployment config. Try to disprove high-consequence splits, package extractions, dependency inversions, and contract moves. Put plausible but unsupported changes in "Considered & Rejected."
7. **Design the target architecture.** State responsibilities, allowed dependency directions, public entry points, state/data ownership, runtime flows, and physical layout. Include before/after trees or diagrams only where they clarify a meaningful change.
8. **Build executable action groups.** Group findings by shared boundaries, file overlap, dependency order, and stable intermediate states. Identify prerequisite decisions and separate mechanical relocation from semantic or contract changes.
9. **Sequence migration by risk.** Establish dependency rules and low-risk relocations first, then internal boundary changes, then public contracts, persistent data, or runtime/deployment changes. Keep the codebase buildable and testable between groups.
10. **Write one review.** Include the architecture snapshot, verified findings, rejected alternatives, target architecture, integrated action groups, migration sequence, testing strategy, verification log, and gates not run.

## Review lenses

Use each lens independently before synthesizing:

1. **Boundaries & ownership** - Find responsibilities split across owners, mixed policy and mechanism, unclear state ownership, and subsystems whose public surface does not match their role.
2. **Dependencies & contracts** - Find cycles, inverted dependencies, deep imports, unstable barrels, cross-layer leakage, shared-model coupling, and contracts owned by consumers instead of providers.
3. **Runtime & data flow** - Find orchestration in the wrong layer, repeated transformations across boundaries, hidden side effects, ambiguous lifecycle ownership, and persistence or integration concerns leaking upward.
4. **Packages, modules & files** - Find artificial fragmentation, grab-bag modules, false package boundaries, misplaced code, poor colocation, and directory layouts that obscure the logical system.
5. **Evolution & operability** - Find boundaries that make common changes span unrelated areas, prevent isolated testing, complicate deployment/configuration, or conflict with stated roadmap needs.

## Evidence & finding standard

Include a finding only when the live repository demonstrates a structural problem and the recommendation improves a named architectural property. For each finding, record:

- exact locations, dependency edges, runtime flows, or change patterns;
- the current responsibility or ownership mismatch;
- concrete impact rather than aesthetic preference;
- the proposed boundary and why it belongs there;
- change class: physical-only, internal contract, public contract, persistent data, or runtime/deployment;
- risk, confidence, prerequisites, migration implications, and a stable intermediate state;
- affected tests, config, docs, tooling, and verification gates;
- non-goals and behavior that must remain unchanged.

Use history as supporting evidence, not as a substitute for understanding current code. Do not claim two files "always change together" or a boundary "causes frequent bugs" without checking the available evidence.

## Risk model

- **Low** - physical relocation, naming, colocation, or dependency-rule enforcement with unchanged contracts and runtime behavior.
- **Medium** - module splits/merges, internal API changes, entry-point cleanup, dependency inversion, or state/orchestration relocation within one deployable unit.
- **High** - public contract changes, package/workspace extraction, persistent-data ownership or migration, cross-runtime movement, deployable-service boundaries, or broad framework changes.

Risk is about migration and regression exposure, not the value of the recommendation. Keep high-value, high-risk findings visible and decision-gated.

## Relationship to sibling skills

- Use `simplification-review` when the primary goal is local, behavior-preserving implementation cleanup within the current architecture.
- Use `consolidation-audit` when the primary goal is finding duplicated or drifting implementations to merge or deduplicate.
- Keep architecture findings here when the primary issue is misplaced ownership, the wrong boundary, dependency direction, or system decomposition, even if consolidation or simplification is part of the eventual fix.
- Use `phased-implementation` after approval to execute one architecture action group at a time and update the review's implementation ledger.

## Thoroughness

Let the user's intensity and scope set the depth. For a narrow subsystem, work inline and trace its immediate dependencies. For a whole-codebase review, cover every major runtime and package surface plus cross-cutting dependency and ownership rules. For an exhaustive review, add adversarial refutation of high-risk redesigns and a completeness pass against the source inventory.

Do not confuse more proposed changes with greater thoroughness. A well-structured codebase may produce few findings; document clean boundaries and rejected candidates so that conclusion is auditable.

## Template

- [assets/templates/architecture-review-template.md](assets/templates/architecture-review-template.md) - copy this packaged resource to the concrete review path; never edit it in place.

## Shared evidence and approval

Use [review-protocol.md](references/review-protocol.md) for evidence-based verification, the five action-group authorization dimensions, and handoffs. Keep this skill's specialized question, permitted references, and output requirements. The packaged protocol is neutral and self-contained.
