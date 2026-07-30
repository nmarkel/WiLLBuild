import { afterEach, describe, expect, it } from 'vitest'
import { useConfigurator } from './store'
import { DEFAULT_SCENE } from './lib/url'

// The scene lives on the store as its own axis (not inside `config`), so it
// survives config changes and unrelated view-state toggles. These tests run in
// the default node environment: with no catalog loaded, setScene only mutates
// state and never touches window.history, so they stay hermetic.

const initial = useConfigurator.getState()

afterEach(() => {
  useConfigurator.setState(initial, true)
})

describe('scene store persistence', () => {
  it('defaults to Park', () => {
    expect(useConfigurator.getState().scene).toBe(DEFAULT_SCENE)
    expect(useConfigurator.getState().scene).toBe('park')
  })

  it('setScene updates the scene', () => {
    useConfigurator.getState().setScene('street')
    expect(useConfigurator.getState().scene).toBe('street')
    useConfigurator.getState().setScene('courtyard')
    expect(useConfigurator.getState().scene).toBe('courtyard')
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
