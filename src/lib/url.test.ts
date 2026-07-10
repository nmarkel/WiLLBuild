import { describe, expect, it } from 'vitest'
import type { PoleConfig } from '../types'
import { configToParams, paramsToPartialConfig, productToParams, paramsToViewMode } from './url'

const config: PoleConfig = {
  configId: 'test',
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
