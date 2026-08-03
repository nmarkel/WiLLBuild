import type { Catalog, CatalogPart, PoleConfig, ProductLine, Slot } from '../types'
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
 * Phase 0.8 (A1): even-spaced azimuths (degrees, about the pole's vertical axis)
 * for a radial arm arrangement. 1→[0]; 2→[0,180]; 3→[0,120,240]; 4→[0,90,180,270].
 * Position 0° is the single-arm reference direction, so armCount=1 is unchanged.
 */
export function armAzimuths(count: number): number[] {
  const n = Math.max(1, Math.floor(count))
  return Array.from({ length: n }, (_, i) => (i * 360) / n)
}

/**
 * Phase 0.8 (A2): the arm counts a config may choose, driven purely by catalog
 * rules — the intersection of the pole's and the arm's `arrangements` lists
 * (absent → single only). This is how the UI offers only real, mountable
 * layouts; no component hardcodes which poles/arms support multiples.
 */
export function allowedArmCounts(catalog: Catalog, config: PoleConfig): number[] {
  const pole = partById(catalog, config.pole)
  const arm = partById(catalog, config.arm)
  if (!pole || !arm) return [1]
  const poleSet = pole.arrangements ?? [1]
  const armSet = arm.arrangements ?? [1]
  const allowed = poleSet.filter((n) => armSet.includes(n) && n >= 1 && n <= 4)
  // Always allow single; keep sorted + unique.
  return [...new Set([1, ...allowed])].sort((a, b) => a - b)
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
    const options = compatibleParts(catalog, next, slot)
    if (!options.some((p) => p.id === next[slot])) {
      next[slot] = options[0]?.id ?? ''
    }
  }
  if (!catalog.finishes.some((f) => f.id === next.finish)) {
    next.finish = catalog.finishes[0].id
  }
  // Phase 0.8 (A2): clamp the arm count to what the repaired pole+arm allow.
  const allowed = allowedArmCounts(catalog, next)
  const count = next.armCount ?? 1
  next.armCount = allowed.includes(count) ? count : 1
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
  return repairConfig(catalog, {
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
}
