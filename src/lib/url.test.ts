import { describe, expect, it } from 'vitest'
import type { PoleConfig } from '../types'
import { configToParams, paramsToPartialConfig } from './url'

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
