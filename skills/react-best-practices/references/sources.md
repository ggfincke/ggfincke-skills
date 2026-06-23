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
- React-layer accessibility falls back to a self-contained checklist in `react-core.md`; the `web-design-guidelines` skill (optional, not bundled with this skill) and the `security-remediation` skill cover the general accessibility and untrusted-input rules when installed.
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
