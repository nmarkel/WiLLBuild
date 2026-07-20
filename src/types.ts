export type Slot = 'pole' | 'baseCover' | 'arm' | 'fixture'
export type PartSlot = Slot | 'standalone'

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
  /** Official category order per product line (willbrands.com/pages/products) — drives CatalogNav pill order. */
  categories?: Record<string, string[]>
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
}
