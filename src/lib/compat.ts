import type { Catalog, CatalogPart, PoleConfig, Slot } from '../types'
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

export function partsForSlot(catalog: Catalog, slot: Slot): CatalogPart[] {
  return catalog.parts.filter((p) => p.slot === slot)
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
  const options = partsForSlot(catalog, slot)
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
 * Walk slots fixture-first and replace any selection that is no longer
 * compatible by the first compatible option, so the assembly is never broken.
 */
export function repairConfig(catalog: Catalog, config: PoleConfig): PoleConfig {
  const next = { ...config }
  for (const slot of SLOT_ORDER) {
    if (slot === 'fixture') {
      if (partById(catalog, next.fixture)?.slot !== 'fixture') {
        next.fixture = partsForSlot(catalog, 'fixture')[0].id
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

export function defaultConfig(catalog: Catalog): PoleConfig {
  return repairConfig(catalog, {
    configId: crypto.randomUUID(),
    pole: '',
    baseCover: '',
    arm: '',
    fixture: partsForSlot(catalog, 'fixture')[0].id,
    finish: catalog.finishes[0].id,
    rev: 1,
  })
}
