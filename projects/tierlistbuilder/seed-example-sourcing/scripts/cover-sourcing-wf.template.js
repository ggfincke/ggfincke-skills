// projects/tierlistbuilder/seed-example-sourcing/scripts/cover-sourcing-wf.template.js
// legacy Workflow cover sourcing with read-only scoring and explicit failed results

// then read-only vision-scores them. adapt COVERS + RUN_ID, copy to the scratchpad, run via {scriptPath}.
// requires compatible Workflow globals; source is ADD-only, verification is read-only.
// models inherit host defaults unless an approved host binding is supplied.
// output is RANKED CANDIDATES for a human to eyeball (contact sheet + simulate-cover-surfaces.py); it does NOT install.
// covers are OPTIONAL: only franchise rosters + music discographies where one evocative textless image fits.

export const meta = {
  name: 'seed-cover-sourcing',
  description:
    'Source + read-only verify _cover.jpg hero-banner candidates for TierListBuilder seed templates',
  phases: [
    {
      title: 'Source',
      detail:
        'fetch textless wide hero candidates per template into unique scratch paths',
    },
    {
      title: 'Verify',
      detail: 'read-only vision scoring; human makes the final call',
    },
  ],
}

const ROOT = '/Users/ggfincke/Projects/Applications/tierlistbuilder'
const UA = 'tierlistbuilder-seed/1.0'
// edit the run id for each pass; reuse it only when resuming that pass.
// candidates stay in SCRATCH/<cat>/<slug>/<RUN_ID>/, never in examples/.
const RUN_ID = '<RUN_ID>'
const SCRATCH = `${ROOT}/dev-docs/seed-examples/candidates`

// EDIT THIS: one entry per template that should get a cover.
// kind: 'franchise' (key art / textless ensemble poster / box-art hero / iconic vista)
//     | 'artist'    (band/artist press photo; a compilation grid only if unusually strong)
const COVERS = [
  {
    slug: 'example-slug',
    cat: 'gaming',
    id: 'gaming:example-slug',
    kind: 'franchise',
    title: 'Example Roster',
    hint: 'What the set IS + traps: wrong entry/era, must be textless, must not reuse an image another template owns.',
  },
]

// three blind search angles per template; each source agent works one angle so candidates stay diverse
const ANGLES = [
  {
    key: 'official',
    how: 'official key art / promo poster / textless theatrical one-sheet / game box-art hero / studio press art',
  },
  {
    key: 'editorial',
    how: 'editorial or press photography: cast/band group shot, tour or live photo, era-defining portrait',
  },
  {
    key: 'archive',
    how: 'high-res archive, fan-wiki, lobby card, or production still that is wide, textless, and on-brand',
  },
]

const SOURCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['saved'],
  properties: {
    saved: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'width', 'height'],
        properties: {
          file: {
            type: 'string',
            description: 'basename saved under SCRATCH/<cat>/<slug>/<RUN_ID>/',
          },
          width: { type: 'number' },
          height: { type: 'number' },
          sourceUrl: { type: 'string' },
          sourcePage: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'file',
    'usable',
    'entityCorrect',
    'textFree',
    'resolutionOk',
    'composition',
    'depicts',
    'vibeFit',
    'score',
    'reason',
  ],
  properties: {
    file: { type: 'string' },
    usable: { type: 'boolean' },
    entityCorrect: { type: 'boolean' },
    textFree: {
      type: 'boolean',
      description:
        'false if ANY baked-in title/logo/credits/watermark/site stamp',
    },
    resolutionOk: { type: 'boolean' },
    composition: {
      type: 'string',
      enum: ['highlight', 'ensemble', 'compilation', 'other'],
    },
    depicts: {
      type: 'string',
      description: 'literally what is in the frame, as YOU see it',
    },
    vibeFit: { type: 'string' },
    score: {
      type: 'number',
      description:
        '0-10 as a wide hero banner; portrait aspect + baked-in text cost points',
    },
    reason: { type: 'string' },
  },
}

const guidance = (m) =>
  m.kind === 'artist'
    ? `DISCOGRAPHY: the cover should evoke the ARTIST. Best is professional photography of the artist/band (press shot, live/tour photo, era-defining portrait). A single album cover alone is weak; a compilation grid of album art is acceptable only if unusually strong, but a highlight photo is preferred. Wrong-lineup traps matter (e.g. The Strokes != The Voidz).`
    : `FRANCHISE: best is official key art, textless poster art, box-art hero, or an iconic ensemble/vista. A single striking on-brand image is as valid as ensemble art. It MUST NOT reuse an image another template already owns. A highlight image beats a compilation grid.`

const sourcePrompt = (
  m,
  angle,
  folder
) => `Source WIDE cover-banner candidates for a TierListBuilder tier-list. Save each clean candidate; do NOT install anything into examples/.

TEMPLATE: "${m.title}" (${m.id})
THE SET: ${m.hint}
SEARCH ANGLE (stick to this angle): ${angle.how}
${guidance(m)}

RULES:
- User-Agent for ALL downloads: '${UA}'. Record source provenance, known usage constraints, and intended use; local preview does not grant publication rights. Mark unknown rights and retain alternatives. Do not disclose personal contact details or remove credits/watermarks. Follow the host image-editing contract and preserve pre-existing originals.
- Prefer landscape/wide sources; textless. Any baked-in title/logo/credits/watermark makes it weak - avoid.
- Download to a unique temp path, normalize with Pillow (open, convert RGB, if long side > 3840 downscale to 3840 LANCZOS, save JPEG quality 92) via: uv run --project scripts/seed_pipeline python -c "..."
- Save 2-3 candidates into this EXACT folder (create it), ADD-ONLY - never delete or overwrite an existing file there: ${folder}
  filename: ${m.slug}__${angle.key}<n>.jpg  (n = 1,2,3)
- VISION-VERIFY each: Read the saved file, confirm it is really ${m.title} and textless/wide before returning it.

Return the saved candidates (basename, dimensions, sourceUrl/sourcePage).`

const verifyPrompt = (
  f,
  m
) => `Verify ONE cover-image candidate. YOU ARE READ-ONLY: do not create, modify, move, or delete any file. Report only.

TEMPLATE: "${m.title}" (${m.id})
THE SET: ${m.hint}
CANDIDATE: ${f.file}  (${f.width}x${f.height})

Read that path and LOOK at the image. Judge it as a wide hero banner behind the list title.
${guidance(m)}

Be skeptical - wrong-entity traps are the #1 failure. Describe what you ACTUALLY see in "depicts" before judging.
- textFree: any baked-in title text, logo, credits, watermark, or site stamp -> false.
- resolutionOk: >= 1600 long side, not visibly upscaled/blurry.
- score: 0-10 as a cover; portrait aspect and baked-in text cost points.
- usable: true only if entityCorrect AND resolutionOk AND it is real (not composited) professional imagery.
If you cannot open the image, set usable=false and say so. Never guess from the filename.`

if (
  typeof pipeline !== 'function' ||
  typeof parallel !== 'function' ||
  typeof agent !== 'function' ||
  typeof log !== 'function'
)
{
  throw new Error(
    'Legacy Workflow globals unavailable; use the native-subagent or sequential contract in SKILL.md'
  )
}
if (RUN_ID === '<RUN_ID>')
  throw new Error('Set a fresh run-owned candidate directory before sourcing')

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
  COVERS,
  async (m) =>
  {
    const folder = `${SCRATCH}/${m.cat}/${m.slug}/${RUN_ID}`
    const perAngle = await parallel(
      ANGLES.map(
        (a) => () =>
          callAgent(sourcePrompt(m, a, folder), {
            label: `source:${m.slug}:${a.key}`,
            phase: 'Source',
            // write-capable on purpose
            schema: SOURCE_SCHEMA,
          })
      )
    )
    const sourceFailures = ANGLES.flatMap((angle, index) =>
      Array.isArray(perAngle[index]?.saved)
        ? []
        : [
            {
              angle: angle.key,
              error: perAngle[index]?.workerError || 'missing source result',
            },
          ]
    )
    const files = perAngle.flatMap((result) =>
      Array.isArray(result?.saved)
        ? result.saved.map((saved) => ({
            ...saved,
            file: `${folder}/${saved.file}`,
          }))
        : []
    )
    return { ...m, folder, files, sourceFailures }
  },
  async (t) =>
  {
    if (!t || !t.files.length)
      return {
        slug: t?.slug,
        id: t?.id,
        sourceFailures: t?.sourceFailures || [],
        verdicts: [],
        error: 'no candidates saved',
      }
    const verdicts = await parallel(
      t.files.map(
        (f) => () =>
          callAgent(verifyPrompt(f, t), {
            label: `verify:${t.slug}`,
            phase: 'Verify',
            agentType: 'Explore',
            schema: VERDICT_SCHEMA,
          })
      )
    )
    return {
      slug: t.slug,
      id: t.id,
      kind: t.kind,
      folder: t.folder,
      sourceFailures: t.sourceFailures,
      expectedCandidates: t.files.length,
      verdicts: t.files
        .map((file, index) =>
        {
          const verdict = verdicts[index]
          return verdict?.file === file.file &&
            typeof verdict.usable === 'boolean' &&
            Number.isFinite(verdict.score)
            ? verdict
            : {
                file: file.file,
                usable: false,
                score: 0,
                reason:
                  verdict?.workerError ||
                  'missing, mismatched, or invalid verification result',
              }
        })
        .sort((a, b) => b.score - a.score),
    }
  }
)

const clean = COVERS.map((cover) =>
{
  const matches = (out || []).filter((row) => row?.id === cover.id)
  return matches.length === 1
    ? matches[0]
    : {
        slug: cover.slug,
        id: cover.id,
        verdicts: [],
        error: 'missing or duplicate template result',
      }
})
const templatesNeedingResource = clean
  .filter((r) => !r.verdicts.some((v) => v.usable))
  .map((r) => r.slug)
log(
  `accounted for ${clean.length}/${COVERS.length} templates; ${templatesNeedingResource.length} with nothing usable${templatesNeedingResource.length ? ': ' + templatesNeedingResource.join(', ') : ''}`
)
log(
  'NEXT (human): contact-sheet the folders, run simulate-cover-surfaces.py to pick coverZoom, then install the winner as examples/<cat>/<slug>/_cover.jpg'
)
return {
  templates: clean,
  expectedTemplates: COVERS.length,
  templatesNeedingResource,
}
