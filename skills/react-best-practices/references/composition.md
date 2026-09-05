# Composition routing

Use composition when current component variation or state ownership warrants it. Inspect callers and preserve the public contract. Simple boolean state is valid; compound components, context, providers, or dependency injection need a present responsibility to own.

Read the relevant individual sources in `../rules/composition/`:

- [Component variation](../rules/composition/architecture-avoid-boolean-props.md) and [compound components](../rules/composition/architecture-compound-components.md).
- [State ownership](../rules/composition/state-lift-state.md), [implementation boundaries](../rules/composition/state-decouple-implementation.md), and [context contracts](../rules/composition/state-context-interface.md).
- [Explicit variants](../rules/composition/patterns-explicit-variants.md) and [children versus render props](../rules/composition/patterns-children-over-render-props.md).
- [React 19 ref props and context](../rules/composition/react19-no-forwardref.md), only when the installed versions support them. Existing supported APIs do not require migration.

The [generated composition collection](composition-rules.md) provides the complete eight-rule reference. Its [metadata](../rules/composition/metadata.json) preserves upstream attribution and local corrections.
