import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { Catalog, CatalogPart, PoleConfig } from '../types'
import { attachSocket, partById } from '../lib/compat'
import { PlaceholderPart } from './PlaceholderPart'

interface Props {
  catalog: Catalog
  config: PoleConfig
}

/**
 * Assembles the selected parts by attaching each one at its host's socket
 * position — positions come from catalog data, never hardcoded offsets.
 */
export function Assembly({ catalog, config }: Props) {
  const pole = partById(catalog, config.pole)
  const baseCover = partById(catalog, config.baseCover)
  const arm = partById(catalog, config.arm)
  const fixture = partById(catalog, config.fixture)

  const finish = catalog.finishes.find((f) => f.id === config.finish) ?? catalog.finishes[0]

  // One shared PBR material across all paintable parts so a finish swap is a
  // single material change, applied instantly to the whole assembly.
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: finish.hex,
        roughness: finish.roughness,
        metalness: finish.metalness,
        // Lathe silhouettes (fixture brims, open rims) are visible from both sides.
        side: THREE.DoubleSide,
      }),
    [finish],
  )
  useEffect(() => () => material.dispose(), [material])

  if (!pole) return null

  const socketOf = (part: CatalogPart | undefined, host: CatalogPart | undefined) =>
    part && host ? attachSocket(part, host) : undefined

  const baseSocket = socketOf(baseCover, pole)
  const armSocket = socketOf(arm, pole)
  const fixtureSocket = socketOf(fixture, arm)

  return (
    <group>
      <PlaceholderPart spec={pole.placeholder} material={material} />
      {baseCover && baseSocket && (
        <group position={baseSocket.position}>
          <PlaceholderPart spec={baseCover.placeholder} material={material} />
        </group>
      )}
      {arm && armSocket && (
        <group position={armSocket.position}>
          <PlaceholderPart spec={arm.placeholder} material={material} />
          {fixture && fixtureSocket && (
            <group position={fixtureSocket.position}>
              <PlaceholderPart spec={fixture.placeholder} material={material} />
            </group>
          )}
        </group>
      )}
    </group>
  )
}
