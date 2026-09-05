# Hybrid components

Read the [component guide](guide.md) and [project scope gates](../../SKILL.md).
A hybrid design combines a local component with shared TypeScript library code.
Use it only for a concrete need to keep some schema/function behavior local
while sharing another part. It is not the default because an abstraction might
be useful someday.

## Decide before implementing

State why a [local component](local-components.md) or a
[packaged component](packaged-components.md) alone does not satisfy the task.
Identify the exact extension points and the owner of each table, validator,
callback, env binding and app wrapper. If the requirement is vague, choose the
simpler existing boundary rather than adding override hooks.

## Costs to account for

Hybrid designs add build/codegen coordination and can blur the isolation
boundary. Shared-library upgrades may change local schema or function contracts;
define how the supported version range and intentional local divergence are
reviewed. Do not add compatibility scaffolding to TierListBuilder's disposable
alpha merely to make a hypothetical future package upgrade easier.

## Verification

Exercise the actual local/shared composition and its app wrapper. Ensure no
shared code imports another component's private generated runtime or relies on
app auth/env being inherited implicitly. Keep required atomic writes together.
Run existing relevant checks and add tests only with approval. A hybrid design
does not authorize dependency changes, package publication or deployments.

See [official authoring guidance](https://docs.convex.dev/components/authoring#hybrid-components)
for the current model and its maintenance tradeoffs.
