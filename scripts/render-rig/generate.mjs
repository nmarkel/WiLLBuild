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

  let parts = catalog.parts.filter((p) => p.placeholder || realParts[p.id])
  if (line) parts = parts.filter((p) => p.line === line)
  if (partFilter) parts = parts.filter((p) => partFilter.includes(p.id))

  if (parts.length === 0) {
    console.error('No matching parts (check --line / --parts).')
    process.exit(1)
  }

  // A full run (no --parts) REPLACES its shard.  A partial re-render splices the
  // rendered parts into the shard each part already belongs to — writing them to
  // a separate `manifest-all.json` used to lose the race in merge-manifests.mjs,
  // which merges shards alphabetically, so `all` was overwritten by `studio`.
  const slugFor = (part) => BRAND_SLUGS[part.line] ?? part.line.toLowerCase()
  const fullRunSlug = line ? (BRAND_SLUGS[line] ?? line.toLowerCase()) : 'all'
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
            console.error(`  FAILED to load real GLB for ${part.id}: ${err.message} — using placeholder`)
          }
        } else {
          console.error(`  MISSING GLB for ${part.id}: ${glbPath} — using placeholder`)
        }
      }
      // Phase 0.8 (A/B) + 0.10 (A): arms and fixtures are radial attachments, so
      // they get one render per discrete mount azimuth (0°=hero + the
      // twin/triple/quad angles). Everything else (poles, base covers,
      // standalone) is single-view. Arms mount on a 90° DRILLED TENON per the
      // ordering matrix — triple is 3@90, not 3@120 — so the union of angles
      // across single/twin/triple/quad is bounded at 4 total (0/90/180/270).
      // Keep in sync with MULTI_ARM_AZIMUTHS + armAzimuths on the app side.
      const isRadial = part.slot === 'arm' || part.slot === 'fixture' || part.slot === 'banner'
      const ANGLES = isRadial
        ? [
            { key: 'hero', yaw: 0 },
            { key: 'az90', yaw: 90 },
            { key: 'az180', yaw: 180 },
            { key: 'az270', yaw: 270 },
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

    // Group the freshly rendered parts by the shard they belong to.
    const byShard = new Map()
    for (const part of parts) {
      const entry = manifestParts[part.id]
      if (!entry) continue
      const shard = partFilter ? slugFor(part) : fullRunSlug
      if (!byShard.has(shard)) byShard.set(shard, {})
      byShard.get(shard)[part.id] = entry
    }

    for (const [shard, entries] of byShard) {
      const manifestPath = resolve(OUT_DIR, `manifest-${shard}.json`)
      let existing = {}
      if (partFilter) {
        // Partial re-render: keep every other part already in this shard.
        try {
          existing = JSON.parse(await readFile(manifestPath, 'utf8')).parts ?? {}
        } catch { /* first render for this shard */ }
      }
      const merged = { ...existing, ...entries }
      const sortedParts = {}
      for (const k of Object.keys(merged).sort()) sortedParts[k] = merged[k]
      await writeFile(manifestPath, JSON.stringify({ rig, parts: sortedParts }, null, 2) + '\n')
      console.log(
        `wrote ${manifestPath} (${Object.keys(entries).length} rendered, ${Object.keys(sortedParts).length} total)`,
      )
    }
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
