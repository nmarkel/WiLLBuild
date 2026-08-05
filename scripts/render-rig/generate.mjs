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
import { fileURLToPath } from 'node:url'
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

  try {
    const page = await browser.newPage()
    page.on('pageerror', (e) => console.error('[page error]', e.message))
    await page.goto(url, { waitUntil: 'networkidle0' })
    await page.waitForFunction('window.rigReady === true', { timeout: 60000 })

    const rig = await page.evaluate(() => window.getRig())

    for (const part of parts) {
      const realEntry = realParts[part.id]
      const realRel = typeof realEntry === 'string' ? realEntry : realEntry?.glb
      const rotateY = typeof realEntry === 'object' ? (realEntry.rotateY ?? 0) : 0
      let realLoaded = false
      if (realRel) {
        const glbPath = resolve(__dirname, realRel)
        if (existsSync(glbPath)) {
          const b64 = (await readFile(glbPath)).toString('base64')
          try {
            await page.evaluate(
              (pid, data, rot) => window.loadRealModel(pid, data, rot),
              part.id,
              b64,
              rotateY,
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
          console.log(`  ${part.id}: real design file unavailable — render skipped, manifest entry preserved${ratio !== 1 ? ` (scaled ×${ratio})` : ''}`)
        } else {
          console.error(`  ${part.id}: real design file unavailable and no prior manifest entry — part left unrendered`)
          failures++
        }
        continue
      }
      // Phase 0.8 (A/B): arms and fixtures are radial attachments, so they get
      // one render per discrete mount azimuth (0°=hero + the twin/triple/quad
      // angles). Everything else (poles, base covers, standalone) is single-view.
      // The union of angles across single/twin/triple/quad is bounded — 6 total.
      // Poles joined the radial set in Phase 1.0: the baked hand-hole cover
      // breaks their rotational symmetry, so the view spin needs their compass.
      const isRadial =
        part.slot === 'arm' || part.slot === 'fixture' || part.slot === 'banner' || part.slot === 'pole'
      // Phase 1.0: full 45° compass — arm arrangements/orientations are
      // 90°-stepped, and the viewer's 8-angle assembly spin shifts them by
      // 45°, so every multiple of 45° must exist. (az120/az240 died with the
      // old 3@120 triple layout.)
      const ANGLES = isRadial
        ? [
            { key: 'hero', yaw: 0 },
            { key: 'az45', yaw: 45 },
            { key: 'az90', yaw: 90 },
            { key: 'az135', yaw: 135 },
            { key: 'az180', yaw: 180 },
            { key: 'az225', yaw: 225 },
            { key: 'az270', yaw: 270 },
            { key: 'az315', yaw: 315 },
          ]
        : [{ key: 'hero', yaw: 0 }]

      const angles = {}
      let totalRenders = 0
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

  if (failures > 0) {
    console.error(`\n${failures} render(s) failed.`)
    process.exit(1)
  }
  console.log('\nrender rig complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
