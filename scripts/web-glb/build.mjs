#!/usr/bin/env node
// Web-GLB shell pipeline driver (Phase 0.15 Workstream B).
//
//   node scripts/web-glb/build.mjs [--parts id,id]
//
// For every real-CAD fixture/arm (or the requested subset): load the render
// rig's master GLB, drop every triangle invisible from ~230 directions
// (exterior-shell extraction — the IP step, see page/main.ts), decimate +
// quantize + meshopt-compress with gltfpack down to the web budget, re-measure
// the OUTPUT's visible fraction (the shell-only re-check the gate pins), and
// only then register it in public/renders/web-glb-manifest.json.
//
// FAIL-CLOSED: a part that misses any check (visible fraction, budget,
// material identity) is NOT registered — it ships its image fallback — and the
// script exits non-zero so the failure can't scroll past. A deliberate hold
// goes in scripts/web-glb/holds.json with a reason; the vitest gate
// (src/lib/webModels.test.ts) requires every real-CAD fixture/arm to be in
// exactly one of {registry, holds}.
//
// Determinism: fixed direction set + raster, no wall clock in any output.

import { createServer } from 'vite'
import puppeteer from 'puppeteer'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PAGE_DIR = resolve(__dirname, 'page')
const REPO_ROOT = resolve(__dirname, '../..')
const PUBLIC_DIR = resolve(REPO_ROOT, 'public')
const RIG_DIR = resolve(REPO_ROOT, 'scripts/render-rig')
const OUT_DIR = resolve(PUBLIC_DIR, 'renders/web-glb')
const REGISTRY_PATH = resolve(PUBLIC_DIR, 'renders/web-glb-manifest.json')
const REPORT_PATH = resolve(__dirname, 'shell-report.json')
const HOLDS_PATH = resolve(__dirname, 'holds.json')
const GLTFPACK = resolve(REPO_ROOT, 'node_modules/.bin/gltfpack')

// The hard web budget (0.12/0.15: ≤2–3 MB) and the soft target we pack toward.
const BUDGET_BYTES = 3 * 1024 * 1024
const TARGET_BYTES = 2 * 1024 * 1024
// Decimation entry point: cap shipped triangles before byte-driven refinement.
const TARGET_TRIS = 250_000
// Shell-only re-check floor on the OUTPUT (fraction of triangles visible).
const VIS_MIN = 0.95
// Lossiness floor: the shipped mesh must be a strict, non-manufacturable
// subset of the master's tessellation.
const MAX_SHIP_RATIO = 0.5

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/** Triangle count straight from a GLB's JSON chunk (accessor counts live
 *  there even when the buffers are meshopt-compressed). */
function glbTriCount(buf) {
  const jsonLen = buf.readUInt32LE(12)
  const j = JSON.parse(buf.subarray(20, 20 + jsonLen).toString())
  let tris = 0
  for (const mesh of j.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const acc = prim.indices !== undefined ? j.accessors[prim.indices] : j.accessors[prim.attributes.POSITION]
      tris += acc.count / 3
    }
  }
  return Math.round(tris)
}

function parseArgs(argv) {
  const args = { parts: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--parts') args.parts = argv[++i].split(',').map((s) => s.trim())
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const catalog = JSON.parse(await readFile(resolve(PUBLIC_DIR, 'catalog.json'), 'utf-8'))
  const rigRegistry = JSON.parse(await readFile(resolve(RIG_DIR, 'real-parts.json'), 'utf-8'))
  const holds = existsSync(HOLDS_PATH) ? JSON.parse(await readFile(HOLDS_PATH, 'utf-8')) : {}

  // The DEFAULT population stays 0.15's scope (fixtures + arms — the live-focus
  // slots the gate partitions over). Phase 0.17: an explicit --parts request may
  // shell ANY real-CAD part — base covers, poles, accessories — because the
  // geometry-service's shell-accurate IFC consumes the same registry. The gate
  // still hash-binds every registered entry; the partition requirement simply
  // doesn't extend to the extra slots.
  const population = catalog.parts.filter(
    (p) => p.realCad && !p.pseudoPart && (p.slot === 'fixture' || p.slot === 'arm'),
  )
  const shellable = catalog.parts.filter((p) => p.realCad && !p.pseudoPart)
  const wanted = args.parts
    ? shellable.filter((p) => args.parts.includes(p.id))
    : population.filter((p) => !(p.id in holds))
  if (args.parts) {
    for (const id of args.parts) {
      if (!wanted.some((p) => p.id === id)) {
        throw new Error(`--parts ${id}: not a real-CAD part in the catalog`)
      }
    }
  }

  await mkdir(OUT_DIR, { recursive: true })
  const tmp = join(tmpdir(), `web-glb-${process.pid}`)
  await mkdir(tmp, { recursive: true })

  const server = await createServer({
    configFile: false,
    root: PAGE_DIR,
    publicDir: PUBLIC_DIR,
    logLevel: 'warn',
    server: { port: 0 },
  })
  await server.listen()
  const url = server.resolvedUrls.local[0]
  console.log(`shell server: ${url}`)

  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 900_000,
    args: [
      '--no-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader',
    ],
  })

  // Same lesson as the render rig: a fresh page per part caps WebGL/base64
  // memory growth at one part's worth regardless of how many parts run.
  async function openPage() {
    const p = await browser.newPage()
    p.on('pageerror', (e) => console.error('[page error]', e.message))
    await p.goto(url, { waitUntil: 'networkidle0' })
    await p.waitForFunction('window.shellReady === true', { timeout: 60_000 })
    return p
  }

  // Existing registry/report are carried for parts NOT in this run, so a
  // --parts run can never truncate the shipped set (the manifest-baseline
  // lesson from 0.13, applied by construction here).
  const registry = existsSync(REGISTRY_PATH)
    ? JSON.parse(await readFile(REGISTRY_PATH, 'utf-8'))
    : { version: 2, models: {} }
  const report = existsSync(REPORT_PATH)
    ? JSON.parse(await readFile(REPORT_PATH, 'utf-8'))
    : { version: 1, rtSize: 1024, parts: {} }

  const failures = []

  for (const part of wanted) {
    const rigEntry = rigRegistry[part.id]
    const glbRel = typeof rigEntry === 'string' ? rigEntry : rigEntry?.glb
    const rotateYDeg = typeof rigEntry === 'object' ? (rigEntry.rotateY ?? 0) : 0
    const masterPath = glbRel ? resolve(RIG_DIR, glbRel) : null
    if (!masterPath || !existsSync(masterPath)) {
      failures.push(`${part.id}: no local master GLB (${glbRel ?? 'unmapped'})`)
      continue
    }

    console.log(`\n=== ${part.id} ===`)
    const master = await readFile(masterPath)
    const masterB64 = master.toString('base64')

    let page = await openPage()
    const t0 = Date.now()
    const cull = await page.evaluate(
      (b64) => window.cullGlb(b64),
      masterB64,
    )
    console.log(
      `  cull: ${cull.stats.totalTris} → ${cull.stats.keptTris} tris ` +
        `(${((cull.stats.keptTris / cull.stats.totalTris) * 100).toFixed(1)}% visible), ${((Date.now() - t0) / 1000).toFixed(0)}s`,
    )
    await page.close()

    const culledPath = join(tmp, `${part.id}.culled.glb`)
    await writeFile(culledPath, Buffer.from(cull.glbB64, 'base64'))

    // Decimate + quantize + meshopt-compress; refine si until under the byte
    // target AND the lossiness ceiling (shipped ≤ 0.5 × master tessellation —
    // decimation is a feature: the shipped mesh must be non-manufacturable).
    const outPath = join(tmp, `${part.id}.web.glb`)
    const triCeiling = Math.floor(cull.stats.totalTris * MAX_SHIP_RATIO * 0.95)
    let si = Math.min(1, TARGET_TRIS / cull.stats.keptTris, triCeiling / cull.stats.keptTris)
    let bytes = Infinity
    let shippedTris = Infinity
    for (let attempt = 0; attempt < 6; attempt++) {
      execFileSync(GLTFPACK, ['-i', culledPath, '-o', outPath, '-cc', '-si', si.toFixed(4)])
      const outStat = await readFile(outPath)
      bytes = outStat.length
      shippedTris = glbTriCount(outStat)
      console.log(`  gltfpack -si ${si.toFixed(4)} → ${(bytes / 1048576).toFixed(2)} MB, ${shippedTris} tris`)
      if (bytes <= TARGET_BYTES && shippedTris <= cull.stats.totalTris * MAX_SHIP_RATIO) break
      si *= Math.min(bytes > TARGET_BYTES ? TARGET_BYTES / bytes : 1, shippedTris > triCeiling ? triCeiling / shippedTris : 0.8)
    }
    if (bytes > BUDGET_BYTES) {
      failures.push(`${part.id}: ${(bytes / 1048576).toFixed(2)} MB > 3 MB budget after 6 passes`)
      continue
    }

    // Shell-only re-check on the OUTPUT — the number the gate pins.
    const outBuf = await readFile(outPath)
    page = await openPage()
    const check = await page.evaluate(
      (b64) => window.visibleFraction(b64),
      outBuf.toString('base64'),
    )
    await page.close()
    console.log(
      `  re-check: ${check.visibleTris}/${check.totalTris} visible (${(check.frac * 100).toFixed(2)}% by count, ${(check.areaFrac * 100).toFixed(2)}% by area), materials [${check.materials.join(', ')}]`,
    )

    const materialsIn = [...new Set(cull.stats.perMaterial.filter((m) => m.kept > 0).map((m) => m.material))].sort()
    const problems = []
    if (check.areaFrac < VIS_MIN)
      problems.push(`area-weighted visible fraction ${check.areaFrac.toFixed(3)} < ${VIS_MIN}`)
    if (check.totalTris > cull.stats.totalTris * MAX_SHIP_RATIO)
      problems.push(`shipped ${check.totalTris} tris > ${MAX_SHIP_RATIO} × master ${cull.stats.totalTris}`)
    if (materialsIn.join('|') !== check.materials.join('|'))
      problems.push(`material identity changed: [${materialsIn}] → [${check.materials}]`)
    if (!check.materials.some((m) => m === 'will-body' || m === ''))
      problems.push('no paintable (will-body/unnamed) material survived — tinting would be dead')
    if (problems.length) {
      failures.push(`${part.id}: ${problems.join('; ')}`)
      continue
    }

    const file = `renders/web-glb/${part.id}.glb`
    await writeFile(resolve(PUBLIC_DIR, file), outBuf)
    registry.models[part.id] = {
      file,
      bytes,
      ...(rotateYDeg ? { rotateYDeg } : {}),
      sha256: sha256(outBuf),
    }
    report.parts[part.id] = {
      sourceGlb: glbRel,
      sourceSha256: sha256(master),
      masterTris: cull.stats.totalTris,
      culledTris: cull.stats.keptTris,
      shippedTris: check.totalTris,
      visibleFrac: Number(check.frac.toFixed(4)),
      visibleAreaFrac: Number(check.areaFrac.toFixed(4)),
      simplifyRatio: Number(si.toFixed(4)),
      bytes,
      sha256: registry.models[part.id].sha256,
      materials: check.materials,
    }
  }

  // Registry hygiene: only current-SHELLABLE, non-held parts stay registered
  // (0.17: any real-CAD part may be shelled for the service's IFC, so hygiene
  // prunes against the wider set — a part that LOST realCad still deregisters).
  for (const id of Object.keys(registry.models)) {
    if (id in holds || !shellable.some((p) => p.id === id)) {
      delete registry.models[id]
      delete report.parts[id]
      console.log(`  deregistered ${id} (held or out of population)`)
    }
  }

  registry.version = 2
  registry.note =
    'GENERATED by scripts/web-glb/build.mjs — exterior-shell-only, decimated web GLBs. ' +
    'Gate: src/lib/webModels.test.ts (shell re-check, budget, material identity, holds partition). Do not hand-edit.'
  const sortedModels = {}
  for (const k of Object.keys(registry.models).sort()) sortedModels[k] = registry.models[k]
  registry.models = sortedModels
  const sortedParts = {}
  for (const k of Object.keys(report.parts).sort()) sortedParts[k] = report.parts[k]
  report.parts = sortedParts
  report.directions = 230
  report.rtSize = 1024

  await writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n')
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + '\n')
  await rm(tmp, { recursive: true, force: true })
  await browser.close()
  await server.close()

  console.log(`\nregistered: ${Object.keys(registry.models).length} parts`)
  if (failures.length) {
    console.error('\nFAIL-CLOSED (not registered):')
    for (const f of failures) console.error(`  ${f}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
