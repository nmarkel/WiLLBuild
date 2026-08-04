import { describe, expect, it } from 'vitest'
import type { PoleConfig } from '../types'
import {
  configToParams,
  paramsToPartialConfig,
  productToParams,
  paramsToViewMode,
  paramsToScene,
  DEFAULT_SCENE,
} from './url'

const config: PoleConfig = {
  configId: 'test',
  brand: 'WiLLstudio',
  pole: 'alum-pole-14',
  baseCover: 'bc-fluted',
  arm: 'upsweep',
  fixture: 'drx-post-top',
  finish: 'forest-green',
  rev: 1,
}

describe('config <-> URL params', () => {
  it('round-trips every part selection', () => {
    const partial = paramsToPartialConfig(configToParams(config))
    expect(partial).toEqual({
      pole: 'alum-pole-14',
      baseCover: 'bc-fluted',
      arm: 'upsweep',
      fixture: 'drx-post-top',
      finish: 'forest-green',
    })
  })

  it('does not leak configId or rev into the URL', () => {
    const params = configToParams(config)
    expect(params.get('configId')).toBeNull()
    expect(params.get('rev')).toBeNull()
  })

  it('returns null for a URL with no config params', () => {
    expect(paramsToPartialConfig(new URLSearchParams('?utm_source=x'))).toBeNull()
  })
})

describe('arm count <-> URL params (Phase 0.8 A4)', () => {
  it('omits the single-arm default from the URL', () => {
    expect(configToParams({ ...config, armCount: 1 }).get('arms')).toBeNull()
    expect(configToParams(config).get('arms')).toBeNull()
  })

  it('round-trips a multi-arm count', () => {
    const params = configToParams({ ...config, armCount: 3 })
    expect(params.get('arms')).toBe('3')
    expect(paramsToPartialConfig(params)?.armCount).toBe(3)
  })

  it('ignores out-of-range arm counts', () => {
    expect(paramsToPartialConfig(new URLSearchParams('?arms=9'))?.armCount).toBeUndefined()
    expect(paramsToPartialConfig(new URLSearchParams('?arms=abc'))?.armCount).toBeUndefined()
  })
})

describe('banner <-> URL params (Phase 0.8 C/A4)', () => {
  it('omits an absent banner', () => {
    expect(configToParams(config).get('banner')).toBeNull()
    expect(configToParams({ ...config, banner: null }).get('banner')).toBeNull()
  })

  it('round-trips a banner accessory', () => {
    const banner = { armId: 'ba1-banner-arm', count: 2, heightFt: 8 }
    const params = configToParams({ ...config, banner })
    expect(params.get('banner')).toBe('ba1-banner-arm~2~8')
    expect(paramsToPartialConfig(params)?.banner).toEqual(banner)
  })

  it('ignores a malformed banner param', () => {
    expect(paramsToPartialConfig(new URLSearchParams('?banner=~~'))?.banner).toBeUndefined()
  })
})

describe('spec options <-> URL params (Phase 0.8 D, per-slot in 1.0)', () => {
  it('omits absent / empty spec options', () => {
    expect(configToParams(config).get('opts')).toBeNull()
    expect(configToParams({ ...config, specOptions: {} }).get('opts')).toBeNull()
    expect(configToParams({ ...config, specOptions: { fixture: {} } }).get('opts')).toBeNull()
  })

  it('round-trips selected spec options across slots', () => {
    const specOptions = {
      fixture: { 'lumen-output': '80', mounting: 'ARM' },
      pole: { 'fixture-mounting': 'T23' },
    }
    const params = configToParams({ ...config, specOptions })
    expect(paramsToPartialConfig(params)?.specOptions).toEqual(specOptions)
  })

  it('serializes spec options deterministically (keys sorted)', () => {
    // Same map, different insertion order -> identical string (share-link stability).
    const a = configToParams({ ...config, specOptions: { fixture: { mounting: 'ARM', color: 'BK' } } })
    const b = configToParams({ ...config, specOptions: { fixture: { color: 'BK', mounting: 'ARM' } } })
    expect(a.get('opts')).toBe('fixture.color:BK,fixture.mounting:ARM')
    expect(a.get('opts')).toBe(b.get('opts'))
  })

  it('reads legacy pre-1.0 pairs (no slot prefix) as fixture options', () => {
    const partial = paramsToPartialConfig(new URLSearchParams('?opts=color:BK,mounting:ARM'))
    expect(partial?.specOptions).toEqual({ fixture: { color: 'BK', mounting: 'ARM' } })
  })

  it('ignores a malformed opts param (no valid key:code pairs)', () => {
    expect(paramsToPartialConfig(new URLSearchParams('?opts=garbage'))?.specOptions).toBeUndefined()
    expect(paramsToPartialConfig(new URLSearchParams('?opts='))?.specOptions).toBeUndefined()
  })

  it('keeps only well-formed pairs from a partially-malformed opts param', () => {
    const partial = paramsToPartialConfig(
      new URLSearchParams('?opts=fixture.color:BK,junk,notaslot.k:V,pole.mounting:ARM'),
    )
    expect(partial?.specOptions).toEqual({ fixture: { color: 'BK' }, pole: { mounting: 'ARM' } })
  })
})

describe('per-part finishes <-> URL params (Phase 1.0)', () => {
  it('omits absent / empty finish overrides', () => {
    expect(configToParams(config).get('fins')).toBeNull()
    expect(configToParams({ ...config, finishes: {} }).get('fins')).toBeNull()
  })

  it('round-trips per-slot finish overrides (base finish param unchanged)', () => {
    const finishes = { fixture: 'matte-black', pole: 'silver' }
    const params = configToParams({ ...config, finishes })
    expect(params.get('finish')).toBe('forest-green')
    expect(params.get('fins')).toBe('fixture:matte-black,pole:silver')
    expect(paramsToPartialConfig(params)?.finishes).toEqual(finishes)
  })

  it('drops unknown slots from a fins param', () => {
    const partial = paramsToPartialConfig(new URLSearchParams('?fins=fixture:silver,evil:hack'))
    expect(partial?.finishes).toEqual({ fixture: 'silver' })
  })
})

describe('brand round-trip', () => {
  it('default brand (WiLLstudio) is omitted from params', () => {
    const params = configToParams({ ...config, brand: 'WiLLstudio' })
    expect(params.get('brand')).toBeNull()
  })

  it('non-default brand is serialized to params', () => {
    const params = configToParams({ ...config, brand: 'NAFCO' })
    expect(params.get('brand')).toBe('NAFCO')
  })

  it('non-default brand round-trips through params', () => {
    const partial = paramsToPartialConfig(configToParams({ ...config, brand: 'WiLLsport' }))
    expect(partial?.brand).toBe('WiLLsport')
  })

  it('default brand is not present in partial (caller merges defaultConfig)', () => {
    const partial = paramsToPartialConfig(configToParams({ ...config, brand: 'WiLLstudio' }))
    // brand key absent — caller fills it from defaultConfig
    expect(partial?.brand).toBeUndefined()
  })

  it('invalid brand (not in ProductLine union) is ignored', () => {
    const params = new URLSearchParams('?pole=alum-pole-14&brand=evilstring')
    const partial = paramsToPartialConfig(params)
    // brand key must be absent when invalid
    expect(partial?.brand).toBeUndefined()
    // but other valid params are still present
    expect(partial?.pole).toBe('alum-pole-14')
  })

  it('valid non-default brand is accepted and present in partial', () => {
    const params = new URLSearchParams('?pole=alum-pole-14&brand=NAFCO')
    const partial = paramsToPartialConfig(params)
    expect(partial?.brand).toBe('NAFCO')
    expect(partial?.pole).toBe('alum-pole-14')
  })
})

describe('scene <-> URL params', () => {
  it('default scene (Park) is omitted from params', () => {
    const params = configToParams(config, 'park')
    expect(params.get('scene')).toBeNull()
  })

  it('scene param is absent when scene is not passed (backwards compatible)', () => {
    expect(configToParams(config).get('scene')).toBeNull()
  })

  it('non-default scene is serialized', () => {
    expect(configToParams(config, 'street').get('scene')).toBe('street')
    expect(configToParams(config, 'courtyard').get('scene')).toBe('courtyard')
  })

  it('non-default scene round-trips through params', () => {
    const params = configToParams(config, 'courtyard')
    expect(paramsToScene(params)).toBe('courtyard')
  })

  it('absent scene param reads back as the default', () => {
    expect(paramsToScene(configToParams(config))).toBe(DEFAULT_SCENE)
    expect(paramsToScene(new URLSearchParams(''))).toBe('park')
  })

  it('unknown scene value falls back to the default (not trusted)', () => {
    expect(paramsToScene(new URLSearchParams('?scene=evilstring'))).toBe(DEFAULT_SCENE)
  })

  it('scene param does not leak into the parsed config', () => {
    const partial = paramsToPartialConfig(configToParams(config, 'street'))
    expect(partial).not.toHaveProperty('scene')
  })
})

describe('product view <-> URL params', () => {
  it('productToParams round-trips to product view', () => {
    const params = productToParams('hdx-high-bay')
    expect(params.get('product')).toBe('hdx-high-bay')
    const view = paramsToViewMode(params)
    expect(view).toEqual({ kind: 'product', productId: 'hdx-high-bay' })
  })

  it('config params round-trip to builder view', () => {
    const params = configToParams(config)
    const view = paramsToViewMode(params)
    expect(view).toEqual({ kind: 'builder' })
  })

  it('product param wins when both product and config params are present', () => {
    const params = configToParams(config)
    params.set('product', 'hdx-high-bay')
    const view = paramsToViewMode(params)
    expect(view).toEqual({ kind: 'product', productId: 'hdx-high-bay' })
  })

  it('builder view when no params present', () => {
    const view = paramsToViewMode(new URLSearchParams(''))
    expect(view).toEqual({ kind: 'builder' })
  })
})

describe('multi-select spec options <-> URL params (Phase 1.0)', () => {
  it('joins multi codes with + and round-trips them as an array', () => {
    const specOptions = { fixture: { options: ['WHP3NP', 'N5P'] } }
    const params = configToParams({ ...config, specOptions })
    expect(params.get('opts')).toBe('fixture.options:WHP3NP+N5P')
    expect(paramsToPartialConfig(params)?.specOptions).toEqual(specOptions)
  })

  it('a single-code multi column parses as a plain string (repairConfig normalizes)', () => {
    const params = configToParams({ ...config, specOptions: { fixture: { options: ['WHP3NP'] } } })
    expect(params.get('opts')).toBe('fixture.options:WHP3NP')
    expect(paramsToPartialConfig(params)?.specOptions).toEqual({ fixture: { options: 'WHP3NP' } })
  })

  it('omits empty arrays', () => {
    expect(configToParams({ ...config, specOptions: { fixture: { options: [] } } }).get('opts')).toBeNull()
  })
})
