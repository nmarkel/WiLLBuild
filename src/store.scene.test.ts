import { afterEach, describe, expect, it } from 'vitest'
import { useConfigurator } from './store'
import { DEFAULT_SCENE } from './lib/url'
import type { PoleConfig } from './types'

// The scene lives on the store as its own axis (not inside `config`), so it
// survives config changes and unrelated view-state toggles. These tests run in
// the default node environment: with no catalog loaded, setScene only mutates
// state and never touches window.history, so they stay hermetic.

const initial = useConfigurator.getState()

afterEach(() => {
  useConfigurator.setState(initial, true)
})

const config: PoleConfig = {
  configId: 'test',
  brand: 'WiLLstudio',
  pole: 'alum-pole-14',
  baseCover: 'bc-cl2-medium-clamshell',
  arm: 'upsweep',
  fixture: 'drx-post-top',
  finish: 'forest-green',
  rev: 1,
}

describe('scene store persistence', () => {
  // Phase 0.11 (F1): Blank is the default backdrop (was Park).
  it('defaults to Blank', () => {
    expect(useConfigurator.getState().scene).toBe(DEFAULT_SCENE)
    expect(useConfigurator.getState().scene).toBe('blank')
  })

  it('setScene updates the scene', () => {
    useConfigurator.getState().setScene('street')
    expect(useConfigurator.getState().scene).toBe('street')
    useConfigurator.getState().setScene('parking')
    expect(useConfigurator.getState().scene).toBe('parking')
  })

  it('scene survives unrelated state changes (day/night + human scale)', () => {
    useConfigurator.getState().setScene('street')
    useConfigurator.getState().toggleMode()
    useConfigurator.getState().toggleScale()
    useConfigurator.getState().toggleMode()
    // A config/view change axis must not reset the chosen backdrop.
    expect(useConfigurator.getState().scene).toBe('street')
  })
})

// Phase 0.11 (F3): the Share button used to call shareUrl(config) with no scene,
// so the link always carried the default backdrop instead of the one on screen.
describe('shareLink carries the live scene', () => {
  const params = (link: string) => new URL(link, 'https://x.test').searchParams

  it('is empty before the config loads', () => {
    expect(useConfigurator.getState().shareLink()).toBe('')
  })

  it('includes the chosen non-default scene', () => {
    useConfigurator.setState({ config })
    useConfigurator.getState().setScene('street')
    expect(params(useConfigurator.getState().shareLink()).get('scene')).toBe('street')
  })

  it('tracks a scene change without the config changing', () => {
    useConfigurator.setState({ config })
    useConfigurator.getState().setScene('park')
    expect(params(useConfigurator.getState().shareLink()).get('scene')).toBe('park')
    useConfigurator.getState().setScene('parking')
    expect(params(useConfigurator.getState().shareLink()).get('scene')).toBe('parking')
  })

  it('omits the scene param on the default backdrop, and still shares the config', () => {
    useConfigurator.setState({ config })
    const p = params(useConfigurator.getState().shareLink())
    expect(p.get('scene')).toBeNull()
    expect(p.get('pole')).toBe('alum-pole-14')
  })

  it('never leaks the session-only custom backdrop into the link', () => {
    useConfigurator.setState({ config, customSceneUrl: 'blob:fake', scene: 'custom' })
    expect(params(useConfigurator.getState().shareLink()).get('scene')).toBeNull()
  })
})
