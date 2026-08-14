export type Slot = 'pole' | 'baseCover' | 'arm' | 'fixture'
/**
 * `banner` is a positional accessory (Phase 0.8, Workstream C): a mid-shaft
 * bracket pair, NOT one of the four assembly slots the stepper walks. It is a
 * PartSlot so banner-arm parts can live in the catalog, but it is deliberately
 * kept out of `Slot` so the generic slot machinery (SLOT_ORDER, repairConfig's
 * slot sweep, config[slot]) never treats it as a scalar assembly selection.
 */
export type PartSlot = Slot | 'standalone' | 'banner' | 'accessory'

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
  /**
   * Phase 0.12 (D): true when this part's render layers come from Cole's real
   * CAD rather than a placeholder solid.
   *
   * GENERATED — `scripts/merge-real-cad-flag.mjs` stamps it from the render
   * rig's `real-parts.json`. Never hand-edit it: the whole point is that a part
   * stops being "Coming Soon" the moment Workstream A maps its geometry, with
   * nothing to remember. `src/lib/availability.test.ts` keeps the two in step.
   */
  realCad?: boolean
  /**
   * Phase 0.12: an EDITORIAL hold — this product is finished enough to render
   * but is deliberately outside the configurator's current cut.
   *
   * Deliberately a separate axis from `realCad`, not an override of it. Tyler's
   * 8/11 cut is GVX + TEX only, so DRX / MVX / DWX come out even though all
   * three render from real CAD. Expressing that by clearing `realCad` would be
   * a lie about the geometry — the flag is generated from the render rig and
   * still points at each part's real CAD source — and it would silently drag
   * the render pipeline and the coverage gate along with a merchandising call.
   *
   * Hand-set, unlike `realCad`. A part held this way does NOT re-enable itself
   * when Workstream A lands more geometry: someone has to decide it is in the
   * cut and delete the flag.
   */
  comingSoon?: boolean
  /**
   * Phase 0.12_TO (Tyler 8/12): curated default codes for this part's
   * ORDERING columns, keyed by column key — seeds `config.specOptions` when
   * the part is chosen so the derived part number is complete out of the
   * gate (GVX: 15,200 lm / 5000K / 120-277V / 90° Type V Medium). Hand-set
   * like `comingSoon`; a code absent from the sheet's column never seeds.
   */
  specDefaults?: Record<string, string>
  /** Pole OD in inches (WiLLstudio RSAA = 4). Drives the derived base-cover
      Pole Fit code — a function of the pole, never a customer choice. */
  diameterIn?: number
  /**
   * CR-OPT-06 (Tyler 8/14): arms only — the cord code a pendant fixture gets
   * when hung from this bracket. Absent → the WHP7NP standard. The cord is
   * REQUIRED with a WiLLstudio bracket and derived, never customer-chosen.
   */
  cordCode?: string
  /**
   * CR-OPT-15 (Tyler 8/14): arms only — the pole's fixture-mounting code this
   * bracket implies (PF flush arm fit for nearly all; FR2 → PD). Derived,
   * never customer-chosen; absent → blank placeholder, determined at quote.
   * NOT an exclusivity claim — other mountings may be compatible.
   */
  mountingCode?: string
  /**
   * Phase 0.12_TO (Tyler 8/12): this part may sell from PLACEHOLDER art — an
   * explicit, per-part exemption from the geometry-gap Coming Soon rule.
   *
   * The 8/11 rule (also Tyler's) said a placeholder must not sit next to real
   * products as an equal; this flag is him narrowing that rule for named
   * parts he wants orderable now (SD/HS/PM1 pendant brackets). Hand-set like
   * `comingSoon`, and self-cleaning in effect: once the part's real CAD lands,
   * `realCad` flips true and this flag simply stops mattering.
   */
  placeholderApproved?: boolean
  /**
   * Phase 0.12 (D): a configuration concept rather than a manufactured product
   * — today the `direct-mount` tenon adapter, which is how you say "no arm".
   *
   * Pseudo-parts need no CAD ever, so the Coming Soon rule must skip them:
   * badging one would advertise a future product that will never exist, and
   * disabling it would remove the only way to configure a post-top fixture with
   * no arm at all.
   */
  pseudoPart?: boolean
  heightFt?: number
  /** Socket type this part attaches to on its host (null for poles, which are the root). Optional for standalone. */
  mount?: string | null
  /** Sockets this part exposes for other parts to attach to. Optional for standalone. */
  sockets?: Record<string, SocketDef>
  /**
   * Phase 0.12: correction applied to this part's ORIGIN when it is attached to
   * its host, in the part's own frame (metres, +Y up).
   *
   * `ASSETS.md` requires a part's origin to be its lower attachment point, and
   * every arm honours that — except FR2, whose real CAD puts y=0 at the tips of
   * the decorative finials that hang BELOW the crossarm, leaving its pole collar
   * 0.0889 m up. Placed by the book, the crossarm floated 3.5" off the pole.
   *
   * Kept as a placement correction rather than baked into the socket positions
   * on purpose: the sockets stay in the GLB's own frame, so a number measured
   * off the CAD can be written straight into the catalog with no rebasing, and
   * exactly one field carries the discrepancy. The alternative — a translate at
   * ingest in `real-parts.json`, alongside `rotateY` — is arguably more correct
   * (it would make the asset obey ASSETS.md rather than compensating for it),
   * but it moves the rig's recorded anchor and so needs the part re-rendered.
   */
  mountOffset?: [number, number, number]
  /**
   * Phase 0.8 (A2): the arm counts / banner side-counts this part supports in a
   * radial arrangement, e.g. [1,2,3,4]. On a pole it's the counts the pole top
   * can host; on an arm it's the counts that arm can cluster into; on a banner
   * arm it's the side-counts (1 / 2-opposite / 4). The effective allowed set for
   * a config is the intersection of the host and guest lists (see compat.ts).
   * Absent → single only ([1]).
   */
  arrangements?: number[]
  /**
   * Phase 0.10.5: official ordering model code per radial count (arms), e.g.
   * {1:"SS1",2:"SS2",3:"SS3",4:"SS4"} — the arm's part number for that
   * configuration. Keys mirror `arrangements`.
   */
  modelCodes?: Record<number, string>
  /**
   * Phase 0.10.5: the part's ordering-matrix design code (e.g. "RSAA" = Round
   * Straight Aluminum Anchor Base), when the design is a property of the part
   * itself rather than a customer choice — e.g. every WiLLstudio decorative
   * pole is the anchor-base variant. `buildPartNumber` reads this instead of
   * matching against the parsed `design` column's values (see summary.ts).
   */
  designCode?: string
  finishes: string[]
  /** Phrases the describe-your-product parser matches against (lowercase). */
  keywords: string[]
  /**
   * Fixtures only: where the luminaire's light source sits relative to the
   * fixture origin, in meters — drives the conceptual night-mode light.
   */
  lightOffset?: [number, number, number]
  /**
   * CR-PLC-05 (Tyler 8/14): pendant fixtures only — how far the body hangs
   * BELOW its mount point, in meters. Measured from the part's own render
   * (asset height minus anchor y, over pxPerMeterY), never guessed. Drives
   * the banner-top clearance below the fixture.
   */
  hangM?: number
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
  /**
   * Phase 0.12_TO (Tyler 8/12): this accessory takes a shaft placement
   * (height/orientation). Replaces the sheets' "(Specify Pole Height &
   * Orientation)" label boilerplate, which plain-English copy dropped —
   * label matching on PLACEMENT_MARKER remains as back-compat for parts
   * whose sheets haven't had the copy treatment.
   */
  placeable?: boolean
  /**
   * CR-OPT-06 (Tyler 8/14): this row is DERIVED — shown checked and locked in
   * the UI (it ships with the build), and its own code never enters the part
   * number; the resolver appends the derived code instead (cord: from the
   * bracket). Old share URLs may still carry the row's code harmlessly.
   */
  derived?: boolean
  /**
   * CR-OPT-07 (Tyler 8/14): when this row is selected, the code that enters
   * the part number resolves by the part's chosen VOLTAGE code (MV/HV) —
   * e.g. the surge suppressor's SRGXXX10 becomes SRG27710 (MV) / SRG48010
   * (HV). Unmapped or unchosen voltage → the row's own code prints as-is.
   */
  resolvesBy?: Record<string, string>
  /**
   * CR-OPT-10 (Tyler 8/14): like resolvesBy, but keyed by the chosen POLE's
   * outside diameter in inches — the hand hole's size digit is a function of
   * the pole (HHX → HHX-4 on a 4" pole). No/unknown diameter → own code.
   */
  resolvesByDiameter?: Record<string, string>
  /**
   * CR-OPT-15 (Tyler 8/14): like resolvesBy, but keyed by the placement
   * instance's PANEL SIZE id and resolved per instance — the banner arm kit
   * prints BA18/BA24/BA30, the arm length following each banner's width.
   * Instances without a stored size use the catalog's default panel.
   */
  resolvesBySize?: Record<string, string>
  /**
   * CR-OPT-14 (Tyler 8/14): choosing this value REQUIRES the named columns'
   * selections to be among the allowed codes (PF flush arm fit → wall D/E).
   * The UI disables incompatible chips; repair clears a constrained column's
   * violating choice back to unchosen (never auto-picks a replacement).
   */
  requires?: Record<string, string[]>
  /**
   * CR-PLC-09 (Tyler 8/14): attention line shown when this accessory is
   * SELECTED (banner kits: engineering reviews every application at quote).
   */
  disclaimer?: string
  /**
   * Phase 0.14 (Tyler 8/14): the render-only catalog part (slot 'accessory' —
   * the banner-part pattern, never selectable) whose layer the compositor
   * places at each of this accessory's configured instances. Absent → the
   * accessory has no visual (or, for banner kits, uses the banner path).
   */
  renderPartId?: string
  /**
   * CR-PLC-07 (Tyler 8/14): bespoke shaft-placement window for this
   * accessory — floor/ceiling/default in feet, step in inches. Absent fields
   * fall back to the generic rules (label minimum / pole-top clearance /
   * 1-inch granularity). The pole's own ceiling still applies on short poles.
   */
  placement?: {
    minFt?: number
    maxFt?: number
    defaultFt?: number
    stepIn?: number
    /** CR-OPT-11: this accessory may repeat on one pole, each instance placed. */
    multi?: boolean
    /** CR-OPT-12: instance cap (couplings: 3 — more via engineering). */
    maxInstances?: number
    /** CR-OPT-12: minimum vertical gap between same-orientation instances, ft. */
    minGapFt?: number
    /**
     * CR-OPT-13: when set, minGapFt applies ACROSS every accessory sharing
     * this group, regardless of orientation (hand holes + festoons share the
     * shaft-access group — an opening is an opening).
     */
    spacingGroup?: string
    /** CR-OPT-13: combined instance cap across the spacing group (HH+FSTR: 2, mix and match). */
    groupMaxInstances?: number
  }
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
  /** Spec-sheet order code (BK, DB, WH, NA, LG, SG, DG, DP, GM, BA, BKA, SA, RAL). */
  code: string
  /**
   * Finish-type PN segment this color implies: FP (painted, incl. custom RAL)
   * or AN (anodized, aluminum only).
   */
  typeCode: string
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

/**
 * Phase 0.11 (D2): a banner panel the customer can order, in inches (W × H).
 * Panel sizes are product-offering data, so they live in `public/catalog.json`
 * (core architecture rule 1) rather than in a component or lib constant — the
 * banner UI, the clamp math and the quote text all read them from there.
 */
export interface BannerPanelSize {
  /** Stable id used in the config object and share URLs, e.g. "24x48". */
  id: string
  /** Panel width in inches (across the pole). */
  widthIn: number
  /** Panel height in inches — the drop from the top bar to the bottom bar. */
  heightIn: number
  /** Exactly one size is the default; 24" width is the most commonly ordered. */
  default?: boolean
}

export interface Catalog {
  parts: CatalogPart[]
  finishes: FinishDef[]
  /** True until the standard WiLLcoat palette is confirmed — surfaced in the UI. */
  finishesProvisional: boolean
  referenceAssemblies: ReferenceAssembly[]
  /** Official category order per product line (willbrands.com/pages/products) — drives brand-showroom category order. */
  categories?: Record<string, string[]>
  /** Phase 0.11 (D2): the fixed banner panel sizes offered on banner-arm kits. */
  bannerPanelSizes?: BannerPanelSize[]
}

/**
 * Phase 0.8 (Workstream C): a mid-shaft banner-arm accessory. A bracket pair
 * (top + bottom of the banner) mounted at a height up the pole shaft, repeated
 * radially on `count` sides (1 / 2-opposite / 4). `armId` is a catalog part with
 * `slot: 'banner'`. Custom banner artwork is explicitly deferred — the render
 * carries a plain placeholder panel only.
 */
/**
 * Phase 0.10.5: shaft placement for a pole accessory whose label carries the
 * "Specify Pole Height & Orientation" marker (festoon, couplings, extra hand
 * holes, flag/plant holders). Height in feet above grade; orientation is one
 * of the four compass rotations relative to the 0° hand-hole reference.
 */
export interface AccessoryPlacement {
  /**
   * Mounting height up the pole shaft, in feet above grade.
   *
   * REFERENCE POINT (Phase 0.11, D1 — this was undefined before and is now
   * pinned): the height is measured to the accessory's own MOUNTING POINT, and
   * for banner-arm kits (BA24/BA30) that mounting point is the BOTTOM OF THE
   * BANNER — the same reference `BannerConfig.heightFt` uses, so the legacy
   * banner path and the accessory path can never disagree. Puddy's spec
   * measures banner mounting height to the bottom of the banner; measuring to
   * the vertical centre (the pre-0.11 behaviour) reported a 24×48 banner at the
   * 8 ft floor as compliant when its bottom edge actually sat at ~6 ft.
   */
  heightFt: number
  orientation: number
  /** Banner-arm kits (BA24/BA30) only: how many radial sides — 1 | 2 (@180) | 4. */
  sides?: number
  /**
   * Banner-arm kits only (Phase 0.11, D2): the ordered panel size, as a
   * `Catalog.bannerPanelSizes[].id`. Optional — absent means the catalog
   * default (24×48), so pre-0.11 share URLs keep loading.
   */
  size?: string
}

export interface BannerConfig {
  armId: string
  /** Number of sides the banner bracket set repeats on (1 | 2 | 4). */
  count: number
  /**
   * Height up the pole shaft, in feet above grade.
   *
   * REFERENCE POINT (Phase 0.11, D1 — CHANGED): this is the BOTTOM OF THE
   * BANNER, not its vertical centre. Puddy's spec measures banner mounting
   * height to the bottom edge; the pre-0.11 centre reference made a 24×48
   * banner placed at the 8 ft minimum hang down to ~6 ft while the app still
   * reported it compliant. `AccessoryPlacement.heightFt` uses the same
   * reference for BA24/BA30 kits, so the two banner paths agree.
   */
  heightFt: number
  /**
   * Phase 0.11 (D2): the ordered panel size, as a `Catalog.bannerPanelSizes[].id`
   * (18x36 | 24x48 | 30x60). Optional — absent means the catalog default
   * (24×48), so pre-0.11 share URLs keep loading.
   */
  size?: string
}

/** The single serializable configuration object — becomes the platform's structured config JSON. */
export interface PoleConfig {
  configId: string
  brand: ProductLine
  pole: string
  baseCover: string
  arm: string
  fixture: string
  /**
   * Base finish. Kept as the single-finish field the frozen geometry-service
   * contract and pre-0.10.5 share URLs expect; the UI no longer offers a global
   * finish step — it acts as the default for any slot without a `finishes`
   * override (see `finishFor` in lib/compat.ts).
   */
  finish: string
  /**
   * Phase 0.10.5 (concierge steps): per-part finish overrides, keyed by slot.
   * Absent slot → the part renders in the base `finish`. The describe-box
   * parser still writes `finish` only, so "in a black finish" colors every
   * part that hasn't been individually overridden.
   */
  finishes?: Partial<Record<Slot, string>>
  /**
   * Phase 0.12: the SECOND finish some parts order in, keyed by slot.
   *
   * TEX is the first: its sheet carries two finish segments — the Housing
   * colour and the Spider Mount & Accent Line colour — and requires the accent
   * designation even on side mounts, where the mounting arm matches the
   * housing. A part with one finish column ignores this entirely.
   *
   * Absent slot → the accent falls back to that slot's own finish, exactly as
   * an absent `finishes` entry falls back to the base `finish`. That is a
   * default, not a fabricated choice: the fallback value is a colour the
   * customer really did pick. Which parts have an accent is data, not code —
   * see `hasAccentFinish` in lib/compat.ts.
   */
  accentFinishes?: Partial<Record<Slot, string>>
  /**
   * Phase 0.10.5: when a slot's finish is `custom-ral`, the customer's picked
   * color as a #rrggbb hex, keyed by slot. Feeds the swatch + quote text; the
   * render itself stays the neutral custom-ral layer until real RAL-tinted
   * assets exist.
   */
  finishRal?: Partial<Record<Slot, string>>
  rev: number
  /**
   * Phase 0.8 (A1): how many arms are mounted radially around the pole top.
   * 1 = single (default), 2 = twin @180°, 3 = triple @120°, 4 = quad @90°.
   * All arms carry the same `arm` + `fixture`; the arrangement is even-spaced.
   * Optional so pre-0.8 configs and share URLs (which omit it) read as single.
   */
  armCount?: number
  /**
   * Phase 0.10.5: rotation of the whole arm arrangement about the pole, in
   * degrees — 0 | 90 | 180 | 270. Optional so pre-0.10.5 configs read as 0.
   */
  armOrientation?: number
  /** Phase 0.8 (C): optional mid-shaft banner-arm accessory; null/absent = none. */
  banner?: BannerConfig | null
  /**
   * Phase 0.10.5: shaft placements keyed by the selected pole-accessory order
   * code (FSTR, CPL-P-12, FH, …). Only meaningful while the code is selected
   * in the pole's options — repairConfig prunes the rest.
   */
  /**
   * CR-OPT-11 (Tyler 8/14): placements are INSTANCED — an accessory marked
   * `placement.multi` (couplings, hand holes) may repeat on one pole, each
   * instance with its own height/orientation. Arrays are canonical; legacy
   * single-object entries (old share URLs, pre-8/14 configs) are normalized
   * at the boundaries (placementInstances / the URL parser).
   */
  accessoryPlacements?: Record<string, AccessoryPlacement[]>
  /**
   * Phase 0.8 (D), reshaped in 0.10.5: selected spec-sheet option codes, keyed by
   * slot then SpecOption.key (e.g. {"fixture":{"lumen-output":"80"},"pole":
   * {"anchor-bolts-base-type-finish-type":"AB"}}) — each part step carries its
   * own ordering-table choices. Ordering columns are single-choice (string);
   * options & accessories columns are multi-select (string[]), constrained to
   * one code per exclusive family — cord/surge/photocontrol (see
   * EXCLUSIVE_CODE_FAMILIES in lib/compat.ts). Values whose
   * SpecOptionValue.buildable !== true route to a quote. Legacy flat share
   * URLs are read as fixture options.
   */
  specOptions?: Partial<Record<Slot, Record<string, string | string[]>>>
}
