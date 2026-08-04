import type { Catalog, CatalogPart, PartSelections, PoleConfig, ProductLine, Slot } from '../types'
export { isAssemblyPart } from '../types'

/**
 * Selection order is fixture-first (Phase 0.1): downstream steps filter on the
 * fixture's mounting requirements, so compatibility flows fixture → arm → pole,
 * not pole-up. Physical assembly is unchanged (parts still stack on the pole).
 */
export const SLOT_ORDER: Slot[] = ['fixture', 'arm', 'pole', 'baseCover']

export function partById(catalog: Catalog, id: string): CatalogPart | undefined {
  return catalog.parts.find((p) => p.id === id)
}

/** Wizard parts for a slot; brand-scoped when a brand is given (each line has its own builder). */
export function partsForSlot(catalog: Catalog, slot: Slot, brand?: ProductLine): CatalogPart[] {
  return catalog.parts.filter((p) => p.slot === slot && (!brand || p.line === brand))
}

/** A host can carry a part when it exposes a socket of the part's mount type. */
export function canHost(host: CatalogPart | undefined, part: CatalogPart | undefined): boolean {
  if (!host || !part || !part.mount || !host.sockets) return false
  return Object.values(host.sockets).some((s) => s.type === part.mount)
}

/**
 * Parts selectable for a slot given the current selections, walking down from
 * the fixture: arms must carry the chosen fixture, poles the chosen arm, base
 * covers must fit the chosen pole.
 */
export function compatibleParts(catalog: Catalog, config: PoleConfig, slot: Slot): CatalogPart[] {
  const options = partsForSlot(catalog, slot, config.brand)
  switch (slot) {
    case 'fixture':
      return options
    case 'arm':
      return options.filter((arm) => canHost(arm, partById(catalog, config.fixture)))
    case 'pole':
      return options.filter((pole) => canHost(pole, partById(catalog, config.arm)))
    case 'baseCover':
      return options.filter((cover) => canHost(partById(catalog, config.pole), cover))
  }
}

/** The host socket a part attaches at (position offset comes from catalog data, never hardcoded). */
export function attachSocket(part: CatalogPart, host: CatalogPart) {
  if (!host.sockets) return undefined
  return Object.values(host.sockets).find((s) => s.type === part.mount)
}

/**
 * Phase 0.10 (Workstream A): mount azimuths (degrees about the pole's vertical
 * axis) for a radial arm arrangement, per the WiLLstudio ordering matrix — arms
 * sit on a **90° drilled tenon**, so a triple is 3@90 with one leg left empty,
 * NOT the 120° spacing Phase 0.8 assumed. The decorative-pole sheet's drilling
 * column carries both (D3 = Drill 3@120, D6 = Drill 3@90); the arms matrix
 * specifies 3@90 for SS3/AR3, which is what the configurator builds.
 * Position 0° is the single-arm reference direction, so armCount=1 is unchanged.
 * Also used for banner side-counts (2 → an opposite pair).
 */
const DRILLED_TENON_AZIMUTHS: Record<number, number[]> = {
  1: [0],
  2: [0, 180],
  3: [0, 90, 180],
  4: [0, 90, 180, 270],
}

export function armAzimuths(count: number): number[] {
  const n = Math.max(1, Math.floor(count))
  // Counts beyond the drilled-tenon vocabulary fall back to even spacing.
  return DRILLED_TENON_AZIMUTHS[n] ?? Array.from({ length: n }, (_, i) => (i * 360) / n)
}

/**
 * Phase 0.8 (A2) / 0.10 (A): the arm counts a config may choose, driven purely
 * by catalog rules — the intersection of the pole's and the arm's `arrangements`
 * lists (absent → single only). `arrangements` for every family on the ordering
 * matrix is generated from it (scripts/merge-ordering.mjs), so the UI offers
 * exactly the counts that resolve to a real design code: SH1 single-only,
 * SS/AR 1–4, SD/HS 1–2, crossarm a fixed 2.
 *
 * 0.10 fix: single is NO LONGER force-added. A crossarm is only ever ordered as
 * a fixed pair (CR2), so offering "1 arm" invented a product that has no code.
 */
export function allowedArmCounts(catalog: Catalog, config: PoleConfig): number[] {
  const pole = partById(catalog, config.pole)
  const arm = partById(catalog, config.arm)
  if (!pole || !arm) return [1]
  const poleSet = pole.arrangements ?? [1]
  const armSet = arm.arrangements ?? [1]
  const allowed = [...new Set(poleSet.filter((n) => armSet.includes(n) && n >= 1 && n <= 4))].sort(
    (a, b) => a - b,
  )
  return allowed.length > 0 ? allowed : [1]
}

/**
 * Walk slots fixture-first and replace any selection that is no longer
 * compatible by the first compatible option, so the assembly is never broken.
 */
export function repairConfig(catalog: Catalog, config: PoleConfig): PoleConfig {
  const next = { ...config }
  for (const slot of SLOT_ORDER) {
    if (slot === 'fixture') {
      const fixture = partById(catalog, next.fixture)
      if (fixture?.slot !== 'fixture' || fixture.line !== next.brand) {
        next.fixture = partsForSlot(catalog, 'fixture', next.brand)[0]?.id ?? ''
      }
      continue
    }
    // Phase 0.10 (B): the base cover is a selectable Option, so "none" ('') is a
    // deliberate choice, not a broken selection — leave it alone. Anything set
    // but incompatible is still repaired.
    if (slot === 'baseCover' && next.baseCover === '') continue
    const options = compatibleParts(catalog, next, slot)
    if (!options.some((p) => p.id === next[slot])) {
      next[slot] = options[0]?.id ?? ''
    }
  }
  if (!catalog.finishes.some((f) => f.id === next.finish)) {
    next.finish = catalog.finishes[0].id
  }
  // Phase 0.8 (A2) / 0.10 (A): clamp the arm count to what the repaired pole+arm
  // allow. Falling back to the first ALLOWED count (not a hardcoded 1) is what
  // keeps a fixed-pair crossarm at 2.
  const allowed = allowedArmCounts(catalog, next)
  const count = next.armCount ?? 1
  next.armCount = allowed.includes(count) ? count : allowed[0]
  // Phase 0.8 (C): drop a banner selection that is no longer a valid part.
  if (next.banner) {
    const bannerPart = partById(catalog, next.banner.armId)
    if (!bannerPart || bannerPart.slot !== 'banner') next.banner = null
    else {
      const sides = bannerPart.arrangements ?? [1]
      let banner = next.banner
      if (!sides.includes(banner.count)) banner = { ...banner, count: sides[0] ?? 1 }
      // Phase 0.9: clamp the shaft height to the pole's usable range so a
      // hand-crafted share link can't place the banner off the pole (mirrors
      // BannerPicker's slider bounds: [4 ft, pole height − 2 ft]).
      const poleFt = partById(catalog, next.pole)?.heightFt ?? 20
      const maxFt = Math.max(4, Math.round(poleFt - 2))
      const clampedFt = Math.min(maxFt, Math.max(4, banner.heightFt))
      if (clampedFt !== banner.heightFt) banner = { ...banner, heightFt: clampedFt }
      next.banner = banner
    }
  }
  return repairPartOptions(catalog, next)
}

/** The part ids whose ordering selections belong to this config. */
function selectedPartIds(config: PoleConfig): string[] {
  const ids = [config.fixture, config.arm, config.pole, config.baseCover]
  if (config.banner?.armId) ids.push(config.banner.armId)
  return ids.filter(Boolean)
}

/**
 * Phase 0.10 (Workstream 0/B): keep per-part ordering selections honest.
 *
 * - Folds a pre-0.10 `specOptions` map (fixture-only, single level) into
 *   `partOptions[fixture]` so old share links keep their choices.
 * - Drops entries for parts no longer in the build (options belong to a product,
 *   and it keeps share URLs from accumulating dead codes).
 * - Drops codes/add-ons that aren't in that part's matrix, so a hand-crafted URL
 *   can never inject a code into a part number.
 */
export function repairPartOptions(catalog: Catalog, config: PoleConfig): PoleConfig {
  const next = { ...config }
  const merged: Record<string, PartSelections> = { ...(next.partOptions ?? {}) }

  if (next.specOptions && Object.keys(next.specOptions).length > 0 && next.fixture) {
    const existing = merged[next.fixture] ?? {}
    merged[next.fixture] = {
      ...existing,
      // Existing per-part codes win — they are the newer representation.
      codes: { ...next.specOptions, ...(existing.codes ?? {}) },
    }
  }
  next.specOptions = undefined

  const kept: Record<string, PartSelections> = {}
  for (const partId of selectedPartIds(next)) {
    const selections = merged[partId]
    const part = partById(catalog, partId)
    if (!selections || !part) continue

    const validCodes: Record<string, string> = {}
    for (const [key, code] of Object.entries(selections.codes ?? {})) {
      // `design` names the transcribed matrix's design column AND (on the spec
      // sheets) a parsed column of the same name — a part only ever has one of
      // the two, so accept the code if either source knows it.
      const inSpecSheet = part.options?.find((o) => o.key === key)?.values.some((v) => v.code === code)
      const inMatrix = key === 'design' && part.ordering?.designs.some((d) => d.code === code)
      if (inSpecSheet || inMatrix) validCodes[key] = code
    }

    const knownAddOns = new Set<string>([
      ...(part.ordering?.options ?? []).map((o) => o.code),
      ...(part.options ?? []).flatMap((o) => o.values.map((v) => v.code)),
    ])
    const validAddOns = [...new Set((selections.addOns ?? []).filter((c) => knownAddOns.has(c)))].sort()

    if (Object.keys(validCodes).length > 0 || validAddOns.length > 0) {
      kept[partId] = {
        ...(Object.keys(validCodes).length > 0 ? { codes: validCodes } : {}),
        ...(validAddOns.length > 0 ? { addOns: validAddOns } : {}),
      }
    }
  }
  next.partOptions = Object.keys(kept).length > 0 ? kept : undefined
  return next
}

/**
 * Status chip: only Standard and Configurable exist in the catalog-only world.
 * Standard = matches a known reference assembly (Design Library imports, later);
 * anything else the user builds from catalog parts is Configurable.
 */
export function configStatus(catalog: Catalog, config: PoleConfig): 'Standard' | 'Configurable' {
  const isStandard = catalog.referenceAssemblies.some(
    (ref) =>
      ref.pole === config.pole &&
      ref.baseCover === config.baseCover &&
      ref.arm === config.arm &&
      ref.fixture === config.fixture,
  )
  return isStandard ? 'Standard' : 'Configurable'
}

export function defaultConfig(catalog: Catalog, brand: ProductLine = 'WiLLstudio'): PoleConfig {
  const config = repairConfig(catalog, {
    configId: crypto.randomUUID(),
    brand,
    pole: '',
    baseCover: '',
    arm: '',
    fixture: partsForSlot(catalog, 'fixture', brand)[0]?.id ?? '',
    finish: catalog.finishes[0].id,
    rev: 1,
    armCount: 1,
    banner: null,
  })
  // The default build ships WITH a base cover (unchanged from 0.9). Since 0.10
  // treats it as an Option, `repairConfig` no longer fills an empty one in, so
  // the default picks it explicitly here.
  return { ...config, baseCover: compatibleParts(catalog, config, 'baseCover')[0]?.id ?? '' }
}
