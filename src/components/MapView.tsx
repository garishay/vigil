import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Map as MapLibreMap, NavigationControl } from 'maplibre-gl'
import type { ExpressionSpecification, GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import '../lib/maplibreWorker'
import { GLYPHS, glyphImage } from './glyphs'
import { IdentityLegend } from './IdentityDot'
import type { AreaOfOperations, FriendlyArea, ProtectedSite } from '../config/ao'
import { circlePolygon, destinationPoint } from '../lib/geo'
import { BAND_COLOR, trackIdent, trackShape, type WarmBand } from '../lib/display'
import { IDENTITY_COLOR } from '../lib/identity'
import type { Mode } from '../lib/session'
import type { AdsbTrack, InjectTrack, Track } from '../lib/tracks'

const SITES_SOURCE = 'protected-sites'
const ADSB_SOURCE = 'adsb-tracks'
const INJECT_SOURCE = 'inject-tracks'
const SELECT_SOURCE = 'selected-track'
const TRAIL_SOURCE = 'selected-trail'
const PROJECTION_SOURCE = 'selected-projection'
/** Raw mode's heading ticks (S4a): one short line per moving track, along its observed heading. */
const HEADING_SOURCE = 'heading-ticks'
/** The tick's length on the ground, metres — the mockup's stub, readable at the AO's zoom. */
const HEADING_TICK_M = 300
/**
 * The glyphs' box on screen, pixels (S9, #181): one visual weight across the three shapes — the
 * plain dot is 13 px across with its stroke, and a silhouette needs a wider box to carry the
 * same ink — rasterised at twice the ratio so the edge stays crisp on a dense display.
 */
const GLYPH_PX = 22
const GLYPH_RATIO = 2
/**
 * The drone's identity stroke: an SDF halo grows the shape outward by this many image pixels —
 * one on screen at the ratio, narrower than the dot's 2 px, since it wraps four rotors and four
 * arms and would otherwise outweigh the dot it sits beside. A drone glyph already says heard
 * and associated, so its stroke carries less than the dot's does.
 */
const GLYPH_STROKE_PX = 2
/**
 * Raw mode's one colour (S4a, #136, ruled A4; #131's fairness spec): every dot, every tick, every
 * label the same neutral — no band fill, no identity colour. Identity is read off the label.
 */
const RAW_COLOR = '#c5cfdc'
/**
 * The font stack raw's labels are set in — the one the basemap's own symbol layers declare, so
 * the glyph fetch that a `glyphs` root makes is one the tile server serves (#148 review).
 */
const RAW_LABEL_FONT = [
  'Montserrat Regular',
  'Open Sans Regular',
  'Noto Sans Regular',
  'HanWangHeiLight Regular',
  'NanumBarunGothic Regular',
]

/** One frozen empty array, so the default prop is not a new identity every render. */
const NO_TERMINAL: readonly string[] = []
/** Likewise for a line with no points. */
const NO_LINE: readonly [number, number][] = []
/** Likewise for the band map: no warm bands, one identity. */
const NO_BANDS: ReadonlyMap<string, WarmBand> = new Map()
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

/**
 * Zero or one line — the selected track's trail, oldest first (06b), or its projected path to
 * the ring (#102) — or an empty collection when there are not two points to join.
 */
function lineFeature(points: readonly [number, number][]) {
  return {
    type: 'FeatureCollection' as const,
    features:
      points.length >= 2
        ? [
            {
              type: 'Feature' as const,
              geometry: { type: 'LineString' as const, coordinates: points.map((p) => [...p]) },
              properties: {},
            },
          ]
        : [],
  }
}

/** Mirrors --accent in the theme; MapLibre paint properties take literals, not CSS variables. */
const RING_COLOR = '#4c9aff'

/**
 * The projected path's colour (#102, ruled A7): `--muted`, mirrored as `RING_COLOR` mirrors its
 * token. Neutral on purpose — no marker wears it, so it spends neither the identity stroke nor
 * the band fill (#96), and it is not the trail's blue, which is the past.
 */
const PROJECTION_COLOR = '#8b98a9'

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

/** The calm fill — the neutral an inject wore before a score could earn it colour. */
const INJECT_FILL = '#f2f6fc'

/**
 * The fill carries the band (#96): the same whole-number score the Queue chip prints, in the
 * chip's own tokens, so a score change is visible on the map without the Queue in view. Identity
 * stays on the stroke; the two never share a channel. A dimmed track paints no band — dim means
 * nothing here needs you (#61, #36 [9]) — so `terminal` is read before the band is.
 */
const BAND_FILL: ExpressionSpecification = [
  'case',
  ['get', 'terminal'],
  INJECT_FILL,
  [
    'match',
    ['get', 'band'],
    'caution',
    BAND_COLOR.caution,
    'warning',
    BAND_COLOR.warning,
    INJECT_FILL,
  ],
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
        // The label raw mode prints beside the glyph (S4a): the ident, observed.
        ident: trackIdent(track),
        // The aircraft glyph turns to its heading (S9); an aircraft reporting none points north.
        heading: track.headingDeg ?? 0,
        onGround: track.onGround,
        terminal: terminalIds.includes(track.id),
      },
    })),
  }
}

function injectFeatures(
  tracks: InjectTrack[],
  terminalIds: readonly string[],
  bands: ReadonlyMap<string, WarmBand>,
) {
  return {
    type: 'FeatureCollection' as const,
    features: tracks.map((track) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: track.position },
      // Observed and derived only. `behavior` and `remoteId` used to travel here unread by any
      // paint or handler; a live map source in the running app is neither a fixture nor a test,
      // which is where §2 puts the answer key (ruled on #61). The band is derived — the score's
      // own word — and only an inject carries one: both caps hold a real aircraft below caution.
      properties: {
        id: track.id,
        callsign: track.callsign ?? '',
        ident: trackIdent(track),
        identity: track.identity,
        // The shape (S9): a drone glyph for a heard, associated Remote ID, the dot otherwise —
        // read off the callsign the association rule left, never off the generator.
        shape: trackShape(track),
        terminal: terminalIds.includes(track.id),
        band: bands.get(track.id) ?? 'calm',
      },
    })),
  }
}

/**
 * Raw mode's heading ticks: a moving, airborne inject with a heading gets a stub along it. An
 * aircraft gets none — its glyph is turned to its heading (S9).
 */
function headingFeatures(tracks: readonly Track[]) {
  return {
    type: 'FeatureCollection' as const,
    features: tracks
      .filter(
        (track) => !track.onGround && track.headingDeg !== null && (track.groundSpeedKt ?? 0) > 0,
      )
      .map((track) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            track.position,
            destinationPoint(track.position, track.headingDeg as number, HEADING_TICK_M),
          ],
        },
        properties: { id: track.id },
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
  projection = NO_LINE,
  terminalIds = NO_TERMINAL,
  bands = NO_BANDS,
  mode = 'vigil',
  onSelect,
  children,
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
   * Each inject's band by id, warm entries only — an absent id is calm (#96). A map rather than
   * a lookup function for the reason `terminalIds` is an array: it sits in the inject effect's
   * deps, so the fill follows a score that moves while the picture does not (a site edit with
   * the clock paused), and the caller owes it one identity while no band has moved.
   */
  bands?: ReadonlyMap<string, WarmBand>
  /**
   * Whether the selection ring is drawn — presentation only (A2 on #3: Home suppresses the
   * ring). The selection itself, and the once-per-selection ease stamp, ride `selectedId`:
   * hiding the ring must not reset them, or a Home round trip re-flies the camera (#47).
   */
  selectionShown?: boolean
  /** The selected track's history trail (06b), oldest first; drawn only with the ring. */
  trail?: readonly [number, number][]
  /**
   * The selected track's projected path (#102): its position and the point where dead reckoning
   * meets a protected ring, or empty when there is no entry inside the horizon. Drawn only with
   * the ring, like the trail; faded and neutral, with no marker at either end (ruled A7).
   */
  projection?: readonly [number, number][]
  /**
   * The study's condition (S4a, #136, ruled A4): in `raw` every shape wears one neutral colour,
   * a label prints each track's ident and a tick the heading of a drone or a dot, and the legend
   * is not drawn — the layers exist in both modes, toggled and repainted from an effect, since
   * the session may resolve after the map has built. `vigil` is the map as built.
   */
  mode?: Mode
  onSelect?: (id: string) => void
  /** Overlays that live in the map's frame beside the legend — the alert stack (#101). */
  children?: ReactNode
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
      // A symbol that moves between two ticks is placed afresh each time, and a fresh symbol
      // fades in: with the default 300 ms every airborne glyph would flicker once a second (S9).
      fadeDuration: 0,
    })
    mapRef.current = map
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')

    map.on('load', () => {
      // The two glyphs (S9) as SDF images, so paint colours them as it colours the dot: the band
      // on the fill, the identity on the halo, raw's neutral on both, the dim on the opacity.
      for (const shape of ['aircraft', 'drone'] as const) {
        map.addImage(shape, glyphImage(GLYPHS[shape], GLYPH_PX, GLYPH_RATIO), {
          sdf: true,
          pixelRatio: GLYPH_RATIO,
        })
      }
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
      // Invisible hit area, deliberately *below* the visible glyph: a slender silhouette is a
      // narrow target on a dense frame, so this rounds the click target out to the glyph's box
      // without changing the picture — and because click dispatch prefers the topmost feature,
      // a visible parked glyph under the cursor beats an overlapping invisible airborne disc.
      map.addLayer({
        id: `${ADSB_SOURCE}-hit`,
        type: 'circle',
        source: ADSB_SOURCE,
        // Airborne only: giving a parked aircraft an invisible 16 px disc would blanket the
        // apron with overlapping targets. Ground glyphs stay clickable at exactly their visible
        // shape through the glyph layer above.
        filter: ['!', ['get', 'onGround']],
        paint: { 'circle-radius': 8, 'circle-opacity': 0 },
      })
      // The aircraft glyph (S9), turned to its heading and drawn whatever it overlaps: every
      // track is on the map, and the apron is the apron.
      map.addLayer({
        id: `${ADSB_SOURCE}-glyph`,
        type: 'symbol',
        source: ADSB_SOURCE,
        layout: {
          'icon-image': 'aircraft',
          'icon-rotate': ['get', 'heading'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-color': ADSB_COLOR,
          // One expression, two conditions, one value — the Queue's own rule transplanted
          // (`.queue__row--ground, .queue__row--terminal { opacity: 0.55 }`), so a handled
          // ground track does not dim twice. Composing the two instead would put a terminal
          // ground glyph at 0.22, which on this background is gone (ruled on #61).
          'icon-opacity': ['case', ['any', ['get', 'terminal'], ['get', 'onGround']], 0.4, 0.8],
        },
      })
      // The breadcrumb trail (06b) sits under the injects and the ring: where the selected
      // track has been must never cover where it is.
      map.addSource(TRAIL_SOURCE, { type: 'geojson', data: lineFeature([]) })
      map.addLayer({
        id: `${TRAIL_SOURCE}-line`,
        type: 'line',
        source: TRAIL_SOURCE,
        paint: { 'line-color': RING_COLOR, 'line-width': 1.5, 'line-opacity': 0.55 },
      })
      // The projected path (#102) sits with the trail, under the injects: where the selected
      // track is going, from the dot to the ring, and the dot covers where it starts.
      map.addSource(PROJECTION_SOURCE, { type: 'geojson', data: lineFeature([]) })
      map.addLayer({
        id: `${PROJECTION_SOURCE}-line`,
        type: 'line',
        source: PROJECTION_SOURCE,
        paint: { 'line-color': PROJECTION_COLOR, 'line-width': 1.5, 'line-opacity': 0.6 },
      })
      // Raw mode's heading ticks (S4a), under every dot and hidden until the mode says raw.
      map.addSource(HEADING_SOURCE, { type: 'geojson', data: headingFeatures([]) })
      map.addLayer({
        id: `${HEADING_SOURCE}-line`,
        type: 'line',
        source: HEADING_SOURCE,
        layout: { visibility: 'none' },
        paint: { 'line-color': RAW_COLOR, 'line-width': 1.5, 'line-opacity': 0.9 },
      })
      // Raw mode's labels (S4a): the ident beside each aircraft's dot, hidden until raw.
      map.addLayer({
        id: `${ADSB_SOURCE}-label`,
        type: 'symbol',
        source: ADSB_SOURCE,
        layout: {
          visibility: 'none',
          'text-field': ['get', 'ident'],
          /* The stack the basemap's own symbol layers declare (CARTO Dark Matter): with a
             `glyphs` root, MapLibre requests the stack by name, and an undeclared one paints
             nothing — silently (#148 review). */
          'text-font': RAW_LABEL_FONT,
          'text-size': 11,
          'text-anchor': 'left',
          // Clear of the glyph's box at any heading (S9); the dot's label sat at 0.6.
          'text-offset': [1.2, 0],
          'text-allow-overlap': true,
        },
        paint: { 'text-color': RAW_COLOR, 'text-halo-color': '#0b1220', 'text-halo-width': 1 },
      })
      // Added last, so injects draw above cooperative traffic rather than under it.
      map.addSource(INJECT_SOURCE, {
        type: 'geojson',
        data: injectFeatures([], NO_TERMINAL, NO_BANDS),
      })
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
      // The plain dot (S9): a track with no associated broadcast, whatever it is.
      map.addLayer({
        id: `${INJECT_SOURCE}-dot`,
        type: 'circle',
        source: INJECT_SOURCE,
        filter: ['==', ['get', 'shape'], 'dot'],
        paint: {
          'circle-radius': 4.5,
          'circle-color': BAND_FILL,
          'circle-opacity': ['case', ['get', 'terminal'], 0.5, 0.95],
          'circle-stroke-width': 2,
          'circle-stroke-color': IDENTITY_STROKE,
          'circle-stroke-opacity': ['case', ['get', 'terminal'], 0.5, 1],
        },
      })
      // The drone glyph (S9): a heard, associated Remote ID, in the dot's own paint — the band
      // on the fill, the identity on the stroke, drawn whatever it overlaps.
      map.addLayer({
        id: `${INJECT_SOURCE}-glyph`,
        type: 'symbol',
        source: INJECT_SOURCE,
        filter: ['==', ['get', 'shape'], 'drone'],
        layout: {
          'icon-image': 'drone',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-color': BAND_FILL,
          'icon-opacity': ['case', ['get', 'terminal'], 0.5, 0.95],
          'icon-halo-color': IDENTITY_STROKE,
          'icon-halo-width': GLYPH_STROKE_PX,
        },
      })

      // Raw mode's labels for the injects (S4a), above their dots, hidden until raw.
      map.addLayer({
        id: `${INJECT_SOURCE}-label`,
        type: 'symbol',
        source: INJECT_SOURCE,
        layout: {
          visibility: 'none',
          'text-field': ['get', 'ident'],
          /* The stack the basemap's own symbol layers declare (CARTO Dark Matter): with a
             `glyphs` root, MapLibre requests the stack by name, and an undeclared one paints
             nothing — silently (#148 review). */
          'text-font': RAW_LABEL_FONT,
          'text-size': 11,
          'text-anchor': 'left',
          'text-offset': [1.2, 0],
          'text-allow-overlap': true,
        },
        paint: { 'text-color': RAW_COLOR, 'text-halo-color': '#0b1220', 'text-halo-width': 1 },
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
      // the one under the cursor visually. The glyph layer is in the array for the ground traffic
      // the filtered hit layer excludes; for airborne, glyph and hit are the same dispatch. Empty
      // basemap clicks select nothing.
      map.on(
        'click',
        [`${ADSB_SOURCE}-hit`, `${ADSB_SOURCE}-glyph`, `${INJECT_SOURCE}-halo`],
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
    map
      .getSource<GeoJSONSource>(INJECT_SOURCE)
      ?.setData(injectFeatures(injects, terminalIds, bands))
  }, [injects, terminalIds, bands, styleReady])

  // Raw mode (S4a): the neutral paint on every dot, the labels and the ticks shown; Vigil's
  // paint and hidden layers otherwise. From an effect, since the mode resolves with the session.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    const raw = mode === 'raw'
    const visibility = raw ? 'visible' : 'none'
    for (const id of [`${HEADING_SOURCE}-line`, `${ADSB_SOURCE}-label`, `${INJECT_SOURCE}-label`]) {
      map.setLayoutProperty(id, 'visibility', visibility)
    }
    map.setPaintProperty(`${ADSB_SOURCE}-glyph`, 'icon-color', raw ? RAW_COLOR : ADSB_COLOR)
    map.setPaintProperty(`${INJECT_SOURCE}-halo`, 'circle-color', raw ? RAW_COLOR : IDENTITY_STROKE)
    map.setPaintProperty(`${INJECT_SOURCE}-dot`, 'circle-color', raw ? RAW_COLOR : BAND_FILL)
    map.setPaintProperty(
      `${INJECT_SOURCE}-dot`,
      'circle-stroke-color',
      raw ? RAW_COLOR : IDENTITY_STROKE,
    )
    map.setPaintProperty(`${INJECT_SOURCE}-glyph`, 'icon-color', raw ? RAW_COLOR : BAND_FILL)
    map.setPaintProperty(
      `${INJECT_SOURCE}-glyph`,
      'icon-halo-color',
      raw ? RAW_COLOR : IDENTITY_STROKE,
    )
  }, [mode, styleReady])

  // Whether the tick source holds anything: in Vigil it is left empty — created so — and never
  // re-pushed per tick for a layer nothing shows (#148 review); cleared once if raw is left.
  const ticksShownRef = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    const source = map.getSource<GeoJSONSource>(HEADING_SOURCE)
    if (mode !== 'raw') {
      if (ticksShownRef.current) source?.setData(headingFeatures([]))
      ticksShownRef.current = false
      return
    }
    ticksShownRef.current = true
    source?.setData(headingFeatures(injects))
  }, [injects, mode, styleReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    map.getSource<GeoJSONSource>(TRAIL_SOURCE)?.setData(lineFeature(selectionShown ? trail : []))
  }, [trail, selectionShown, styleReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    map
      .getSource<GeoJSONSource>(PROJECTION_SOURCE)
      ?.setData(lineFeature(selectionShown ? projection : []))
  }, [projection, selectionShown, styleReady])

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
      {mode !== 'raw' && <IdentityLegend />}
      {children}
    </div>
  )
}
