import { describe, it, expect } from 'vitest'
import { parseRoute, builderPath, productPath, brandHomePath, BRAND_SLUGS } from './routes'

describe('BRAND_SLUGS', () => {
  it('maps WiLLstudio to studio', () => {
    expect(BRAND_SLUGS['WiLLstudio']).toBe('studio')
  })
  it('maps every real brand to a slug; only Other has none', () => {
    expect(BRAND_SLUGS['NAFCO']).toBe('nafco')
    expect(BRAND_SLUGS['WiLLsport']).toBe('sport')
    expect(BRAND_SLUGS['WiLLev']).toBe('ev')
    expect(BRAND_SLUGS['WiLLcloud']).toBe('cloud')
    expect(BRAND_SLUGS['Other']).toBeNull()
  })
})

describe('builderPath', () => {
  it('returns /studio/design for WiLLstudio', () => {
    expect(builderPath('WiLLstudio')).toBe('/studio/design')
  })
  it('falls back to /studio/design for brands with no slug', () => {
    expect(builderPath('Other')).toBe('/studio/design')
  })
})

describe('brandHomePath', () => {
  it('returns the builder for WiLLstudio', () => {
    expect(brandHomePath('WiLLstudio')).toBe('/studio/design')
  })
  it('returns /<slug> for other brands', () => {
    expect(brandHomePath('NAFCO')).toBe('/nafco')
    expect(brandHomePath('WiLLsport')).toBe('/sport')
    expect(brandHomePath('WiLLev')).toBe('/ev')
    expect(brandHomePath('WiLLcloud')).toBe('/cloud')
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

  it('parses /studio/product/ (trailing slash, no id) as WiLLstudio builder', () => {
    const result = parseRoute('/studio/product/')
    expect(result.brand).toBe('WiLLstudio')
    expect(result.view.kind).toBe('builder')
  })

  it('parses /nafco as the NAFCO brand home', () => {
    const result = parseRoute('/nafco')
    expect(result.brand).toBe('NAFCO')
    expect(result.view.kind).toBe('home')
  })

  it('parses /studio as the WiLLstudio builder (brand landing)', () => {
    const result = parseRoute('/studio')
    expect(result.brand).toBe('WiLLstudio')
    expect(result.view.kind).toBe('builder')
  })

  it('parses /sport/product/<id> as a WiLLsport product', () => {
    const result = parseRoute('/sport/product/willsport-kbx-lighting-system')
    expect(result.brand).toBe('WiLLsport')
    expect(result.view.kind).toBe('product')
    if (result.view.kind === 'product') {
      expect(result.view.productId).toBe('willsport-kbx-lighting-system')
    }
  })

  it('parses /nafco/unknown as the NAFCO brand home', () => {
    const result = parseRoute('/nafco/unknown')
    expect(result.brand).toBe('NAFCO')
    expect(result.view.kind).toBe('home')
  })
})
