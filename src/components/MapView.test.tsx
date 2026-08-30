import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MapView } from './MapView'
import { AO } from '../config/ao'
import type { AdsbTrack } from '../lib/tracks'

const TRACKS: AdsbTrack[] = [
  {
    id: 'adsb-a06461',
    source: 'adsb',
    icaoHex: 'a06461',
    identity: 'cooperative',
    callsign: 'AAL423',
    position: [-75.12915, 39.69481],
    altitudeFt: 5175,
    onGround: false,
    groundSpeedKt: 275.8,
    headingDeg: 45.9,
    verticalRateFpm: -768,
    lastSeenSec: 0,
  },
  {
    id: 'adsb-a3303d',
    source: 'adsb',
    icaoHex: 'a3303d',
    identity: 'cooperative',
    callsign: null,
    position: [-75.26544, 39.86816],
    altitudeFt: 0,
    onGround: true,
    groundSpeedKt: 0,
    headingDeg: null,
    verticalRateFpm: null,
    lastSeenSec: 38,
  },
]

// jsdom has no WebGL, so MapLibre is mocked. These tests guard the config wiring — that the map
// is built from src/config/ao.ts and nowhere else — not MapLibre's own behavior.
const { mapInstance, setData, MapConstructor, NavigationControl } = vi.hoisted(() => {
  const setDataFn = vi.fn()
  const instance = {
    addControl: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    getSource: vi.fn(() => ({ setData: setDataFn })),
    remove: vi.fn(),
    on: vi.fn((event: string, handler: () => void) => {
      if (event === 'load') handler()
    }),
  }
  return {
    mapInstance: instance,
    setData: setDataFn,
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
  })

  it('adds the ADS-B layer empty, so track updates never rebuild it', () => {
    render(<MapView ao={AO} />)
    const [sourceId, source] = mapInstance.addSource.mock.calls[1]
    expect(sourceId).toBe('adsb-tracks')
    expect(source.data.features).toEqual([])
    expect(mapInstance.addLayer).toHaveBeenCalledTimes(3)
  })

  it('feeds tracks to the layer as points, carrying id and ground state', () => {
    render(<MapView ao={AO} tracks={TRACKS} />)
    const collection = setData.mock.calls.at(-1)?.[0]
    expect(collection.features).toHaveLength(2)
    expect(collection.features[0]).toMatchObject({
      geometry: { type: 'Point', coordinates: TRACKS[0].position },
      properties: { id: 'adsb-a06461', callsign: 'AAL423', onGround: false },
    })
    expect(collection.features[1].properties).toMatchObject({ callsign: '', onGround: true })
  })

  it('renders no tracks before the recording has loaded', () => {
    render(<MapView ao={AO} />)
    expect(setData.mock.calls.at(-1)?.[0].features).toEqual([])
  })

  it('tears the map down on unmount', () => {
    const { unmount } = render(<MapView ao={AO} />)
    unmount()
    expect(mapInstance.remove).toHaveBeenCalled()
  })
})
