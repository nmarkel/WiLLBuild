import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Catalog, PoleConfig } from '../types'
import { attachSocket, compatibleParts, defaultConfig, partById, repairConfig } from './compat'

const catalog: Catalog = JSON.parse(readFileSync('public/catalog.json', 'utf-8'))

function config(overrides: Partial<PoleConfig>): PoleConfig {
  return {
    configId: 'test',
    pole: 'alum-pole-14',
    baseCover: 'bc-fluted',
    arm: 'sh1-shepherds-hook',
    fixture: 'gvx-pendant',
    finish: 'matte-black',
    rev: 1,
    ...overrides,
  }
}

describe('compatibleParts (fixture-first)', () => {
  it('offers every fixture unconditionally', () => {
    expect(compatibleParts(catalog, config({}), 'fixture')).toHaveLength(4)
  })

  it('offers only pendant arms for the GVX pendant', () => {
    const ids = compatibleParts(catalog, config({ fixture: 'gvx-pendant' }), 'arm').map((p) => p.id)
    expect(ids).toEqual(['sh1-shepherds-hook', 'pa1-pendant-arm', 'pm1-pendant-arm'])
  })

  it('offers only direct mount for post tops', () => {
    const ids = compatibleParts(catalog, config({ fixture: 'drx-post-top' }), 'arm').map((p) => p.id)
    expect(ids).toEqual(['direct-mount'])
  })

  it('offers only arm-mount carriers for the MVX coach', () => {
    const ids = compatibleParts(catalog, config({ fixture: 'mvx-coach' }), 'arm').map((p) => p.id)
    expect(ids).toEqual(['upsweep'])
  })

  it('offers every pole for any arm, and every base cover for any pole', () => {
    expect(compatibleParts(catalog, config({}), 'pole')).toHaveLength(4)
    expect(compatibleParts(catalog, config({}), 'baseCover')).toHaveLength(2)
  })
})

describe('repairConfig', () => {
  it('replaces an arm that cannot carry the new fixture', () => {
    const broken = config({ fixture: 'drx-post-top', arm: 'sh1-shepherds-hook' })
    const repaired = repairConfig(catalog, broken)
    expect(repaired.arm).toBe('direct-mount')
    expect(repaired.pole).toBe('alum-pole-14')
  })

  it('keeps a valid config unchanged', () => {
    const valid = config({})
    expect(repairConfig(catalog, valid)).toEqual(valid)
  })

  it('repairs unknown part ids from a tampered share URL', () => {
    const repaired = repairConfig(catalog, config({ fixture: 'nope', arm: 'nope', finish: 'nope' }))
    expect(partById(catalog, repaired.fixture)?.slot).toBe('fixture')
    expect(partById(catalog, repaired.arm)?.slot).toBe('arm')
    expect(repaired.finish).toBe('matte-black')
  })
})

describe('attachSocket', () => {
  it('finds the socket position for a fixture on its arm', () => {
    const arm = partById(catalog, 'sh1-shepherds-hook')!
    const fixture = partById(catalog, 'gvx-pendant')!
    expect(attachSocket(fixture, arm)?.position).toEqual([0.63, 0.45, 0])
  })

  it('lets a post top sit directly on the pole via the direct mount adapter', () => {
    const adapter = partById(catalog, 'direct-mount')!
    const fixture = partById(catalog, 'drx-post-top')!
    expect(attachSocket(fixture, adapter)?.type).toBe('tenon-2-3/8')
  })
})

describe('defaultConfig', () => {
  it('produces a fully valid config', () => {
    const cfg = defaultConfig(catalog)
    expect(repairConfig(catalog, cfg)).toEqual(cfg)
    expect(cfg.pole && cfg.baseCover && cfg.arm && cfg.fixture && cfg.finish).toBeTruthy()
  })
})

describe('mount-type rules (H3b)', () => {
  const base: PoleConfig = {
    configId: 'test',
    pole: 'alum-pole-14',
    baseCover: 'bc-fluted',
    arm: '',
    fixture: 'gvx-pendant',
    finish: 'matte-black',
    rev: 1,
  }

  it('post-top fixtures only get the direct mount in the arm step', () => {
    const cfg = { ...base, fixture: 'drx-post-top' }
    const arms = compatibleParts(catalog, cfg, 'arm').map((p) => p.id)
    expect(arms).toEqual(['direct-mount'])
  })

  it('TEX post-top also only gets the direct mount in the arm step', () => {
    const cfg = { ...base, fixture: 'tex-post-top' }
    const arms = compatibleParts(catalog, cfg, 'arm').map((p) => p.id)
    expect(arms).toEqual(['direct-mount'])
  })
  it('coach fixtures only get the upsweep', () => {
    const cfg = { ...base, fixture: 'mvx-coach' }
    const arms = compatibleParts(catalog, cfg, 'arm').map((p) => p.id)
    expect(arms).toEqual(['upsweep'])
  })
  it('pendants only get pendant arms', () => {
    const cfg = { ...base, fixture: 'gvx-pendant' }
    const arms = compatibleParts(catalog, cfg, 'arm').map((p) => p.id)
    expect(arms).toEqual(['sh1-shepherds-hook', 'pa1-pendant-arm', 'pm1-pendant-arm'])
  })
  it('repairConfig moves a post-top off an arm onto the direct mount', () => {
    const cfg = { ...base, fixture: 'drx-post-top', arm: 'upsweep' }
    expect(repairConfig(catalog, cfg).arm).toBe('direct-mount')
  })
})
