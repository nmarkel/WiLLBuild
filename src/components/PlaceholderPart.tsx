import { useMemo } from 'react'
import * as THREE from 'three'
import type { PlaceholderSpec } from '../types'

interface Props {
  spec: PlaceholderSpec
  material: THREE.Material
}

/**
 * Parametric stand-in geometry rendered until real GLBs come through the asset
 * pipeline. Lives behind the same catalog interface: origin at the part's lower
 * attachment point, +Y up, real meters. Lathe/prism/group specs approximate the
 * actual product silhouettes (modeled from willbrands.com product photos).
 */
export function PlaceholderPart({ spec, material }: Props) {
  const curvedGeometry = useMemo(() => {
    if (spec.kind === 'tube') {
      const curve = new THREE.CatmullRomCurve3(spec.points.map((p) => new THREE.Vector3(...p)))
      return new THREE.TubeGeometry(curve, 32, spec.radiusM, 12, false)
    }
    if (spec.kind === 'lathe') {
      const points = spec.profile.map(([r, y]) => new THREE.Vector2(r, y))
      return new THREE.LatheGeometry(points, 48)
    }
    return null
  }, [spec])

  switch (spec.kind) {
    case 'pole':
    case 'baseCover':
      return (
        <mesh castShadow material={material} position={[0, spec.heightM / 2, 0]}>
          <cylinderGeometry args={[spec.radiusTopM, spec.radiusBottomM, spec.heightM, 32]} />
        </mesh>
      )
    case 'tube':
    case 'lathe':
      return <mesh castShadow material={material} geometry={curvedGeometry!} />
    case 'prism':
      // Rotate so a flat face (not an edge) faces forward, like a real lantern.
      return (
        <mesh
          castShadow
          material={material}
          position={[0, spec.heightM / 2, 0]}
          rotation={[0, Math.PI / 4, 0]}
        >
          <cylinderGeometry args={[spec.radiusTopM, spec.radiusBottomM, spec.heightM, spec.sides]} />
        </mesh>
      )
    case 'group':
      return (
        <group>
          {spec.children.map((child, i) => (
            <group key={i} position={child.position}>
              <PlaceholderPart spec={child.spec} material={material} />
            </group>
          ))}
        </group>
      )
    case 'box': {
      const y = spec.direction === 'up' ? spec.sizeM[1] / 2 : -spec.sizeM[1] / 2
      return (
        <mesh castShadow material={material} position={[0, y, 0]}>
          <boxGeometry args={spec.sizeM} />
        </mesh>
      )
    }
    case 'cone': {
      const up = spec.direction === 'up'
      return (
        <mesh
          castShadow
          material={material}
          position={[0, up ? spec.heightM / 2 : -spec.heightM / 2, 0]}
          rotation={[up ? 0 : Math.PI, 0, 0]}
        >
          <coneGeometry args={[spec.radiusM, spec.heightM, 32]} />
        </mesh>
      )
    }
  }
}
