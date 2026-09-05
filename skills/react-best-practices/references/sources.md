# Sources and Maintenance

This skill combines official React correctness guidance with framework-neutral production performance guidance adapted from Vercel's React Best Practices material.

## Primary sources

- React Rules of React: https://react.dev/reference/rules
- React You Might Not Need an Effect: https://react.dev/learn/you-might-not-need-an-effect
- React Synchronizing with Effects: https://react.dev/learn/synchronizing-with-effects
- React Lifecycle of Reactive Effects: https://react.dev/learn/lifecycle-of-reactive-effects
- React Compiler: https://react.dev/learn/react-compiler
- React Hooks reference: https://react.dev/reference/react/hooks
- React useId: https://react.dev/reference/react/useId
- React Actions and forms: https://react.dev/reference/react/useActionState, https://react.dev/reference/react-dom/hooks/useFormStatus, https://react.dev/reference/react/useOptimistic, https://react.dev/reference/react-dom/components/form
- React hydration and `suppressHydrationWarning`: https://react.dev/reference/react-dom/client/hydrateRoot
- React with TypeScript: https://react.dev/learn/typescript
- React TypeScript Cheatsheet: https://react-typescript-cheatsheet.netlify.app/
- React-layer accessibility falls back to a self-contained checklist in `react-core.md`; the `frontend-workbench` skill (optional, not bundled with this skill) and the `security-remediation` skill cover the general accessibility and untrusted-input rules when installed.
- Vercel Introducing React Best Practices: https://vercel.com/blog/introducing-react-best-practices
- Vercel agent skills repo: https://github.com/vercel-labs/agent-skills

## Adaptation notes

- The Vercel source skill is React and Next.js oriented. This repo's skill is React-first and framework-neutral.
- Next.js-only advice is intentionally excluded from the main guidance.
- If a target repo uses Next.js, inspect that repo's local conventions and current Next docs before applying Next-specific rules.
- Keep `SKILL.md` short. Put detailed guidance in references and route to it from the body.
- `typescript.md` covers the React/TypeScript interface only. Leave general TypeScript guidance to the language's own docs.
- Keep canonical frontmatter portable: only `name` and `description`.

## Update checklist

When revising this skill:

1. Check current React docs for changed guidance around Compiler, Effects, Hooks, forms/Actions, hydration, and React 19+ APIs.
2. Check the Vercel agent skills repo for new framework-neutral performance rules.
3. Keep advice version-gated where APIs are not universal.
4. Run `python3 scripts/validate-skills.py --strict-frontmatter`.

## Checked facts and provenance

Reviewed on 2026-08-27 against current primary React documentation and local React/React DOM 19.2.8 with `@types/react` 19.2.18. The `use` conditional-call exception, continued `useContext` support, ref-prop availability, URL-sink behavior, and `FunctionComponent` children typing are version-sensitive; inspect the target's installed versions before applying them. Direct props typing remains a house preference, not a claim that modern `React.FC` adds children.

The Vercel source comparison used [agent-skills at 20e89cc4bb256eb7b1fcbdc68f7175284709a847](https://github.com/vercel-labs/agent-skills/tree/20e89cc4bb256eb7b1fcbdc68f7175284709a847). The historical imported revision was not recorded. This skill is a local framework-neutral adaptation, not an unmodified upstream snapshot or a complete refresh to that revision. The two local Vercel-derived collections record their source paths, checked reference, local divergence, and deterministic generator in [performance metadata](../rules/performance/metadata.json) and [composition metadata](../rules/composition/metadata.json). Each collection retains all imported rule bodies and local corrections.
