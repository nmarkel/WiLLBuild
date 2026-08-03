export type Slot = 'pole' | 'baseCover' | 'arm' | 'fixture'
/**
 * `banner` is a positional accessory (Phase 0.8, Workstream C): a mid-shaft
 * bracket pair, NOT one of the four assembly slots the stepper walks. It is a
 * PartSlot so banner-arm parts can live in the catalog, but it is deliberately
 * kept out of `Slot` so the generic slot machinery (SLOT_ORDER, repairConfig's
 * slot sweep, config[slot]) never treats it as a scalar assembly selection.
 */
export type PartSlot = Slot | 'standalone' | 'banner'

export type ProductLine = 'NAFCO' | 'WiLLsport' | 'WiLLstudio' | 'WiLLev' | 'WiLLcloud' | 'Other'
export type ProductClass = 'assembly-part' | 'standalone'
export type AssetTier = 1 | 2 | 3

export interface SocketDef {
  type: string
  /** Offset from the part's origin, in meters (+Y up). */
  position: [number, number, number]
}

export type PlaceholderSpec =
  | { kind: 'pole'; heightM: number; radiusTopM: number; radiusBottomM: number }
  | { kind: 'baseCover'; heightM: number; radiusTopM: number; radiusBottomM: number }
  | { kind: 'tube'; points: [number, number, number][]; radiusM: number }
  | { kind: 'box'; sizeM: [number, number, number]; direction: 'up' | 'down' }
  | { kind: 'cone'; radiusM: number; heightM: number; direction: 'up' | 'down' }
  /** Revolved silhouette: [radiusM, yM] pairs from the attachment origin — negative y hangs below (pendants). */
  | { kind: 'lathe'; profile: [number, number][] }
  /** Faceted cylinder (sides=4 → tapered lantern bodies, pyramid roofs). Stands up from origin like baseCover. */
  | { kind: 'prism'; radiusTopM: number; radiusBottomM: number; heightM: number; sides: number }
  /** Compound part assembled from child specs at local offsets. */
  | { kind: 'group'; children: { spec: PlaceholderSpec; position: [number, number, number] }[] }

export interface CatalogPart {
  id: string
  slot: PartSlot
  name: string
  family: string
  line: ProductLine
  /** Descriptive category, e.g. 'fixture', 'arm', 'pole', 'base-cover', 'Area & Site', 'High Bay'. */
  category: string
  productClass: ProductClass
  dropShip: boolean
  tier: AssetTier
  heightFt?: number
  /** Socket type this part attaches to on its host (null for poles, which are the root). Optional for standalone. */
  mount?: string | null
  /** Sockets this part exposes for other parts to attach to. Optional for standalone. */
  sockets?: Record<string, SocketDef>
  /**
   * Phase 0.8 (A2): the arm counts / banner side-counts this part supports in a
   * radial arrangement, e.g. [1,2,3,4]. On a pole it's the counts the pole top
   * can host; on an arm it's the counts that arm can cluster into; on a banner
   * arm it's the side-counts (1 / 2-opposite / 4). The effective allowed set for
   * a config is the intersection of the host and guest lists (see compat.ts).
   * Absent → single only ([1]).
   */
  arrangements?: number[]
  finishes: string[]
  /** Phrases the describe-your-product parser matches against (lowercase). */
  keywords: string[]
  /**
   * Fixtures only: where the luminaire's light source sits relative to the
   * fixture origin, in meters — drives the conceptual night-mode light.
   */
  lightOffset?: [number, number, number]
  /** GLB path; null while parts are placeholder primitives. */
  model: string | null
  /** Parametric primitive spec for preview; optional for standalone (photo-card tier). */
  placeholder?: PlaceholderSpec
  /** Product photo URL/path for photo-card display and thumbnails. */
  photo?: string
  thumbnail: string | null
  productUrl: string
  /** Phase 0.8 (D): spec-sheet-parsed ordering-matrix options (only spec-parsed parts). */
  options?: SpecOption[]
  optionsMeta?: SpecOptionsMeta
}

/**
 * Phase 0.8 (Workstream D): a product's configurable options, parsed
 * programmatically from its spec-sheet ordering matrix (docs.willbrands.com/
 * <handle>.pdf) — see `scripts/spec-parse/` and `docs/spec-options.md`. This is
 * the option-schema layer, distinct from geometry: it drives the configurator's
 * dropdowns + validation. Never hand-transcribed.
 */
export interface SpecOptionValue {
  /** Order-code token, e.g. "BK", "5W", "WHP3NP". */
  code: string
  /** Human label from the sheet, e.g. "Black", "150° Type V Square". */
  label: string
  /**
   * true  = buildable in the configurator today (only the 5 real catalog finishes),
   * null  = pending Tyler/Cole confirmation (gate behind "request a quote"),
   * false = confirmed quote-only.
   */
  buildable: boolean | null
  /** Catalog finish id this value maps to, when buildable (else null). */
  mapsTo: string | null
  note: string | null
}

/** One column of the ordering matrix = one configurator choice. */
export interface SpecOption {
  /** Unique slug within the part. */
  key: string
  label: string
  group: 'ordering' | 'options-accessories'
  orderPosition: number
  values: SpecOptionValue[]
}

export interface SpecOptionsMeta {
  /** Spec-sheet PDF URL the options were parsed from. */
  source: string | null
  sourcePage: number | null
  parseStatus: 'ok' | 'partial' | 'failed'
  /** Human-review flags for columns the parser couldn't split cleanly. */
  gaps: string[]
}

/** Narrows a CatalogPart to an assembly part (slot is a Slot, has placeholder/sockets/mount). */
export function isAssemblyPart(
  p: CatalogPart,
): p is CatalogPart & {
  slot: Slot
  placeholder: PlaceholderSpec
  sockets: Record<string, SocketDef>
} {
  return p.slot !== 'standalone' && p.placeholder !== undefined && p.sockets !== undefined
}

export interface FinishDef {
  id: string
  name: string
  hex: string
  roughness: number
  metalness: number
  /** Clearcoat layer strength (0 = matte powder coat, 1 = full gloss lacquer). */
  clearcoat: number
  clearcoatRoughness: number
  /** HDRI environment reflection strength for this finish. */
  envMapIntensity: number
  keywords: string[]
  /** RAL colour code for this finish (provisional — palette unconfirmed). */
  ral?: string
}

/** A known stock combination; a config matching one gets the "Standard" status chip. */
export interface ReferenceAssembly {
  pole: string
  baseCover: string
  arm: string
  fixture: string
}

export interface Catalog {
  parts: CatalogPart[]
  finishes: FinishDef[]
  /** True until the standard WiLLcoat palette is confirmed — surfaced in the UI. */
  finishesProvisional: boolean
  referenceAssemblies: ReferenceAssembly[]
  /** Official category order per product line (willbrands.com/pages/products) — drives brand-showroom category order. */
  categories?: Record<string, string[]>
}

/**
 * Phase 0.8 (Workstream C): a mid-shaft banner-arm accessory. A bracket pair
 * (top + bottom of the banner) mounted at a height up the pole shaft, repeated
 * radially on `count` sides (1 / 2-opposite / 4). `armId` is a catalog part with
 * `slot: 'banner'`. Custom banner artwork is explicitly deferred — the render
 * carries a plain placeholder panel only.
 */
export interface BannerConfig {
  armId: string
  /** Number of sides the banner bracket set repeats on (1 | 2 | 4). */
  count: number
  /** Height up the pole shaft, in feet, where the banner's vertical center sits. */
  heightFt: number
}

/** The single serializable configuration object — becomes the platform's structured config JSON. */
export interface PoleConfig {
  configId: string
  brand: ProductLine
  pole: string
  baseCover: string
  arm: string
  fixture: string
  finish: string
  rev: number
  /**
   * Phase 0.8 (A1): how many arms are mounted radially around the pole top.
   * 1 = single (default), 2 = twin @180°, 3 = triple @120°, 4 = quad @90°.
   * All arms carry the same `arm` + `fixture`; the arrangement is even-spaced.
   * Optional so pre-0.8 configs and share URLs (which omit it) read as single.
   */
  armCount?: number
  /** Phase 0.8 (C): optional mid-shaft banner-arm accessory; null/absent = none. */
  banner?: BannerConfig | null
  /**
   * Phase 0.8 (D): selected spec-sheet option codes, keyed by SpecOption.key
   * (e.g. {"lumen-output":"80","distribution":"5W"}). Drives the ordering-code
   * summary; values whose SpecOptionValue.buildable !== true route to a quote.
   */
  specOptions?: Record<string, string>
}
