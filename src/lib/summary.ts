import type { Catalog, CatalogPart, PoleConfig, Slot, SpecOption } from '../types'
import { bannerSummaryLine, formatPanelSize } from './banner'
import {
  ACCENT_FINISH_KEY,
  accentFinishFor,
  bannerPanelSize,
  configStatus,
  finishFor,
  hasAccentFinish,
  isBannerKitLabel,
  optionLabel,
  partById,
  specCodes,
} from './compat'
import { DEFAULT_SCENE, shareUrl, type Scene } from './url'
import { isComingSoon } from './availability'

/**
 * Phase 0.10.5: the part's full ordering part number, assembled the way the spec
 * sheet's ordering example does (e.g. WD-DRX-80-30-MV-3M-3T-BK): every base
 * configuration column in sheet order joined with `-`, then each selected
 * option/accessory code appended with `-`. Columns the customer hasn't chosen
 * yet show `_`; columns the UI answers elsewhere fill themselves in — the
 * product family/design from the part card, the finish color from the step's
 * finish (via SpecOptionValue.mapsTo). Returns undefined for parts without a
 * parsed ordering table (no sheet, no part number).
 */
/**
 * The selected options & accessories codes for a part, in sheet-column order.
 * Shared by both `buildPartNumber` branches so a model-code arm and a
 * spec-sheet part append their add-ons identically. Mirrored by
 * `_with_add_ons` in geometry-service/app/partnumber.py.
 */
function addOnCodes(part: CatalogPart, config: PoleConfig, slot: Slot): string[] {
  const chosen = config.specOptions?.[slot] ?? {}
  return (part.options ?? [])
    .filter((o) => o.group === 'options-accessories')
    .sort((a, b) => a.orderPosition - b.orderPosition)
    .flatMap((o) => specCodes(chosen[o.key]))
}

/**
 * A finish column's code for one finish id: the sheet's own code when that
 * column lists the finish, else the palette code (covers a sheet whose finish
 * column predates a newly added colour — TEX prints 10 of the palette's 13).
 * Shared by both finish segments so Housing and Accent resolve identically.
 */
function finishCode(catalog: Catalog, opt: SpecOption, finishId: string): string {
  return (
    opt.values.find((v) => v.mapsTo === finishId)?.code ??
    catalog.finishes.find((f) => f.id === finishId)?.code ??
    '_'
  )
}

export function buildPartNumber(
  catalog: Catalog,
  config: PoleConfig,
  slot: Slot,
): string | undefined {
  const part = partById(catalog, config[slot])
  if (!part) return undefined
  // Phase 0.12 (D): a Coming Soon part produces NO part number. It is not
  // orderable yet, and a spec-able-looking SKU is precisely what a designer
  // would paste into a project spec — the one thing that must not escape for a
  // product we cannot build. Mirrored in geometry-service/app/partnumber.py.
  if (isComingSoon(part)) return undefined
  // Arms carry official per-configuration model codes (SH1, SS3, AR2, …) —
  // that code IS the arm's ordering part number for the chosen count.
  if (slot === 'arm' && part.modelCodes) {
    const base = part.modelCodes[config.armCount ?? 1]
    if (base === undefined) return undefined
    // Phase 0.12_TO (Tyler 8/12): the arm's finish colour is part of its
    // ordering number — `SS2-BK-CF2`, finish before the centre-feature codes.
    // Arms have no sheet columns, so the code comes from the palette itself.
    const armFinish = catalog.finishes.find((f) => f.id === finishFor(config, slot))?.code
    // Phase 0.11 (Workstream C): a model-code arm still carries its chosen
    // options. Tyler 8/12: arms lead with the WP product-family code like
    // every other WiLLstudio number — `WP-SS2-BK-CF2`.
    return ['WP', base, ...(armFinish ? [armFinish] : []), ...addOnCodes(part, config, slot)].join('-')
  }
  const options = part.options
  if (!options || options.length === 0) return undefined
  const chosen = config.specOptions?.[slot] ?? {}
  const finishId = finishFor(config, slot)
  const byPosition = (a: { orderPosition: number }, b: { orderPosition: number }) =>
    a.orderPosition - b.orderPosition

  const segments: string[] = []
  for (const opt of options.filter((o) => o.group === 'ordering').sort(byPosition)) {
    const selected = specCodes(chosen[opt.key])[0]
    if (opt.key === 'pole-fit') {
      // Phase 0.12_TO (Tyler 8/12): a base cover's Pole Fit is a function of
      // the chosen pole's diameter, not a customer choice — derived below and
      // appended AFTER the finish, at the end of the number.
      continue
    }
    if (selected) {
      segments.push(selected)
    } else if (opt.key === ACCENT_FINISH_KEY) {
      // Phase 0.12: TEX's second finish segment (Spider Mount & Accent Line).
      // MUST be tested before the `finish-color` prefix below, which this key
      // also matches — otherwise both columns resolve to the housing colour and
      // the accent silently duplicates it.
      segments.push(finishCode(catalog, opt, accentFinishFor(config, slot)))
    } else if (opt.key.startsWith('finish-color')) {
      segments.push(finishCode(catalog, opt, finishId))
    } else if (opt.key === 'finish-type') {
      // Finish type is a function of the picked color: FP painted / AN anodized.
      segments.push(catalog.finishes.find((f) => f.id === finishId)?.typeCode ?? opt.values[0].code)
    } else if (opt.key === 'design' && part.designCode) {
      // The pole's design code (RSAA = Round Straight Aluminum Anchor Base) is a
      // property of the part, not a customer choice. It lives on the catalog part
      // rather than being matched against opt.values, because the parsed `design`
      // column mixes design codes with lengths and wall codes — see
      // docs/part-numbers.md.
      segments.push(part.designCode)
    } else if (opt.key === 'length' && part.heightFt) {
      // Likewise: length is implied by which pole the customer picked, not a
      // dropdown choice within that pole's own options.
      segments.push(String(part.heightFt))
    } else if (opt.values.length === 1) {
      segments.push(opt.values[0].code)
    } else if (opt.values.some((v) => v.code === part.family)) {
      // The part card IS this choice (e.g. the DRX design column).
      segments.push(part.family)
    } else {
      segments.push('_')
    }
  }
  segments.push(...addOnCodes(part, config, slot))
  // Derived Pole Fit rides at the very end (after finish + add-ons): the
  // pole's OD selects the matching fit code (4" round pole → 4R).
  const fitColumn = options.find((o) => o.key === 'pole-fit')
  const poleDiameter = partById(catalog, config.pole)?.diameterIn
  const fit = fitColumn && poleDiameter
    ? fitColumn.values.find((v) => v.code === `${poleDiameter}R`)?.code
    : undefined
  if (fit) segments.push(fit)
  // Phase 0.12_TO (Tyler 8/12): trailing unanswered columns don't print — a
  // pole with nothing chosen ends after its colour code, not with `-_`.
  // Interior blanks stay: they keep the sheet's column positions readable.
  while (segments.length > 0 && segments[segments.length - 1] === '_') segments.pop()
  return segments.join('-')
}

export const SUMMARY_ROWS: { label: string; key: 'fixture' | 'arm' | 'pole' | 'baseCover' }[] = [
  { label: 'Fixture', key: 'fixture' },
  { label: 'Arm', key: 'arm' },
  { label: 'Pole', key: 'pole' },
  { label: 'Base Cover', key: 'baseCover' },
]

/**
 * Phase 0.10.5: arms mount on a 90° drilled tenon, so a triple is 3 @ 90° —
 * NOT 120°. The old label contradicted both armAzimuths (which returns
 * [0, 90, 180]) and the per-azimuth renders. Mirrors
 * _ARM_ARRANGEMENT_LABELS in geometry-service/app/generation.py.
 */
export function armArrangementLabel(count: number): string {
  return (
    { 1: 'Single', 2: 'Twin (2 @ 180°)', 3: 'Triple (3 @ 90°)', 4: 'Quad (4 @ 90°)' }[count] ??
    `${count} arms`
  )
}

/**
 * Human-readable config block — attached to quote requests and copyable from
 * the output tray. Phase 0.10.5: each part carries its own finish and its own
 * spec-sheet choices (indented under the part), with a quote flag on anything
 * not confirmed buildable online.
 */
export function buildSummaryText(
  catalog: Catalog,
  config: PoleConfig,
  /**
   * Phase 0.11 (F3): the backdrop the customer is actually looking at. Omitting
   * it silently substitutes the default, so the pasted link would restore a
   * different scene than the one they shared.
   */
  scene: Scene = DEFAULT_SCENE,
): string {
  const armCount = config.armCount ?? 1
  const banner = config.banner
  const bannerPart = banner ? partById(catalog, banner.armId) : undefined

  const partLines: string[] = []
  for (const r of SUMMARY_ROWS) {
    const part = partById(catalog, config[r.key])
    const finish = catalog.finishes.find((f) => f.id === finishFor(config, r.key))
    // Custom RAL carries the picked color so the quote knows what to match.
    const ralHex = finish?.id === 'custom-ral' ? config.finishRal?.[r.key] : undefined
    const finishName = finish ? `${finish.name}${ralHex ? ` (${ralHex.toUpperCase()})` : ''}` : ''
    partLines.push(`${r.label}: ${part ? `${part.name}${finishName ? ` — ${finishName}` : ''}` : '—'}`)
    const partNumber = buildPartNumber(catalog, config, r.key)
    if (partNumber) partLines.push(`  Part No: ${partNumber}`)
    // Phase 0.12: a two-finish part must say BOTH colours, or the quote reads as
    // one colour while the part number carries two codes.
    if (hasAccentFinish(part)) {
      const accent = catalog.finishes.find((f) => f.id === accentFinishFor(config, r.key))
      const accentCol = part?.options?.find((o) => o.key === ACCENT_FINISH_KEY)
      if (accent) {
        const label = accentCol?.label.replace(/^Finish Color\s*/, '') ?? 'Accent'
        partLines.push(`  ${label}: ${accent.name}`)
      }
    }
    const chosen = config.specOptions?.[r.key]
    if (part?.options && chosen) {
      for (const opt of part.options) {
        // Multi-select columns list one line per selected code.
        for (const code of specCodes(chosen[opt.key])) {
          const value = opt.values.find((v) => v.code === code)
          const quote = value && value.buildable !== true ? ' (quote only)' : ''
          // Placed accessories carry their shaft position for the quote.
          const placement = config.accessoryPlacements?.[code]
          const sides = placement?.sides && placement.sides > 1 ? `, ${placement.sides} sides` : ''
          // Phase 0.11 (D): say what the height measures TO, and name the
          // ordered panel — a bare "12 ft" is exactly the ambiguity the
          // centre-vs-bottom bug hid behind.
          const panel =
            placement && isBannerKitLabel(value?.label ?? '')
              ? `, ${formatPanelSize(bannerPanelSize(catalog, placement.size))} panel`
              : ''
          const placed = placement
            ? ` — placed ${placement.heightFt} ft to bottom @ ${placement.orientation}°${sides}${panel}`
            : ''
          partLines.push(`  ${optionLabel(opt)}: ${code}${value ? ` — ${value.label}` : ''}${quote}${placed}`)
        }
      }
    }
  }

  return [
    `Config ID: ${config.configId}`,
    `Status: ${configStatus(catalog, config)}`,
    ...partLines,
    ...(armCount > 1 ? [`Arm arrangement: ${armArrangementLabel(armCount)}`] : []),
    ...(config.armOrientation ? [`Arm orientation: ${config.armOrientation}°`] : []),
    ...(banner
      ? [
          `Banner arm: ${
            bannerPart
              ? bannerSummaryLine(
                  bannerPart,
                  banner.count,
                  banner.heightFt,
                  bannerPanelSize(catalog, banner.size),
                )
              : `${banner.armId} — ${banner.count}-side @ ${banner.heightFt} ft`
          }`,
        ]
      : []),
    `Link: ${shareUrl(config, scene)}`,
  ].join('\n')
}
