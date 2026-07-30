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
