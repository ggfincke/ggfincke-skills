# Image-First UI Workflow

For a new page, screen, or material visual redesign, create or accept a concrete UI reference before coding. A generated image is a target for implementation, not a loose moodboard.

For an existing interface, capture its current state first. Use that screenshot as a constraint unless the user asked for a full redesign.

1. Define the target surface, platform, audience, and visual direction.
2. Generate a full-screen reference with the built-in `imagegen` skill, or use a user-provided reference.
3. Record the reference's composition, alignments, spacing, type hierarchy, colors, component geometry, asset positions, and layering.
4. Use real image assets for illustrated, photographic, rendered, or textured material. Do not approximate those assets with decorative CSS.
5. Implement one screen or section at a time.
6. Capture the result at the same viewport and compare it to the reference.
7. Name the largest mismatches, correct them, and repeat until the main visual relationships agree.

Skip generation only when the user explicitly asks to skip it or supplies a sufficiently precise visual target. Replace unreadable generated text with concise, realistic copy that preserves the original hierarchy and density.
