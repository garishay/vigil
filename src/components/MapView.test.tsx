import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MapView } from './MapView'
import { AO } from '../config/ao'
import { BAND_COLOR } from '../lib/display'
import { IDENTITY_COLOR } from '../lib/identity'
import type { AdsbTrack, GeneratedInjectTrack } from '../lib/tracks'

/** jsdom serialises an inline hex background as `rgb(r, g, b)`. */
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`

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

const INJECTS: GeneratedInjectTrack[] = [
  {
    id: 'inject-01',
    source: 'inject',
    behavior: 'loiter',
    remoteId: 'silent',
    uaType: null,
    broadcast: null,
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
    broadcast: null,
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
  {
    id: 'inject-03',
    source: 'inject',
    behavior: 'transit',
    remoteId: 'broadcasting',
    uaType: 'multirotor',
    broadcast: { label: 'UAS-8E8F', position: [-75.25, 39.92] },
    identity: 'cooperative',
    callsign: 'UAS-8E8F',
    position: [-75.25, 39.92],
    altitudeFt: 150,
    onGround: false,
    groundSpeedKt: 12,
    headingDeg: 90,
    verticalRateFpm: 0,
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
      // The two glyphs (S9) are added as SDF images on load.
      addImage: vi.fn(),
      addSource: vi.fn(),
      addLayer: vi.fn(),
      easeTo: vi.fn(),
      getCanvas: vi.fn(() => canvas),
      // The source id travels with the data, so a test can say *which* layer it is asserting on.
      getSource: vi.fn((id: string) => ({ setData: (data: unknown) => setDataFn(id, data) })),
      remove: vi.fn(),
      // Raw mode (S4a) repaints and toggles layers from an effect.
      setLayoutProperty: vi.fn(),
      setPaintProperty: vi.fn(),
      // North-up (#192): the two handlers whose rotation is switched off after construction.
      touchZoomRotate: { disableRotation: vi.fn() },
      keyboard: { disableRotation: vi.fn() },
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

/** S8's handled case, as the paint expressions carry it, and the ground a hollow marker shows. */
const HANDLED = ['==', ['get', 'mark'], 'handled']
const HOLLOW = '#0b1220'

describe('MapView', () => {
  it('builds the map from the AO config rather than its own coordinates', () => {
    render(<MapView ao={AO} />)
    expect(MapConstructor).toHaveBeenCalledTimes(1)
    expect(MapConstructor.mock.calls[0][0]).toMatchObject({
      style: AO.basemapStyleUrl,
      center: AO.center,
      zoom: AO.zoom,
      // No symbol fade (S9): a glyph that moves between ticks is placed afresh each tick, and
      // MapLibre's default fades a fresh symbol in over 300 ms — a flicker once a second.
      fadeDuration: 0,
    })
  })

  it('adds a navigation control so the map pans and zooms', () => {
    render(<MapView ao={AO} />)
    expect(NavigationControl).toHaveBeenCalled()
    expect(mapInstance.addControl).toHaveBeenCalled()
  })

  it('holds the map north-up: no rotation or pitch by drag, touch or keyboard, the bearing 0, no compass (#192, ruled; #36 [41])', () => {
    render(<MapView ao={AO} />)
    // The four settings and the bearing, on the map's options.
    expect(MapConstructor.mock.calls[0][0]).toMatchObject({
      bearing: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
    })
    // Touch and keyboard rotation switched off on their handlers; pinch zoom and arrow-key
    // panning stay, as does the zoom control — the compass never shows.
    expect(mapInstance.touchZoomRotate.disableRotation).toHaveBeenCalledTimes(1)
    expect(mapInstance.keyboard.disableRotation).toHaveBeenCalledTimes(1)
    expect(NavigationControl).toHaveBeenCalledWith({ showCompass: false })
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
    // The trail's source measures its line (S10): the fade reads the line's own progress.
    expect(trailSource.lineMetrics).toBe(true)
    // #102 adds the projected path beside the trail: under the injects too.
    const [projectionId, projectionSource] = mapInstance.addSource.mock.calls[3]
    expect(projectionId).toBe('selected-projection')
    expect(projectionSource.data.features).toEqual([])
    const [injectId, injectSource] = mapInstance.addSource.mock.calls[4]
    expect(injectId).toBe('inject-tracks')
    expect(injectSource.data.features).toEqual([])
    // 03a adds the selection ring: its own source, empty, layered above the picture.
    const [selectId, selectSource] = mapInstance.addSource.mock.calls[5]
    expect(selectId).toBe('selected-track')
    expect(selectSource.data.features).toEqual([])
    // S10 adds the path's end last: the arrowhead and the entry reading, empty until a course
    // meets the ring, above the selection ring so a close track's arrowhead is not lost under
    // it (ruled R3 on #182).
    const [entryId, entrySource] = mapInstance.addSource.mock.calls[6]
    expect(entryId).toBe('selected-entry')
    expect(entrySource.data.features).toEqual([])
    // 08b adds the friendly ring layer beside the protected line; #102 the projected path;
    // S4a the two label layers, hidden until raw; S9 the drone glyph beside the dot, the
    // aircraft glyph in the ADS-B dot's place; S10 the path's arrowhead and reading, and the
    // heading tick as a symbol on the inject source in the S4a line layer's place; S8 the
    // assessed ring and the handled badge, one of each per track source.
    expect(mapInstance.addLayer).toHaveBeenCalledTimes(20)
    const order = mapInstance.addLayer.mock.calls.map(([layer]) => layer.id)
    expect(order.indexOf('selected-trail-line')).toBeLessThan(order.indexOf('inject-tracks-halo'))
    expect(order.indexOf('selected-projection-line')).toBeGreaterThan(
      order.indexOf('selected-trail-line'),
    )
    expect(order.indexOf('selected-projection-line')).toBeLessThan(
      order.indexOf('inject-tracks-halo'),
    )
    // The tick sits under the markers it starts from.
    expect(order.indexOf('inject-tracks-tick')).toBeLessThan(order.indexOf('inject-tracks-halo'))
    // The path's end draws above the selection ring (R3); the ring above everything else.
    expect(order.slice(-3)).toEqual([
      'selected-track-ring',
      'selected-entry-arrow',
      'selected-entry-reading',
    ])
    // The ADS-B hit layer is every aircraft's one click target, invisible, a disc the glyph's
    // box covers — no larger than what the operator sees, parked or airborne (#186 round 1).
    const hit = mapInstance.addLayer.mock.calls.find(
      ([layer]) => layer.id === 'adsb-tracks-hit',
    )![0]
    expect(hit.paint['circle-opacity']).toBe(0)
    expect(hit.paint['circle-radius']).toBe(11)
    expect(hit.filter).toBeUndefined()
    // The hit layer sits below the visible glyph, which is drawn and never clicked through.
    expect(order.indexOf('adsb-tracks-hit')).toBeLessThan(order.indexOf('adsb-tracks-glyph'))
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
    // Two discs, one per layer; no symbol layer is in the dispatch — a symbol is hit-tested by
    // its collision box, the padded image quad, not by the silhouette drawn (#186 round 1).
    expect(clickRegistrations[0][1]).toEqual(['adsb-tracks-hit', 'inject-tracks-halo'])
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
    expect(order.indexOf('inject-tracks-dot')).toBeGreaterThan(order.indexOf('adsb-tracks-glyph'))
    expect(order.indexOf('inject-tracks-halo')).toBeLessThan(order.indexOf('inject-tracks-dot'))
    expect(order.indexOf('inject-tracks-glyph')).toBeGreaterThan(order.indexOf('inject-tracks-dot'))
  })

  it('draws the three shapes from one rule, keyed on the shape property and the source (S9, #181)', () => {
    // Shape is what the track said about itself; paint is what Vigil made of it. The aircraft
    // glyph is the ADS-B layer's only visible marker, turned to its heading; an inject is the
    // drone glyph or the dot by its shape property, under one halo; injects keep their stroke.
    render(<MapView ao={AO} />)
    const layers = Object.fromEntries(
      mapInstance.addLayer.mock.calls.map(([layer]) => [layer.id, layer]),
    )
    expect(layers['adsb-tracks-dot']).toBeUndefined()
    expect(layers['adsb-tracks-glyph']).toMatchObject({
      type: 'symbol',
      layout: {
        'icon-image': 'aircraft',
        'icon-rotate': ['get', 'heading'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    })
    expect(layers['inject-tracks-dot'].filter).toEqual(['==', ['get', 'shape'], 'dot'])
    expect(layers['inject-tracks-glyph']).toMatchObject({
      type: 'symbol',
      filter: ['==', ['get', 'shape'], 'drone'],
      layout: { 'icon-image': 'drone', 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    })
    // The drone is not turned: a quadcopter has no nose, and the tick carries its heading in raw.
    expect(layers['inject-tracks-glyph'].layout).not.toHaveProperty('icon-rotate')
    expect(layers['inject-tracks-dot'].paint['circle-stroke-color'][1]).toEqual(['get', 'identity'])
    expect(layers['inject-tracks-halo'].paint['circle-radius']).toBeGreaterThan(
      layers['inject-tracks-dot'].paint['circle-radius'],
    )
  })

  it('adds the two glyphs and the two marks as SDF images at the ratio they were drawn at, so paint can colour them (S9, S10)', () => {
    render(<MapView ao={AO} />)
    const images = mapInstance.addImage.mock.calls as [
      string,
      { width: number; height: number; data: Uint8ClampedArray },
      Record<string, unknown>,
    ][]
    // S8 adds the handled badge beside S10's two bearing marks.
    expect(images.map(([id]) => id)).toEqual(['aircraft', 'drone', 'tick', 'arrow', 'check'])
    for (const [, image, options] of images) {
      expect(options).toEqual({ sdf: true, pixelRatio: 2 })
      expect(image.width).toBe(image.height)
      expect(image.data).toHaveLength(image.width * image.height * 4)
    }
    // The images are added before any layer names them.
    expect(mapInstance.addImage.mock.invocationCallOrder[0]).toBeLessThan(
      mapInstance.addLayer.mock.invocationCallOrder[0],
    )
  })

  it('paints the drone glyph with no outline but a handled one’s: the band fill for caution and warning, the cooperative tone otherwise, the dot’s dim (#186, ruled on R2; S8, ruled R1)', () => {
    render(<MapView ao={AO} />)
    const layers = Object.fromEntries(
      mapInstance.addLayer.mock.calls.map(([layer]) => [layer.id, layer]),
    )
    const dot = layers['inject-tracks-dot'].paint
    const glyph = layers['inject-tracks-glyph'].paint
    // Calm and terminal alike take the ADS-B layer's tone: a heard, calm drone is cooperative
    // traffic; the warm bands read the same tokens the dot's fill does. Since S8's handled
    // shape (ruled R1, and its addendum, which left the glyphs' hollowing to the lane) the fill
    // is that reading under one case: empty where the subject is done with the track, the
    // reading itself everywhere else.
    const BAND_MATCH = [
      'match',
      ['get', 'band'],
      'caution',
      BAND_COLOR.caution,
      'warning',
      BAND_COLOR.warning,
      '#8fa3bf',
    ]
    expect(glyph['icon-color']).toEqual(['case', HANDLED, HOLLOW, BAND_MATCH])
    expect(glyph['icon-opacity']).toEqual(['case', ['get', 'terminal'], 0.5, 0.95])
    // No identity stroke in either mode: the shape already says heard and associated. The halo
    // is the outline a handled marker is drawn with, and zero on every other track — #186's R2
    // governs how a drone is drawn, R1 how a track the subject has finished with is marked.
    expect(glyph['icon-halo-width']).toEqual(['case', HANDLED, 1.1, 0])
    expect(glyph['icon-halo-color']).toEqual(BAND_MATCH)
    // The dot keeps its own stroke: identity is read there, and a hollowed dot keeps it.
    expect(dot['circle-stroke-width']).toBe(2)
    expect(dot['circle-opacity']).toEqual([
      'case',
      HANDLED,
      0,
      ['case', ['get', 'terminal'], 0.5, 0.95],
    ])
    // The aircraft wears the ADS-B layer's quiet colour and no stroke but the same outline.
    expect(layers['adsb-tracks-glyph'].paint).toEqual({
      'icon-color': ['case', HANDLED, HOLLOW, '#8fa3bf'],
      'icon-halo-color': '#8fa3bf',
      'icon-halo-width': ['case', HANDLED, 1.1, 0],
      'icon-opacity': ['case', ['any', ['get', 'terminal'], ['get', 'onGround']], 0.4, 0.8],
    })
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

  it('names the two warm bands beside the identity entries, in the fill the marker wears (#96)', () => {
    render(<MapView ao={AO} />)
    const legend = screen.getByRole('group', { name: 'Map legend' })
    expect(legend).toContainElement(screen.getByRole('list', { name: 'Identity legend' }))
    const bands = within(legend).getByRole('list', { name: 'Band legend' })
    const items = within(bands).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual(['Caution', 'Warning'])
    expect(
      items.map((item) => (item.querySelector('.band-dot') as HTMLElement).style.background),
    ).toEqual([BAND_COLOR.caution, BAND_COLOR.warning].map(rgb))
  })

  it('feeds injects to their own layer, carrying observed identity and nothing assigned', () => {
    render(<MapView ao={AO} injects={INJECTS} />)
    const collection = dataFor('inject-tracks')
    expect(collection.features).toHaveLength(3)
    expect(collection.features[0]).toMatchObject({
      geometry: { type: 'Point', coordinates: INJECTS[0].position },
      properties: { id: 'inject-01', identity: 'non-cooperative', shape: 'dot' },
    })
    expect(collection.features[1].properties).toMatchObject({
      identity: 'unknown',
      callsign: '',
      shape: 'dot',
    })
    // The shape reads the callsign the association rule left (S9): heard and associated, a
    // drone; the generator's own word never reaches it.
    expect(collection.features[2].properties).toMatchObject({
      callsign: 'UAS-8E8F',
      shape: 'drone',
    })
    // The answer key does not travel with the feature. A live map source in the running app is
    // neither a fixture nor a test, which is where §2 keeps `behavior` and `remoteId` — and the
    // click handler hands the whole feature back (ruled on #61).
    for (const feature of collection.features) {
      expect(feature.properties).not.toHaveProperty('behavior')
      expect(feature.properties).not.toHaveProperty('remoteId')
      // No inject feature carries a ground state: the generator flies every inject, so the band
      // expression reads `terminal` alone and ruling 4's ground half rests on the ADS-B layer
      // carrying no band (#96). A ground phase for injects trips this, and writes the union then.
      expect(feature.properties).not.toHaveProperty('onGround')
    }
  })

  it('stamps the band it is handed on inject features, calm when absent, none on ADS-B (#96)', () => {
    render(
      <MapView
        ao={AO}
        tracks={TRACKS}
        injects={INJECTS}
        bands={new Map([['inject-02', 'warning' as const]])}
      />,
    )
    const bandOf = (sourceId: string) =>
      Object.fromEntries(
        dataFor(sourceId).features.map((f) => [f.properties.id, f.properties.band]),
      )
    expect(bandOf('inject-tracks')).toEqual({
      'inject-01': 'calm',
      'inject-02': 'warning',
      'inject-03': 'calm',
    })
    // A real aircraft has no fill channel to spend and both caps hold it below caution: the ADS-B
    // layer carries no band at all, rather than a band that is always calm.
    for (const feature of dataFor('adsb-tracks').features) {
      expect(feature.properties).not.toHaveProperty('band')
    }
  })

  it('fills from the band in the chip tokens, terminal first, and keeps identity on the stroke (#96)', () => {
    render(<MapView ao={AO} />)
    const [layer] = mapInstance.addLayer.mock.calls.find(([l]) => l.id === 'inject-tracks-dot')!
    // The one paint change: a dimmed track paints no band, whatever band it is in; then the
    // score's word picks the token, and anything else — calm — is the neutral fill.
    expect(layer.paint['circle-color']).toEqual([
      'case',
      ['get', 'terminal'],
      '#f2f6fc',
      [
        'match',
        ['get', 'band'],
        'caution',
        BAND_COLOR.caution,
        'warning',
        BAND_COLOR.warning,
        '#f2f6fc',
      ],
    ])
    // The two encodings never share a channel: the stroke still reads identity, nothing else.
    expect(layer.paint['circle-stroke-color'][1]).toEqual(['get', 'identity'])
    expect(JSON.stringify(layer.paint['circle-stroke-color'])).not.toContain('band')
  })

  it('re-pushes the inject source when a band moves with the picture unmoved, and only that source (#96)', () => {
    const { rerender } = render(<MapView ao={AO} tracks={TRACKS} injects={INJECTS} />)
    expect(dataFor('inject-tracks').features[0].properties.band).toBe('calm')
    const adsbPushes = setData.mock.calls.filter((call) => call[0] === 'adsb-tracks').length

    // Same tracks, same positions — a site edit with the clock paused moves the score and nothing
    // else. The fill must still arrive, which is why `bands` is in the inject effect's deps; the
    // ADS-B effect does not read it, so that source is left alone.
    rerender(
      <MapView
        ao={AO}
        tracks={TRACKS}
        injects={INJECTS}
        bands={new Map([['inject-01', 'caution' as const]])}
      />,
    )
    expect(dataFor('inject-tracks').features[0].properties.band).toBe('caution')
    expect(setData.mock.calls.filter((call) => call[0] === 'adsb-tracks')).toHaveLength(adsbPushes)
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
    expect(flag('inject-tracks')).toEqual({
      'inject-01': false,
      'inject-02': true,
      'inject-03': false,
    })
  })

  it('dims a terminal track to the ruled table, and never twice (#61)', () => {
    render(<MapView ao={AO} />)
    const paintOf = (id: string) =>
      mapInstance.addLayer.mock.calls.find(([layer]) => layer.id === id)![0].paint

    // ADS-B: one expression, two conditions, one value — the Queue's rule, so a handled ground
    // track does not dim twice. Composing would put a terminal ground glyph at 0.22. One size
    // for every aircraft (S9): dim means nothing here needs you, not a lifecycle (#36 [9]).
    const adsb = paintOf('adsb-tracks-glyph')
    expect(adsb['icon-opacity']).toEqual([
      'case',
      ['any', ['get', 'terminal'], ['get', 'onGround']],
      0.4,
      0.8,
    ])

    expect(paintOf('inject-tracks-dot')['circle-opacity']).toEqual([
      'case',
      HANDLED,
      0,
      ['case', ['get', 'terminal'], 0.5, 0.95],
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

  it('draws the projected path as one dashed neutral line, only with the ring, and nothing without a course (#102, S10)', () => {
    const projection: [number, number][] = [
      [-75.2, 39.9],
      [-75.22, 39.88],
    ]
    const { rerender } = render(
      <MapView ao={AO} injects={INJECTS} selectedId="inject-01" projection={projection} />,
    )
    const drawn = dataFor('selected-projection')
    expect(drawn.features).toHaveLength(1)
    expect(drawn.features[0].geometry).toEqual({ type: 'LineString', coordinates: projection })
    // Neutral (ruled A7): `--muted` mirrored, 1.5 px at .6 — no marker's stroke or fill — and
    // dashed (S10, #182): told from the trail by its form, not its hue.
    const layer = mapInstance.addLayer.mock.calls.find(
      ([layer]) => layer.id === 'selected-projection-line',
    )![0]
    expect(layer.paint).toEqual({
      'line-color': '#8b98a9',
      'line-width': 1.5,
      'line-opacity': 0.6,
      'line-dasharray': [2, 2],
    })
    expect(Object.values(IDENTITY_COLOR)).not.toContain(layer.paint['line-color'])
    expect(Object.values(BAND_COLOR)).not.toContain(layer.paint['line-color'])
    // A course that misses the ring: the line, and nothing at its end.
    expect(dataFor('selected-entry').features).toEqual([])
    // Home hides the ring and the path with it, the selection kept (A2 on #3).
    rerender(
      <MapView
        ao={AO}
        injects={INJECTS}
        selectedId="inject-01"
        projection={projection}
        selectionShown={false}
      />,
    )
    expect(dataFor('selected-projection').features).toEqual([])
    // Inside, or nothing observed to project: nothing to draw.
    rerender(<MapView ao={AO} injects={INJECTS} selectedId="inject-01" projection={[]} />)
    expect(dataFor('selected-projection').features).toEqual([])
  })

  it('ends a path that meets the ring in an arrowhead turned to its bearing, with the entry reading in m:ss beside it (S10, #182)', () => {
    // South-east from the track to the ring — 142.5°, the longitude foreshortened at this
    // latitude: the arrowhead turns to it, the reading prints the row's own seconds as m:ss,
    // and both sit on the entry point.
    const projection: [number, number][] = [
      [-75.2, 39.9],
      [-75.19, 39.89],
    ]
    const { rerender } = render(
      <MapView
        ao={AO}
        injects={INJECTS}
        selectedId="inject-01"
        projection={projection}
        projectionEntryS={108}
      />,
    )
    const end = dataFor('selected-entry').features
    expect(end).toHaveLength(1)
    expect(end[0].geometry).toEqual({ type: 'Point', coordinates: [-75.19, 39.89] })
    // The reading says what it is (R3): the row's seconds as m:ss after the word.
    expect(end[0].properties.reading).toBe('enters 1:48')
    expect(end[0].properties.bearing).toBeCloseTo(142.5, 1)
    const layers = Object.fromEntries(
      mapInstance.addLayer.mock.calls.map(([layer]) => [layer.id, layer]),
    )
    // The arrowhead: the mark turned to the bearing, its tip pushed onto the anchor, drawn
    // whatever it overlaps, in the bright text tone (R3) — the path itself stays muted.
    expect(layers['selected-entry-arrow']).toMatchObject({
      type: 'symbol',
      layout: {
        'icon-image': 'arrow',
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-color': '#e6edf3' },
    })
    expect(layers['selected-projection-line'].paint['line-color']).toBe('#8b98a9')
    expect(layers['selected-entry-arrow'].layout['icon-offset'][1]).toBeCloseTo(5.75, 6)
    // The reading: the map's label face in the bright text tone (R3), anchored ahead of the
    // arrowhead by the quadrant the path points into — just inside the ring — and 1.5 em off
    // the point, past the selection ring's 13 px radius from any path's near end.
    expect(layers['selected-entry-reading']).toMatchObject({
      type: 'symbol',
      layout: {
        'text-field': ['get', 'reading'],
        'text-size': 11,
        'text-radial-offset': 1.8,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': '#e6edf3' },
    })
    expect(1.8 * 11).toBeGreaterThan(13)
    expect(layers['selected-entry-reading'].layout['text-anchor']).toEqual([
      'step',
      ['get', 'bearing'],
      'bottom',
      45,
      'left',
      135,
      'top',
      225,
      'right',
      315,
      'bottom',
    ])
    // Home hides the end with the path.
    rerender(
      <MapView
        ao={AO}
        injects={INJECTS}
        selectedId="inject-01"
        projection={projection}
        projectionEntryS={108}
        selectionShown={false}
      />,
    )
    expect(dataFor('selected-entry').features).toEqual([])
  })

  it('draws no arrowhead and no reading for a clamped entry whose path is zero (#192, ruled 3)', () => {
    // At the ring itself the entry estimate clamps its path to nothing and its point to the
    // position: two equal points give no bearing to turn an arrowhead to, and the row already
    // says where the track is.
    const at: [number, number] = [-75.2, 39.9]
    render(
      <MapView
        ao={AO}
        injects={INJECTS}
        selectedId="inject-01"
        projection={[at, [...at]]}
        projectionEntryS={0}
      />,
    )
    expect(dataFor('selected-entry').features).toEqual([])
  })

  it('stands the reading clear of the selection ring on every anchor, as MapLibre lays it out (#192, ruled 4)', () => {
    render(<MapView ao={AO} />)
    const layer = mapInstance.addLayer.mock.calls.find(
      ([layer]) => layer.id === 'selected-entry-reading',
    )![0]
    const radial = layer.layout['text-radial-offset'] as number
    const size = layer.layout['text-size'] as number
    const anchors = (layer.layout['text-anchor'] as unknown[])
      .slice(2)
      .filter((v): v is string => typeof v === 'string')
    expect(new Set(anchors)).toEqual(new Set(['top', 'right', 'bottom', 'left']))
    // MapLibre's evaluateVariableOffset, in 24-unit ems: a radial offset stands a left or right
    // anchor the full radius out, and a top or bottom anchor the radius less a 7-unit baseline
    // shift. The ring's radius is 13 px; the halo adds one.
    const standoffPx = (anchor: string) =>
      ((radial * 24 - (anchor === 'top' || anchor === 'bottom' ? 7 : 0)) / 24) * size
    for (const anchor of anchors) expect([anchor, standoffPx(anchor) >= 14]).toEqual([anchor, true])
  })

  it('fades the trail toward its old end: full strength at the track, nothing at the oldest point (S10, #182)', () => {
    render(<MapView ao={AO} />)
    const layer = mapInstance.addLayer.mock.calls.find(
      ([layer]) => layer.id === 'selected-trail-line',
    )![0]
    // The gradient runs over the line's progress, oldest point first as the trail is built:
    // transparent at 0, the trail's blue at 1, concave between — the older half of the wake,
    // the part outside a slow track's marker and ring, stays above half strength. No
    // line-color: the gradient is the colour.
    const gradient = layer.paint['line-gradient'] as unknown[]
    expect(gradient.slice(0, 3)).toEqual(['interpolate', ['linear'], ['line-progress']])
    const stops: [number, string][] = []
    for (let i = 3; i < gradient.length; i += 2)
      stops.push([gradient[i] as number, gradient[i + 1] as string])
    expect(stops[0]).toEqual([0, 'rgba(76, 154, 255, 0)'])
    expect(stops.at(-1)).toEqual([1, '#4c9aff'])
    const alphaAt = (stop: [number, string]) => Number(stop[1].match(/, ([\d.]+)\)$/)?.[1] ?? 1)
    for (let i = 1; i < stops.length; i++) {
      // Monotone in progress and in alpha, and above the straight line between the ends.
      expect(stops[i][0]).toBeGreaterThan(stops[i - 1][0])
      expect(alphaAt(stops[i])).toBeGreaterThan(alphaAt(stops[i - 1]))
      if (stops[i][0] < 1) expect(alphaAt(stops[i])).toBeGreaterThan(stops[i][0])
    }
    expect(
      stops.every(([, colour]) => colour.startsWith('rgba(76, 154, 255') || colour === '#4c9aff'),
    ).toBe(true)
    expect(layer.paint).not.toHaveProperty('line-color')
    expect(layer.paint['line-width']).toBe(1.5)
  })

  it('feeds tracks to the layer as points, carrying id and ground state', () => {
    render(<MapView ao={AO} tracks={TRACKS} />)
    const collection = dataFor('adsb-tracks')
    expect(collection.features).toHaveLength(2)
    expect(collection.features[0]).toMatchObject({
      geometry: { type: 'Point', coordinates: TRACKS[0].position },
      properties: { id: 'adsb-a06461', callsign: 'AAL423', onGround: false, heading: 45.9 },
    })
    // The glyph turns to the heading (S9); a track reporting none points north.
    expect(collection.features[1].properties).toMatchObject({
      callsign: '',
      onGround: true,
      heading: 0,
    })
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

describe('raw mode (S4a, #136, ruled A4)', () => {
  it('paints every shape one neutral, shows a label per track and a heading tick per drone or dot, and draws no legend (S9)', () => {
    render(<MapView ao={AO} mode="raw" tracks={TRACKS} injects={INJECTS} />)
    for (const id of ['inject-tracks-tick', 'adsb-tracks-label', 'inject-tracks-label']) {
      expect(mapInstance.setLayoutProperty).toHaveBeenCalledWith(id, 'visibility', 'visible')
    }
    const neutral = '#c5cfdc'
    for (const [layer, prop] of [
      ['inject-tracks-halo', 'circle-color'],
      ['inject-tracks-dot', 'circle-color'],
      ['inject-tracks-dot', 'circle-stroke-color'],
    ]) {
      expect(mapInstance.setPaintProperty).toHaveBeenCalledWith(layer, prop, neutral)
    }
    // The two glyph fills carry the handled case with them, so a marker the subject finished
    // with stays hollow when the condition resolves (S8, ruled R1) — without it the mode's own
    // paint filled it back in. The halo they take is the neutral itself, so an unhandled glyph
    // still draws none: the width is 0 everywhere but a handled track.
    for (const layer of ['adsb-tracks-glyph', 'inject-tracks-glyph']) {
      expect(mapInstance.setPaintProperty).toHaveBeenCalledWith(layer, 'icon-color', [
        'case',
        HANDLED,
        HOLLOW,
        neutral,
      ])
      expect(mapInstance.setPaintProperty).toHaveBeenCalledWith(layer, 'icon-halo-color', neutral)
    }
    expect(
      mapInstance.setPaintProperty.mock.calls.some((call) =>
        String(call[1]).startsWith('icon-halo-width'),
      ),
    ).toBe(false)
    // The ident rides every feature, for the label layers to print.
    expect(dataFor('adsb-tracks').features.map((f) => f.properties.ident)).toEqual([
      'AAL423',
      'a3303d',
    ])
    expect(dataFor('inject-tracks').features.map((f) => f.properties.ident)).toEqual([
      'TRK-01',
      'TRK-02',
      'UAS-8E8F',
    ])
    // A tick for each moving, airborne inject with a heading — a drone or a dot; an aircraft
    // gets none, its glyph is turned to its heading (S9). The tick is a mark on the inject
    // feature itself (S10): the feature says whether it has one and which way it points.
    const injectFeatures = dataFor('inject-tracks').features
    expect(injectFeatures.map((f) => [f.properties.tick, f.properties.heading])).toEqual([
      [true, 118.4],
      [true, 238.6],
      [true, 90],
    ])
    expect(dataFor('adsb-tracks').features.every((f) => !('tick' in f.properties))).toBe(true)
    expect(screen.queryByRole('group', { name: 'Map legend' })).toBeNull()
  })

  it('keeps Vigil’s paint and the raw layers hidden when the mode is vigil', () => {
    render(<MapView ao={AO} tracks={TRACKS} injects={INJECTS} />)
    for (const id of ['inject-tracks-tick', 'adsb-tracks-label', 'inject-tracks-label']) {
      expect(mapInstance.setLayoutProperty).toHaveBeenCalledWith(id, 'visibility', 'none')
    }
    const neutralCalls = mapInstance.setPaintProperty.mock.calls.filter(
      (call) => call[2] === '#c5cfdc',
    )
    expect(neutralCalls).toHaveLength(0)
    expect(screen.getByRole('group', { name: 'Map legend' })).toBeInTheDocument()
  })
})

describe('the heading tick (S4a; S10, #182 item 5)', () => {
  it('holds the fairness spec’s heading line by visibility, not presence: one screen length from the marker’s edge at any zoom, never culled, raw only (#182 item 5)', () => {
    render(<MapView ao={AO} mode="raw" injects={INJECTS} />)
    const tick = mapInstance.addLayer.mock.calls.find(
      ([layer]) => layer.id === 'inject-tracks-tick',
    )![0]
    // A symbol is placed in screen pixels, so its length is one fixed length at every zoom —
    // the S4a line was 300 m on the ground, 5 px at the working zoom, under the 13 px dot.
    expect(tick).toMatchObject({
      type: 'symbol',
      source: 'inject-tracks',
      filter: ['get', 'tick'],
      layout: {
        'icon-image': 'tick',
        'icon-rotate': ['get', 'heading'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-color': '#c5cfdc' },
    })
    // The mark is 12 px long; it starts at the marker's edge, so its centre stands the edge
    // plus half its length forward: 6.5 + 6 for the dot (its radius and stroke); for the drone
    // the glyph's reach along the heading (#192, ruled 2) — the glyph is drawn nose-up while
    // the tick swings round it, so the edge is the body's 2.27 px on an axis and a rotor's far
    // edge, 11.23 px, on a diagonal — read off a step table over the heading folded to 0–45°.
    // Forward is a negative y under the rotation.
    const offset = tick.layout['icon-offset']
    expect(offset.slice(0, 2)).toEqual(['case', ['==', ['get', 'shape'], 'drone']])
    expect(offset[3][1]).toEqual([0, -12.5])
    const drone = offset[2]
    expect(drone[0]).toBe('step')
    expect(drone[1]).toEqual([
      'min',
      ['%', ['get', 'heading'], 90],
      ['-', 90, ['%', ['get', 'heading'], 90]],
    ])
    // The table's first entry is the axis; its last the diagonal. To within a pixel.
    const standoff = (literal: unknown[]) => -(literal[1] as [number, number])[1] - 6
    expect(standoff(drone[2] as unknown[])).toBeCloseTo(2.27, 0)
    const last = drone[drone.length - 1] as unknown[]
    expect(drone[drone.length - 2]).toBeLessThanOrEqual(45)
    expect(standoff(last)).toBeCloseTo(11.23, 0)
    // The image is the box's height at 12 px, at the same ratio as the glyphs.
    const [, image, options] = mapInstance.addImage.mock.calls.find(([id]) => id === 'tick')!
    expect(options).toEqual({ sdf: true, pixelRatio: 2 })
    expect(image.width).toBe(24 + 14)
    // Only an airborne inject with a heading, moving at 2 kt or more, carries one (R2): a
    // hover's drift under that is noise; a still track and a heading-less one carry none.
    const drift = { ...INJECTS[0], groundSpeedKt: 1.9 }
    const still = { ...INJECTS[0], headingDeg: null, groundSpeedKt: 0 }
    const walking = { ...INJECTS[1], groundSpeedKt: 2 }
    render(<MapView ao={AO} mode="raw" injects={[drift, still, walking]} />)
    expect(dataFor('inject-tracks').features.map((f) => f.properties.tick)).toEqual([
      false,
      false,
      true,
    ])
  })

  it('puts raw’s label on the side the tick is not on: left for a heading into the right-hand half, right otherwise or with no tick (R1)', () => {
    render(<MapView ao={AO} mode="raw" injects={INJECTS} />)
    const label = mapInstance.addLayer.mock.calls.find(
      ([layer]) => layer.id === 'inject-tracks-label',
    )![0]
    const left = [
      'all',
      ['get', 'tick'],
      ['>=', ['get', 'heading'], 20],
      ['<', ['get', 'heading'], 160],
    ]
    // Anchored right (hanging left) at a heading of 20° up to 160° with a tick; else anchored
    // left (hanging right), the S4a placement — the same 1.2 em standoff either way.
    expect(label.layout['text-anchor']).toEqual(['case', left, 'right', 'left'])
    expect(label.layout['text-offset']).toEqual([
      'case',
      left,
      ['literal', [-1.2, 0]],
      ['literal', [1.2, 0]],
    ])
    // The aircraft's label keeps its side: no tick to clear.
    const aircraft = mapInstance.addLayer.mock.calls.find(
      ([layer]) => layer.id === 'adsb-tracks-label',
    )![0]
    expect(aircraft.layout['text-anchor']).toBe('left')
  })

  it('names the font stack the basemap declares on every text layer, the entry reading included', () => {
    render(<MapView ao={AO} />)
    const labels = mapInstance.addLayer.mock.calls
      .map(([layer]) => layer)
      .filter((layer) => layer.type === 'symbol' && layer.layout['text-field'])
    expect(labels.map((layer) => layer.id)).toEqual([
      'adsb-tracks-label',
      'inject-tracks-label',
      'selected-entry-reading',
    ])
    for (const layer of labels) {
      // Clear of a 22 px glyph at any heading (S9): 1.2 em of an 11 px face is 13 px — the
      // aircraft's to the right; the inject's on the side the tick is not on (R1, below).
      if (layer.id === 'adsb-tracks-label') expect(layer.layout['text-offset']).toEqual([1.2, 0])
      expect(layer.layout['text-font']).toEqual([
        'Montserrat Regular',
        'Open Sans Regular',
        'Noto Sans Regular',
        'HanWangHeiLight Regular',
        'NanumBarunGothic Regular',
      ])
    }
  })
})
