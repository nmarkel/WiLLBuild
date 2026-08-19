import type {
  SpecOptionValue,
  BannerPanelSize,
  Catalog,
  CatalogPart,
  PartSlot,
  PoleConfig,
  ProductLine,
  Slot,
  SpecOption,
} from '../types'
import { isComingSoon } from './availability'
export { isAssemblyPart } from '../types'

const SLOTS: readonly Slot[] = ['fixture', 'arm', 'pole', 'baseCover']

/**
 * Minimum banner mounting height, in feet — measured to the BOTTOM of the
 * banner (Phase 0.11 D1; before 0.11 the legacy path measured to the banner's
 * vertical centre, so a 24×48 panel "at 8 ft" actually hung to ~6 ft).
 */
export const BANNER_MIN_FT = 8

/**
 * Puddy's spec raises the banner floor to 10 ft on a 25 ft pole. No catalog
 * pole reaches 25 ft today (WiLLstudio ships 8–20 ft; NAFCO poles carry no
 * `heightFt` at all and fall back to 20), so the rule is expressed as a
 * function of pole height keyed at ≥ 25 ft rather than as a per-part exception
 * — it starts applying by itself the day a 25 ft pole lands in the catalog.
 */
const BANNER_TALL_POLE_FT = 25
const BANNER_TALL_POLE_MIN_FT = 10

/**
 * Headroom kept between the top of a shaft accessory and the pole top, in feet.
 *
 * Phase 0.11 (D3) reconciliation: two different caps existed — `poleFt − 2` on
 * the legacy banner path and `poleFt − 1` on the accessory-placement path. The
 * extra foot the legacy path reserved was an unlabelled stand-in for the banner
 * extending above its (then centre) mounting point. Now that the reference is
 * the banner's bottom edge, that allowance is stated explicitly as the panel's
 * own height, and BOTH paths keep the same generic 1 ft of pole-top clearance.
 */
export const ACCESSORY_TOP_CLEARANCE_FT = 1

/** Phase 0.11 (D2): last-resort panel size when the catalog declares none. */
const FALLBACK_BANNER_PANEL_SIZE: BannerPanelSize = {
  id: '24x48',
  widthIn: 24,
  heightIn: 48,
  default: true,
}

/** The banner panel sizes the catalog offers (never empty — see the fallback). */
export function bannerPanelSizes(catalog: Catalog): BannerPanelSize[] {
  const sizes = catalog.bannerPanelSizes
  return sizes && sizes.length > 0 ? sizes : [FALLBACK_BANNER_PANEL_SIZE]
}

/**
 * Resolve a `BannerConfig.size` / `AccessoryPlacement.size` id to its panel
 * dimensions. An absent or unknown id resolves to the catalog default (24"
 * width is the most commonly ordered), which is what keeps pre-0.11 share URLs
 * — they carry no size at all — loading as a valid 24×48 banner.
 */
export function bannerPanelSize(catalog: Catalog, id: string | undefined): BannerPanelSize {
  const sizes = bannerPanelSizes(catalog)
  return sizes.find((s) => s.id === id) ?? sizes.find((s) => s.default) ?? sizes[0]
}

/** True when a pole-accessory label is a banner-arm kit (BA24/BA30). */
export function isBannerKitLabel(label: string): boolean {
  return label.includes('Banner Arm Kit')
}

/**
 * Panel sizes a banner-arm kit can actually carry, from the arm length its own
 * label declares (`24" Wind Shedding Banner Arm Kit … 24" Fiberglass Arms` →
 * panels up to 24" wide). Derived from catalog label text, never a hardcoded
 * code→size table. Labels with no declared arm length (the legacy BA1 banner
 * parts) offer every size. All three catalog sizes clear the labels' other
 * stated limit — "For Banners Less Than 17.5 sq ft" — so it needs no filter.
 */
export function bannerSizesForLabel(catalog: Catalog, label: string): BannerPanelSize[] {
  const sizes = bannerPanelSizes(catalog)
  const armIn = label.match(/(\d+)\s*[”"]\s*(?:Wind Shedding )?Banner Arm Kit/)
  if (!armIn) return sizes
  const maxWidthIn = Number(armIn[1])
  const fits = sizes.filter((s) => s.widthIn <= maxWidthIn)
  return fits.length > 0 ? fits : sizes
}

/** The bottom-of-banner floor for a pole of this height (see BANNER_TALL_POLE_FT). */
export function bannerMinFt(poleFt: number): number {
  return poleFt >= BANNER_TALL_POLE_FT ? BANNER_TALL_POLE_MIN_FT : BANNER_MIN_FT
}

/**
 * A legal mounting-height window in feet. `fits` is false only when the pole is
 * too short to carry the accessory above its own minimum — the range then
 * collapses onto the minimum and the caller should warn rather than pretend.
 */
export interface HeightRange {
  minFt: number
  maxFt: number
  fits: boolean
}

/**
 * Phase 0.11 (D3): the legal bottom-of-banner window on a pole, in feet — the
 * single definition both banner paths and the placement UI use, so they can no
 * longer drift apart. Because the height is measured to the banner's BOTTOM,
 * the ceiling has to leave room for the panel itself, or a tall banner's top
 * would run off the pole.
 */
const M_TO_FT = 3.280839895

/**
 * CR-PLC-05 (Tyler 8/14): how high the chosen fixture's BOTTOM sits above
 * grade, in feet — pole top, plus the arm's fixture-socket height, minus the
 * fixture's measured hang. Undefined when any piece is missing (post-top
 * fixtures carry no hangM, so the rule is pendant-only by data).
 */
export function fixtureBottomFt(catalog: Catalog, config: PoleConfig): number | undefined {
  const fixture = partById(catalog, config.fixture)
  const arm = partById(catalog, config.arm)
  const poleFt = partById(catalog, config.pole)?.heightFt
  if (!fixture?.hangM || !arm || !poleFt) return undefined
  const socket = Object.values(arm.sockets ?? {}).find((s) => s.type === fixture.mount)
  if (!socket) return undefined
  return poleFt + socket.position[1] * M_TO_FT - fixture.hangM * M_TO_FT
}

/**
 * CR-OPT-13 (amended): snap a placement height onto its legal ladder — the
 * exact floor (which may sit OFF the step grid, like the 37" hand-hole /
 * festoon minimum), then the step grid anchored at the next round increment
 * (37" → 42" → 48" → …). On-grid floors degrade to plain grid snapping.
 */
export function snapPlacementHeightFt(heightFt: number, minFt: number, stepFt: number): number {
  const anchor = Math.ceil(minFt / stepFt - 1e-9) * stepFt
  if (heightFt < (minFt + anchor) / 2) return Math.round(minFt * 12) / 12
  const snapped = Math.max(anchor, Math.round(heightFt / stepFt) * stepFt)
  return Math.round(snapped * 12) / 12
}

export function bannerHeightRange(
  catalog: Catalog,
  poleFt: number,
  sizeId?: string,
  fixtureBottom?: number,
  placement?: { minFt?: number; maxFt?: number },
): HeightRange {
  // CR-PLC-08: the kit's own window (BAX bottom arm: 8–10 ft) combines with
  // the structural rules — every ceiling applies, tightest wins.
  const minFt = Math.max(bannerMinFt(poleFt), placement?.minFt ?? 0)
  const panelFt = bannerPanelSize(catalog, sizeId).heightIn / 12
  // CR-PLC-05: the banner's TOP stays at least 1 ft below the fixture's
  // bottom — the binding ceiling when a pendant hangs below the pole top.
  const belowFixture =
    fixtureBottom !== undefined ? fixtureBottom - ACCESSORY_TOP_CLEARANCE_FT - panelFt : Infinity
  const ceiling =
    Math.round(
      Math.min(
        poleFt - panelFt - ACCESSORY_TOP_CLEARANCE_FT,
        belowFixture,
        placement?.maxFt ?? Infinity,
      ) * 12,
    ) / 12
  // A pole too short to hold this panel above the floor collapses to the floor
  // rather than inverting the range (the "floor wins" rule pre-dates 0.11).
  // `fits: false` says so out loud instead of quietly returning a height whose
  // banner overhangs the pole top — the UI warns, it does not pretend.
  return { minFt, maxFt: Math.max(minFt, ceiling), fits: ceiling >= minFt }
}

/**
 * The shaft-height window for any placeable pole accessory. Banner kits use
 * the banner rules above; everything else keeps its label-declared minimum
 * (FSTR's `Minimum 37" Above Base Plate`) or the generic 2 ft floor, under the
 * same 1 ft of pole-top clearance.
 */
export function accessoryHeightRange(
  catalog: Catalog,
  poleFt: number,
  label: string,
  sizeId?: string,
  fixtureBottom?: number,
  placement?: { minFt?: number; maxFt?: number },
): HeightRange {
  if (isBannerKitLabel(label)) return bannerHeightRange(catalog, poleFt, sizeId, fixtureBottom, placement)
  // CR-PLC-07: an accessory's own window (FH/PH: 8–12 ft) beats the generic
  // rules; the pole's physical ceiling still applies on short poles.
  const minFt = placement?.minFt ?? labelMinFt(label) ?? 2
  const poleCeiling = Math.round(poleFt - ACCESSORY_TOP_CLEARANCE_FT)
  const ceiling = Math.min(placement?.maxFt ?? Infinity, poleCeiling)
  return { minFt, maxFt: Math.max(minFt, ceiling), fits: ceiling >= minFt }
}

export function isSlot(s: PartSlot): s is Slot {
  return (SLOTS as readonly string[]).includes(s)
}

/**
 * Phase 0.10.5 (concierge steps): the finish a part in `slot` renders in — the
 * per-slot override when set, else the base `config.finish`. Non-assembly
 * slots (banner accessories) always use the base finish.
 */
export function finishFor(config: PoleConfig, slot: PartSlot): string {
  if (isSlot(slot)) return config.finishes?.[slot] ?? config.finish
  return config.finish
}

/**
 * The ordering key of a part's SECOND finish column, when it has one.
 *
 * Phase 0.12: TEX's sheet prints two finish columns — Housing, and Spider Mount
 * & Accent Line. `finish-color-accent` is the corrected key the split produces
 * (see docs/spec-option-corrections.json). Kept as a constant because the
 * resolver must test it BEFORE the generic `finish-color` prefix, which it also
 * matches.
 */
export const ACCENT_FINISH_KEY = 'finish-color-accent'

/** Whether this part orders in two finishes — data-driven, never a part-id list. */
export function hasAccentFinish(part: CatalogPart | undefined): boolean {
  return (part?.options ?? []).some((o) => o.key === ACCENT_FINISH_KEY)
}

/**
 * Phase 0.12: the finish a part's accent / secondary component orders in.
 *
 * Falls back to the slot's own finish, mirroring how `finishFor` falls back to
 * the base `config.finish` — so an untouched accent still resolves to a real
 * colour the customer picked, and the part number never carries a `_` for a
 * column the sheet says is always required.
 */
export function accentFinishFor(config: PoleConfig, slot: PartSlot): string {
  if (isSlot(slot)) return config.accentFinishes?.[slot] ?? finishFor(config, slot)
  return finishFor(config, slot)
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

/** Marker text on pole-accessory values whose install point must be specified. */
export const PLACEMENT_MARKER = 'Specify Pole Height & Orientation'

/**
 * A placement minimum declared in an accessory's own label (e.g. FSTR's
 * "Minimum 37” Above Base Plate"), in feet — undefined when the label doesn't
 * declare one (generic 2 ft floor applies).
 */
export function labelMinFt(label: string): number | undefined {
  const m = label.match(/Minimum\s+(\d+)\s*[”"]/i)
  return m ? Number(m[1]) / 12 : undefined
}

/** A value's full machine-readable text: label + note (constraints like the
    festoon's Minimum 37” now live in the plain-English caption). */
export function valueText(v: { label: string; note?: string | null }): string {
  return v.note ? `${v.label} ${v.note}` : v.label
}

/** Whether an accessory value takes a shaft placement — the explicit flag,
    with the legacy label-marker as back-compat for untreated sheets. */
export function isPlaceable(v: { label: string; placeable?: boolean }): boolean {
  return v.placeable === true || v.label.includes(PLACEMENT_MARKER)
}

/**
 * Radial side counts an accessory may repeat on, by what it is: banner-arm
 * kits go 1 / 2@180 / 4; couplings go single or opposite pair; everything
 * else places once (undefined — no Sides chooser).
 */
export function accessorySideOptions(label: string): number[] | undefined {
  if (label.includes('Banner Arm Kit')) return [1, 2, 4]
  // CR-OPT-12 (Tyler 8/14): couplings are INSTANCED, not paired — an
  // "opposite pair" is two instances at 0° and 180°, so no sides option.
  if (label.includes('Flag Holder') || label.includes('Plant Holder')) return [1, 2]
  return undefined
}

/** The full text of a selected pole accessory value (label + caption), for
    placement rules — constraints like the festoon minimum live in the caption
    since the plain-English pass. */
export function poleAccessoryLabel(catalog: Catalog, config: PoleConfig, code: string): string {
  const value = poleAccessoryValue(catalog, config, code)
  return value ? valueText(value) : ''
}

/**
 * CR-OPT-11: an accessory's placement instances, whatever shape the config
 * carries (legacy single object, array, or nothing → []).
 */
export function placementInstances(
  config: PoleConfig,
  code: string,
): import('../types').AccessoryPlacement[] {
  // Legacy single-object entries reach here through old URLs / saved configs
  // typed loosely — normalize defensively even though arrays are canonical.
  const raw = config.accessoryPlacements?.[code] as
    | import('../types').AccessoryPlacement[]
    | import('../types').AccessoryPlacement
    | undefined
  if (!raw) return []
  return Array.isArray(raw) ? raw : [raw]
}

/** The selected pole accessory's full value object (placement window etc.). */
/**
 * Phase 0.17 (Tyler 8/19): the base cover's STACKING accessory — a checked
 * options-accessories code on the chosen cover whose value names a render
 * part carrying `stackHeightM` (today: CLE, the Clamshell Base Extender).
 * The compositor draws it under the cover and lifts the cover by that
 * height. Data-driven end to end: no code here knows "CLE".
 */
export function coverExtenderFor(catalog: Catalog, config: PoleConfig): CatalogPart | undefined {
  const cover = partById(catalog, config.baseCover)
  const chosen = config.specOptions?.baseCover
  if (!cover || !chosen) return undefined
  for (const opt of cover.options ?? []) {
    if (opt.group !== 'options-accessories') continue
    for (const code of specCodes(chosen[opt.key])) {
      const value = opt.values.find((v) => v.code === code)
      if (!value?.renderPartId) continue
      const part = partById(catalog, value.renderPartId)
      if (part?.stackHeightM !== undefined) return part
    }
  }
  return undefined
}

export function poleAccessoryValue(catalog: Catalog, config: PoleConfig, code: string) {
  for (const opt of partById(catalog, config.pole)?.options ?? []) {
    if (opt.group !== 'options-accessories') continue
    const value = opt.values.find((v) => v.code === code)
    if (value) return value
  }
  return undefined
}

/**
 * The pole-accessory codes currently selected on `config` that carry the
 * placement marker — each gets a height/orientation config box (and, once
 * product renders exist, a shaft layer in the viewer).
 */
export function placeableAccessoryCodes(catalog: Catalog, config: PoleConfig): string[] {
  const options = partById(catalog, config.pole)?.options
  if (!options) return []
  const chosen = config.specOptions?.pole
  if (!chosen) return []
  const codes: string[] = []
  for (const opt of options) {
    if (opt.group !== 'options-accessories') continue
    for (const code of specCodes(chosen[opt.key])) {
      const value = opt.values.find((v) => v.code === code)
      if (value && isPlaceable(value)) codes.push(code)
    }
  }
  return codes
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
  // Phase 0.11 (C2): the shepherds hook's centre feature — one decorative /
  // logo insert sits in the hook, so CF1, CF2 and CF3 are three variants of one
  // physical thing. Anchored to exactly CF1|CF2|CF3 rather than a `^CF` prefix
  // on purpose: the catalog also carries a bare `CF` = "Custom" on mvx-coach,
  // which is a different concept (a quote conversation on a coach fixture, not
  // a hook insert) and must NOT be swept into this family — a prefix match
  // would also claim any future CF-prefixed code sight unseen.
  { name: 'center-feature', match: /^CF[123]$/ },
]

/** The exclusive family a code belongs to, if any. */
export function exclusiveFamily(code: string): string | undefined {
  return EXCLUSIVE_CODE_FAMILIES.find((f) => f.match.test(code))?.name
}

/**
 * Phase 0.11 (C3): arms allowed to carry the centre-feature codes, keyed by the
 * arm's official ordering model code (`modelCodes[1]`) rather than its catalog
 * id — the arms sheet keys its Options column by model code too.
 *
 * Tyler confirmed 8/12: the SS side-shepherds-hook brackets DO take the
 * centre feature (the 0.11 "treat SS as no-logo until Tyler confirms" interim
 * is settled the other way). The guard is keyed by the family's single-arm
 * model code, so SS2 (twin) carries it too — matching the sheet, where CF is
 * a family option, not a per-count one. It still exists so a parser re-run
 * fanning the arms sheet's Options column across all 10 arm families cannot
 * silently start offering a logo feature on a crossarm.
 */
const CENTER_FEATURE_MODEL_CODES = new Set(['SH1', 'SS1'])

/**
 * CR-OPT-14: whether choosing `value` in `opt` is compatible with the other
 * columns' CURRENT choices — both directions: this value's own `requires`
 * against chosen columns, and other chosen values' `requires` against this
 * column. Used by the UI to disable chips and by repair to clear violations.
 */
export function valueCompatibleWithChosen(
  part: CatalogPart,
  chosen: Record<string, string | string[]>,
  optKey: string,
  value: SpecOptionValue,
): boolean {
  // This value's own requirements vs already-chosen columns.
  for (const [col, allowed] of Object.entries(value.requires ?? {})) {
    const current = specCodes(chosen[col])[0]
    if (current && !allowed.includes(current)) return false
  }
  // Other chosen values' requirements vs this column.
  for (const opt of part.options ?? []) {
    if (opt.key === optKey) continue
    const current = specCodes(chosen[opt.key])[0]
    if (!current) continue
    const chosenValue = opt.values.find((v) => v.code === current)
    const allowed = chosenValue?.requires?.[optKey]
    if (allowed && !allowed.includes(value.code)) return false
  }
  return true
}

/**
 * Whether a part may offer a given option/accessory code at all. This is the
 * part-level counterpart to `voltageCompatible`: `voltageCompatible` filters on
 * a chosen value, this one filters on which product the sheet's code belongs to.
 */
export function codeAllowedOnPart(part: CatalogPart | undefined, code: string): boolean {
  if (exclusiveFamily(code) !== 'center-feature') return true
  return CENTER_FEATURE_MODEL_CODES.has(part?.modelCodes?.[1] ?? '')
}

/**
 * Order codes pre-selected whenever a part offering them is chosen.
 * EMPTY since CR-OPT-06 (Tyler 8/14): the cord is no longer a seeded
 * SELECTION — it is required and DERIVED from the bracket (cordCodeFor),
 * like the base cover's pole fit. The mechanism stays for future defaults.
 */
const DEFAULT_OPTION_CODES: string[] = []

/**
 * CR-OPT-06 (Tyler 8/14): the cord code a pendant fixture ships with — a
 * REQUIRED, bracket-derived inclusion, never a customer choice. WHP7NP is
 * the standard; short-drop brackets carry their own code on the part
 * (PM1 → WHP3NP; WM1/WM2/PC1 → WHP3NP and PC3 → WHP11NP when those parts
 * land). Undefined when the fixture isn't a pendant or the arm isn't a
 * WiLLstudio bracket.
 */
/**
 * CR-OPT-15: the pole's fixture-mounting code implied by the chosen bracket
 * (PF for nearly all WiLLstudio brackets; FR2 → PD). Undefined when no arm is
 * chosen or the bracket doesn't decide it — the column prints `_`, resolved
 * at quote.
 */
export function poleMountingCodeFor(catalog: Catalog, config: PoleConfig): string | undefined {
  return partById(catalog, config.arm)?.mountingCode
}

export function cordCodeFor(catalog: Catalog, config: PoleConfig): string | undefined {
  const fixture = partById(catalog, config.fixture)
  const arm = partById(catalog, config.arm)
  if (!fixture || !arm) return undefined
  if (fixture.mount !== 'pendant') return undefined
  if (arm.line !== 'WiLLstudio' || arm.pseudoPart) return undefined
  return arm.cordCode ?? 'WHP7NP'
}

/**
 * The default multi-select choices for a freshly chosen part: each default
 * code the part's sheet offers, keyed by its column. Undefined when none.
 */
export function defaultSpecOptions(
  part: CatalogPart | undefined,
): Record<string, string | string[]> | undefined {
  if (!part?.options) return undefined
  const seeded: Record<string, string | string[]> = {}
  for (const opt of part.options) {
    // Ordering columns: the part's own curated defaults (catalog
    // `specDefaults`, e.g. GVX's 15,200 lm / 5000K / 120-277V / Type V
    // Medium — Tyler 8/12) seed the column so the derived part number is
    // complete out of the gate. Only codes the sheet actually offers seed.
    if (opt.group === 'ordering') {
      // Single-choice columns store the bare code (setSpecOption's own shape).
      const want = part.specDefaults?.[opt.key]
      if (want && opt.values.some((v) => v.code === want)) seeded[opt.key] = want
      continue
    }
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
  // Phase 0.14: ground-mounted products (RXB/SXB bollard) join the Fixture
  // step from the standalone slot — see `groundMounted` in types.ts.
  return catalog.parts.filter(
    (p) =>
      (p.slot === slot || (slot === 'fixture' && p.groundMounted === true)) &&
      (!brand || p.line === brand),
  )
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
    // Phase 0.12_TO (blank slate): an unchosen upstream slot ('') constrains
    // nothing — every section stays open with its full list until the
    // customer's own picks start narrowing it.
    case 'arm': {
      const fixture = partById(catalog, config.fixture)
      // Phase 0.14: a ground-mounted product is complete — nothing mounts it,
      // nothing stands under it. All three mounting slots go empty (the Panel
      // shows them grayed as "not applicable", repair evicts prior choices).
      if (fixture?.groundMounted) return []
      return fixture ? options.filter((arm) => canHost(arm, fixture)) : options
    }
    case 'pole': {
      if (partById(catalog, config.fixture)?.groundMounted) return []
      const arm = partById(catalog, config.arm)
      return arm ? options.filter((pole) => canHost(pole, arm)) : options
    }
    case 'baseCover': {
      if (partById(catalog, config.fixture)?.groundMounted) return []
      const pole = partById(catalog, config.pole)
      return pole ? options.filter((cover) => canHost(pole, cover)) : options
    }
  }
}

/** The host socket a part attaches at (position offset comes from catalog data, never hardcoded). */
export function attachSocket(part: CatalogPart, host: CatalogPart) {
  return attachSockets(part, host)[0]
}

/**
 * EVERY host socket a part can attach at, in catalog order.
 *
 * Phase 0.12: a crossarm carries a fixture at each end (FR2 is "Fixed 2 @ 180
 * deg" in the ordering matrix, and its real CAD has an upward tenon at either
 * end). `attachSocket` returning only the first match is why the second tenon
 * always rendered bare — the catalog could declare both and the compositor
 * would still place one.
 *
 * Kept separate from `attachSocket` rather than replacing it: a part mounts to
 * exactly ONE socket on its host (an arm sits on one pole top), so the singular
 * form is the right question for the mount side. The plural is the right
 * question for the carry side — "what can I hang on this?".
 */
export function attachSockets(part: CatalogPart, host: CatalogPart) {
  if (!host.sockets) return []
  return Object.values(host.sockets).filter((s) => s.type === part.mount)
}

/**
 * Phase 0.8 (A1): azimuths (degrees, about the pole's vertical axis) for a
 * radial arm arrangement. 1→[0]; 2→[0,180]; 4→[0,90,180,270]. Triple is the
 * official 3@90 layout (SS3/AR3 ordering codes) — [0,90,180], not even 120°
 * spacing. Position 0° is the single-arm reference, so armCount=1 is unchanged.
 */
/** Phase 0.10.5: the orientations an arm arrangement may rotate to about the pole. */
export const ARM_ORIENTATIONS = [0, 90, 180, 270]

export function armAzimuths(count: number): number[] {
  const n = Math.max(1, Math.floor(count))
  if (n === 3) return [0, 90, 180]
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
 * Phase 0.12_TO (Tyler 8/12): the orientations that produce DISTINCT layouts
 * for an arm arrangement. Evenly spaced arrangements are rotationally
 * symmetric — a twin (2 @ 180°) repeats every 180°, so 180/270 duplicate
 * 0/90; a quad (4 @ 90°) repeats every 90°, so only 0 is distinct. The
 * official triple is 3 @ 90° (NOT evenly spaced), so it keeps all four.
 */
export function armOrientationOptions(count: number): number[] {
  if (count === 2) return [0, 90]
  if (count === 4) return [0]
  return [...ARM_ORIENTATIONS]
}

/** Fold an orientation onto its arrangement's distinct set (270° twin ≡ 90°). */
export function foldArmOrientation(deg: number, count: number): number {
  if (count === 2) return deg % 180
  if (count === 4) return 0
  return deg
}

/**
 * Walk slots fixture-first and replace any selection that is no longer
 * compatible by the first compatible option, so the assembly is never broken.
 */
export function repairConfig(catalog: Catalog, config: PoleConfig): PoleConfig {
  const next = { ...config }
  // Phase 0.12 (D)'s rule — repair never CHOOSES a Coming Soon part but never
  // evicts one already selected — is now subsumed by the blank-slate rule
  // below: repair never chooses ANY part. A held part a config already names
  // stays (the customer's saved design is not rewritten); an invalid choice
  // falls back to '' rather than to a silently-picked replacement.
  for (const slot of SLOT_ORDER) {
    // Phase 0.12_TO (Tyler 8/12, blank slate): '' is a deliberate "not chosen
    // yet" — the builder opens with every slot empty and the customer builds
    // up. Repair FIXES invalid choices; it never MAKES choices. (Standalone
    // products already relied on '' being a legal value.) An invalid non-empty
    // choice repairs to '' too — falling back to "unchosen" is honest where
    // auto-picking a replacement part was silent invention.
    if (!next[slot]) continue
    if (slot === 'fixture') {
      const fixture = partById(catalog, next.fixture)
      // Phase 0.14: ground-mounted products (slot 'standalone') are legal
      // fixture choices — see `groundMounted` in types.ts.
      const legal =
        fixture !== undefined &&
        (fixture.slot === 'fixture' || fixture.groundMounted === true) &&
        fixture.line === next.brand
      if (!legal) {
        next.fixture = ''
      }
      continue
    }
    const options = compatibleParts(catalog, next, slot)
    if (!options.some((p) => p.id === next[slot])) {
      next[slot] = ''
    }
  }
  if (!catalog.finishes.some((f) => f.id === next.finish)) {
    next.finish = catalog.finishes[0].id
  }
  // Phase 0.10.5: per-slot finish overrides — keep only known finish ids the
  // selected part actually offers (anodized colors are pole/aluminum-only).
  if (next.finishes) {
    const cleaned: Partial<Record<Slot, string>> = {}
    for (const slot of SLOT_ORDER) {
      const id = next.finishes[slot]
      if (!id || !catalog.finishes.some((f) => f.id === id)) continue
      const offered = partById(catalog, next[slot])?.finishes
      if (offered && offered.length > 0 && !offered.includes(id) && id !== 'custom-ral') continue
      cleaned[slot] = id
    }
    next.finishes = Object.keys(cleaned).length > 0 ? cleaned : undefined
  }
  // Phase 0.12: accent finishes — same validation as the finish overrides above,
  // PLUS the part must actually have a second finish column. Swapping TEX out
  // for a one-finish fixture must not leave an orphan accent behind: it would
  // ride the share URL and reappear if TEX were reselected, silently changing a
  // part number the customer never configured.
  if (next.accentFinishes) {
    const cleaned: Partial<Record<Slot, string>> = {}
    for (const slot of SLOT_ORDER) {
      const id = next.accentFinishes[slot]
      if (!id || !catalog.finishes.some((f) => f.id === id)) continue
      const part = partById(catalog, next[slot])
      if (!hasAccentFinish(part)) continue
      const offered = part?.finishes
      if (offered && offered.length > 0 && !offered.includes(id) && id !== 'custom-ral') continue
      cleaned[slot] = id
    }
    next.accentFinishes = Object.keys(cleaned).length > 0 ? cleaned : undefined
  }
  // Phase 0.10.5: custom RAL colors — keep only well-formed hex values on slots
  // whose finish actually is custom-ral.
  if (next.finishRal) {
    const cleaned: Partial<Record<Slot, string>> = {}
    for (const slot of SLOT_ORDER) {
      const hex = next.finishRal[slot]
      if (hex && /^#[0-9a-fA-F]{6}$/.test(hex) && finishFor(next, slot) === 'custom-ral') {
        cleaned[slot] = hex.toLowerCase()
      }
    }
    next.finishRal = Object.keys(cleaned).length > 0 ? cleaned : undefined
  }
  // Phase 0.10.5: prune spec options to the columns + codes the currently selected
  // part's ordering table actually offers (a part swap drops stale choices).
  // Ordering columns normalize to a single string; options & accessories to a
  // string[] holding at most one code per exclusive family (first one wins,
  // walking columns in sheet order — so hand-crafted URLs can't stack cords).
  if (next.specOptions) {
    const cleaned: NonNullable<PoleConfig['specOptions']> = {}
    for (const slot of SLOT_ORDER) {
      const chosen = next.specOptions[slot]
      if (!chosen) continue
      const part = partById(catalog, next[slot])
      const options = part?.options
      if (!options) continue
      const kept: Record<string, string | string[]> = {}
      const seenFamilies = new Set<string>()
      for (const opt of [...options].sort((a, b) => a.orderPosition - b.orderPosition)) {
        const valid = specCodes(chosen[opt.key]).filter(
          // Phase 0.11 (C3): `codeAllowedOnPart` rejects a code the sheet lists
          // but this product may not carry (CF1/CF2/CF3 outside SH1), so a
          // crafted URL — or a catalog edit that fans the arms sheet's Options
          // column across every arm — can't smuggle a logo onto a crossarm.
          (code) => opt.values.some((v) => v.code === code) && codeAllowedOnPart(part, code),
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
      // CR-OPT-14: clear choices violating another chosen value's `requires`
      // (PF flush fit → wall must be D/E). The requires-OWNER wins; the
      // CONSTRAINED column clears back to unchosen — repair never re-picks.
      // CR-OPT-15: the DERIVED fixture-mounting (from the bracket) counts as
      // chosen for these checks — an SH1 bracket implies PF, so C walls clear.
      const derivedMounting = slot === 'pole' ? poleMountingCodeFor(catalog, next) : undefined
      const effectiveChosen = derivedMounting
        ? { ...kept, 'fixture-mounting': derivedMounting }
        : kept
      for (const opt of options) {
        const current = specCodes(effectiveChosen[opt.key])[0]
        if (!current || opt.group !== 'ordering') continue
        const value = opt.values.find((v) => v.code === current)
        if (!value) continue
        if (!valueCompatibleWithChosen(part, effectiveChosen, opt.key, value)) {
          // Only clear if this value is the CONSTRAINED side (some other
          // chosen value's requires names this column).
          const constrainedByOther = (part.options ?? []).some((o) => {
            if (o.key === opt.key) return false
            const c = specCodes(effectiveChosen[o.key])[0]
            const cv = c ? o.values.find((v2) => v2.code === c) : undefined
            const allowed = cv?.requires?.[opt.key]
            return !!allowed && !allowed.includes(current)
          })
          if (constrainedByOther) delete kept[opt.key]
        }
      }
      if (Object.keys(kept).length > 0) cleaned[slot] = kept
    }
    next.specOptions = Object.keys(cleaned).length > 0 ? cleaned : undefined
  }
  // Phase 0.8 (A2): clamp the arm count to what the repaired pole+arm allow.
  const allowed = allowedArmCounts(catalog, next)
  const count = next.armCount ?? 1
  next.armCount = allowed.includes(count) ? count : 1
  // Phase 0.10.5: arm orientation is one of the four compass rotations; anything
  // else (tampered URL) resets to 0, and 0 stays unset to keep URLs clean.
  if (next.armOrientation !== undefined) {
    next.armOrientation = ARM_ORIENTATIONS.includes(next.armOrientation) ? next.armOrientation : 0
    // Fold onto the arrangement's distinct set (a twin at 270° IS 90°).
    next.armOrientation = foldArmOrientation(next.armOrientation, next.armCount ?? 1)
    if (next.armOrientation === 0) next.armOrientation = undefined
  }
  // Phase 0.10.5: accessory placements exist only while their code is selected
  // on the pole; height clamps to the shaft and orientation to the compass set.
  if (next.accessoryPlacements) {
    const placeable = new Set(placeableAccessoryCodes(catalog, next))
    const poleFt = partById(catalog, next.pole)?.heightFt ?? 20
    const cleaned: NonNullable<PoleConfig['accessoryPlacements']> = {}
    for (const code of Object.keys(next.accessoryPlacements)) {
      const instances = placementInstances(next, code)
      if (!placeable.has(code) || instances.length === 0) continue
      const label = poleAccessoryLabel(catalog, next, code)
      const accessoryValue = poleAccessoryValue(catalog, next, code)
      const sideOptions = accessorySideOptions(label)
      const stepFt = (accessoryValue?.placement?.stepIn ?? 1) / 12
      // CR-OPT-11: only `multi` accessories keep several instances;
      // CR-OPT-12: capped (couplings: 3 — more via engineering).
      const cap = accessoryValue?.placement?.multi
        ? (accessoryValue.placement.maxInstances ?? Infinity)
        : 1
      const kept = instances.slice(0, cap)
      const clamped = kept.map((p) => {
        // Phase 0.11 (D2): a panel size is meaningful only on a banner kit.
        const size = isBannerKitLabel(label)
          ? bannerSizesForLabel(catalog, label).find((s2) => s2.id === p.size)?.id
          : undefined
        // Sides exist only where the accessory supports them, clamped to its set.
        const sides =
          sideOptions && p.sides !== undefined
            ? sideOptions.includes(p.sides)
              ? p.sides
              : 1
            : undefined
        // Phase 0.11 (D3): ONE height window shared with the placement UI;
        // CR-PLC-05 fixture clearance and CR-PLC-07/08 windows apply per
        // instance, and heights snap to the accessory's step grid.
        const { minFt, maxFt } = accessoryHeightRange(
          catalog,
          poleFt,
          label,
          size,
          fixtureBottomFt(catalog, next),
          accessoryValue?.placement,
        )
        const heightFt = Math.min(
          maxFt,
          Math.max(Math.round(minFt * 12) / 12, snapPlacementHeightFt(p.heightFt, minFt, stepFt)),
        )
        // Tyler 8/12: fold the orientation onto the arrangement's distinct set.
        const rawOrientation = ARM_ORIENTATIONS.includes(p.orientation) ? p.orientation : 0
        const orientation = foldArmOrientation(rawOrientation, sides ?? 1)
        return {
          heightFt,
          orientation,
          ...(sides !== undefined ? { sides } : {}),
          ...(size !== undefined ? { size } : {}),
        }
      })
      // CR-OPT-12: same-orientation instances keep a minimum vertical gap —
      // later instances nudge UP in step increments (deterministic), clamped
      // to the window; engineering resolves anything the pole can't fit.
      const minGap = accessoryValue?.placement?.minGapFt
      if (minGap && clamped.length > 1) {
        const byOrientation = new Map<number, number>()
        const ordered = [...clamped].sort((a, b) => a.heightFt - b.heightFt)
        for (const inst of ordered) {
          const lastTop = byOrientation.get(inst.orientation)
          if (lastTop !== undefined && inst.heightFt - lastTop < minGap) {
            inst.heightFt = Math.round((lastTop + minGap) * 12) / 12
          }
          byOrientation.set(inst.orientation, inst.heightFt)
        }
      }
      cleaned[code] = clamped
    }
    // CR-OPT-13: cross-code spacing groups — instances of every code sharing
    // a spacingGroup (hand holes + festoons) keep their gap regardless of
    // orientation; later instances nudge UP deterministically.
    const groups = new Map<
      string,
      { code: string; idx: number; gapFt: number; cap?: number }[]
    >()
    for (const code of Object.keys(cleaned)) {
      const pl = poleAccessoryValue(catalog, next, code)?.placement
      if (!pl?.spacingGroup || !pl.minGapFt) continue
      const list = groups.get(pl.spacingGroup) ?? []
      cleaned[code].forEach((_, idx) =>
        list.push({ code, idx, gapFt: pl.minGapFt!, cap: pl.groupMaxInstances }),
      )
      groups.set(pl.spacingGroup, list)
    }
    for (const members of groups.values()) {
      // CR-OPT-13: combined cap across the group (mix and match) — keep the
      // first N in code/instance order, drop the rest deterministically.
      const cap = members.find((m) => m.cap !== undefined)?.cap
      if (cap !== undefined && members.length > cap) {
        const dropped = members.slice(cap)
        for (const m of dropped) {
          cleaned[m.code] = cleaned[m.code].filter((_, i) => i !== m.idx)
        }
        // Re-index survivors after the removals.
        members.length = 0
        for (const code of Object.keys(cleaned)) {
          const pl = poleAccessoryValue(catalog, next, code)?.placement
          if (!pl?.spacingGroup || !pl.minGapFt) continue
          cleaned[code].forEach((_, idx) =>
            members.push({ code, idx, gapFt: pl.minGapFt!, cap: pl.groupMaxInstances }),
          )
        }
        for (const code of Object.keys(cleaned)) {
          if (cleaned[code].length === 0) delete cleaned[code]
        }
      }
    }
    for (const members of groups.values()) {
      members.sort((a, b) => cleaned[a.code][a.idx].heightFt - cleaned[b.code][b.idx].heightFt)
      let lastTop: number | undefined
      for (const m of members) {
        const inst = cleaned[m.code][m.idx]
        if (lastTop !== undefined && inst.heightFt - lastTop < m.gapFt) {
          inst.heightFt = Math.round((lastTop + m.gapFt) * 12) / 12
        }
        lastTop = inst.heightFt
      }
    }
    next.accessoryPlacements = Object.keys(cleaned).length > 0 ? cleaned : undefined
  }
  // Phase 0.10.5: brands whose pole sheet carries banner-kit accessories
  // (BA24/BA30) configure banners exclusively through those placements — a
  // legacy `banner` from an old share URL would render an unremovable panel.
  if (
    next.banner &&
    partById(catalog, next.pole)?.options?.some(
      (o) =>
        o.group === 'options-accessories' && o.values.some((v) => v.label.includes('Banner Arm Kit')),
    )
  ) {
    next.banner = null
  }
  // Phase 0.8 (C): drop a banner selection that is no longer a valid part.
  if (next.banner) {
    const bannerPart = partById(catalog, next.banner.armId)
    if (!bannerPart || bannerPart.slot !== 'banner') next.banner = null
    else {
      const sides = bannerPart.arrangements ?? [1]
      let banner = next.banner
      if (!sides.includes(banner.count)) banner = { ...banner, count: sides[0] ?? 1 }
      // Phase 0.11 (D2): keep only a size the catalog actually offers; an absent
      // or unknown id reads as the default (24×48), which is how a pre-0.11
      // share link — it carries no size — still loads.
      if (banner.size !== undefined && !bannerPanelSizes(catalog).some((s) => s.id === banner.size)) {
        banner = { armId: banner.armId, count: banner.count, heightFt: banner.heightFt }
      }
      // Phase 0.11 (D3): the same height window the accessory path uses, so the
      // two banner paths agree — floor at bannerMinFt (10 ft on a 25 ft+ pole),
      // ceiling leaves room for the panel above its bottom-edge mounting height.
      const poleFt = partById(catalog, next.pole)?.heightFt ?? 20
      const { minFt, maxFt } = bannerHeightRange(catalog, poleFt, banner.size)
      const clampedFt = Math.min(maxFt, Math.max(minFt, banner.heightFt))
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

/**
 * Fill every empty slot with the first CONFIGURABLE compatible part, walking
 * fixture-first. This is the pre-8/12 repair behavior preserved as an explicit
 * act: repair never makes choices any more, but tests (and any future
 * "build one for me" affordance) still need a one-call complete assembly.
 */
export function autofillConfig(catalog: Catalog, config: PoleConfig): PoleConfig {
  const next = { ...config }
  for (const slot of SLOT_ORDER) {
    if (next[slot]) continue
    const options = compatibleParts(catalog, next, slot).filter((p) => !isComingSoon(p))
    next[slot] = options[0]?.id ?? ''
  }
  return repairConfig(catalog, next)
}

export function defaultConfig(catalog: Catalog, brand: ProductLine = 'WiLLstudio'): PoleConfig {
  // Phase 0.12_TO (Tyler 8/12): the builder opens as a BLANK SLATE — no part
  // pre-selected in any slot, no spec selections seeded. Every section sits
  // open and unselected; the customer's first act is choosing, not undoing.
  // (This retired 0.12 (D)'s fixture seeding, which existed only to keep the
  // seed off Coming Soon parts — nothing is seeded now.)
  const fixture = ''
  const seeded = undefined
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
