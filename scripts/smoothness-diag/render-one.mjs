#!/usr/bin/env node
// Phase 0.16 diagnostic: render ONE GLB through the EXACT render-rig scene
// (same page/main.ts — camera, lights, PMREM, tone mapping, material swap) and
// save the trimmed WebP. Candidates and the current master render through the
// identical pipeline, so any pixel difference is the GLB's alone.
//
//   node scripts/smoothness-diag/render-one.mjs --glb <path> --out <path.webp>
//        [--part gvx-pendant] [--finish light-gray] [--yaw 0] [--rotate-y 0]
//
// Never writes into public/renders and never touches any manifest.

import { createServer } from 'vite'
import puppeteer from 'puppeteer'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')
const PAGE_DIR = resolve(REPO_ROOT, 'scripts/render-rig/page')
const PUBLIC_DIR = resolve(REPO_ROOT, 'public')

function parseArgs(argv) {
  const args = { part: 'gvx-pendant', finish: 'light-gray', yaw: 0, rotateY: 0, pxpm: 0 }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--glb') args.glb = argv[++i]
    else if (argv[i] === '--out') args.out = argv[++i]
    else if (argv[i] === '--part') args.part = argv[++i]
    else if (argv[i] === '--finish') args.finish = argv[++i]
    else if (argv[i] === '--yaw') args.yaw = Number(argv[++i])
    else if (argv[i] === '--rotate-y') args.rotateY = Number(argv[++i])
    else if (argv[i] === '--pxpm') args.pxpm = Number(argv[++i])
  }
  if (!args.glb || !args.out) {
    console.error('usage: render-one.mjs --glb <path> --out <path.webp> [--part id] [--finish id] [--yaw deg] [--rotate-y deg] [--pxpm n]')
    process.exit(1)
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const server = await createServer({
    configFile: false,
    root: PAGE_DIR,
    publicDir: PUBLIC_DIR,
    logLevel: 'warn',
    server: { port: 0 },
  })
  await server.listen()
  const url = server.resolvedUrls.local[0]
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
  })
  try {
    const page = await browser.newPage()
    page.on('pageerror', (e) => console.error('[page error]', e.message))
    await page.goto(url, { waitUntil: 'networkidle0' })
    await page.waitForFunction('window.rigReady === true', { timeout: 60000 })
    const b64 = (await readFile(resolve(args.glb))).toString('base64')
    await page.evaluate(
      (pid, data, rot) => window.loadRealModel(pid, data, rot, [], []),
      args.part, b64, args.rotateY,
    )
    const result = await page.evaluate(
      (pid, fid, yaw, pxpm) => window.renderPart(pid, fid, yaw, pxpm || undefined),
      args.part, args.finish, args.yaw, args.pxpm,
    )
    if (result.empty || !result.dataUrl) throw new Error('empty render readback')
    await mkdir(dirname(resolve(args.out)), { recursive: true })
    const png = result.dataUrl.replace(/^data:image\/webp;base64,/, '')
    await writeFile(resolve(args.out), Buffer.from(png, 'base64'))
    console.log(`${args.out}: ${result.width}x${result.height} anchor=(${result.anchorX.toFixed(1)},${result.anchorY.toFixed(1)})`)
  } finally {
    await browser.close()
    await server.close()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
