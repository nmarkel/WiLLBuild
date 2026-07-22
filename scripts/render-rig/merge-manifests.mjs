#!/usr/bin/env node
// Merge every manifest-<slug>.json shard in public/renders/ into a single
// public/renders/manifest.json (the runtime app fetches only this file).
// Asserts all shards share an identical `rig` block, and sorts part + finish
// keys for byte-deterministic output.

import { readFile, writeFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../../public/renders')

async function main() {
  const entries = await readdir(OUT_DIR)
  const shards = entries
    .filter((f) => /^manifest-.+\.json$/.test(f) && f !== 'manifest.json')
    .sort()

  if (shards.length === 0) {
    console.error('No manifest-*.json shards in public/renders/.')
    process.exit(1)
  }

  let rig = null
  const parts = {}

  for (const shard of shards) {
    const m = JSON.parse(await readFile(resolve(OUT_DIR, shard), 'utf8'))
    if (!rig) {
      rig = m.rig
    } else if (JSON.stringify(rig) !== JSON.stringify(m.rig)) {
      console.error(`rig block in ${shard} differs from earlier shards — refusing to merge.`)
      process.exit(1)
    }
    for (const [partId, entry] of Object.entries(m.parts)) parts[partId] = entry
  }

  const sortedParts = {}
  for (const partId of Object.keys(parts).sort()) {
    const entry = parts[partId]
    const angles = {}
    for (const angle of Object.keys(entry.angles).sort()) {
      const finishes = entry.angles[angle].finishes
      const sortedFinishes = {}
      for (const fid of Object.keys(finishes).sort()) sortedFinishes[fid] = finishes[fid]
      angles[angle] = { finishes: sortedFinishes }
    }
    sortedParts[partId] = { angles }
  }

  const manifest = { rig, parts: sortedParts }
  const outPath = resolve(OUT_DIR, 'manifest.json')
  await writeFile(outPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log(
    `merged ${shards.length} shard(s) → ${outPath}  (${Object.keys(sortedParts).length} parts)`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
