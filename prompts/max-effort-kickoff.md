# Max-effort kickoff

A canned prompt expansion for when a task warrants maximum analysis depth. Paste it at the start of (or partway into) a hard task instead of re-typing "BE EXTREMELY THOROUGH" each time.

Why a prompt and not a skill: this is the most common modifier in the session history, so a skill keyed on it would mis-fire constantly. As a paste-block there is no trigger cost - you invoke it only when you mean it.

The key move is the second paragraph: it raises *depth* (how hard you think, how much you verify) without raising *scope* (it must not override discuss-first or major-tests-only). Keep both halves.

## Paste block

```
Be extremely thorough and comprehensive on this - do not cut corners and do not stop at the first plausible answer. Trace it end to end, verify claims against the live code rather than assuming, consider the cases I didn't name, and surface explicitly what you're unsure about or couldn't verify.

This dials up depth, not scope. It does NOT authorize implementation during a review or expand an existing approval. Preserve the agreed scope and side-effect boundaries; add or change only explicitly requested or approved major tests, never exhaustive coverage. Continue already authorized work without redundant approval; ask before a new scope or risk decision.
```

## Variants

- Read-only analysis (no edits expected): append "Stay read-only - I want the findings and a plan first, not changes."
- Hand off to a deep pass: for a true everything-at-once review into one document, use the `mega-review` skill instead of this prompt.
- Host-specific cue: use `ultrathink` only where the host documents it. Prompt wording is not proof that the actual model or reasoning setting changed; inspect supported controls and honor authorization before changing them.
