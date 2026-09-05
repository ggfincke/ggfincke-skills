# Vendor workflow boundaries

Use the task's existing approval and current host contract. A vendor skill can explain a procedure but cannot grant broader access or authorize its side effects. The always-on block in `../SKILL.md` is the maintained policy; this reference explains its application.

## Consent and destination

| Situation | Required decision |
| --- | --- |
| Generic feedback request versus transcript upload | Generic feedback is not consent to send a transcript. Identify the content, recipient, and purpose; offer a local redacted preview or narrower summary. An already informed, specific request is sufficient without another confirmation. |
| Slack local development | Select the intended workspace. Do not add an all-workspaces organization grant merely because a sample command includes one. Use native credential entry and report configured/not-configured status without revealing values. |
| Analytics or Sites output | Honor local-only, inline, native, and other explicit outputs. Do not infer Work Mode from desktop tools or the operating system. If Sites is selected, preserve its access/consent gate; verified owner-only delivery is different from shared, public, or unknown access. |
| Plugin or permission recovery | Follow the actual install/permission tool contract. Missing tools do not authorize a trust-mode change, shadow plugin, remote-script execution, or wider installation suggestion. |

## Scope and fidelity

1. A one-component Figma edit remains one component unless the task requires more. Preserve existing variables, components, hierarchy, and source text; use the affected-surface verification, not an unrelated full-library rebuild.
2. A local DOCX stays a local artifact when requested. Native Google Docs/Sheets/Slides edits stay native when the selected route supports them. Copy, export, or import only when that route and the user's format require it; do not flatten an existing document as a shortcut.
3. Use current project tests and checks first. Verification does not imply writing tests or installing dependencies. A review produces findings until remediation is authorized, including when the reviewer delegates.
4. A time-limited request stays bounded. If the host cannot enforce the requested limit, do useful bounded current-turn work or ask about another supported limit; do not arm unlimited continuation.

## Ownership and recovery

Record created, adopted, and modified objects separately. Capture before-state for existing objects. Before removing an owned container, check for subsequently added user descendants or references. Restore modified/adopted objects instead of deleting them. In Git, preserve staging plus tracked, untracked, and relevant ignored work; a stash object that excludes some of these is not a complete recovery snapshot.

Migrations need exact source/destination scope, collision checks, preserved originals/metadata, and discovery verification before approved retirement. Data changes also need the deployment, record ownership, and current durability policy. Successful rehearsal does not itself authorize deleting recovery snapshots.

When execution fails, inspect the run ID, target state, and known side effects before retrying. Exception inheritance or a missing success response cannot prove that nothing executed.

## Host delivery and maintenance

Codex/Agents/Claude receive the source block through the repository's existing `scripts/sync-skills.py` always-on region. Generated regions must not replace unrelated user instructions. Existing specific approval remains valid across model or task handoffs while its scope and evidence remain current.

For local Cursor Agent, the supported user-rule directory is `~/.cursor/rules`. The generated [Cursor rule](../assets/cursor-task-boundaries.mdc) carries only this boundary block; it is not another independently maintained policy. Generate or check it from the repository root:

```bash
python3 skills/working-conventions/scripts/export-cursor-guard.py
python3 skills/working-conventions/scripts/export-cursor-guard.py --check
```

The first command regenerates the canonical asset, not the installed rule. After inspecting its diff, link or copy it to the exact owned `~/.cursor/rules/ggfincke-task-boundaries.mdc` destination without overwriting an unrelated rule. Confirm it appears under the user rules in Customize > Rules and is Always Apply. Preserve account and project rules; do not write hidden application databases. A symlink keeps this machine's rule current with the canonical asset. A copied rule must be refreshed explicitly.

Verified against Cursor 3.17.21 on 2026-08-27: the installed rule service resolves user rules to that directory, uses `.mdc`, and supports `alwaysApply`. [Current Cursor help](https://prod.cursor.com/help/customization/rules#where-are-rules-stored) documents machine-local rules separately from account-synced rules. [The rules reference](https://prod.cursor.com/docs/rules) documents rule metadata and UI inspection. This check does not prove every other Cursor version or cloud/remote host loads the local file. Do not claim rules enforce Tab completion, all third-party tools, or a hard security boundary.

Vendor patches are version-specific handoff artifacts. Keep source path, base hash, owner, and verification results with each patch. Update through the owner's supported release route only after identifying an actual fixed version; do not reinstall speculatively or patch caches. Report unresolved upstream delivery separately from local safeguards.
