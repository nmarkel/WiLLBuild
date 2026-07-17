import { describe, it, expect } from 'vitest'
import { parseRoute, builderPath, productPath, BRAND_SLUGS } from './routes'

describe('BRAND_SLUGS', () => {
  it('maps WiLLstudio to studio', () => {
    expect(BRAND_SLUGS['WiLLstudio']).toBe('studio')
  })
  it('maps all other brands to null', () => {
    expect(BRAND_SLUGS['NAFCO']).toBeNull()
    expect(BRAND_SLUGS['WiLLsport']).toBeNull()
    expect(BRAND_SLUGS['WiLLev']).toBeNull()
    expect(BRAND_SLUGS['WiLLcloud']).toBeNull()
    expect(BRAND_SLUGS['Other']).toBeNull()
  })
})

describe('builderPath', () => {
  it('returns /studio/design for WiLLstudio', () => {
    expect(builderPath('WiLLstudio')).toBe('/studio/design')
  })
  it('falls back to /studio/design for brands with no slug', () => {
    expect(builderPath('NAFCO')).toBe('/studio/design')
  })
})

describe('productPath', () => {
  it('returns /studio/product/<id> for WiLLstudio', () => {
    expect(productPath('WiLLstudio', 'hdx-high-bay')).toBe('/studio/product/hdx-high-bay')
  })
})

describe('parseRoute', () => {
  it('parses /studio/design as WiLLstudio builder', () => {
    const result = parseRoute('/studio/design')
    expect(result.brand).toBe('WiLLstudio')
    expect(result.view.kind).toBe('builder')
  })

  it('parses /studio/product/hdx-high-bay as WiLLstudio product', () => {
    const result = parseRoute('/studio/product/hdx-high-bay')
    expect(result.brand).toBe('WiLLstudio')
    expect(result.view.kind).toBe('product')
    if (result.view.kind === 'product') {
      expect(result.view.productId).toBe('hdx-high-bay')
    }
  })

  it('parses / as WiLLstudio builder (default)', () => {
    const result = parseRoute('/')
    expect(result.brand).toBe('WiLLstudio')
    expect(result.view.kind).toBe('builder')
  })

  it('parses empty string as WiLLstudio builder (default)', () => {
    const result = parseRoute('')
    expect(result.brand).toBe('WiLLstudio')
    expect(result.view.kind).toBe('builder')
  })

  it('falls back to WiLLstudio builder for unknown brand slug', () => {
    const result = parseRoute('/unknown-brand/design')
    expect(result.brand).toBe('WiLLstudio')
    expect(result.view.kind).toBe('builder')
  })

  it('falls back to WiLLstudio builder for unknown path shape', () => {
    const result = parseRoute('/some/random/path')
    expect(result.brand).toBe('WiLLstudio')
    expect(result.view.kind).toBe('builder')
  })
})
