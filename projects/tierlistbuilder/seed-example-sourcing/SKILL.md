---
name: seed-example-sourcing
description: "Source and QC TierListBuilder marketplace seed templates or revise existing item art and optional covers. Owns rosters, source provenance, transparent/logo/photo/poster rules, reuse, local manifests, and offline gates. Not live Convex activation, persisted-field changes (contract-propagation), or application UI."
---

# Seed Example Sourcing (TierListBuilder)

Author new marketplace seed "example" templates end to end. Each template is a folder of sourced images plus a JSON def; a batch is usually about five templates, sized to the requested scope and host capacity. Active sources live in the **gitignored** `examples/` and `data/seeds/`; working material lives in `dev-docs/seed-examples/`. This is a local preview, never committed by this skill and never live-seeded here.

## When this applies

- "Source / add / populate / seed" a batch of example templates, or fill entries from `dev-docs/seed-examples/backlog.md`.
- Adding brand logos, transparent renders or character art, photos, or movie/TV/game posters & box art as new tier-list templates.
- Not for: the live Convex upload/activate (separate user deploy), persisted contract-field changes (use `contract-propagation`), or UI work.

## Task and media boundaries

Keep provenance and working notes inside the task's approved project paths. Write durable memory only after an explicit user request and through the current host's supported memory mechanism; sourcing a batch does not grant that permission.

Record source pages, creators when available, known usage constraints, and the intended use in the existing provenance fields or a task-local sourcing note. A gitignored preview is not blanket permission to reuse or publish an asset. Mark unknown rights honestly, retain acceptable alternatives, and obtain any missing publication authorization before distribution; do not invent a legal conclusion from the file's location.

Follow the current host's image-editing contract. Use its required image-editing tool when applicable; the local Pillow, SVG, and converter recipes below are only for an explicitly requested local method or a host that permits it. Inspect the source image before editing. Do not remove credits/watermarks to make a source appear eligible.

## Deliverables per template (all gitignored)

- `examples/<cat>/<slug>/NN-<externalId>.{png,jpg}` - one verified image per item. `NN` = 2-digit zero-padded order. png for logos/transparent art, jpg for photos/posters.
- `examples/<cat>/<slug>/_manifest.json` - provenance: `{schemaVersion:2, searchContext, failures:[], sources:[{label,queryTitle,path,width,height,format,sourceUrl,sourcePage,sourceTitle,sourceWiki,imageTitle,sourceKind}]}`.
- `data/seeds/templates/<cat>/<slug>.json` - def per `scripts/seed_pipeline/seed_pipeline/schemas/template.schema.json`. Required: schemaVersion(=2), externalId(`cat:slug`), folder, title(<=80), categoryPath(ENUM), description(<=500), tags(<=12, <=32 each), visibility(`public`), labelPolicy(`explicit-required`), criteria(1-8), items(1+ `{externalId(kebab), image(basename), label}`). Optional: `labels{show}`, `autoPlate`, `coverZoom`, `suggestedTiers`.
- `examples/<cat>/<slug>/_cover.jpg` - OPTIONAL wide hero banner, auto-detected by filename (no def edit needed). Only some templates want one; see **Cover images** below.
- `data/seeds/marketplace-core.json` -> append `"cat:slug"` to `templateOrder[]`. An unreferenced def OR an orphan order entry is a hard error.
- Reconcile `dev-docs/seed-examples/backlog.md` against the newly registered templates and add a completion note; bump the registered count.

Alternate art belongs beneath the authored template's `folder`, at `styles/<style-id>/`, with its own `_manifest.json` and optional `_cover.*`. Keep `styles[].folder` pointed at that nested directory; never create category-level sibling folders such as `<slug>-pixel`. A style ID is one safe path segment, not a path (`pixel`, not `../pixel` or `styles/pixel`). Default images stay directly in the template folder; do not recursively scan its styles as default items.

Keep unused/source candidates in `dev-docs/seed-examples/candidates/<cat>/<slug>/`, with a fresh run subdirectory for each cover-sourcing pass. Put montage and surface-preview output in `dev-docs/seed-examples/previews/`; namespace per-template outputs by category/template/style. The full original backlog/history is preserved at `dev-docs/archive/seed-examples/future-examples-2026-08-27.md`; consult it for duplicate/rejected decisions without editing that historical record.

**categoryPath enum** (only these): gaming, gaming/pokemon[/pokedex|/games], gaming/smash-bros, gaming/zelda, gaming/final-fantasy, movies, movies/mcu, movies/star-wars, anime, music, sports, food, books, tech, other. No node for cars/animals/presidents -> `other`; chocolate -> `food`; **TV series live under `movies`** (no tv node - HBO shows, sitcoms, prestige-tv-dramas are all `movies`).

## Modality rules

| Modality | Format | autoPlate | labels.show | Notes |
|---|---|---|---|---|
| Brand logos (transparent) | png | `{mode:"uniform"}` | `false` | RGBA; recolor white marks to black for a white plate. Keep authentic brand colors (Cadbury purple, Veja white-on-black). |
| **Renders / character art / illustrations** | **png (RGBA)** | `{mode:"off"}` | `true` | **Cutouts on the dark board - the default for game renders, creature art, mascots, product shots. Source the ORIGINAL transparent asset; do not flatten onto white.** |
| Photos / life-art | jpg | `{mode:"off"}` | `true` | flatten onto white, RGB q90. Real photographs only (food, people, places) - they have no isolatable subject. |
| Posters / box art | jpg | omit (none) | `false` | full-bleed portrait; `coverZoom:1`. Matches james-bond-films / horror-movie-franchises / best-picture-winners. |

Read one existing def of the same modality before authoring and copy its shape.

`autoPlate` semantics (`_compile_item_transform_and_plate` in `build/compile.py`): `off` plates nothing, `uniform` fills one colour behind every tile, and an **absent** `autoPlate` leaves the per-item detector verdict. **`off` is NOT the same as omitting it** - for bare cutouts write `{"mode":"off"}` explicitly.

## The pipeline (per batch)

0. **Check for an existing superset FIRST - reuse beats sourcing.** Before sourcing any roster, look for a bigger sibling template that already owns the same items, and copy its art. `gaming:all-pokemon` (1342 official PokeAPI renders) covers every pokemon list; `movies:mcu-characters` covers the hero/villain/supporting splits; `movies:star-wars-characters` covers its three subsets; `gaming:street-fighter-6` covered 25 of `street-fighter-characters`. Reused art is better art - it is the original asset, already transparent, already style-consistent. Find candidates by intersecting item `externalId` sets across defs.
   - Keep the target template's own `NN-slug.png` filenames; only the bytes and the manifest provenance change (add `note: "reused from <superset> (<file>)"`).
   - A superset may split an entry into variants - map the plain id onto the canonical one (e.g. `giratina` -> `giratina-altered-forme`, `deoxys` -> `deoxys-normal`, `tornadus`/`thundurus`/`landorus`/`enamorus` -> `-incarnate-forme`).
   - **! Never blanket-unify on `externalId`.** ~330 ids collide across unrelated domains: `sprite` (soda / MCU), `ghost` (pokemon type / MCU), `twitch` (LoL champ / tech co), `scorpion` (Drake album / Mortal Kombat), plus `wendy`, `toad`, `simon`, `echo`. Only reuse within the same franchise, and eyeball the pair before copying.
1. **Pick the batch** (~5 templates) from `dev-docs/seed-examples/backlog.md`; first diff category-level template folders against the defs and registered `templateOrder` so you target real gaps. Nested `styles/` folders are alternate art, not additional templates; unregistered candidates belong outside `examples/`.
2. **Roster** (one bounded assignment/template): canonical ordered item list `{externalId(kebab), label, query}`. **Size by RECOGNIZABILITY, not a count.** Give a must-include list, then tell the agent to keep adding entries while they are genuinely notable/recognizable and **STOP the moment it would be reaching for obscure deep-cuts** - do not set a target number or a padding floor beyond the schema's structural one-item minimum (a round-number target forces padding with straws). The final size is whatever clears that bar: could be 12, could be 60. A large roster is fine when every entry is genuinely famous (e.g. `anime-villains` spans dozens of hit series); a franchise with a shallow bench should stay small. Applies to fresh rosters AND supplementary expansions.
3. **Source** (bounded chunks, often about five items): fetch one clean image per item -> unique temp path -> Pillow normalize -> save `examples/<cat>/<slug>/NN-<externalId>.ext` -> **vision-verify by Reading the saved file**. Return provenance.
4. **QC montage** - THE gate. Build a white-plate (logos/photos) or portrait (posters) contact sheet and Read it visually. Agent self-report does not catch mislabeled/contaminated/badly-framed cells; the montage does. Re-source the failures. **Also curate here:** actively CUT any entry that is a reach (obscure deep-cut, or a weak/off-style source like an action-figure photo among comic art) - drop it, do not keep it just to hold a count. If a workflow padded the roster to a number, the montage is where you trim it back to what genuinely belongs.
5. **Author** defs + manifests (a Python script embedding a META dict of per-template criteria), append `templateOrder`.
6. **Gates** (all offline, no Convex) - see below.
7. **Docs + provenance**: reconcile `dev-docs/seed-examples/backlog.md` and add a task-local batch completion/source note. Write a `project_seed_batch*` memory only if the user explicitly requests durable memory and the host supports that action.

The host-neutral contract below governs steps 2-3. The [batch template](scripts/batch-sourcing-wf.template.js) is an optional legacy Workflow adapter, not an available tool on every host.

## Transparent backgrounds (renders, character art, product shots)

The board and the marketplace cards are DARK. A white-matte item reads as a white box fighting the
theme, so anything with an isolatable subject should ship as a transparent PNG.

**The pipeline already supports this end to end - there is NO code change to make.**
`build/assets.py` emits an alpha-capable webp tile + a png editor variant (only the *jpg preview*
variant flattens onto white, because JPEG has no alpha), and `SourceAsset.media_plate` already
carries the transparent-logo plate verdict. Converting a template is purely a data change: swap the
files, flip `items[].image` extensions, patch `_manifest.json` paths, set `autoPlate {"mode":"off"}`,
rebuild.

**Order of preference, strongest first:**
1. **Reuse a superset's asset** (step 0 above).
2. **Re-source the ORIGINAL transparent PNG.** Wiki and press assets usually already have alpha -
   the seed pipeline flattened them to white jpg at source time. mariowiki, zeldawiki,
   minecraft.wiki, disney.fandom, valorant.fandom, streetfighter.fandom, PokeAPI, and manufacturer
   press kits (ASUS, Analogue) all serve real RGBA. **Re-fetching beats cutting, every time.**
3. **Cut the white matte yourself** - only for a clean studio-white backdrop, and only when 1 and 2
   fail. This is lossy and has real failure modes (below).

**Verify alpha, never trust the extension.** A `.png` URL routinely returns an opaque RGBA with a
baked-in white background, or a *fake checkerboard painted into the RGB pixels*. Require mode RGBA
**and** corner pixels at `alpha == 0` **and** a sane transparent fraction. Fandom's CDN also serves
WebP bytes for `.png` URLs (Pillow opens them fine); `&format=original` bypasses the transcode.

### If you must cut a white matte

Border flood-fill alone is not enough. Four failure modes, all seen in production:

| Failure | Signature | Handling |
|---|---|---|
| Enclosed pocket left white | gap inside a bow / lantern handle ring / between legs | flat like the outer matte (mean ~254, std ~2) AND walled in by a dark ring -> cut it |
| White artwork wrongly cut | logo lettering, polka dots, cartoon pupils | same flat-white signature, so guard with a min area + "a swarm of qualifying pockets means artwork, not gaps" + a per-template opt-out |
| White subject fused with matte | Boo, a white chicken, a chrome cap | **unfixable - the pixels are genuinely ambiguous. Re-source the item.** |
| Cream halo | pale fringe on the silhouette, only visible on dark | ramp alpha across the off-white band just inside the cut (despill), don't leave a binary edge |

**Detect a bad cut by boundary GRADIENT, not colour.** A correct cut tracks a real silhouette, so the
image gradient across it is steep; a cut through fused white material wanders through flat pixels.
Score = fraction of the alpha boundary where sobel < 12. Boo scored 0.72, clean items 0.00-0.03;
flag >= 0.25. **Colour-based metrics do not work - the cut destroys its own evidence** (a chewed
white subject scores *clean* on residual-white because the white is already gone). Expect false
positives on smooth-gradient subjects (a glossy star, a mushroom cap) - always eyeball before acting.

**Do NOT chase ground shadows or platform slabs baked into the artwork.** Paleoart cast shadows and
character-render platforms are more saturated than a neutral matte, so brightness filters miss them;
identifying them by shape+position instead (low in frame, wider than tall) matched a triceratops'
own body and cut a band clean through it. Accept them - they read as intentional shading.

### Deciding whether a template converts at all

Score every item, then judge the roster as a whole:
- **Convert** when the large majority cut cleanly and the stragglers can be re-sourced.
- **Keep white** when the roster is a MIX of isolatable cutouts and full-bleed scene stills.
  Half-converted looks worse than uniformly white. This is what disqualified `naruto-characters`
  (13/32 full-bleed), `dragon-ball-characters`, `anime-villains`, `girl-scout-cookies`, `hot-sauces`,
  `candy-bars`.
- **Never** for posters, box art, album covers, or flags - the white is part of the artwork.
- Real photographs (food, people, places) have no isolatable subject; leave them jpg.

Beware a stale keep-white call: `street-fighter-characters` was held back over "the splash art
deliberately uses white", until `street-fighter-6` turned out to hold transparent versions of the
*same* Capcom art proving the flourishes survive. Re-check the assumption before accepting it.

### Preserve originals before conversion

Inspect a converter's input-removal behavior before running it. Work on copies in a fresh,
run-owned candidate directory; do not give a source-deleting converter the only original.
Before replacing pre-existing assets, record exact paths and hashes and verify a recovery copy
inside the approved project workspace. A remembered cache or temporary directory is not proof
that the current source bytes are recoverable.

Validate the converted files, transparency, framing, and declared formats before installing
them. Remove pre-existing originals only when that exact replacement/removal is authorized
and recovery is established. Validated, disposable downloads created solely by this run may
be cleaned within the approved task; do not confuse them with the user's original assets.

## Cover images (optional hero banner)

A template folder may hold ONE `_cover.{jpg,jpeg,png,webp}`. The build auto-detects it by filename (`_detect_cover` in `build/source.py`) - no def edit needed unless you add `coverZoom`. It renders as a wide hero banner behind the list title. This is a SEPARATE, optional pass on top of a template that already has its item images - not every list wants one. Give a cover to franchise rosters and music discographies where a single evocative image fits; a plain logo grid usually does not need one. Reference the shipped `entire-mcu` (textless Endgame cast art) and `ssbu-fighters` (roster mural).

**Aesthetic (SOURCED online, NEVER composited).** Real images pulled from the web - never a Pillow collage. Must be textless: any baked-in title/logo/credits/watermark disqualifies it.
- Franchise -> official key art, textless poster art, box-art hero, or an iconic ensemble/vista. A single striking on-brand image is as valid as ensemble art. MUST NOT reuse an image another template already owns (e.g. `mcu-villains` must not be the Endgame hero poster `entire-mcu` uses; villain lists must be villain-forward).
- Discography (artist) -> professional artist/band photography (press shot, tour/live photo, era-defining portrait) beats a lone album cover. A compilation grid of album art is acceptable only if unusually strong; a highlight photo is preferred. Right lineup matters (The Strokes != The Voidz; Queen != a Bohemian Rhapsody film still).

**Deliverable.** `examples/<cat>/<slug>/_cover.jpg` - RGB, quality 92, long side downscaled to <=3840. Add `"coverZoom": <n>` to the def ONLY when framing needs it (below); default (omit) is best.

**coverZoom + the three surfaces - "fit right for every viewport".** Surfaces live in `SURFACE_ASPECT_RATIOS` (build/template_payloads.py), mirrored by `COVER_SURFACES` (packages/contracts/lib/coverMedia.ts): browseHero 16:9, card 16:10, detailHero 4:3 (the tightest crop). One `coverZoom` scalar applies to all three. It is counter-intuitive: `coverZoom > 1` zooms **OUT** past cover-fit - it reveals more of an ultra-wide source and letterboxes the gap with `--t-media-matte` (#0d0d0d). When the source is wider than a surface, matte fraction = `1 - 1/zoom`, **constant across all three surfaces** (that is why `ssbu-fighters` at 1.6 shows ~37.5% bars on every surface). So:
- Default `1` = full-bleed, zero matte, but each surface crops the source's sides/top on the tighter aspects. This is the most robust choice: a zero-matte cover cannot letterbox unexpectedly when a live container drifts off the canonical aspect.
- Raise `coverZoom` only to rescue an ultra-wide source whose subjects get cropped out at default, and only if you accept the bars. In the 2026-07-10 batch full-bleed default beat every candidate, including the two widest (`mortal-kombat-1` 2.32:1, `street-fighter-6` 3.10:1).

**The QC gate = simulate every surface, do not eyeball one crop.** [The surface simulator](scripts/simulate-cover-surfaces.py) renders exactly what browseHero/detailHero/card show at a given zoom (it re-implements `zoomedFrameForSurface`) and flags any surface showing <62% source width or >30% matte:
```bash
uv run --project scripts/seed_pipeline python .agents/skills/seed-example-sourcing/scripts/simulate-cover-surfaces.py \
  examples/gaming/street-fighter-6/_cover.jpg=1.6 examples/gaming/mortal-kombat-1/_cover.jpg
```
Sheets go to `dev-docs/seed-examples/previews/surfaces/`. Nested-style input labels include category/template/style so repeated style IDs stay distinguishable. Look at the sheet, then set `coverZoom` per template. **The LLM vision scorer misranks covers** - it rewards square album art, white-logo banners, and hero-over-villain art; the montage + surface sim is the real gate, same as item QC.

**Verify build.** `seed:marketplace:build` reports a `cover variants` count = the number of templates with a `_cover.*`; confirm it rose by exactly the number you added (that is the compile-time proof each new cover was detected from its filename).

[The cover sourcing Workflow helper](scripts/cover-sourcing-wf.template.js) is ready to adapt for this: sonnet multi-angle source (write-only, ADD never overwrite scratch candidates) -> read-only Explore vision-score. It returns RANKED CANDIDATES to a scratch dir - present the best to the user and install only the picked one; it never writes into `examples/` itself.

## Offline gates (must be green before done)

```bash
npm run seed:marketplace:validate
npm run seed:marketplace:build     # expect 100% inspect per template
npm run audit:doc-paths
```

The maintained full-source validator above rejects missing definitions and orphan order entries. Do not replace it with a print-only orphan comparison. Recheck the current target package scripts and seed CLI before relying on these commands.

Also compare category-level `examples/<cat>/<slug>/` folders against the defs' declared
default folders. Resolve alternate folders through `styles[].folder`; candidates and previews
are working material under `dev-docs/seed-examples/`, not exceptions to the active catalog.

Never run two `seed:marketplace:build` invocations concurrently - they write the same
`.seed-cache/.../variants/` dir and corrupt the webp tiles.

Run Python/Pillow through the seed venv: `uv run --project scripts/seed_pipeline python ...`.

## Sourcing recipe

- Use a nonpersonal User-Agent such as `tierlistbuilder-seed/1.0`. Disclose contact details only if the source requires them and the user approves that disclosure. Accept only HTTP200 + image/* + >=3KB.
- Commons: `https://commons.wikimedia.org/wiki/Special:FilePath/<FileTitle>?width=1024` (auto-rasterizes SVG; %20 space, %27 apostrophe).
- **Brand logos are often NOT on Commons** - they sit on **en.wikipedia** as local fair-use uploads. Always also search `en.wikipedia.org/w/api.php?...list=search&srnamespace=6&srsearch=<brand> logo`. A pure-Commons search falsely reports "no logo".
- **Posters: Wikipedia's fair-use copies are tiny (~250px)**. Get full-res from **IMPAwards** (`impawards.com/<year>/posters/<slug>_xlg.jpg`), **TMDB** (`image.tmdb.org`), **Rotten Tomatoes/Flixster og:image**, **Steam** (`steamstatic.com` capsule, games), or fan wikis.
- **Very-new brands not on Wikimedia** (e.g. Windsurf editor): grab the official site's `/favicon.svg`; if it has a solid background `<rect>`, delete that line then `rsvg-convert` -> transparent mark.
- Normalize w/ Pillow: downscale long side to 1024 LANCZOS; keep alpha for png; flatten white RGB q90 for jpg.
- **Provenance and intended use travel with the source.** Prefer a correct image whose known usage conditions fit the requested use. Record uncertainty and alternatives rather than declaring rights irrelevant; local preview does not authorize publication.
- Tooling present: rsvg-convert, cwebp, Pillow (in the seed venv). NO ImageMagick.

## Gotchas (hard-won)

- **Unique temp paths per download.** A shared `/tmp/logo_<nn>` cross-contaminates when templates source concurrently (`nn` is only unique within a template) - one template's item 14 overwrites another's. Symptom: a cell shows a different template's image. Fix: `/tmp/<slug>_<nn>`. The montage is what catches it.
- **The montage is the real QC gate**, not per-item vision-verify (nondeterministic timing lets contamination through).
- **The catalog is authoritative, not backlog checkboxes.** Reconcile the active backlog against disk; the archived checklist preserves history and may be stale in either direction.
- Diff category-level template folders vs defs and `templateOrder` before picking a batch; keep half-done/unregistered material in `dev-docs/seed-examples/candidates/`.
- Photo source agents pick badly-framed shots (montages, harsh shadows); re-source from the montage.
- **Cover candidates go to scratch, ADD-only** - source agents write `dev-docs/seed-examples/candidates/<cat>/<slug>/<RUN_ID>/`, never into `examples/`, and never delete/overwrite a sibling's file (a stray agent once dumped imgur error placeholders into the repo root). Install the one picked cover yourself after the human eyeballs it.
- **Cover verifiers must be read-only** (the legacy adapter uses `agentType: 'Explore'`; other hosts use their own read-only controls) - a write-capable verify agent can corrupt the candidate set. The vision score is advisory; it misranks covers, so the surface-sim montage decides.
- **Agent montage QC is noisy - it FLAGS, you DECIDE.** Sonnet contact-sheet readers called a clean 18/18 dinosaur set "broken 11/18" and false-positived a Minecraft chicken, while genuinely catching a hollowed-out logo wordmark that was invisible at contact-sheet scale. Treat every report as a list to verify, never as a verdict. Verify at full size before acting on a flag.
- **Verify a template on the background it actually ships on.** Compositing an `autoPlate:{mode:"uniform"}` template (which renders on a light plate) against the dark board produces a pile of bogus "illegible-on-dark" findings. For transparency QC, show each PNG over BOTH a light card and the dark board - a white fringe shows on dark, a punched hole shows on light.
- **Keep QC artifacts inside the repo** (`dev-docs/seed-examples/previews/...`, gitignored), with category/template/style context in per-template output names. Reading images from `/private/tmp` trips a permission prompt on every file, and that scratchpad can be wiped mid-session.

## Dedicated artifact handoff

Use [the artifact workflow](references/artifact-workflow.md) for task-local receipts, source inventory reuse, and isolated-workspace materialization. The [materialization helper](scripts/materialize-inputs.py) copies only declared hash-verified inputs; the [receipt template](assets/artifact-receipt.template.json) records media, counts, provenance, recovery, and visual QC without changing application manifests. Ignored artifact files are outside broker Git-patch acceptance.

## Execution and reconciliation

1. Inspect the current host capabilities. Use native subagents when available and authorized, or execute sequentially. Generic subagent permission does not activate the opt-in `orchestrate` broker workflow. Do not invent a Workflow tool or translate its API directly into another tool's arguments.
2. Assign exact template/item identities, owned output paths, media boundaries, source/QC requirements, and expected result fields. Choose models only through the host's approved mechanism; omission means its existing default, not a hidden provider preference. Cover sourcing may write only its run-owned candidates; cover verification is read-only.
3. Keep one result row per requested template and roster item, including failed, missing, duplicate, or invalid results. Reconcile requested = succeeded + failed + pending before authoring manifests. A roster failure leaves its item count unknown, not zero-success. Record unexpected result IDs separately instead of silently accepting or discarding them.
4. Treat model scores and worker claims as advisory. Verify saved files and inspect the montage/surface previews. Retry only failed owned work after checking existing outputs; a resumed run is not assumed free, cached, or supported.

### Optional legacy Workflow adapter

Only on a host that actually provides compatible `pipeline`, ordered `parallel`, `agent`, schema validation, and top-level script-result semantics, adapt the [batch](scripts/batch-sourcing-wf.template.js) or [cover](scripts/cover-sourcing-wf.template.js) template in task scratch. They are not Node programs or native-subagent API wrappers. Validate that host's current contract before execution; the templates fail before calls when the required globals are absent. Bind any model overrides to an approved current catalog; the templates otherwise inherit host defaults. Use `scriptPath`/`resumeFromRunId` only if that host documents those fields and the prior run identity is verified.

## Constraints

- Never commit (the user owns all commits) and never run the live Convex upload/activate. Both `examples/` and `data/seeds/` are gitignored, so changes never appear in `git status` - that is expected, not a failure.
