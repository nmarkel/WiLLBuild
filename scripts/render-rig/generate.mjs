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

  let parts = catalog.parts.filter((p) => p.placeholder)
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
      const realRel = realParts[part.id]
      if (realRel) {
        const glbPath = resolve(__dirname, realRel)
        if (existsSync(glbPath)) {
          const b64 = (await readFile(glbPath)).toString('base64')
          await page.evaluate((pid, data) => window.loadRealModel(pid, data), part.id, b64)
          console.log(`  loaded real geometry for ${part.id} (${(b64.length/1e6).toFixed(1)}MB b64)`)
        } else {
          console.error(`  MISSING GLB for ${part.id}: ${glbPath} — using placeholder`)
        }
      }
      const finishes = {}
      for (const finishId of finishIds) {
        let result
        try {
          result = await page.evaluate(
            (pid, fid) => window.renderPart(pid, fid),
            part.id,
            finishId,
          )
        } catch (err) {
          console.error(`  FAIL ${part.id} / ${finishId}: ${err.message}`)
          failures++
          continue
        }
        if (result.empty || !result.dataUrl) {
          console.error(`  EMPTY ${part.id} / ${finishId} (blank readback)`)
          failures++
          continue
        }
        const fileName = `${part.id}--hero--${finishId}.webp`
        const base64 = result.dataUrl.replace(/^data:image\/webp;base64,/, '')
        await writeFile(resolve(OUT_DIR, fileName), Buffer.from(base64, 'base64'))
        finishes[finishId] = {
          file: `renders/${fileName}`,
          width: result.width,
          height: result.height,
          anchor: [Math.round(result.anchorX * 100) / 100, Math.round(result.anchorY * 100) / 100],
        }
      }
      const sortedFinishes = {}
      for (const k of Object.keys(finishes).sort()) sortedFinishes[k] = finishes[k]
      manifestParts[part.id] = { angles: { hero: { finishes: sortedFinishes } } }
      const n = Object.keys(finishes).length
      const kind = realParts[part.id] ? 'real' : part.placeholder.kind
      console.log(`  ${part.id}: ${n}/${finishIds.length} finishes  (${kind})`)
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
