import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Catalog, PoleConfig } from '../types'
import { repairConfig } from './compat'
import { resolveAssemblyLayout, SLOT_Z, type RenderManifest } from './composite'

// Phase 0.8 (A5): the representative end-to-end proof, against the REAL catalog
// and the REAL merged render manifest — twin/triple/quad GVX on the AR
// suspension arm must composite with zero missing renders and the right number
// of arm + fixture layers, at the shipped camera angle. (Originally proved on
// the SH1 shepherd's hook; the official config list made SH1/PA1/PM1
// single-only, so the AR suspension arm — AR1–AR4 — carries it now.)
const catalog: Catalog = JSON.parse(readFileSync('public/catalog.json', 'utf-8'))
const manifest: RenderManifest = JSON.parse(readFileSync('public/renders/manifest.json', 'utf-8'))

const base: PoleConfig = repairConfig(catalog, {
  configId: 'multiarm-e2e',
  brand: 'WiLLstudio',
  pole: 'alum-pole-20',
  baseCover: 'bc-cl2-medium-clamshell',
  arm: 'willstudio-suspension-arm-pole-top-brackets',
  fixture: 'gvx-pendant',
  finish: 'matte-black',
  rev: 1,
  armCount: 1,
})

describe('multi-arm GVX on AR suspension arm — real assets', () => {
  it('base config is the intended twin-capable GVX + AR suspension build', () => {
    // Guards against a catalog change silently repairing the parts away.
    expect(base.arm).toBe('willstudio-suspension-arm-pole-top-brackets')
    expect(base.fixture).toBe('gvx-pendant')
    expect(base.pole).toBe('alum-pole-20')
  })

  it.each([
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
  ])('armCount=%i composites with 0 missing and %i arm layers', (count, expectedArms) => {
    const config = repairConfig(catalog, { ...base, armCount: count })
    expect(config.armCount).toBe(count) // catalog allows it (A2)
    const layout = resolveAssemblyLayout(catalog, manifest, config)
    expect(layout.missing).toEqual([])
    const armLayers = layout.layers.filter((l) => l.partId.startsWith('willstudio-suspension-arm-pole-top-brackets'))
    const fixLayers = layout.layers.filter((l) => l.partId.startsWith('gvx-pendant'))
    expect(armLayers.length).toBe(expectedArms)
    expect(fixLayers.length).toBe(expectedArms)
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.height).toBeGreaterThan(0)
  })

  it('twin draws one arm behind the pole and one in front (occlusion)', () => {
    const twin = repairConfig(catalog, { ...base, armCount: 2 })
    const layout = resolveAssemblyLayout(catalog, manifest, twin)
    const poleZ = layout.layers.find((l) => l.partId === 'alum-pole-20')!.z
    expect(poleZ).toBe(SLOT_Z.pole)
    const armZs = layout.layers
      .filter((l) => l.partId.startsWith('willstudio-suspension-arm-pole-top-brackets'))
      .map((l) => l.z)
    expect(armZs.some((z) => z < poleZ)).toBe(true) // one behind
    expect(armZs.some((z) => z > poleZ)).toBe(true) // one in front
  })

  it('twin resolves distinct per-azimuth render files (not the same image reused)', () => {
    const twin = repairConfig(catalog, { ...base, armCount: 2 })
    const layout = resolveAssemblyLayout(catalog, manifest, twin)
    const armFiles = layout.layers
      .filter((l) => l.partId.startsWith('willstudio-suspension-arm-pole-top-brackets'))
      .map((l) => l.asset.file)
    expect(new Set(armFiles).size).toBe(2)
  })
})

// Phase 0.8 (C, DoD #9): a banner-arm config renders + composites end-to-end.
// Legacy config.banner path — WiLLstudio moved to BA24/BA30 accessory
// placements in 0.10.5, so this proof runs on NAFCO (still Banner Arm box).
describe('banner arm — real assets (legacy path, NAFCO)', () => {
  const bannerPart = catalog.parts.find((p) => p.slot === 'banner' && p.line === 'NAFCO')
  const nafcoBase: PoleConfig = repairConfig(catalog, {
    configId: 'banner-e2e',
    brand: 'NAFCO',
    pole: '',
    baseCover: '',
    arm: '',
    fixture: 'nafco-chx-cobrahead',
    finish: 'matte-black',
    rev: 1,
    armCount: 1,
  })

  it('the banner-arm category exists in the catalog', () => {
    expect(bannerPart).toBeDefined()
    expect(bannerPart!.arrangements).toBeDefined()
  })

  it.each([
    [1, 1],
    [2, 2],
    [4, 4],
  ])('an opposite/multi-side banner (count=%i) composites with 0 missing and %i banner layers', (count, expected) => {
    const config = repairConfig(catalog, {
      ...nafcoBase,
      banner: { armId: bannerPart!.id, count, heightFt: 8 },
    })
    expect(config.banner?.count).toBe(count)
    const layout = resolveAssemblyLayout(catalog, manifest, config)
    expect(layout.missing).toEqual([])
    const bannerLayers = layout.layers.filter((l) => l.partId.startsWith(bannerPart!.id))
    expect(bannerLayers.length).toBe(expected)
  })

  it('places the banner at the configured mid-shaft height (below the arm)', () => {
    const config = repairConfig(catalog, {
      ...nafcoBase,
      banner: { armId: bannerPart!.id, count: 1, heightFt: 8 },
    })
    const layout = resolveAssemblyLayout(catalog, manifest, config)
    const banner = layout.layers.find((l) => l.partId.startsWith(bannerPart!.id))!
    const arm = layout.layers.find((l) => l.partId.startsWith(nafcoBase.arm))!
    // Banner at 8 ft sits below the arm at the 20 ft pole top (larger top = lower on screen).
    expect(banner.top).toBeGreaterThan(arm.top)
  })
})

// Phase 0.10.5: orientation rotates the arrangement — every oriented layout must
// resolve real per-azimuth renders with nothing missing.
describe('arm orientation — real assets', () => {
  it.each([90, 180, 270])('single arm at %i° uses that azimuth render', (deg) => {
    const cfg = repairConfig(catalog, { ...base, armCount: 1, armOrientation: deg })
    const layout = resolveAssemblyLayout(catalog, manifest, cfg)
    expect(layout.missing).toEqual([])
    const armLayer = layout.layers.find((l) => l.partId.startsWith('willstudio-suspension-arm-pole-top-brackets'))!
    expect(armLayer.asset.file).toContain(`az${deg}`)
  })

  it('twin at 90° resolves the az90/az270 pair', () => {
    const cfg = repairConfig(catalog, { ...base, armCount: 2, armOrientation: 90 })
    const layout = resolveAssemblyLayout(catalog, manifest, cfg)
    expect(layout.missing).toEqual([])
    const files = layout.layers
      .filter((l) => l.partId.startsWith('willstudio-suspension-arm-pole-top-brackets'))
      .map((l) => l.asset.file)
      .sort()
    expect(files[0]).toContain('az270')
    expect(files[1]).toContain('az90')
  })

  it('triple (3@90) at 180° wraps around cleanly', () => {
    const cfg = repairConfig(catalog, { ...base, armCount: 3, armOrientation: 180 })
    const layout = resolveAssemblyLayout(catalog, manifest, cfg)
    expect(layout.missing).toEqual([])
    expect(
      layout.layers.filter((l) => l.partId.startsWith('willstudio-suspension-arm-pole-top-brackets')),
    ).toHaveLength(3)
  })
})

// Phase 0.10.5: the 8-angle assembly spin — rotated views must composite with
// nothing missing. Every catalog part (rig- and real-render alike) now ships
// the full 8-angle compass, so this applies exactly rather than falling back
// to a nearest angle.
describe('assembly view rotation — real assets', () => {
  it.each([45, 90, 135, 180, 225, 270, 315])('viewYaw=%i composites with 0 missing', (yaw) => {
    const twin = repairConfig(catalog, { ...base, armCount: 2 })
    const layout = resolveAssemblyLayout(catalog, manifest, twin, yaw)
    expect(layout.missing).toEqual([])
    expect(
      layout.layers.filter((l) => l.partId.startsWith('willstudio-suspension-arm-pole-top-brackets')),
    ).toHaveLength(2)
  })

  it('a 45° view uses exact 45°-compass renders for rig-rendered arms', () => {
    // HSX deco upsweep is placeholder-rendered → full 8-angle compass.
    const twin = repairConfig(catalog, {
      ...base,
      fixture: 'mvx-coach',
      arm: 'willstudio-hsx-decorative-upsweep-arms',
      armCount: 2,
    })
    const layout = resolveAssemblyLayout(catalog, manifest, twin, 45)
    const files = layout.layers
      .filter((l) => l.partId.startsWith('willstudio-hsx'))
      .map((l) => l.asset.file)
      .join(',')
    expect(files).toContain('az135')
    expect(files).toContain('az315')
  })

  it('assemblies with real-render parts rotate coherently: arm and fixture apply the same yaw', () => {
    // Phase 0.10.5: every part now ships the full 8-angle compass, so a 45°
    // request applies exactly (no more snapping to 90°). What this test
    // actually guards is COHERENCE — the arm and its fixture must land on
    // the SAME applied angle at each radial position, never rotating by
    // different amounts and shearing apart.
    const twin = repairConfig(catalog, { ...base, armCount: 2 })
    const at45 = resolveAssemblyLayout(catalog, manifest, twin, 45)
    expect(at45.appliedViewYaw).toBe(45)

    const armFiles = at45.layers
      .filter((l) => l.partId.startsWith('willstudio-suspension-arm-pole-top-brackets'))
      .map((l) => l.asset.file)
      .sort()
    const fixtureFiles = at45.layers
      .filter((l) => l.partId.startsWith('gvx-pendant'))
      .map((l) => l.asset.file)
      .sort()
    expect(armFiles.some((f) => f.includes('az315'))).toBe(true)
    expect(armFiles.some((f) => f.includes('az135'))).toBe(true)
    // Each fixture rides the same angle as the arm it hangs from.
    expect(fixtureFiles.some((f) => f.includes('az315'))).toBe(true)
    expect(fixtureFiles.some((f) => f.includes('az135'))).toBe(true)
  })

  it('all-rig assemblies apply 45° exactly', () => {
    const twin = repairConfig(catalog, {
      ...base,
      fixture: 'mvx-coach',
      arm: 'willstudio-hsx-decorative-upsweep-arms',
      armCount: 2,
    })
    expect(resolveAssemblyLayout(catalog, manifest, twin, 45).appliedViewYaw).toBe(45)
  })
})
