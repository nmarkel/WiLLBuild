import type { Catalog, CatalogPart, PoleConfig, Slot } from '../types'
import { bannerSummaryLine, formatPanelSize } from './banner'
import {
  bannerPanelSize,
  configStatus,
  finishFor,
  isBannerKitLabel,
  optionLabel,
  partById,
  specCodes,
} from './compat'
import { DEFAULT_SCENE, shareUrl, type Scene } from './url'

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

export function buildPartNumber(
  catalog: Catalog,
  config: PoleConfig,
  slot: Slot,
): string | undefined {
  const part = partById(catalog, config[slot])
  if (!part) return undefined
  // Arms carry official per-configuration model codes (SH1, SS3, AR2, …) —
  // that code IS the arm's ordering part number for the chosen count.
  if (slot === 'arm' && part.modelCodes) {
    const base = part.modelCodes[config.armCount ?? 1]
    if (base === undefined) return undefined
    // Phase 0.11 (Workstream C): SH1 offers the CF1/CF2/CF3 centre-feature
    // codes, so a model-code arm must still carry its chosen options —
    // `SH1-CF2`, not a bare `SH1`. Arms with no options column are unchanged.
    return [base, ...addOnCodes(part, config, slot)].join('-')
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
    if (selected) {
      segments.push(selected)
    } else if (opt.key.startsWith('finish-color')) {
      // The sheet's own code when it lists this finish, else the palette code
      // (covers sheets whose finish column predates a newly added color).
      segments.push(
        opt.values.find((v) => v.mapsTo === finishId)?.code ??
          catalog.finishes.find((f) => f.id === finishId)?.code ??
          '_',
      )
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
