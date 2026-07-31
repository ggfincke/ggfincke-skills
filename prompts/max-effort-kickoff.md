# Max-effort kickoff

A canned prompt expansion for when a task warrants maximum analysis depth. Paste it at the start of (or partway into) a hard task instead of re-typing "BE EXTREMELY THOROUGH" each time.

Why a prompt and not a skill: this is the most common modifier in the session history, so a skill keyed on it would mis-fire constantly. As a paste-block there is no trigger cost - you invoke it only when you mean it.

The key move is the second paragraph: it raises *depth* (how hard you think, how much you verify) without raising *scope* (it must not override discuss-first or major-tests-only). Keep both halves.

## Paste block

```
ultrathink. Be extremely thorough and comprehensive on this - do not cut corners and do not stop at the first plausible answer. Trace it end to end, verify claims against the live code rather than assuming, consider the cases I didn't name, and surface explicitly what you're unsure about or couldn't verify.

This dials up depth, not scope. It does NOT override my standing rules: still discuss the approach and get my go-ahead before changing files, still major/important tests only (never exhaustive coverage), and still keep edits scoped to what we agreed. Be exhaustive in the analysis; stay disciplined in what you actually do.
```

## Variants

- Read-only analysis (no edits expected): append "Stay read-only - I want the findings and a plan first, not changes."
- Hand off to a deep pass: for a true everything-at-once review into one document, use the `mega-review` skill instead of this prompt.
- Quick depth bump (inline): just "ultrathink" alone already raises reasoning effort; use the full block when you also want the scope guardrails restated.
