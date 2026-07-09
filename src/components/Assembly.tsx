import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Catalog, CatalogPart, PoleConfig } from '../types'
import { attachSocket, partById } from '../lib/compat'
import { PlaceholderPart } from './PlaceholderPart'

interface Props {
  catalog: Catalog
  config: PoleConfig
  /** Night preset: the luminaire emits light. Conceptual, not photometric. */
  night?: boolean
}

const LIGHT_COLOR = '#ffd9a0'

/**
 * Conceptual luminaire glow for night mode, placed at the fixture's catalog
 * `lightOffset`: an emissive lens (blooms), a local point light, and a wide
 * spot pooling light on the ground below.
 */
function FixtureLight() {
  const spot = useRef<THREE.SpotLight>(null)
  const target = useRef<THREE.Object3D>(null)

  useEffect(() => {
    if (spot.current && target.current) spot.current.target = target.current
  }, [])

  return (
    <group>
      <mesh>
        <sphereGeometry args={[0.07, 16, 16]} />
        <meshStandardMaterial
          color={LIGHT_COLOR}
          emissive={LIGHT_COLOR}
          emissiveIntensity={5}
          toneMapped={false}
        />
      </mesh>
      <pointLight color={LIGHT_COLOR} intensity={30} distance={12} decay={1.8} />
      <spotLight
        ref={spot}
        color={LIGHT_COLOR}
        intensity={220}
        angle={0.85}
        penumbra={0.7}
        distance={25}
        decay={1.5}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0005}
      />
      <object3D ref={target} position={[0, -6, 0]} />
    </group>
  )
}

/**
 * Assembles the selected parts by attaching each one at its host's socket
 * position — positions come from catalog data, never hardcoded offsets.
 */
export function Assembly({ catalog, config, night = false }: Props) {
  const pole = partById(catalog, config.pole)
  const baseCover = partById(catalog, config.baseCover)
  const arm = partById(catalog, config.arm)
  const fixture = partById(catalog, config.fixture)

  const finish = catalog.finishes.find((f) => f.id === config.finish) ?? catalog.finishes[0]

  // One shared PBR material across all paintable parts so a finish swap is a
  // single material change, applied instantly to the whole assembly. Each
  // WiLLcoat finish carries its own measured powder-coat response: clearcoat
  // separates gloss finishes from matte, envMapIntensity scales HDRI pickup.
  const material = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: finish.hex,
        roughness: finish.roughness,
        metalness: finish.metalness,
        clearcoat: finish.clearcoat,
        clearcoatRoughness: finish.clearcoatRoughness,
        envMapIntensity: finish.envMapIntensity,
        // Lathe silhouettes (fixture brims, open rims) are visible from both sides.
        side: THREE.DoubleSide,
      }),
    [finish],
  )
  useEffect(() => () => material.dispose(), [material])

  if (!pole || !pole.placeholder) return null

  const socketOf = (part: CatalogPart | undefined, host: CatalogPart | undefined) =>
    part && host ? attachSocket(part, host) : undefined

  const baseSocket = socketOf(baseCover, pole)
  const armSocket = socketOf(arm, pole)
  const fixtureSocket = socketOf(fixture, arm)

  return (
    <group>
      <PlaceholderPart spec={pole.placeholder} material={material} />
      {baseCover && baseCover.placeholder && baseSocket && (
        <group position={baseSocket.position}>
          <PlaceholderPart spec={baseCover.placeholder} material={material} />
        </group>
      )}
      {arm && arm.placeholder && armSocket && (
        <group position={armSocket.position}>
          <PlaceholderPart spec={arm.placeholder} material={material} />
          {fixture && fixture.placeholder && fixtureSocket && (
            <group position={fixtureSocket.position}>
              <PlaceholderPart spec={fixture.placeholder} material={material} />
              {night && fixture.lightOffset && (
                <group position={fixture.lightOffset}>
                  <FixtureLight />
                </group>
              )}
            </group>
          )}
        </group>
      )}
    </group>
  )
}
