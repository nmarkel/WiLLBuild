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
  const args = { line: null, parts: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--line') args.line = argv[++i]
    else if (argv[i] === '--parts') args.parts = argv[++i].split(',').map((s) => s.trim())
  }
  return args
}

// Phase 0.10.5 (spec D9): every part gets the full 45° compass, standalone
// products included. Previously only arm/fixture/banner/pole were radial,
// which left base covers and standalone products at a single hero angle — and
// left 4 real-CAD parts on the retired az120/az240 set, which silently snapped
// the whole assembly rotation to 90° steps via composite.ts supports45.
const COMPASS = [
  { key: 'hero', yaw: 0 },
  { key: 'az45', yaw: 45 },
  { key: 'az90', yaw: 90 },
  { key: 'az135', yaw: 135 },
  { key: 'az180', yaw: 180 },
  { key: 'az225', yaw: 225 },
  { key: 'az270', yaw: 270 },
  { key: 'az315', yaw: 315 },
]

export function ANGLES_FOR_SLOT(_slot) {
  return COMPASS
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
  const { line, parts: partFilter } = parseArgs(process.argv.slice(2))

  const catalog = JSON.parse(await readFile(CATALOG_PATH, 'utf8'))
  const finishIds = catalog.finishes.map((f) => f.id)

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
          // homes its 0° orientation on the placeholder's hand-hole cover — so
          // graft it onto the real tube, at native size, after this GLB load.
          const graftChildren = placeholderGraftChildren(part)
          try {
            await page.evaluate(
              (pid, data, rot, grafts) => window.loadRealModel(pid, data, rot, grafts),
              part.id,
              b64,
              rotateY,
              graftChildren,
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

      const angles = {}
      let totalRenders = 0
      angleLoop:
      for (const { key, yaw } of ANGLES) {
        const finishes = {}
        for (const finishId of finishIds) {
          let result
          try {
            result = await page.evaluate(
              (pid, fid, y) => window.renderPart(pid, fid, y),
              part.id,
              finishId,
              yaw,
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
          finishes[finishId] = {
            file: `renders/${fileName}`,
            width: result.width,
            height: result.height,
            anchor: [Math.round(result.anchorX * 100) / 100, Math.round(result.anchorY * 100) / 100],
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
