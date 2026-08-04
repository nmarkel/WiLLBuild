import type {
  Catalog,
  CatalogPart,
  OrderingDesign,
  OrderingFitCode,
  PartSelections,
  PoleConfig,
  Slot,
  SpecOption,
} from '../types'
import { attachSocket, partById } from './compat'

/**
 * Phase 0.10, Workstream 0 — the part-number resolver.
 *
 * Per Tyler (8/3) the configured **part number is the primary output**: a
 * designer drops the WiLL SKU into their spec and it becomes the project's
 * basis of design. So every component resolves its OWN number and the
 * configurator's headline deliverable is the complete set.
 *
 *     [Product Family] - [Design] - [Pole/Tenon Fit] - [Finish] [- Options]
 *     WP - AR2 - 50F - BK
 *
 * Two data sources, one output shape — no code table lives in this module:
 *
 *  1. `part.ordering` — the WiLLstudio arms/base-cover matrix, transcribed into
 *     `docs/ordering-matrix.json` and merged into the catalog by
 *     `scripts/merge-ordering.mjs`. Family + arm count resolve the design code.
 *  2. `part.options`  — the machine-parsed spec-sheet ordering matrix (Phase 0.8
 *     Workstream D). Its `ordering`-group columns ARE the number's segments, in
 *     sheet order (`WD-GVX-80-30-MV-5W-BK-PM`).
 *
 * A part with neither resolves to NO number (`unavailable`), never a guessed
 * one. A column the customer hasn't chosen renders as `?` and marks the number
 * incomplete, so an unfinished spec never looks finished.
 */

/** Placeholder for an ordering column the customer hasn't chosen yet. */
export const UNSPECIFIED = '?'

const IN_PER_M = 1 / 0.0254

export type SegmentSource = 'family' | 'design' | 'fit' | 'finish' | 'spec' | 'option'

export interface PartNumberSegment {
  /** Column label from the matrix, e.g. "Design", "Pole/Tenon Fit", "Lumen Output". */
  label: string
  /** Resolved code, or null when nothing is chosen/derivable yet. */
  code: string | null
  source: SegmentSource
  /** SpecOption.key (or `design`) — lets the UI jump straight to the control that fills this segment. */
  optionKey?: string
  /** Human label of the resolved value, when known. */
  valueLabel?: string
}

export interface PartNumber {
  partId: string
  partName: string
  /** Which assembly role this component plays ("Fixture", "Arm", …). */
  slotLabel: string
  /** Assembled part number; unresolved segments appear as `?`. Empty when unavailable. */
  code: string
  segments: PartNumberSegment[]
  /** True when every required (non-option) segment resolved. */
  complete: boolean
  /** Why no number could be assembled at all — null when one was. */
  unavailable: string | null
  /** Provenance of the matrix behind this number. */
  source: string | null
  /** The spec-sheet parse for this part is flagged for human review. */
  parseFlagged: boolean
}

const SLOT_LABELS: Record<string, string> = {
  fixture: 'Fixture',
  arm: 'Arm',
  pole: 'Pole',
  baseCover: 'Base Cover',
  banner: 'Banner Arm',
  standalone: 'Product',
}

/** The assembly components that carry their own part number, in selection order. */
const NUMBERED_SLOTS: Slot[] = ['fixture', 'arm', 'pole', 'baseCover']

/** This part's ordering selections (never undefined — callers can read freely). */
export function selectionsFor(config: PoleConfig, partId: string): PartSelections {
  return config.partOptions?.[partId] ?? {}
}

/**
 * A spec-sheet column that carries the finish COLOUR. The finish is chosen once
 * for the whole assembly (the Finish step), so these columns are driven by
 * `config.finish` instead of being offered as another dropdown.
 *
 * Matched on the "finish-color" key prefix, which also catches TEX's merged
 * housing + spider-mount finish column
 * (`finish-color-finish-color-spider-mount`). Deliberately NOT a bare
 * `includes('finish')`: the decorative-pole sheet has a separate
 * `anchor-bolts-base-type-finish-type` column (finish TYPE — painted vs
 * anodized), which is a real customer choice, not the colour.
 */
export function isFinishColumn(option: SpecOption): boolean {
  return option.key.startsWith('finish-color')
}

/**
 * The multi-select fields. Per Tyler (8/3) the "Options" field within Product
 * Options is multi-select — customers add SEVERAL accessories to one config —
 * while ordering columns (Voltage, Distribution, Mounting…) stay single-select.
 * `options-2` exists because the DRX/MVX/pole sheets lay one Options list out in
 * two physical columns (see docs/spec-options.md).
 */
export function isMultiSelectOption(option: SpecOption): boolean {
  return /^options(-\d+)?$/.test(option.key) || option.key === 'accessories'
}

/** The part-family code column ("WD"/"WP") — it becomes the leading segment, not a choice. */
function isFamilyColumn(option: SpecOption): boolean {
  return option.key === 'product-family'
}

const byPosition = (a: SpecOption, b: SpecOption) => a.orderPosition - b.orderPosition

/** Spec columns the customer picks one value from, in sheet order. */
export function singleSelectColumns(part: CatalogPart): SpecOption[] {
  return (part.options ?? [])
    .filter((o) => !isFamilyColumn(o) && !isFinishColumn(o) && !isMultiSelectOption(o))
    .sort(byPosition)
}

/** Spec columns the customer picks any number of values from, in sheet order. */
export function multiSelectColumns(part: CatalogPart): SpecOption[] {
  return (part.options ?? []).filter(isMultiSelectOption).sort(byPosition)
}

/**
 * The multi-select fields as the CUSTOMER should see them: one "Options" field
 * and one "Accessories" field. The DRX/MVX/pole sheets lay a single Options list
 * out in two physical columns, which the parser emits as `options` + `options-2`
 * (a documented needs-human-review gap in docs/spec-options.md); Tyler asked for
 * ONE multi-select Options field, so same-labelled columns are concatenated here.
 * Values keep their sheet order and are de-duplicated by code.
 */
export function mergedMultiSelectFields(part: CatalogPart): SpecOption[] {
  const merged: SpecOption[] = []
  for (const column of multiSelectColumns(part)) {
    const existing = merged.find((m) => m.label === column.label)
    if (!existing) {
      merged.push({ ...column, values: [...column.values] })
      continue
    }
    for (const value of column.values) {
      if (!existing.values.some((v) => v.code === value.code)) existing.values.push(value)
    }
  }
  return merged
}

/**
 * The design codes available for a part, filtered to the arm count in play.
 * Side Shepherds Hook + 3 arms → [SS3]; the upsweep + 1 arm → [BR12, BR13]
 * (same count, different arm length), so the customer picks among them.
 */
export function designsForCount(part: CatalogPart, armCount: number): OrderingDesign[] {
  const designs = part.ordering?.designs ?? []
  const counted = designs.filter((d) => d.armCount !== undefined)
  if (counted.length === 0) return designs
  return counted.filter((d) => d.armCount === armCount)
}

/** Nearest fit code to a nominal OD, within the catalog's stated tolerance. */
function fitCodeForOd(
  table: OrderingFitCode[],
  odIn: number,
  toleranceIn: number,
): OrderingFitCode | undefined {
  let best: OrderingFitCode | undefined
  let bestDelta = Infinity
  for (const entry of table) {
    if (entry.odIn === null) continue
    const delta = Math.abs(entry.odIn - odIn)
    if (delta < bestDelta) {
      best = entry
      bestDelta = delta
    }
  }
  return best && bestDelta <= toleranceIn ? best : undefined
}

/** The part a component mounts onto — the fit segment is derived from it. */
function hostFor(catalog: Catalog, config: PoleConfig, part: CatalogPart): CatalogPart | undefined {
  switch (part.slot) {
    case 'fixture':
      return partById(catalog, config.arm)
    case 'arm':
    case 'baseCover':
    case 'banner':
      return partById(catalog, config.pole)
    default:
      return undefined
  }
}

/** The Pole/Tenon Fit segment, or null when this family has no fit column. */
function fitSegment(
  catalog: Catalog,
  config: PoleConfig,
  part: CatalogPart,
): PartNumberSegment | null {
  const ordering = part.ordering
  const tables = catalog.ordering
  if (!ordering || !ordering.fit || !tables) return null
  const table = tables.fitCodes[ordering.fit]
  if (!table) return null

  const segment: PartNumberSegment = { label: 'Pole/Tenon Fit', code: null, source: 'fit' }

  let odIn: number | undefined
  if (ordering.fitFrom === 'hostPoleShaftOd') {
    const pole = partById(catalog, config.pole)
    const shaft = pole?.placeholder
    if (shaft && 'radiusTopM' in shaft) odIn = shaft.radiusTopM * 2 * IN_PER_M
  } else {
    const host = hostFor(catalog, config, part)
    const socket = host ? attachSocket(part, host) : undefined
    if (socket) odIn = tables.socketOdIn[socket.type]
  }
  if (odIn === undefined) return segment

  const hit = fitCodeForOd(table, odIn, tables.fitToleranceIn)
  if (hit) {
    segment.code = hit.code
    segment.valueLabel = hit.label
  }
  return segment
}

/** The Finish segment — always driven by the assembly finish, never a dropdown. */
function finishSegment(catalog: Catalog, config: PoleConfig, label = 'Finish'): PartNumberSegment {
  const finish = catalog.finishes.find((f) => f.id === config.finish)
  return {
    label,
    code: finish?.code ?? null,
    source: 'finish',
    valueLabel: finish?.name,
  }
}

/** Segments for the selected multi-select add-ons, in sheet order (deterministic). */
function addOnSegments(part: CatalogPart, selections: PartSelections): PartNumberSegment[] {
  const chosen = new Set(selections.addOns ?? [])
  if (chosen.size === 0) return []
  const segments: PartNumberSegment[] = []

  // Matrix options (arms: CF1/CF2/CF3) first, then spec-sheet Options/Accessories.
  for (const option of part.ordering?.options ?? []) {
    if (chosen.has(option.code)) {
      segments.push({
        label: 'Options',
        code: option.code,
        source: 'option',
        optionKey: 'ordering-options',
        valueLabel: option.label,
      })
    }
  }
  for (const column of multiSelectColumns(part)) {
    for (const value of column.values) {
      if (chosen.has(value.code)) {
        segments.push({
          label: column.label,
          code: value.code,
          source: 'option',
          optionKey: column.key,
          valueLabel: value.label,
        })
      }
    }
  }
  return segments
}

/** Segments from the transcribed ordering matrix: family, design, fit, finish. */
function matrixSegments(
  catalog: Catalog,
  config: PoleConfig,
  part: CatalogPart,
  selections: PartSelections,
): PartNumberSegment[] {
  const ordering = part.ordering!
  const segments: PartNumberSegment[] = [
    {
      label: 'Product Family',
      code: ordering.family,
      source: 'family',
      valueLabel: ordering.familyLabel,
    },
  ]

  // Design = family + arm count (SS + 3 → SS3). When several designs share the
  // count (upsweep lengths), the customer's `design` choice picks one; a single
  // candidate resolves on its own.
  const candidates = designsForCount(part, config.armCount ?? 1)
  const chosen = selections.codes?.design
  const design =
    candidates.find((d) => d.code === chosen) ?? (candidates.length === 1 ? candidates[0] : undefined)
  segments.push({
    label: 'Design',
    code: design?.code ?? null,
    source: 'design',
    optionKey: 'design',
    valueLabel: design?.label,
  })

  const fit = fitSegment(catalog, config, part)
  if (fit) segments.push(fit)

  segments.push(finishSegment(catalog, config))
  return segments
}

/** Segments from a machine-parsed spec sheet: its ordering columns, in sheet order. */
function specSegments(
  catalog: Catalog,
  config: PoleConfig,
  part: CatalogPart,
  selections: PartSelections,
): PartNumberSegment[] {
  const segments: PartNumberSegment[] = []
  const columns = [...(part.options ?? [])].sort(byPosition)

  for (const column of columns) {
    if (isMultiSelectOption(column)) continue
    if (isFamilyColumn(column)) {
      const first = column.values[0]
      segments.push({
        label: column.label,
        code: first?.code ?? null,
        source: 'family',
        valueLabel: first?.label || undefined,
      })
      continue
    }
    if (isFinishColumn(column)) {
      segments.push(finishSegment(catalog, config, column.label))
      continue
    }
    const code = selections.codes?.[column.key]
    const value = column.values.find((v) => v.code === code)
    segments.push({
      label: column.label,
      code: code ?? null,
      source: 'spec',
      optionKey: column.key,
      valueLabel: value?.label,
    })
  }
  return segments
}

/**
 * Resolve one component's WiLL part number. Returns an `unavailable` result —
 * never a fabricated code — for products whose ordering matrix we don't have.
 */
export function resolvePartNumber(
  catalog: Catalog,
  config: PoleConfig,
  partId: string,
): PartNumber {
  const part = partById(catalog, partId)
  const base: PartNumber = {
    partId,
    partName: part?.name ?? partId,
    slotLabel: SLOT_LABELS[part?.slot ?? ''] ?? 'Component',
    code: '',
    segments: [],
    complete: false,
    unavailable: 'Ordering matrix pending for this product.',
    source: null,
    parseFlagged: false,
  }
  if (!part) return base

  const selections = selectionsFor(config, partId)
  const hasMatrix = !!part.ordering
  const hasSpec = (part.options ?? []).some(isFamilyColumn)
  if (!hasMatrix && !hasSpec) return base

  const segments = hasMatrix
    ? matrixSegments(catalog, config, part, selections)
    : specSegments(catalog, config, part, selections)
  segments.push(...addOnSegments(part, selections))

  const required = segments.filter((s) => s.source !== 'option')
  return {
    ...base,
    code: segments.map((s) => s.code ?? UNSPECIFIED).join('-'),
    segments,
    complete: required.every((s) => s.code !== null),
    unavailable: null,
    source: part.ordering?.source ?? part.optionsMeta?.source ?? null,
    parseFlagged: !hasMatrix && part.optionsMeta?.parseStatus === 'partial',
  }
}

/**
 * Every component's part number for the current build, in selection order
 * (fixture → arm → pole → base cover, then the banner accessory). This set IS
 * the configurator's headline output.
 */
export function resolveAssemblyPartNumbers(catalog: Catalog, config: PoleConfig): PartNumber[] {
  const numbers: PartNumber[] = []
  for (const slot of NUMBERED_SLOTS) {
    const id = config[slot]
    if (id) numbers.push(resolvePartNumber(catalog, config, id))
  }
  if (config.banner?.armId) {
    numbers.push(resolvePartNumber(catalog, config, config.banner.armId))
  }
  return numbers
}

/** How many segments of a number still need a choice (0 = spec-able today). */
export function unresolvedCount(number: PartNumber): number {
  return number.segments.filter((s) => s.source !== 'option' && s.code === null).length
}

/** Plain-text block of the assembly's part numbers — quote requests, clipboard, PDFs. */
export function partNumbersText(numbers: PartNumber[]): string[] {
  return numbers.map((n) => {
    if (n.unavailable) return `${n.slotLabel}: ${n.partName} — part number pending matrix`
    const suffix = n.complete ? '' : ` (${unresolvedCount(n)} choice${unresolvedCount(n) === 1 ? '' : 's'} to complete)`
    return `${n.slotLabel}: ${n.code}${suffix}`
  })
}
