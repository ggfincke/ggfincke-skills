# Sources

Pinned from [mattpocock/skills](https://github.com/mattpocock/skills) at `8b78b531ab965735c5dc74f6f7a219e1e37326df` (2026-08-13). License: MIT, see [LICENSE.txt](LICENSE.txt).

## Incorporated guidance

- User-invoked wrapper: [`skills/productivity/grill-me/SKILL.md`](https://github.com/mattpocock/skills/blob/8b78b531ab965735c5dc74f6f7a219e1e37326df/skills/productivity/grill-me/SKILL.md)
- Interview primitive, inlined so this package is self-contained: [`skills/productivity/grilling/SKILL.md`](https://github.com/mattpocock/skills/blob/8b78b531ab965735c5dc74f6f7a219e1e37326df/skills/productivity/grilling/SKILL.md)
- Codex overlay `allow_implicit_invocation: false` from [`skills/productivity/grill-me/agents/openai.yaml`](https://github.com/mattpocock/skills/blob/8b78b531ab965735c5dc74f6f7a219e1e37326df/skills/productivity/grill-me/agents/openai.yaml)

Do not fetch mutable remote skill text during normal use. If asked to refresh from upstream, compare the pinned files to `SKILL.md`, preserve the MIT notice, and update the pin above with the resulting behavior change.

## House adaptations

- Inlined `grilling` into `grill-me`. Upstream `grill-me` is a one-line pointer (`Run a /grilling session.`) and does nothing if the primitive is not installed.
- Dropped `disable-model-invocation` from frontmatter (not portable here). Opt-in is the description plus the Codex overlay.
- Stateless: write no files. Upstream `grill-with-docs` is not adopted.
- While active, the round/frontier format wins over this repo's always-on action-first one-question and five-item-list rules.
