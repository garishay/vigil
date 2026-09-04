import { useEffect, useRef, useState } from 'react'
import { Map as MapLibreMap, NavigationControl } from 'maplibre-gl'
import type { ExpressionSpecification, GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import '../lib/maplibreWorker'
import { IdentityLegend } from './IdentityDot'
import type { AreaOfOperations, FriendlyArea, ProtectedSite } from '../config/ao'
import { circlePolygon } from '../lib/geo'
import { IDENTITY_COLOR } from '../lib/identity'
import type { AdsbTrack, InjectTrack } from '../lib/tracks'

const SITES_SOURCE = 'protected-sites'
const ADSB_SOURCE = 'adsb-tracks'
const INJECT_SOURCE = 'inject-tracks'
const SELECT_SOURCE = 'selected-track'
const TRAIL_SOURCE = 'selected-trail'

/** One frozen empty array, so the default prop is not a new identity every render. */
const NO_TERMINAL: readonly string[] = []
const NO_SITES: readonly ProtectedSite[] = []
const NO_AREAS: readonly FriendlyArea[] = []

/**
 * The rings as polygons (08a, 08b): the session's protected sites and friendly launch areas in
 * one source, each feature carrying its kind so the two line layers split them — a friendly ring
 * draws dashed in the cooperative blue, since it vouches rather than protects — re-pushed
 * whenever the set or the selection changes, the selected ring drawn heavier so the editor's
 * row and the map agree.
 */
function siteFeatures(
  sites: readonly ProtectedSite[],
  areas: readonly FriendlyArea[],
  selectedSiteId: string | null,
) {
  const ring = (site: FriendlyArea, kind: 'protected' | 'friendly') =>
    circlePolygon(site.center, site.radiusM, {
      id: site.id,
      name: site.name,
      kind,
      selected: site.id === selectedSiteId,
    })
  return {
    type: 'FeatureCollection' as const,
    features: [
      ...sites.map((site) => ring(site, 'protected')),
      ...areas.map((area) => ring(area, 'friendly')),
    ],
  }
}

/** Zero or one point: the selected track's position, or an empty collection. */
function selectionFeature(position: [number, number] | null) {
  return {
    type: 'FeatureCollection' as const,
    features: position
      ? [
          {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: position },
            properties: {},
          },
        ]
      : [],
  }
}

/** Zero or one line: the selected track's trail, oldest first, or an empty collection. */
function trailFeature(trail: readonly [number, number][]) {
  return {
    type: 'FeatureCollection' as const,
    features:
      trail.length >= 2
        ? [
            {
              type: 'Feature' as const,
              geometry: { type: 'LineString' as const, coordinates: trail.map((p) => [...p]) },
              properties: {},
            },
          ]
        : [],
  }
}

/** Mirrors --accent in the theme; MapLibre paint properties take literals, not CSS variables. */
const RING_COLOR = '#4c9aff'

/**
 * Cooperative traffic is drawn small, cool, and quiet on purpose (§3): it is the calm background
 * the injects have to stand out against. The warm end of the palette stays unspent so alarm color
 * remains something a score has to earn.
 */
const ADSB_COLOR = '#8fa3bf'

/**
 * Injects are prominent by size, brightness, and a halo — never by warmth. Their stroke carries
 * the *observed* identity, so a Remote ID track that goes quiet visibly changes state on the map
 * (§5.2). The palette is the one the Queue rows and the legend draw from, so the three states
 * read the same everywhere on screen.
 */
const IDENTITY_STROKE: ExpressionSpecification = [
  'match',
  ['get', 'identity'],
  'cooperative',
  IDENTITY_COLOR.cooperative,
  'unknown',
  IDENTITY_COLOR.unknown,
  IDENTITY_COLOR['non-cooperative'],
]

function trackFeatures(tracks: AdsbTrack[], terminalIds: readonly string[]) {
  return {
    type: 'FeatureCollection' as const,
    features: tracks.map((track) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: track.position },
      properties: {
        id: track.id,
        callsign: track.callsign ?? '',
        onGround: track.onGround,
        terminal: terminalIds.includes(track.id),
      },
    })),
  }
}

function injectFeatures(tracks: InjectTrack[], terminalIds: readonly string[]) {
  return {
    type: 'FeatureCollection' as const,
    features: tracks.map((track) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: track.position },
      // Observed and derived only. `behavior` and `remoteId` used to travel here unread by any
      // paint or handler; a live map source in the running app is neither a fixture nor a test,
      // which is where §2 puts the answer key (ruled on #61).
      properties: {
        id: track.id,
        callsign: track.callsign ?? '',
        identity: track.identity,
        terminal: terminalIds.includes(track.id),
      },
    })),
  }
}

/**
 * The persistent map canvas. Mounted once for the life of the app — switching surfaces must not
 * remount it, because rebuilding a MapLibre map is expensive and throws away the operator's view.
 */
export function MapView({
  ao,
  sites = NO_SITES,
  areas = NO_AREAS,
  selectedSiteId = null,
  placing = false,
  onPlace,
  tracks = [],
  injects = [],
  selectedId = null,
  selectionShown = true,
  trail = [],
  terminalIds = NO_TERMINAL,
  onSelect,
}: {
  ao: AreaOfOperations
  /** The session's protected sites (08a): the rings, re-pushed as a source when the set changes. */
  sites?: readonly ProtectedSite[]
  /** The session's friendly launch areas (08b): dashed rings in the same source. */
  areas?: readonly FriendlyArea[]
  /** The site whose ring draws heavier — the row open in the Sites editor. */
  selectedSiteId?: string | null
  /**
   * Armed by the Sites editor: the next map click reports its position to `onPlace` instead of
   * selecting a track, and the cursor is a crosshair while it waits.
   */
  placing?: boolean
  onPlace?: (center: [number, number]) => void
  tracks?: AdsbTrack[]
  injects?: InjectTrack[]
  selectedId?: string | null
  /**
   * Ids of tracks in a terminal lifecycle state — Resolved or Dismissed — which draw dimmed on
   * both layers, matching the Queue row (#61). An array rather than the Queue's `statusFor`
   * because this component pushes to MapLibre from effects: a function prop would be a new
   * identity every render and re-push the source on every tick of the clock, or be left out of
   * the deps and go stale the moment the clock is paused. The caller owes this array a stable
   * identity while the set is unchanged — see App.
   */
  terminalIds?: readonly string[]
  /**
   * Whether the selection ring is drawn — presentation only (A2 on #3: Home suppresses the
   * ring). The selection itself, and the once-per-selection ease stamp, ride `selectedId`:
   * hiding the ring must not reset them, or a Home round trip re-flies the camera (#47).
   */
  selectionShown?: boolean
  /** The selected track's history trail (06b), oldest first; drawn only with the ring. */
  trail?: readonly [number, number][]
  onSelect?: (id: string) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [styleReady, setStyleReady] = useState(false)
  // The click handlers are registered once, inside the load effect; the ref keeps them reading
  // the current callback instead of the one that existed when the map was built.
  const onSelectRef = useRef(onSelect)
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])
  // The placement click reads the same way: registered once, reading the current arm and
  // callback, so arming the map never rebuilds it.
  const placingRef = useRef(placing)
  const onPlaceRef = useRef(onPlace)
  useEffect(() => {
    placingRef.current = placing
    onPlaceRef.current = onPlace
  }, [placing, onPlace])
  // Ease only when the selection itself changes — not when the same track's data refreshes.
  const easedIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!container.current) return
    const map = new MapLibreMap({
      container: container.current,
      style: ao.basemapStyleUrl,
      center: ao.center,
      zoom: ao.zoom,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')

    map.on('load', () => {
      // Added empty and fed by the sites effect below (08a): the rings are the session's, not
      // the AO's, and a set change re-pushes the source rather than rebuilding the layer.
      map.addSource(SITES_SOURCE, { type: 'geojson', data: siteFeatures([], [], null) })
      map.addLayer({
        id: `${SITES_SOURCE}-fill`,
        type: 'fill',
        source: SITES_SOURCE,
        filter: ['==', ['get', 'kind'], 'protected'],
        paint: { 'fill-color': RING_COLOR, 'fill-opacity': 0.08 },
      })
      map.addLayer({
        id: `${SITES_SOURCE}-line`,
        type: 'line',
        source: SITES_SOURCE,
        filter: ['==', ['get', 'kind'], 'protected'],
        paint: {
          'line-color': RING_COLOR,
          'line-width': ['case', ['get', 'selected'], 3, 1.5],
          'line-opacity': ['case', ['get', 'selected'], 0.95, 0.7],
        },
      })
      // A friendly launch area (08b): dashed, in the identity blue a heard drone already wears,
      // and no fill — it is not a volume to keep things out of.
      map.addLayer({
        id: `${SITES_SOURCE}-friendly`,
        type: 'line',
        source: SITES_SOURCE,
        filter: ['==', ['get', 'kind'], 'friendly'],
        paint: {
          'line-color': IDENTITY_COLOR.cooperative,
          'line-width': ['case', ['get', 'selected'], 3, 1.5],
          'line-opacity': ['case', ['get', 'selected'], 0.95, 0.7],
          'line-dasharray': [2, 2],
        },
      })

      // Added empty and fed by the effect below, so track updates never rebuild the layer.
      map.addSource(ADSB_SOURCE, { type: 'geojson', data: trackFeatures([], NO_TERMINAL) })
      // Invisible hit area, deliberately *below* the visible dot: the ADS-B dot is ~3 px of
      // visible radius, close to unclickable on a dense frame, so this widens the click target
      // without changing the picture — and because click dispatch prefers the topmost feature,
      // a visible parked dot under the cursor beats an overlapping invisible airborne ring.
      map.addLayer({
        id: `${ADSB_SOURCE}-hit`,
        type: 'circle',
        source: ADSB_SOURCE,
        // Airborne only: a parked aircraft draws at 1.8 px, and giving it an invisible 16 px
        // target would blanket the apron with clicks on traffic the operator cannot see. Ground
        // dots stay clickable at exactly their visible size through the dot layer above.
        filter: ['!', ['get', 'onGround']],
        paint: { 'circle-radius': 8, 'circle-opacity': 0 },
      })
      map.addLayer({
        id: `${ADSB_SOURCE}-dot`,
        type: 'circle',
        source: ADSB_SOURCE,
        paint: {
          'circle-radius': ['case', ['get', 'onGround'], 1.8, 2.8],
          'circle-color': ADSB_COLOR,
          // One expression, two conditions, one value — the Queue's own rule transplanted
          // (`.queue__row--ground, .queue__row--terminal { opacity: 0.55 }`), so a handled
          // ground track does not dim twice. Composing the two instead would put a terminal
          // ground dot at 0.22, which on this background is gone. The radius is untouched, so a
          // terminal airborne dot still reads larger than an active ground one (ruled on #61).
          'circle-opacity': ['case', ['any', ['get', 'terminal'], ['get', 'onGround']], 0.4, 0.8],
          'circle-stroke-width': 0.5,
          'circle-stroke-color': ADSB_COLOR,
          'circle-stroke-opacity': ['case', ['get', 'terminal'], 0.18, 0.35],
        },
      })
      // The breadcrumb trail (06b) sits under the injects and the ring: where the selected
      // track has been must never cover where it is.
      map.addSource(TRAIL_SOURCE, { type: 'geojson', data: trailFeature([]) })
      map.addLayer({
        id: `${TRAIL_SOURCE}-line`,
        type: 'line',
        source: TRAIL_SOURCE,
        paint: { 'line-color': RING_COLOR, 'line-width': 1.5, 'line-opacity': 0.55 },
      })
      // Added last, so injects draw above cooperative traffic rather than under it.
      map.addSource(INJECT_SOURCE, { type: 'geojson', data: injectFeatures([], NO_TERMINAL) })
      map.addLayer({
        id: `${INJECT_SOURCE}-halo`,
        type: 'circle',
        source: INJECT_SOURCE,
        paint: {
          'circle-radius': 11,
          'circle-color': IDENTITY_STROKE,
          'circle-opacity': ['case', ['get', 'terminal'], 0.07, 0.14],
          'circle-blur': 0.6,
        },
      })
      map.addLayer({
        id: `${INJECT_SOURCE}-dot`,
        type: 'circle',
        source: INJECT_SOURCE,
        paint: {
          'circle-radius': 4.5,
          'circle-color': '#f2f6fc',
          'circle-opacity': ['case', ['get', 'terminal'], 0.5, 0.95],
          'circle-stroke-width': 2,
          'circle-stroke-color': IDENTITY_STROKE,
          'circle-stroke-opacity': ['case', ['get', 'terminal'], 0.5, 1],
        },
      })

      // The selection ring rides its own source, above everything, and holds zero or one point.
      map.addSource(SELECT_SOURCE, { type: 'geojson', data: selectionFeature(null) })
      map.addLayer({
        id: `${SELECT_SOURCE}-ring`,
        type: 'circle',
        source: SELECT_SOURCE,
        paint: {
          'circle-radius': 13,
          'circle-opacity': 0,
          'circle-stroke-width': 2,
          'circle-stroke-color': RING_COLOR,
        },
      })

      // Selection flows both ways (§7): a click selects the track, exactly as a row click does.
      // One registration, one dispatch, one selection: every clickable layer shares a single
      // array-form listener, so an overlap cannot fire two handlers and let the later one
      // overwrite the first — features[0] under a single dispatch is the top-rendered feature,
      // the one under the cursor visually. The dot layer is in the array for the ground traffic
      // the filtered hit layer excludes; for airborne, dot and hit are the same dispatch. Empty
      // basemap clicks select nothing.
      map.on(
        'click',
        [`${ADSB_SOURCE}-hit`, `${ADSB_SOURCE}-dot`, `${INJECT_SOURCE}-halo`],
        (event) => {
          // An armed map is placing a site, not selecting a track (08a).
          if (placingRef.current) return
          const id = event.features?.[0]?.properties?.id as unknown
          if (typeof id === 'string') onSelectRef.current?.(id)
        },
      )
      // The placement click (08a): anywhere on the map, dot or not, while the editor has it armed.
      map.on('click', (event) => {
        if (!placingRef.current) return
        onPlaceRef.current?.([event.lngLat.lng, event.lngLat.lat])
      })

      setStyleReady(true)
    })

    return () => {
      mapRef.current = null
      easedIdRef.current = null
      setStyleReady(false)
      map.remove()
    }
  }, [ao])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    map.getSource<GeoJSONSource>(SITES_SOURCE)?.setData(siteFeatures(sites, areas, selectedSiteId))
  }, [sites, areas, selectedSiteId, styleReady])

  // A crosshair says the map is armed; cleared when the placement lands or is cancelled.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    map.getCanvas().style.cursor = placing ? 'crosshair' : ''
  }, [placing, styleReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    map.getSource<GeoJSONSource>(ADSB_SOURCE)?.setData(trackFeatures(tracks, terminalIds))
  }, [tracks, terminalIds, styleReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    map.getSource<GeoJSONSource>(INJECT_SOURCE)?.setData(injectFeatures(injects, terminalIds))
  }, [injects, terminalIds, styleReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    map.getSource<GeoJSONSource>(TRAIL_SOURCE)?.setData(trailFeature(selectionShown ? trail : []))
  }, [trail, selectionShown, styleReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    const selected =
      (selectedId && [...tracks, ...injects].find((track) => track.id === selectedId)) || null
    map
      .getSource<GeoJSONSource>(SELECT_SOURCE)
      ?.setData(selectionFeature(selectionShown ? (selected?.position ?? null) : null))
    // Stamped only when the camera actually flew: a selection whose track has not arrived yet
    // must still get its ease when the track appears. A cleared selection resets the stamp, so
    // deselecting and reselecting the same track flies again.
    if (!selectedId) {
      easedIdRef.current = null
    } else if (selected && selectedId !== easedIdRef.current) {
      map.easeTo({ center: selected.position, duration: 600 })
      easedIdRef.current = selectedId
    }
  }, [selectedId, selectionShown, tracks, injects, styleReady])

  return (
    <div className="map-frame">
      <div
        className="map"
        ref={container}
        role="application"
        aria-label={`Airspace map centered on ${ao.name}`}
      />
      <IdentityLegend />
    </div>
  )
}
