// seed-example-sourcing: batch sourcing Workflow template (TierListBuilder)
// adapt TEMPLATES + META then run with the Workflow tool; pipeline = opus roster -> sonnet source chunks.
// copy into the session scratchpad, edit, and invoke via {scriptPath}. sourcing branches on t.modality:
//   'logo'   -> png, transparent, uniform plate, labels hidden
//   'photo'  -> jpg, flatten white, plate off, labels shown
//   'poster' -> jpg, full-bleed portrait, no plate, labels hidden

export const meta = {
  name: 'seed-batch-sourcing',
  description: 'Source a batch of TierListBuilder marketplace seed example templates (roster -> image source -> vision-verify)',
  phases: [
    { title: 'Roster', detail: 'opus builds the canonical ordered item list per template' },
    { title: 'Source', detail: 'sonnet fetches + normalizes + vision-verifies one image per item' },
  ],
}

const ROOT = '/Users/ggfincke/Projects/Applications/tierlistbuilder'
const UA = 'tierlistbuilder-seed/1.0 (garrettfincke@gmail.com)'

// EDIT THIS: one entry per template in the batch.
// modality: 'logo' | 'photo' | 'poster'. must = comma-separated must-include items.
const TEMPLATES = [
  {
    slug: 'example-slug', cat: 'tech', modality: 'logo',
    title: 'Example template',
    must: 'Item A, Item B, Item C',
    order: 'by recognition',
  },
]

const MODALITY = {
  logo: {
    word: 'official brand logo (transparent/vector preferred)', ext: 'png',
    norm: 'open, keep alpha (RGBA); if a white wordmark would vanish on a white plate, recolor it to black; downscale long side to 1024 LANCZOS; save PNG',
    reject: 'photos of products, logos-with-tagline lockups when a clean logomark exists, tiny favicons, wrong brand',
    sourceKind: 'logo',
  },
  photo: {
    word: 'clean, well-framed representative photo (single clear subject, plain background)', ext: 'jpg',
    norm: 'open, convert RGB (flatten transparency onto white), downscale long side to 1024 LANCZOS, save JPEG quality 90',
    reject: 'montages/collages, harsh shadows, watermarks, busy backgrounds, wrong subject',
    sourceKind: 'photo',
  },
  poster: {
    word: 'official theatrical poster / series key art / game box art (portrait)', ext: 'jpg',
    norm: 'open, convert RGB, if long side > 1024 downscale to 1024 LANCZOS (no crop/pad), save JPEG quality 90',
    reject: 'tiny thumbnails, DVD-case product photos on white, screenshots, actor headshots, wrong title/year',
    sourceKind: 'poster',
  },
}

const ROSTER_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: {
    items: {
      type: 'array', minItems: 3,
      items: {
        type: 'object', additionalProperties: false,
        required: ['externalId', 'label', 'query'],
        properties: {
          externalId: { type: 'string', description: 'kebab-case, unique, stable' },
          label: { type: 'string', description: 'display name; films/games "Title (Year)", else plain' },
          query: { type: 'string', description: 'precise image-search string' },
        },
      },
    },
  },
}

const SOURCE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['externalId', 'saved'],
        properties: {
          externalId: { type: 'string' }, saved: { type: 'boolean' },
          image: { type: 'string' }, width: { type: 'number' }, height: { type: 'number' }, format: { type: 'string' },
          sourceUrl: { type: 'string' }, sourcePage: { type: 'string' },
          sourceTitle: { type: 'string' }, sourceWiki: { type: 'string' }, note: { type: 'string' },
        },
      },
    },
  },
}

function chunk(arr, n) { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o }
function pad2(n) { return (n < 10 ? '0' : '') + n }

const out = await pipeline(
  TEMPLATES,
  (t) => agent(
    `Build the canonical item roster for a TierListBuilder tier-list template.

Template: "${t.title}" (modality: ${t.modality}).
Order: ${t.order}.
Size by RECOGNIZABILITY, not a count: keep adding genuinely notable/recognizable entries and STOP the moment you would be reaching for obscure deep-cuts. Do NOT pad to a target number. MUST include at least these (add other iconic entries; do NOT invent nonexistent items): ${t.must}

Per item output: externalId (kebab-case, unique, stable), label (films/games "Title (Year)", else plain), query (a precise search string to find the ${MODALITY[t.modality].word}). Return ONLY the structured roster.`,
    { label: `roster:${t.slug}`, phase: 'Roster', model: 'opus', schema: ROSTER_SCHEMA }
  ),
  async (roster, t) => {
    const m = MODALITY[t.modality]
    const items = roster.items.map((it, i) => ({ ...it, nn: pad2(i + 1) }))
    const folderRel = `examples/${t.cat}/${t.slug}`
    const chunks = chunk(items, 5)
    const chunkResults = await parallel(chunks.map((ch, ci) => () => agent(
      `Source ${m.word} images for a TierListBuilder tier-list template. Save one clean image per item.

ROOT = ${ROOT}
Output folder (create it): ${ROOT}/${folderRel}
User-Agent for ALL downloads: '${UA}'
Copyright/licensing does NOT matter (local gitignored preview) - pick the best correct image from any reachable source.

Items (JSON): ${JSON.stringify(ch, null, 2)}

For EACH item:
1. Find the ${m.word}. Try, in order: Wikimedia Commons (Special:FilePath/<File>?width=1024); en.wikipedia file search (api.php ...list=search&srnamespace=6&srsearch=<query>) then imageinfo for the direct url; the article's lead image (prop=pageimages&piprop=original); then any other reachable source (for posters/box art prefer IMPAwards / TMDB image.tmdb.org / Rotten Tomatoes og:image / Steam capsule).
2. Download to a UNIQUE temp path: /tmp/${t.slug}_<nn>.<ext>. Verify HTTP 200 + image/* + >=3KB.
3. Normalize with Pillow via: uv run --project scripts/seed_pipeline python -c "..."  -> ${m.norm} to ${ROOT}/${folderRel}/<nn>-<externalId>.${m.ext}
4. VISION-VERIFY: Read the saved file. Confirm it is the correct item and clean. Reject: ${m.reject}. If wrong, try the next candidate and re-save.
5. Record provenance.

Every saved file MUST be <nn>-<externalId>.${m.ext} with the exact nn + externalId given. Return results for ALL ${ch.length} items (saved bool, image basename, dimensions, sourceUrl/sourcePage/sourceTitle/sourceWiki).`,
      { label: `source:${t.slug}#${ci + 1}`, phase: 'Source', model: 'sonnet', schema: SOURCE_SCHEMA }
    )))
    const results = chunkResults.filter(Boolean).flatMap((r) => r.results || [])
    return { slug: t.slug, cat: t.cat, title: t.title, modality: t.modality, items, results }
  }
)

return { templates: out.filter(Boolean) }
