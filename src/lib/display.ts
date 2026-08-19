/**
 * Phase 0.10.5_TO: builder-display name normalization. Catalog part names are
 * the official willbrands.com titles, some carrying the brand as a prefix
 * ("WiLLstudio® DWX Flood & Spot"). Inside a brand's own builder that prefix
 * is redundant and inconsistent with the other cards, so displayed names drop
 * it. Display-only: quote text, downloads, and catalog data keep the full
 * official names (and this survives catalog regeneration, unlike a data edit).
 */
export function displayPartName(name: string): string {
  return name.replace(/^(WiLLstudio|WiLLsport|WiLLev|WiLLcloud|NAFCO)[®™]?\s+/i, '')
}

/**
 * Phase 0.17 (Tyler 8/19): bracket card naming — "the PN should be on the
 * right (just like it is); the name should use whatever is in the spec sheet
 * minus the PN." Arm names from willbrands.com lead with their code ("SH1
 * Shepherds Hook", "HSX Decorative Upsweep Arms"), which duplicated the
 * card's code chip. Strips the leading token only when it IS one of the
 * part's own model codes or their consolidated X-form (HS1/HS2 → HSX) —
 * data-driven, so a name that legitimately starts with a word ("Side
 * Shepherds Hook…") is never touched. Display-only, like displayPartName.
 */
export function displayArmName(part: {
  name: string
  modelCodes?: Record<string, string>
}): string {
  const name = displayPartName(part.name)
  const codes = Object.values(part.modelCodes ?? {})
  if (codes.length === 0) return name
  const [first, ...rest] = name.split(/\s+/)
  const isCode =
    codes.includes(first) ||
    (/^[A-Z]{2,3}X$/.test(first) && codes.some((c) => c.startsWith(first.slice(0, -1))))
  return isCode && rest.length > 0 ? rest.join(' ') : name
}
