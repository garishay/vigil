import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MapView } from './MapView'
import { AO } from '../config/ao'
import { IDENTITY_COLOR } from '../lib/identity'
import type { AdsbTrack, InjectTrack } from '../lib/tracks'

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
    category: null,
    registry: null,
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
    category: null,
    registry: null,
  },
]

const INJECTS: InjectTrack[] = [
  {
    id: 'inject-01',
    source: 'inject',
    behavior: 'loiter',
    remoteId: 'silent',
    uaType: null,
    identity: 'non-cooperative',
    callsign: null,
    position: [-75.2, 39.9],
    altitudeFt: 210,
    onGround: false,
    groundSpeedKt: 4.2,
    headingDeg: 118.4,
    verticalRateFpm: 0,
    lastSeenSec: 0,
  },
  {
    id: 'inject-02',
    source: 'inject',
    behavior: 'transit',
    remoteId: 'intermittent',
    uaType: null,
    identity: 'unknown',
    callsign: null,
    position: [-75.3, 39.95],
    altitudeFt: 180,
    onGround: false,
    groundSpeedKt: 24.5,
    headingDeg: 238.6,
    verticalRateFpm: 87,
    lastSeenSec: 0,
  },
]

// jsdom has no WebGL, so MapLibre is mocked. These tests guard the config wiring — that the map
// is built from src/config/ao.ts and nowhere else — not MapLibre's own behavior.
const { mapInstance, setData, clickHandlers, MapConstructor, NavigationControl } = vi.hoisted(
  () => {
    const setDataFn = vi.fn()
    // Layer-scoped click handlers, captured so a test can simulate a dot click (03a).
    const clicks: Record<string, (event: unknown) => void> = {}
    const canvas = { style: { cursor: '' } }
    const instance = {
      addControl: vi.fn(),
      addSource: vi.fn(),
      addLayer: vi.fn(),
      easeTo: vi.fn(),
      getCanvas: vi.fn(() => canvas),
      // The source id travels with the data, so a test can say *which* layer it is asserting on.
      getSource: vi.fn((id: string) => ({ setData: (data: unknown) => setDataFn(id, data) })),
      remove: vi.fn(),
      on: vi.fn((event: string, arg2: unknown, arg3?: unknown) => {
        if (event === 'load') (arg2 as () => void)()
        if (event === 'click' && typeof arg2 === 'string')
          clicks[arg2] = arg3 as (event: unknown) => void
        if (event === 'click' && Array.isArray(arg2))
          for (const layerId of arg2 as string[]) clicks[layerId] = arg3 as (event: unknown) => void
        // The map-wide click is the placement click (08a), keyed by its own name.
        if (event === 'click' && typeof arg2 === 'function')
          clicks.map = arg2 as (event: unknown) => void
      }),
    }
    return {
      mapInstance: instance,
      setData: setDataFn,
      clickHandlers: clicks,
      MapConstructor: vi.fn<(options: Record<string, unknown>) => typeof instance>(function () {
        return instance
      }),
      NavigationControl: vi.fn(),
    }
  },
)

vi.mock('maplibre-gl', () => ({ Map: MapConstructor, NavigationControl, setWorkerUrl: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
})

/** The most recent GeoJSON handed to one source. */
const dataFor = (sourceId: string) =>
  setData.mock.calls.filter((call) => call[0] === sourceId).at(-1)?.[1] as {
    features: { geometry: unknown; properties: Record<string, unknown> }[]
  }

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

  it('draws one protection ring per site in the session set, pushed as a source (08a)', () => {
    // Added empty at load: the rings are the session's, not the AO's, and a set change re-pushes
    // the source rather than rebuilding the layer.
    const { rerender } = render(<MapView ao={AO} sites={AO.protectedSites} />)
    const [sourceId, source] = mapInstance.addSource.mock.calls[0]
    expect(sourceId).toBe('protected-sites')
    expect(source.data.features).toEqual([])
    expect(dataFor('protected-sites').features).toHaveLength(AO.protectedSites.length)
    expect(dataFor('protected-sites').features[0].properties).toMatchObject({
      id: AO.protectedSites[0].id,
      selected: false,
    })
    const fence = {
      id: 'site-2',
      name: 'Fence',
      center: [-75.3, 39.85] as [number, number],
      radiusM: 1500,
      tier: 1 as const,
    }
    rerender(<MapView ao={AO} sites={[...AO.protectedSites, fence]} selectedSiteId="site-2" />)
    const rings = dataFor('protected-sites').features
    expect(rings).toHaveLength(2)
    // The selected site's ring draws heavier: the paint reads the property.
    expect(rings.map((ring) => ring.properties.selected)).toEqual([false, true])
    const line = mapInstance.addLayer.mock.calls.find(
      (call) => call[0].id === 'protected-sites-line',
    )
    expect(line?.[0].paint['line-width']).toEqual(['case', ['get', 'selected'], 3, 1.5])
  })

  it('draws a friendly launch area dashed in the cooperative blue, in the same source (08b)', () => {
    const area = {
      id: 'area-2',
      name: 'Pad',
      center: [-75.3, 39.85] as [number, number],
      radiusM: 500,
    }
    render(<MapView ao={AO} sites={AO.protectedSites} areas={[area]} selectedSiteId="area-2" />)
    const rings = dataFor('protected-sites').features
    expect(rings.map((ring) => [ring.properties.kind, ring.properties.selected])).toEqual([
      ['protected', false],
      ['friendly', true],
    ])
    const layers = mapInstance.addLayer.mock.calls.map(([layer]) => layer)
    const friendly = layers.find((layer) => layer.id === 'protected-sites-friendly')
    expect(friendly.filter).toEqual(['==', ['get', 'kind'], 'friendly'])
    expect(friendly.paint['line-dasharray']).toEqual([2, 2])
    expect(friendly.paint['line-color']).toBe(IDENTITY_COLOR.cooperative)
    // The protected line and fill leave the friendly ring alone: no volume to keep things out of.
    for (const id of ['protected-sites-line', 'protected-sites-fill']) {
      expect(layers.find((layer) => layer.id === id).filter).toEqual([
        '==',
        ['get', 'kind'],
        'protected',
      ])
    }
  })

  it('places a site on the armed click and does not select a track under it (08a)', () => {
    const onPlace = vi.fn()
    const onSelect = vi.fn()
    const { rerender } = render(
      <MapView ao={AO} injects={INJECTS} onSelect={onSelect} onPlace={onPlace} />,
    )
    // Unarmed: the map-wide click places nothing and the cursor is the map's own.
    clickHandlers.map({ lngLat: { lng: -75.3, lat: 39.85 } })
    expect(onPlace).not.toHaveBeenCalled()
    expect(mapInstance.getCanvas().style.cursor).toBe('')
    rerender(<MapView ao={AO} injects={INJECTS} onSelect={onSelect} onPlace={onPlace} placing />)
    expect(mapInstance.getCanvas().style.cursor).toBe('crosshair')
    clickHandlers['inject-tracks-halo']({ features: [{ properties: { id: 'inject-01' } }] })
    clickHandlers.map({ lngLat: { lng: -75.3, lat: 39.85 } })
    expect(onSelect).not.toHaveBeenCalled()
    expect(onPlace).toHaveBeenCalledWith([-75.3, 39.85])
  })

  it('adds the track layers empty, so updates never rebuild them', () => {
    render(<MapView ao={AO} />)
    const [adsbId, adsbSource] = mapInstance.addSource.mock.calls[1]
    expect(adsbId).toBe('adsb-tracks')
    expect(adsbSource.data.features).toEqual([])
    // 06b adds the breadcrumb trail between them: under the injects, under the ring.
    const [trailId, trailSource] = mapInstance.addSource.mock.calls[2]
    expect(trailId).toBe('selected-trail')
    expect(trailSource.data.features).toEqual([])
    const [injectId, injectSource] = mapInstance.addSource.mock.calls[3]
    expect(injectId).toBe('inject-tracks')
    expect(injectSource.data.features).toEqual([])
    // 03a adds the selection ring: its own source, empty, layered above everything.
    const [selectId, selectSource] = mapInstance.addSource.mock.calls[4]
    expect(selectId).toBe('selected-track')
    expect(selectSource.data.features).toEqual([])
    // 08b adds the friendly ring layer beside the protected line.
    expect(mapInstance.addLayer).toHaveBeenCalledTimes(9)
    const order = mapInstance.addLayer.mock.calls.map(([layer]) => layer.id)
    expect(order.indexOf('selected-trail-line')).toBeLessThan(order.indexOf('inject-tracks-halo'))
    expect(order.at(-1)).toBe('selected-track-ring')
    // The ADS-B hit layer widens the click target for airborne traffic only, and paints
    // nothing — a parked 1.8 px dot must not carry an invisible 16 px blanket over the apron.
    const hit = mapInstance.addLayer.mock.calls.find(
      ([layer]) => layer.id === 'adsb-tracks-hit',
    )![0]
    expect(hit.paint['circle-opacity']).toBe(0)
    expect(hit.paint['circle-radius']).toBeGreaterThan(5)
    expect(hit.filter).toEqual(['!', ['get', 'onGround']])
    // The hit layer sits below the visible dot: click dispatch prefers the topmost feature, so
    // a visible parked dot under the cursor beats an overlapping invisible airborne ring.
    expect(order.indexOf('adsb-tracks-hit')).toBeLessThan(order.indexOf('adsb-tracks-dot'))
  })

  it('selects through one registration and one dispatch: hit area and halo together (03a)', () => {
    const onSelect = vi.fn()
    render(<MapView ao={AO} tracks={TRACKS} injects={INJECTS} onSelect={onSelect} />)
    // A single array-form listener covers both containing layers, so an overlap is one dispatch
    // with the top-rendered feature first — never two handlers overwriting each other.
    const clickRegistrations = mapInstance.on.mock.calls.filter(
      // The map-wide placement click (08a) is its own registration; the track click is one.
      ([event, target]) => event === 'click' && Array.isArray(target),
    )
    expect(clickRegistrations).toHaveLength(1)
    // The dot layer rides in the array for the ground traffic the filtered hit layer excludes.
    expect(clickRegistrations[0][1]).toEqual([
      'adsb-tracks-hit',
      'adsb-tracks-dot',
      'inject-tracks-halo',
    ])
    clickHandlers['adsb-tracks-hit']({ features: [{ properties: { id: 'adsb-a3303d' } }] })
    clickHandlers['inject-tracks-halo']({ features: [{ properties: { id: 'inject-02' } }] })
    expect(onSelect.mock.calls.map(([id]) => id)).toEqual(['adsb-a3303d', 'inject-02'])
    // The inject dot rides under its halo and carries no handler of its own; the basemap and
    // the ring carry none at all. (The ADS-B dot shares the single registration deliberately —
    // it is the only clickable surface for the ground traffic the hit layer excludes.)
    expect(clickHandlers['inject-tracks-dot']).toBeUndefined()
    expect(clickHandlers['selected-track-ring']).toBeUndefined()
  })

  it('rings and eases to the selected track, and clears when nothing is selected (03a)', () => {
    const { rerender } = render(
      <MapView ao={AO} tracks={TRACKS} injects={INJECTS} selectedId="inject-01" />,
    )
    expect(dataFor('selected-track').features[0].geometry).toMatchObject({
      coordinates: INJECTS[0].position,
    })
    expect(mapInstance.easeTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: INJECTS[0].position }),
    )
    const eased = mapInstance.easeTo.mock.calls.length
    // A fresh array with the same contents forces the selection effect to re-run, so this pins
    // the eased-once guard itself — identical props would skip the effect and prove nothing.
    rerender(<MapView ao={AO} tracks={[...TRACKS]} injects={[...INJECTS]} selectedId="inject-01" />)
    expect(mapInstance.easeTo.mock.calls.length).toBe(eased)
    rerender(<MapView ao={AO} tracks={TRACKS} injects={INJECTS} selectedId={null} />)
    expect(dataFor('selected-track').features).toEqual([])
  })

  it('suppresses the ring as presentation only — selection kept, camera not re-flown (03b, A2)', () => {
    const { rerender } = render(
      <MapView ao={AO} tracks={TRACKS} injects={INJECTS} selectedId="inject-01" />,
    )
    const eased = mapInstance.easeTo.mock.calls.length
    // Home: the ring source empties while the selection stays put…
    rerender(
      <MapView
        ao={AO}
        tracks={TRACKS}
        injects={INJECTS}
        selectedId="inject-01"
        selectionShown={false}
      />,
    )
    expect(dataFor('selected-track').features).toEqual([])
    // …and returns without a second flight: the ease stamp survived the round trip (#47).
    rerender(
      <MapView
        ao={AO}
        tracks={TRACKS}
        injects={INJECTS}
        selectedId="inject-01"
        selectionShown={true}
      />,
    )
    expect(dataFor('selected-track').features[0].geometry).toMatchObject({
      coordinates: INJECTS[0].position,
    })
    expect(mapInstance.easeTo.mock.calls.length).toBe(eased)
  })

  it('draws injects above cooperative traffic rather than under it', () => {
    render(<MapView ao={AO} />)
    const order = mapInstance.addLayer.mock.calls.map(([layer]) => layer.id)
    expect(order.indexOf('inject-tracks-dot')).toBeGreaterThan(order.indexOf('adsb-tracks-dot'))
    expect(order.indexOf('inject-tracks-halo')).toBeLessThan(order.indexOf('inject-tracks-dot'))
  })

  it('renders injects larger than cooperative traffic, stroked by identity, under a halo', () => {
    // Principle 3: alarm color is earned by a score, and PR 04 has not computed one yet. Injects
    // stand out by size and a halo; their stroke carries the observed identity.
    render(<MapView ao={AO} />)
    const layers = Object.fromEntries(
      mapInstance.addLayer.mock.calls.map(([layer]) => [layer.id, layer]),
    )
    const injectRadius = layers['inject-tracks-dot'].paint['circle-radius']
    const adsbRadius = layers['adsb-tracks-dot'].paint['circle-radius']
    expect(injectRadius).toBeGreaterThan(Math.max(adsbRadius[2], adsbRadius[3]))
    expect(layers['inject-tracks-dot'].paint['circle-stroke-color'][1]).toEqual(['get', 'identity'])
    expect(layers['inject-tracks-halo'].paint['circle-radius']).toBeGreaterThan(injectRadius)
  })

  it('strokes identity from the same palette the Queue and the legend use', () => {
    render(<MapView ao={AO} />)
    const [layer] = mapInstance.addLayer.mock.calls.find(([l]) => l.id === 'inject-tracks-dot')!
    const stroke = layer.paint['circle-stroke-color'] as unknown[]
    // ['match', input, 'cooperative', colour, 'unknown', colour, fallback] — the fallback is the
    // third state, so an unexpected identity value cannot paint as cooperative.
    expect(stroke.slice(2)).toEqual([
      'cooperative',
      IDENTITY_COLOR.cooperative,
      'unknown',
      IDENTITY_COLOR.unknown,
      IDENTITY_COLOR['non-cooperative'],
    ])
  })

  it('carries the identity legend in a map corner, so Home can read the three states', () => {
    render(<MapView ao={AO} />)
    const legend = screen.getByRole('list', { name: 'Identity legend' })
    expect(legend).toBeInTheDocument()
    expect(screen.getByRole('application').parentElement).toContainElement(legend)
  })

  it('feeds injects to their own layer, carrying observed identity and nothing assigned', () => {
    render(<MapView ao={AO} injects={INJECTS} />)
    const collection = dataFor('inject-tracks')
    expect(collection.features).toHaveLength(2)
    expect(collection.features[0]).toMatchObject({
      geometry: { type: 'Point', coordinates: INJECTS[0].position },
      properties: { id: 'inject-01', identity: 'non-cooperative' },
    })
    expect(collection.features[1].properties).toMatchObject({
      identity: 'unknown',
      callsign: '',
    })
    // The answer key does not travel with the feature. A live map source in the running app is
    // neither a fixture nor a test, which is where §2 keeps `behavior` and `remoteId` — and the
    // click handler hands the whole feature back (ruled on #61).
    for (const feature of collection.features) {
      expect(feature.properties).not.toHaveProperty('behavior')
      expect(feature.properties).not.toHaveProperty('remoteId')
    }
  })

  it('stamps terminal on both layers, for the ids it is given and no others (#61)', () => {
    render(
      <MapView
        ao={AO}
        tracks={TRACKS}
        injects={INJECTS}
        terminalIds={['adsb-a3303d', 'inject-02']}
      />,
    )
    const flag = (sourceId: string) =>
      Object.fromEntries(
        dataFor(sourceId).features.map((f) => [f.properties.id, f.properties.terminal]),
      )
    expect(flag('adsb-tracks')).toEqual({ 'adsb-a06461': false, 'adsb-a3303d': true })
    expect(flag('inject-tracks')).toEqual({ 'inject-01': false, 'inject-02': true })
  })

  it('dims a terminal track to the ruled table, and never twice (#61)', () => {
    render(<MapView ao={AO} />)
    const paintOf = (id: string) =>
      mapInstance.addLayer.mock.calls.find(([layer]) => layer.id === id)![0].paint

    // ADS-B: one expression, two conditions, one value — the Queue's rule, so a handled ground
    // track does not dim twice. Composing would put a terminal ground dot at 0.22.
    const adsb = paintOf('adsb-tracks-dot')
    expect(adsb['circle-opacity']).toEqual([
      'case',
      ['any', ['get', 'terminal'], ['get', 'onGround']],
      0.4,
      0.8,
    ])
    expect(adsb['circle-stroke-opacity']).toEqual(['case', ['get', 'terminal'], 0.18, 0.35])
    // The radius is untouched, so a terminal airborne dot still reads larger than an active
    // ground one at the shared 0.4 — which is what keeps the two distinguishable.
    expect(adsb['circle-radius']).toEqual(['case', ['get', 'onGround'], 1.8, 2.8])

    expect(paintOf('inject-tracks-dot')['circle-opacity']).toEqual([
      'case',
      ['get', 'terminal'],
      0.5,
      0.95,
    ])
    expect(paintOf('inject-tracks-dot')['circle-stroke-opacity']).toEqual([
      'case',
      ['get', 'terminal'],
      0.5,
      1,
    ])
    expect(paintOf('inject-tracks-halo')['circle-opacity']).toEqual([
      'case',
      ['get', 'terminal'],
      0.07,
      0.14,
    ])
  })

  it('re-pushes both sources when a track becomes terminal, with the picture unmoved (#61)', () => {
    const { rerender } = render(<MapView ao={AO} tracks={TRACKS} injects={INJECTS} />)
    expect(dataFor('inject-tracks').features[1].properties.terminal).toBe(false)

    // Same tracks, same positions — only the record moved. The dim must still arrive, which is
    // why `terminalIds` is in the effect deps rather than riding on a change of `tracks`.
    rerender(<MapView ao={AO} tracks={TRACKS} injects={INJECTS} terminalIds={['inject-02']} />)
    expect(dataFor('inject-tracks').features[1].properties.terminal).toBe(true)
    expect(dataFor('adsb-tracks').features.map((f) => f.properties.terminal)).toEqual([
      false,
      false,
    ])
  })

  it('feeds tracks to the layer as points, carrying id and ground state', () => {
    render(<MapView ao={AO} tracks={TRACKS} />)
    const collection = dataFor('adsb-tracks')
    expect(collection.features).toHaveLength(2)
    expect(collection.features[0]).toMatchObject({
      geometry: { type: 'Point', coordinates: TRACKS[0].position },
      properties: { id: 'adsb-a06461', callsign: 'AAL423', onGround: false },
    })
    expect(collection.features[1].properties).toMatchObject({ callsign: '', onGround: true })
  })

  it('renders no tracks before the recording has loaded', () => {
    render(<MapView ao={AO} />)
    expect(dataFor('adsb-tracks').features).toEqual([])
    expect(dataFor('inject-tracks').features).toEqual([])
  })

  it('tears the map down on unmount', () => {
    const { unmount } = render(<MapView ao={AO} />)
    unmount()
    expect(mapInstance.remove).toHaveBeenCalled()
  })
})
