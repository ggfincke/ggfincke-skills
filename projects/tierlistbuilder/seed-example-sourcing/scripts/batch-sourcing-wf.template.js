// projects/tierlistbuilder/seed-example-sourcing/scripts/batch-sourcing-wf.template.js
// legacy Workflow adapter for roster sourcing with complete failure reconciliation

// use only after the host capability check in SKILL.md; bind models through approved host options.
// copy into task scratch; this is not a Node script. sourcing branches on t.modality:
//   'logo'   -> png, transparent, uniform plate, labels hidden
//   'render' -> png, meaningful alpha, plate off, labels shown
//   'photo'  -> jpg, flatten white, plate off, labels shown
//   'poster' -> jpg, full-bleed portrait, no plate, labels hidden

export const meta = {
  name: 'seed-batch-sourcing',
  description:
    'Source a batch of TierListBuilder marketplace seed example templates (roster -> image source -> vision-verify)',
  phases: [
    {
      title: 'Roster',
      detail: 'build the canonical ordered item list per template',
    },
    {
      title: 'Source',
      detail: 'fetch, normalize, and vision-verify one image per item',
    },
  ],
}

const ROOT = '/Users/ggfincke/Projects/Applications/tierlistbuilder'
const UA = 'tierlistbuilder-seed/1.0'

// EDIT THIS: one entry per template in the batch.
// modality: 'logo' | 'render' | 'photo' | 'poster'. must = comma-separated must-include items.
const TEMPLATES = [
  {
    slug: 'example-slug',
    cat: 'tech',
    modality: 'logo',
    title: 'Example template',
    must: 'Item A, Item B, Item C',
    order: 'by recognition',
  },
]

const MODALITY = {
  logo: {
    word: 'official brand logo (transparent/vector preferred)',
    ext: 'png',
    norm: 'open, keep alpha (RGBA); if a white wordmark would vanish on a white plate, recolor it to black; downscale long side to 1024 LANCZOS; save PNG',
    reject:
      'photos of products, logos-with-tagline lockups when a clean logomark exists, tiny favicons, wrong brand',
    sourceKind: 'logo',
  },
  render: {
    word: 'official transparent render / character art / illustration (original alpha asset)',
    ext: 'png',
    norm: 'open as RGBA, preserve meaningful source alpha, downscale long side to 1024 LANCZOS, save PNG; the template uses autoPlate off and labels shown',
    reject:
      'opaque or white-matte backgrounds, fake checkerboards baked into the image, full-bleed scenes, screenshots, watermarks, wrong character/item',
    sourceKind: 'render',
  },
  photo: {
    word: 'clean, well-framed representative photo (single clear subject, plain background)',
    ext: 'jpg',
    norm: 'open, convert RGB (flatten transparency onto white), downscale long side to 1024 LANCZOS, save JPEG quality 90',
    reject:
      'montages/collages, harsh shadows, watermarks, busy backgrounds, wrong subject',
    sourceKind: 'photo',
  },
  poster: {
    word: 'official theatrical poster / series key art / game box art (portrait)',
    ext: 'jpg',
    norm: 'open, convert RGB, if long side > 1024 downscale to 1024 LANCZOS (no crop/pad), save JPEG quality 90',
    reject:
      'tiny thumbnails, DVD-case product photos on white, screenshots, actor headshots, wrong title/year',
    sourceKind: 'poster',
  },
}

const ROSTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['externalId', 'label', 'query'],
        properties: {
          externalId: {
            type: 'string',
            description: 'kebab-case, unique, stable',
          },
          label: {
            type: 'string',
            description: 'display name; films/games "Title (Year)", else plain',
          },
          query: { type: 'string', description: 'precise image-search string' },
        },
      },
    },
  },
}

const SOURCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['externalId', 'saved'],
        properties: {
          externalId: { type: 'string' },
          saved: { type: 'boolean' },
          image: { type: 'string' },
          width: { type: 'number' },
          height: { type: 'number' },
          format: { type: 'string' },
          sourceUrl: { type: 'string' },
          sourcePage: { type: 'string' },
          sourceTitle: { type: 'string' },
          sourceWiki: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
  },
}

function chunk(arr, n)
{
  const o = []
  for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n))
  return o
}
function pad2(n)
{
  return (n < 10 ? '0' : '') + n
}

if (
  typeof pipeline !== 'function' ||
  typeof parallel !== 'function' ||
  typeof agent !== 'function'
)
{
  throw new Error(
    'Legacy Workflow globals unavailable; use the native-subagent or sequential contract in SKILL.md'
  )
}

async function callAgent(prompt, options)
{
  try
  {
    return (
      (await agent(prompt, options)) ?? { workerError: 'missing worker result' }
    )
  }
  catch (error)
  {
    return { workerError: String(error) }
  }
}

const out = await pipeline(
  TEMPLATES,
  (t) =>
    callAgent(
      `Build the canonical item roster for a TierListBuilder tier-list template.

Template: "${t.title}" (modality: ${t.modality}).
Order: ${t.order}.
Size by RECOGNIZABILITY, not a count: keep adding genuinely notable/recognizable entries and STOP the moment you would be reaching for obscure deep-cuts. Do NOT pad to a target number. MUST include at least these (add other iconic entries; do NOT invent nonexistent items): ${t.must}

Per item output: externalId (kebab-case, unique, stable), label (films/games "Title (Year)", else plain), query (a precise search string to find the ${MODALITY[t.modality].word}). Return ONLY the structured roster.`,
      {
        label: `roster:${t.slug}`,
        phase: 'Roster',
        schema: ROSTER_SCHEMA,
      }
    ),
  async (roster, t) =>
  {
    if (
      !Array.isArray(roster?.items) ||
      !roster.items.length ||
      new Set(roster.items.map((item) => item.externalId)).size !==
        roster.items.length
    )
    {
      return {
        slug: t.slug,
        cat: t.cat,
        status: 'failed',
        items: null,
        results: [],
        error: roster?.workerError || 'invalid or duplicate roster identities',
      }
    }
    const m = MODALITY[t.modality]
    const items = roster.items.map((it, i) => ({ ...it, nn: pad2(i + 1) }))
    const folderRel = `examples/${t.cat}/${t.slug}`
    const chunks = chunk(items, 5)
    const chunkResults = await parallel(
      chunks.map(
        (ch, ci) => () =>
          callAgent(
            `Source ${m.word} images for a TierListBuilder tier-list template. Save one clean image per item.

ROOT = ${ROOT}
Output folder (create it): ${ROOT}/${folderRel}
User-Agent for ALL downloads: '${UA}'
Record source provenance, known usage constraints, and intended use; local preview does not grant publication rights. Mark unknown rights and retain alternatives. Do not disclose personal contact details or remove credits/watermarks. Follow the host image-editing contract and preserve pre-existing originals.

Items (JSON): ${JSON.stringify(ch, null, 2)}

For EACH item:
1. Find the ${m.word}. Try, in order: Wikimedia Commons (Special:FilePath/<File>?width=1024); en.wikipedia file search (api.php ...list=search&srnamespace=6&srsearch=<query>) then imageinfo for the direct url; the article's lead image (prop=pageimages&piprop=original); then any other reachable source (for posters/box art prefer IMPAwards / TMDB image.tmdb.org / Rotten Tomatoes og:image / Steam capsule).
2. Download to a UNIQUE temp path: /tmp/${t.slug}_<nn>.<ext>. Verify HTTP 200 + image/* + >=3KB.
3. Normalize with Pillow via: uv run --project scripts/seed_pipeline python -c "..."  -> ${m.norm} to ${ROOT}/${folderRel}/<nn>-<externalId>.${m.ext}
4. VISION-VERIFY: Read the saved file. Confirm it is the correct item and clean. Reject: ${m.reject}. If wrong, try the next candidate and re-save.
5. Record provenance.

Every saved file MUST be <nn>-<externalId>.${m.ext} with the exact nn + externalId given. Return results for ALL ${ch.length} items (saved bool, image basename, dimensions, sourceUrl/sourcePage/sourceTitle/sourceWiki).`,
            {
              label: `source:${t.slug}#${ci + 1}`,
              phase: 'Source',
              schema: SOURCE_SCHEMA,
            }
          )
      )
    )
    const returned = chunkResults.flatMap((r) =>
      Array.isArray(r?.results) ? r.results : []
    )
    const workerErrors = chunks.flatMap((_, index) =>
      Array.isArray(chunkResults[index]?.results)
        ? []
        : [
            {
              chunk: index,
              error: chunkResults[index]?.workerError || 'missing chunk result',
            },
          ]
    )
    const expectedIds = new Set(items.map((item) => item.externalId))
    const unexpectedResults = returned.filter(
      (row) => !expectedIds.has(row?.externalId)
    )
    const results = items.map((item) =>
    {
      const matches = returned.filter(
        (row) => row?.externalId === item.externalId
      )
      if (matches.length !== 1 || typeof matches[0].saved !== 'boolean')
      {
        return {
          externalId: item.externalId,
          saved: false,
          note:
            matches.length > 1
              ? 'duplicate result'
              : 'missing or invalid result',
        }
      }
      return matches[0]
    })
    return {
      slug: t.slug,
      cat: t.cat,
      title: t.title,
      modality: t.modality,
      items,
      results,
      workerErrors,
      unexpectedResults,
      status:
        results.every((row) => row.saved) &&
        !workerErrors.length &&
        !unexpectedResults.length
          ? 'sourced-needs-qc'
          : 'incomplete',
      expected: items.length,
      succeeded: results.filter((row) => row.saved).length,
      failed: results.filter((row) => !row.saved).length,
    }
  }
)

const templates = TEMPLATES.map((template) =>
{
  const matches = (out || []).filter(
    (row) => row?.slug === template.slug && row?.cat === template.cat
  )
  return matches.length === 1
    ? matches[0]
    : {
        slug: template.slug,
        cat: template.cat,
        status: 'failed',
        items: null,
        results: [],
        error: 'missing or duplicate template result',
      }
})
return {
  templates,
  expectedTemplates: TEMPLATES.length,
  failedTemplates: templates.filter((row) => row.status !== 'sourced-needs-qc')
    .length,
}
