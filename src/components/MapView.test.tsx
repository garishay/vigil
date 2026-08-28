import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MapView } from './MapView'
import { AO } from '../config/ao'

// jsdom has no WebGL, so MapLibre is mocked. These tests guard the config wiring — that the map
// is built from src/config/ao.ts and nowhere else — not MapLibre's own behavior.
const { mapInstance, MapConstructor, NavigationControl } = vi.hoisted(() => {
  const instance = {
    addControl: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    remove: vi.fn(),
    on: vi.fn((event: string, handler: () => void) => {
      if (event === 'load') handler()
    }),
  }
  return {
    mapInstance: instance,
    MapConstructor: vi.fn<(options: Record<string, unknown>) => typeof instance>(function () {
      return instance
    }),
    NavigationControl: vi.fn(),
  }
})

vi.mock('maplibre-gl', () => ({ Map: MapConstructor, NavigationControl, setWorkerUrl: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MapView', () => {
  it('builds the map from the AO config rather than its own coordinates', () => {
    render(<MapView ao={AO} />)
    expect(MapConstructor).toHaveBeenCalledTimes(1)
    expect(MapConstructor.mock.calls[0][0]).toMatchObject({
      style: AO.basemapStyleUrl,
      center: AO.center,
      zoom: AO.zoom,
    })
  })

  it('adds a navigation control so the map pans and zooms', () => {
    render(<MapView ao={AO} />)
    expect(NavigationControl).toHaveBeenCalled()
    expect(mapInstance.addControl).toHaveBeenCalled()
  })

  it('draws one protection ring per configured protected site', () => {
    render(<MapView ao={AO} />)
    const [sourceId, source] = mapInstance.addSource.mock.calls[0]
    expect(sourceId).toBe('protected-sites')
    expect(source.data.features).toHaveLength(AO.protectedSites.length)
    expect(source.data.features[0].properties).toMatchObject({ id: AO.protectedSites[0].id })
    expect(mapInstance.addLayer).toHaveBeenCalledTimes(2)
  })

  it('tears the map down on unmount', () => {
    const { unmount } = render(<MapView ao={AO} />)
    unmount()
    expect(mapInstance.remove).toHaveBeenCalled()
  })
})
