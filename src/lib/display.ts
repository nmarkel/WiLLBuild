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
