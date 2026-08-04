import type { Catalog, CatalogPart, PartSlot, PoleConfig, ProductLine, Slot, SpecOption } from '../types'
export { isAssemblyPart } from '../types'

const SLOTS: readonly Slot[] = ['fixture', 'arm', 'pole', 'baseCover']

/** Minimum banner-arm height up the pole shaft, in feet (clearance rule). */
export const BANNER_MIN_FT = 8

function isSlot(s: PartSlot): s is Slot {
  return (SLOTS as readonly string[]).includes(s)
}

/**
 * Phase 1.0 (concierge steps): the finish a part in `slot` renders in — the
 * per-slot override when set, else the base `config.finish`. Non-assembly
 * slots (banner accessories) always use the base finish.
 */
export function finishFor(config: PoleConfig, slot: PartSlot): string {
  if (isSlot(slot)) return config.finishes?.[slot] ?? config.finish
  return config.finish
}

/** Display label for a spec-sheet column, minus sheet-jargon suffixes. */
export function optionLabel(opt: SpecOption): string {
  return opt.label.replace(' (Model Nominal Lumens)', '')
}

/**
 * A spec-option value normalized to a code list: ordering columns store a
 * single string, options & accessories columns store string[] — readers use
 * this so they never care which shape a share URL delivered.
 */
export function specCodes(value: string | string[] | undefined): string[] {
  if (!value) return []
  return (Array.isArray(value) ? value : [value]).filter(Boolean)
}

/**
 * Options & accessories are multi-select, but some codes are variants of one
 * physical thing (a cord length, a surge suppressor voltage, a photocontrol
 * voltage) — only one of each family may be on a part, across all of its
 * option columns. Families are matched by order-code prefix.
 */
const EXCLUSIVE_CODE_FAMILIES: { name: string; match: RegExp }[] = [
  { name: 'cord', match: /^WHP/ },
  { name: 'surge-suppressor', match: /^SRG/ },
  { name: 'photocontrol', match: /^(BPC|TLPC)/ },
]

/** The exclusive family a code belongs to, if any. */
export function exclusiveFamily(code: string): string | undefined {
  return EXCLUSIVE_CODE_FAMILIES.find((f) => f.match.test(code))?.name
}

/**
 * Order codes pre-selected whenever a part offering them is chosen (the 6'
 * cord is the standard build). The customer can still uncheck them; they only
 * reseed when the part itself changes.
 */
const DEFAULT_OPTION_CODES = ['WHP7NP']

/**
 * The default multi-select choices for a freshly chosen part: each default
 * code the part's sheet offers, keyed by its column. Undefined when none.
 */
export function defaultSpecOptions(
  part: CatalogPart | undefined,
): Record<string, string[]> | undefined {
  if (!part?.options) return undefined
  const seeded: Record<string, string[]> = {}
  for (const opt of part.options) {
    if (opt.group !== 'options-accessories') continue
    const codes = opt.values.filter((v) => DEFAULT_OPTION_CODES.includes(v.code)).map((v) => v.code)
    if (codes.length > 0) seeded[opt.key] = codes
  }
  return Object.keys(seeded).length > 0 ? seeded : undefined
}

/**
 * Voltage class an option/accessory label declares, parsed from its rating
 * text ("120-277V", "347V", "347/480V", …): 'mv' when every mentioned voltage
 * fits the MV fixture range (≤277V), 'hv' when every one needs HV (≥347V),
 * undefined when the label carries no rating (fits any voltage).
 */
function voltageClass(label: string): 'mv' | 'hv' | undefined {
  const volts: number[] = []
  for (const m of label.matchAll(/(\d{2,3})(?:\s*[-–/]\s*(\d{2,3}))?\s*V\b/g)) {
    volts.push(Number(m[1]))
    if (m[2]) volts.push(Number(m[2]))
  }
  if (volts.length === 0) return undefined
  if (volts.every((v) => v <= 277)) return 'mv'
  if (volts.every((v) => v >= 347)) return 'hv'
  return undefined
}

/**
 * Whether a spec-sheet option/accessory value works with the fixture's chosen
 * voltage: MV (120-277V) pairs with ≤277V-rated gear, HV (277-480V) with
 * ≥347V-rated gear; unrated values and no/custom (CV) voltage never filter.
 */
export function voltageCompatible(voltageCode: string | undefined, valueLabel: string): boolean {
  if (voltageCode !== 'MV' && voltageCode !== 'HV') return true
  const cls = voltageClass(valueLabel)
  if (!cls) return true
  return voltageCode === 'MV' ? cls === 'mv' : cls === 'hv'
}

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
  // Phase 1.0: per-slot finish overrides — keep only known finish ids.
  if (next.finishes) {
    const cleaned: Partial<Record<Slot, string>> = {}
    for (const slot of SLOT_ORDER) {
      const id = next.finishes[slot]
      if (id && catalog.finishes.some((f) => f.id === id)) cleaned[slot] = id
    }
    next.finishes = Object.keys(cleaned).length > 0 ? cleaned : undefined
  }
  // Phase 1.0: prune spec options to the columns + codes the currently selected
  // part's ordering table actually offers (a part swap drops stale choices).
  // Ordering columns normalize to a single string; options & accessories to a
  // string[] holding at most one code per exclusive family (first one wins,
  // walking columns in sheet order — so hand-crafted URLs can't stack cords).
  if (next.specOptions) {
    const cleaned: NonNullable<PoleConfig['specOptions']> = {}
    for (const slot of SLOT_ORDER) {
      const chosen = next.specOptions[slot]
      if (!chosen) continue
      const options = partById(catalog, next[slot])?.options
      if (!options) continue
      const kept: Record<string, string | string[]> = {}
      const seenFamilies = new Set<string>()
      for (const opt of [...options].sort((a, b) => a.orderPosition - b.orderPosition)) {
        const valid = specCodes(chosen[opt.key]).filter((code) =>
          opt.values.some((v) => v.code === code),
        )
        if (valid.length === 0) continue
        if (opt.group === 'ordering') {
          kept[opt.key] = valid[0]
          continue
        }
        // Ordering columns sort ahead of options & accessories, so the kept
        // voltage is already resolved when multi codes are vetted against it.
        const voltage = typeof kept['voltage'] === 'string' ? kept['voltage'] : undefined
        const codes = valid.filter((code) => {
          const label = opt.values.find((v) => v.code === code)?.label ?? ''
          if (!voltageCompatible(voltage, label)) return false
          const family = exclusiveFamily(code)
          if (!family) return true
          if (seenFamilies.has(family)) return false
          seenFamilies.add(family)
          return true
        })
        if (codes.length > 0) kept[opt.key] = codes
      }
      if (Object.keys(kept).length > 0) cleaned[slot] = kept
    }
    next.specOptions = Object.keys(cleaned).length > 0 ? cleaned : undefined
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
      // BannerPicker's slider bounds: [BANNER_MIN_FT, pole height − 2 ft]).
      const poleFt = partById(catalog, next.pole)?.heightFt ?? 20
      const maxFt = Math.max(BANNER_MIN_FT, Math.round(poleFt - 2))
      const clampedFt = Math.min(maxFt, Math.max(BANNER_MIN_FT, banner.heightFt))
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
  const fixture = partsForSlot(catalog, 'fixture', brand)[0]?.id ?? ''
  const seeded = defaultSpecOptions(partById(catalog, fixture))
  return repairConfig(catalog, {
    configId: crypto.randomUUID(),
    brand,
    pole: '',
    baseCover: '',
    arm: '',
    fixture,
    finish: catalog.finishes[0].id,
    rev: 1,
    armCount: 1,
    banner: null,
    specOptions: seeded ? { fixture: seeded } : undefined,
  })
}
