#!/usr/bin/env node
// Offline render-rig driver: boots the plain-three.js rig page under a vite dev
// server, drives it with Puppeteer (headless WebGL readback), and writes one
// trimmed transparent WebP per part per finish plus a manifest shard.
//
//   node scripts/render-rig/generate.mjs [--line <ProductLine>] [--parts id,id]
//
// No filter → every part → public/renders/manifest-all.json.

import { createServer } from 'vite'
import puppeteer from 'puppeteer'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PAGE_DIR = resolve(__dirname, 'page')
const REPO_ROOT = resolve(__dirname, '../..')
const PUBLIC_DIR = resolve(REPO_ROOT, 'public')
const CATALOG_PATH = resolve(PUBLIC_DIR, 'catalog.json')
const OUT_DIR = resolve(PUBLIC_DIR, 'renders')
const REALPARTS_PATH = resolve(__dirname, 'real-parts.json')

// ProductLine → manifest-shard slug (mirrors the app's brand slugs).
const BRAND_SLUGS = {
  WiLLstudio: 'studio',
  NAFCO: 'nafco',
  WiLLsport: 'sport',
  WiLLev: 'ev',
  WiLLcloud: 'cloud',
}

function parseArgs(argv) {
  const args = { line: null, parts: null, finishes: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--line') args.line = argv[++i]
    else if (argv[i] === '--parts') args.parts = argv[++i].split(',').map((s) => s.trim())
    // Phase 0.17: re-render ONE finish across parts (custom-ral base change).
    // ⚠️ Same shard hazard as --parts, one level deeper: the written shard
    // holds ONLY these finishes per angle — splice the baseline back at the
    // FINISH level, not the part level, before render-manifest.
    else if (argv[i] === '--finishes') args.finishes = argv[++i].split(',').map((s) => s.trim())
  }
  return args
}

// Phase 0.11 (Workstream E): the 45° orbit is retired. The canonical view set
// is 2 full-assembly views 180° apart plus per-component focus views (Tyler +
// Nick, 8/10) — and a focus view is a FRAMING over the composited layers, not
// a new asset, because the rig already alpha-crops each part at a fixed
// pxPerMeter (a "tighter framing" of one part re-renders the same image).
//
// So the render set is driven purely by what a radial cluster needs INSIDE one
// of the two views: (armAzimuth + armOrientation − viewYaw) mod 360 over
// armAzimuths ⊆ {0,90,180,270}, orientation ∈ {0,90,180,270} and viewYaw ∈
// {0,180} — exactly these four. az45/az135/az225/az315 are now unreachable.
//
// Keep in step with RENDER_ANGLE_KEYS in src/lib/composite.ts and COMPASS in
// src/lib/composite.coverage.test.ts. Every part still gets every angle:
// 0.10.5's no-exemptions rule (spec D9) is unchanged, only the set is smaller.
const COMPASS = [
  { key: 'hero', yaw: 0 },
  { key: 'az90', yaw: 90 },
  { key: 'az180', yaw: 180 },
  { key: 'az270', yaw: 270 },
]

/**
 * Max Y (metres) of a GLB, straight from its JSON chunk: glTF requires
 * min/max on POSITION accessors, so this needs no buffer decode and works on
 * meshopt-compressed files too.
 */
export function glbHeightM(buf) {
  const jsonLen = buf.readUInt32LE(12)
  const doc = JSON.parse(buf.subarray(20, 20 + jsonLen).toString())
  let maxY = -Infinity
  for (const acc of doc.accessors ?? []) {
    if (acc.type === 'VEC3' && Array.isArray(acc.max) && acc.max.length >= 2) {
      maxY = Math.max(maxY, acc.max[1])
    }
  }
  return Number.isFinite(maxY) ? maxY : null
}

export function ANGLES_FOR_SLOT(_slot) {
  return COMPASS
}

// Phase 0.16 (candidate c): per-slot supersampling. The composited assembly
// DOWNSCALES layers (a 20 ft pole fits an ~800 px viewer), but focus views
// UPSCALE the small parts — a fixture layer is ~185 px at 360 px/m and the
// fixture focus blows it up ~4×, which crushes detail whatever the shading
// does. So fixture-class layers render at a multiple of the rig density and
// their manifest entries are divided back to rig density: the compositor
// keeps drawing at the entry's size (mechanism proven by the skip path's
// ratio scaling below), the browser downscales the bigger file crisply in
// assembly view, and focus views get real pixels. Poles stay at 1× — a 20 ft
// pole at 4× exceeds MAX_CANVAS, and nothing upscales pole layers anyway.
export const SUPERSAMPLE = { fixture: 4, baseCover: 4, arm: 2 }

export function supersampleForSlot(slot) {
  return SUPERSAMPLE[slot] ?? 1
}

/**
 * Divide a render result's pixel fields back to rig density. The page reports
 * the density it ACTUALLY used (its cap guard may have halved the request),
 * so the factor comes from the result, never from what was asked for.
 */
export function entryAtRigDensity(result, rigPxPerMeter) {
  const f = (result.pxPerMeter ?? rigPxPerMeter) / rigPxPerMeter
  return {
    width: Math.round((result.width / f) * 100) / 100,
    height: Math.round((result.height / f) * 100) / 100,
    anchor: [
      Math.round((result.anchorX / f) * 100) / 100,
      Math.round((result.anchorY / f) * 100) / 100,
    ],
  }
}

/**
 * Phase 0.10.5 (spec D8): real CAD outranks placeholder geometry. If a part is
 * mapped in real-parts.json and its GLB is on this machine, rendering the
 * placeholder solid instead is a hard failure — not a silent fallback. That
 * silent fallback is exactly how 7 real-CAD parts ended up shipping stale
 * layers with 5 of 13 finishes.
 */
export function assertNoPlaceholderForRealPart(partId, { realLoaded, glbPresent }) {
  if (glbPresent && !realLoaded) {
    throw new Error(
      `${partId}: real geometry available but the render fell back to a placeholder. ` +
        `Real CAD outranks placeholders (spec D8) — fix the GLB load rather than shipping this.`,
    )
  }
}

/**
 * Phase 0.10.5 (spec D8a): placeholder children to add ON TOP of a part's real
 * geometry, because Engineering's export lacks them.
 *
 * Today this is only the pole's hand-hole cover: RSAA-4040-12.STEP is a plain
 * 6-face hollow tube with no hand hole, but the viewer uses that cover as its
 * 0° orientation reference (composite.ts) — rendering the bare tube would
 * delete the reference the ground compass and 8-view rotation home on.
 *
 * Returns [] for every part whose real geometry is already complete. The graft
 * is applied AFTER any axial scale, at native size and native Y: the access
 * door is a fixed-size feature at a fixed height, so it must not stretch with
 * pole length.
 */
export function placeholderGraftChildren(part) {
  if (part?.slot !== 'pole') return []
  const children = part.placeholder?.children ?? []
  return children.filter((c) => c.spec?.kind === 'box')
}

/**
 * Phase 0.17 (Tyler 8/20): a base cover renders with a POLE STUB through it.
 *
 * A cover is a hollow shell, so its own render showed its LIT INNER WALL
 * through the top opening — which reads exactly as "the pole looks translucent
 * through the top hole" (measured: a bright vertical band down the middle of
 * bc-cl2's own layer). In the real assembly the pole fills that opening.
 *
 * The image compositor cannot occlude one layer with another, so the fix has
 * to live in the ASSET: graft a stub of the pole's own diameter through the
 * cover, exactly as the pole's hand-hole cover is grafted. Same axis and same
 * OD as the pole layer behind it, so the two read as one continuous shaft.
 *
 * Diameter comes from the cover's own Pole Fit column (4R -> 4 in), never a
 * hardcoded number; height is the cover's own placeholder height, so the stub
 * fills the opening without protruding above it.
 */
export function baseCoverGraftChildren(part, heightM) {
  if (part?.slot !== 'baseCover') return []
  const fitCode = part.options
    ?.find((o) => o.key === 'pole-fit')
    ?.values?.[0]?.code
  const inches = fitCode ? Number.parseFloat(fitCode) : 4
  if (!Number.isFinite(inches) || inches <= 0) return []
  const radius = (inches * 0.0254) / 2
  // The REAL cover's height, measured from the GLB being rendered — the
  // placeholder's heightM is a different (shorter) number, and a stub built
  // from it stops BELOW the opening it is meant to fill (measured: bc-cl2 is
  // 0.566 m real vs 0.35 m placeholder, so the first attempt changed nothing).
  const height = heightM ?? part.placeholder?.heightM
  if (!height) return []
  return [
    {
      spec: { kind: 'pole', heightM: height, radiusTopM: radius, radiusBottomM: radius },
      position: [0, 0, 0],
    },
  ]
}

/**
 * Spec D8a, upgraded Phase 0.14 (Tyler 8/14): the pole's hand hole grafts
 * Cole's REAL HH-4R geometry when its GLB is on this machine — AND KEEPS the
 * cover-plate box on top of it. Measured first (0.14 crops): the real section
 * is a 6in wrap of the pole itself (x/z exactly the 4in OD, mount-center
 * origin) whose opening is FLUSH — rendered alone it vanishes at 360 px/m,
 * which would delete the visible 0° homing reference, exactly the risk the
 * 0.13 note predicted. A real installed hand hole carries its cover plate
 * screwed on proud of the opening, so frame + plate together are the truthful
 * picture: the real HH-4R at the box cover's vertical centre, with Tyler's
 * 4 mm sheet / 2 mm proud plate (the box) over the opening. Machines without
 * the accessory GLB fall back to the box graft alone.
 */
export const HH_GRAFT_GLB = 'real-assets/glb/willstudio-acc-hand-hole.glb'
// Phase 0.17 (Tyler 8/19): Cole's 4-RND-STANDARD-BASE.STEP is THE standard
// pole base detail. Unlike the hand hole (flush → its cover plate stays), the
// base is a fully visible 3.53in casting, so its GLB REPLACES the placeholder
// plate box outright; machines without the GLB keep the plate fallback.
export const BASE_GRAFT_GLB = 'real-assets/glb/willstudio-pole-base-standard.glb'
export function poleGraftPlan(
  part,
  {
    glbPresent = existsSync(resolve(__dirname, HH_GRAFT_GLB)),
    baseGlbPresent = existsSync(resolve(__dirname, BASE_GRAFT_GLB)),
  } = {},
) {
  let boxes = placeholderGraftChildren(part)
  if (boxes.length === 0) return { boxes: [], glbs: [] }
  const glbs = []
  if (baseGlbPresent && boxes.some((b) => b.name === 'base-plate')) {
    boxes = boxes.filter((b) => b.name !== 'base-plate')
    glbs.push({ glb: BASE_GRAFT_GLB, position: [0, 0, 0] })
  }
  // Phase 0.14: the hand-hole cover is the box proud of the shaft (position
  // x > 0); it STAYS over the real HH-4R frame (the opening is flush and
  // vanishes alone at 360 px/m — the cover is also the 0° homing reference).
  const cover = boxes.find((b) => b.position[0] > 0)
  if (glbPresent && cover) {
    const centerY = cover.position[1] + cover.spec.sizeM[1] / 2
    glbs.push({ glb: HH_GRAFT_GLB, position: [0, centerY, 0] })
  }
  return { boxes, glbs }
}

/**
 * A page that has gone away mid-render (CDP session/target closed, or the
 * "Attempted to use detached Frame" error a long-lived renderer throws once
 * it runs out of memory) surfaces as a distinct Puppeteer error class from an
 * ordinary render bug. Callers use this to recognize that class once and
 * recover/report a single time, instead of retrying every remaining
 * angle/finish combination and printing one identical FAIL line each.
 */
export function isPageDeadError(err) {
  return /detached Frame|Session closed|Target closed/i.test(String(err?.message ?? err))
}

async function main() {
  const { line, parts: partFilter, finishes: finishFilter } = parseArgs(process.argv.slice(2))

  const catalog = JSON.parse(await readFile(CATALOG_PATH, 'utf8'))
  const finishIds = catalog.finishes
    .map((f) => f.id)
    .filter((id) => !finishFilter || finishFilter.includes(id))

  let realParts = {}
  try {
    realParts = JSON.parse(await readFile(REALPARTS_PATH, 'utf8'))
  } catch { /* no real parts mapped */ }

  // The committed renders for real-parts.json entries came from real design
  // files (GLBs under real-assets/, gitignored — they live only on the machine
  // that owns them). When a GLB is unavailable we must never overwrite those
  // renders with placeholder geometry; the part is skipped and its existing
  // manifest entry carried over instead.
  let existingManifest = null
  try {
    existingManifest = JSON.parse(await readFile(resolve(OUT_DIR, 'manifest.json'), 'utf8'))
  } catch { /* first-ever run */ }

  let parts = catalog.parts.filter((p) => p.placeholder || realParts[p.id])
  if (line) parts = parts.filter((p) => p.line === line)
  if (partFilter) parts = parts.filter((p) => partFilter.includes(p.id))

  if (parts.length === 0) {
    console.error('No matching parts (check --line / --parts).')
    process.exit(1)
  }

  const slug = partFilter ? 'all' : line ? (BRAND_SLUGS[line] ?? line.toLowerCase()) : 'all'
  await mkdir(OUT_DIR, { recursive: true })

  const server = await createServer({
    configFile: false,
    root: PAGE_DIR,
    publicDir: PUBLIC_DIR,
    logLevel: 'warn',
    server: { port: 0 },
  })
  await server.listen()
  const url = server.resolvedUrls.local[0]
  console.log(`rig server: ${url}`)

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader',
    ],
  })

  let failures = 0
  const manifestParts = {}
  const skipped = []

  // A single long-lived page accumulates WebGL/GLTF memory across parts —
  // several real-CAD GLBs are 18-26MB base64'd into the page — and a full
  // ~117-part run eventually exhausts it, detaching the render frame partway
  // through. Opening a fresh page per part caps that growth at one part's
  // worth of geometry regardless of catalog size, so there's no
  // recycle-every-N magic number to keep tuned as parts are added.
  async function openRigPage() {
    const p = await browser.newPage()
    p.on('pageerror', (e) => console.error('[page error]', e.message))
    await p.goto(url, { waitUntil: 'networkidle0' })
    await p.waitForFunction('window.rigReady === true', { timeout: 60000 })
    return p
  }

  try {
    let page = await openRigPage()
    const rig = await page.evaluate(() => window.getRig())

    for (const part of parts) {
      // Fresh page per part (see openRigPage above) — cheap relative to a
      // part's ~104 renders, and needs no tuning as the catalog grows.
      await page.close().catch(() => {})
      page = await openRigPage()

      const realEntry = realParts[part.id]
      const realRel = typeof realEntry === 'string' ? realEntry : realEntry?.glb
      const rotateY = typeof realEntry === 'object' ? (realEntry.rotateY ?? 0) : 0
      let realLoaded = false
      let glbPresent = false
      if (realRel) {
        const glbPath = resolve(__dirname, realRel)
        glbPresent = existsSync(glbPath)
        if (glbPresent) {
          const b64 = (await readFile(glbPath)).toString('base64')
          // Spec D8a: the pole's real export has no hand hole, but the viewer
          // homes its 0° orientation on the hand-hole cover — so graft one
          // onto the real tube, at native size, after this GLB load: Cole's
          // real HH-4R section when its GLB is here (0.14), else the box.
          const graftPlan = poleGraftPlan(part)
          // Phase 0.17: a base cover also gets a graft — a pole stub through
          // its opening, so the hollow interior no longer reads as a
          // translucent pole (see baseCoverGraftChildren).
          graftPlan.boxes = [
            ...graftPlan.boxes,
            ...baseCoverGraftChildren(part, glbHeightM(await readFile(glbPath))),
          ]
          const glbGrafts = []
          for (const g of graftPlan.glbs) {
            const gb64 = (await readFile(resolve(__dirname, g.glb))).toString('base64')
            glbGrafts.push({ b64: gb64, position: g.position })
          }
          try {
            await page.evaluate(
              (pid, data, rot, grafts, glbs) => window.loadRealModel(pid, data, rot, grafts, glbs),
              part.id,
              b64,
              rotateY,
              graftPlan.boxes,
              glbGrafts,
            )
            console.log(`  loaded real geometry for ${part.id} (${(b64.length / 1e6).toFixed(1)}MB b64)`)
            realLoaded = true
          } catch (err) {
            console.error(`  FAILED to load real GLB for ${part.id}: ${err.message}`)
          }
        } else {
          console.error(`  MISSING GLB for ${part.id}: ${glbPath}`)
        }
      }
      // Phase 0.10.5 (spec D8): a GLB that IS on this machine but failed to
      // load is a hard failure, never a silent placeholder fallback.
      assertNoPlaceholderForRealPart(part.id, { realLoaded, glbPresent })
      if (realRel && !realLoaded) {
        // Real-render part whose design file isn't on this machine — skip it
        // so the committed real renders survive, and keep its manifest entry.
        // If the rig's pixel density changed since the entry was written, its
        // pixel dimensions/anchors scale by the ratio (the image FILE stays at
        // its old density; the compositor draws it at the entry's size).
        const prev = existingManifest?.parts?.[part.id]
        if (prev) {
          const ratio = rig.pxPerMeter / (existingManifest.rig?.pxPerMeter ?? rig.pxPerMeter)
          const scaled = JSON.parse(JSON.stringify(prev))
          if (ratio !== 1) {
            for (const angle of Object.values(scaled.angles)) {
              for (const a of Object.values(angle.finishes)) {
                a.width = Math.round(a.width * ratio * 100) / 100
                a.height = Math.round(a.height * ratio * 100) / 100
                a.anchor = [a.anchor[0] * ratio, a.anchor[1] * ratio]
              }
            }
          }
          manifestParts[part.id] = scaled
          skipped.push({
            partId: part.id,
            reason: `real design file unavailable — render skipped, manifest entry preserved${ratio !== 1 ? ` (scaled ×${ratio})` : ''}`,
          })
        } else {
          console.error(`  ${part.id}: real design file unavailable and no prior manifest entry — part left unrendered`)
          failures++
        }
        continue
      }
      const ANGLES = ANGLES_FOR_SLOT(part.slot)
      const renderPxPerMeter = rig.pxPerMeter * supersampleForSlot(part.slot)

      const angles = {}
      let totalRenders = 0
      angleLoop:
      for (const { key, yaw } of ANGLES) {
        const finishes = {}
        for (const finishId of finishIds) {
          let result
          try {
            result = await page.evaluate(
              (pid, fid, y, pxpm) => window.renderPart(pid, fid, y, pxpm),
              part.id,
              finishId,
              yaw,
              renderPxPerMeter,
            )
          } catch (err) {
            // A dead page (frame detached / session or target closed) kills
            // every remaining render on it, not just this one — report it
            // once and abandon the rest of this part rather than repeating
            // the same failure for every remaining angle/finish combination.
            if (isPageDeadError(err)) {
              console.error(`  PAGE DIED on ${part.id} (${err.message}) — abandoning remaining renders for this part; next part gets a fresh page`)
              failures++
              break angleLoop
            }
            console.error(`  FAIL ${part.id} / ${key} / ${finishId}: ${err.message}`)
            failures++
            continue
          }
          if (result.empty || !result.dataUrl) {
            console.error(`  EMPTY ${part.id} / ${key} / ${finishId} (blank readback)`)
            failures++
            continue
          }
          const fileName = `${part.id}--${key}--${finishId}.webp`
          const base64 = result.dataUrl.replace(/^data:image\/webp;base64,/, '')
          await writeFile(resolve(OUT_DIR, fileName), Buffer.from(base64, 'base64'))
          // Entries live at rig density whatever density the FILE was rendered
          // at — the compositor draws the file at the entry's size.
          finishes[finishId] = {
            file: `renders/${fileName}`,
            ...entryAtRigDensity(result, rig.pxPerMeter),
          }
          totalRenders++
        }
        const sortedFinishes = {}
        for (const k of Object.keys(finishes).sort()) sortedFinishes[k] = finishes[k]
        angles[key] = { finishes: sortedFinishes }
      }
      // `angles` holds whatever completed before a page-died abort, if any;
      // the next loop iteration opens a fresh page unconditionally.
      manifestParts[part.id] = { angles }
      const kind = realLoaded ? 'real' : part.placeholder ? part.placeholder.kind : 'placeholder'
      console.log(`  ${part.id}: ${totalRenders} renders across ${ANGLES.length} angle(s)  (${kind})`)
    }

    const sortedParts = {}
    for (const k of Object.keys(manifestParts).sort()) sortedParts[k] = manifestParts[k]

    const manifest = { rig, parts: sortedParts }
    const manifestPath = resolve(OUT_DIR, `manifest-${slug}.json`)
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    console.log(`wrote ${manifestPath}`)
  } finally {
    await browser.close()
    await server.close()
  }

  if (skipped.length) {
    console.error(`\n${skipped.length} part(s) SKIPPED — real design file unavailable:`)
    for (const s of skipped) console.error(`  ${s.partId}: ${s.reason}`)
    console.error('On a machine that owns the design files, a skip means something is wrong.')
  }

  if (failures > 0) {
    console.error(`\n${failures} render(s) failed.`)
    process.exit(1)
  }
  console.log('\nrender rig complete.')
}

// Only run when invoked as the CLI (`node generate.mjs` / `npm run render-rig`),
// not when imported by tests — importing this module must not launch Puppeteer.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
