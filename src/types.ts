export type Slot = 'pole' | 'baseCover' | 'arm' | 'fixture'

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

export interface CatalogPart {
  id: string
  slot: Slot
  name: string
  family: string
  heightFt?: number
  /** Socket type this part attaches to on its host (null for poles, which are the root). */
  mount: string | null
  /** Sockets this part exposes for other parts to attach to. */
  sockets: Record<string, SocketDef>
  finishes: string[]
  /** Phrases the describe-your-product parser matches against (lowercase). */
  keywords: string[]
  /** GLB path; null while parts are placeholder primitives. */
  model: string | null
  placeholder: PlaceholderSpec
  thumbnail: string | null
  productUrl: string
}

export interface FinishDef {
  id: string
  name: string
  hex: string
  roughness: number
  metalness: number
  keywords: string[]
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
}

/** The single serializable configuration object — becomes the platform's structured config JSON. */
export interface PoleConfig {
  configId: string
  pole: string
  baseCover: string
  arm: string
  fixture: string
  finish: string
  rev: number
}
