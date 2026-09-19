import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Map as MapLibreMap, NavigationControl } from 'maplibre-gl'
import type { ExpressionSpecification, GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import '../lib/maplibreWorker'
import { GLYPHS, GLYPH_BOX, GLYPH_PX, MARKS, glyphImage, reachAlong } from './glyphs'
import { IdentityLegend } from './IdentityDot'
import type { AreaOfOperations, FriendlyArea, ProtectedSite } from '../config/ao'
import { bearingDegrees, circlePolygon } from '../lib/geo'
import {
  MARK_RING,
  OPENED_GREY,
  OPENED_MARK,
  BAND_COLOR,
  formatEntryClock,
  trackIdent,
  trackShape,
  type WarmBand,
} from '../lib/display'
import { IDENTITY_COLOR } from '../lib/identity'
import type { Mark } from '../lib/lifecycle'
import type { Mode } from '../lib/session'
import type { AdsbTrack, InjectTrack } from '../lib/tracks'

const SITES_SOURCE = 'protected-sites'
const ADSB_SOURCE = 'adsb-tracks'
const INJECT_SOURCE = 'inject-tracks'
/**
 * The subject's own bookkeeping (S8, #180 item 3; ruled R1, and its pick at round 1):
 * **assessed** is a faint ring about the marker, and **handled** is the marker itself drawn
 * empty at its own size — the dot's fill gone and its stroke kept, a glyph's fill swapped for
 * an outline of the same ink.
 *
 * Handled is quieter than assessed and is never a ring: a ring reads as a highlight and
 * resembles the selection ring, and a track the subject is done with should not be the loudest
 * thing on the map. Emptying the marker spends less ink than ringing it, which is that order by
 * construction, and it is findable without hunting because it changes the shape itself. A check
 * badge was the alternative and was all but lost on the study picture at 11 px.
 *
 * Neither is a dim: the terminal-or-ground dim stays Vigil's and is read from `terminal`, which
 * raw never receives. The outline a hollow glyph needs is the handled marker's alone — every
 * other track's halo is zero — so #186's R2 still governs how a drone is drawn.
 */

/** What a hollowed marker's fill becomes: the map's own ground, so the shape reads as an outline. */
const HOLLOW_FILL = '#0b1220'
/** True where a track is handled, for the paint expressions that hollow it. */
const IS_HANDLED = ['==', ['get', 'mark'], 'handled'] as ExpressionSpecification
/** A fill that empties where the track is handled. */
const hollowed = (fill: ExpressionSpecification | string): ExpressionSpecification =>
  ['case', IS_HANDLED, HOLLOW_FILL, fill] as ExpressionSpecification
/** The halo that draws a hollowed marker's outline; zero on every other track. */
const hollowHalo = (width: number): ExpressionSpecification =>
  ['case', IS_HANDLED, 1.1, width] as ExpressionSpecification

/**
 * The map in a study run (S9b, #199): one channel a question, ink spent in the order the
 * questions are asked. In Vigil a track at **warning** takes the warning colour on the whole
 * marker, all three shapes, and every other track the neutral the unaided picture uses — no
 * caution fill, no identity stroke; the list and the drawer keep their chips and dots, with
 * words beside them. In both conditions the **opened** mark moves onto the marker itself:
 * `OPENED_MARK` picks the candidate — `grey`, the marker with its label and tick dropped to a
 * grey plainly between untouched and hollow, or `ring`, S8-i's ring at a weight that is found
 * at device scale 1. A warning track keeps its colour at full brightness when opened, until it
 * is handled (item 3): Vigil's judgment outranks the bookkeeping. Handled stays hollow, in the
 * neutral (S8-i, ruled R1). The demo's paint is untouched.
 */
const IS_OPENED = ['==', ['get', 'mark'], 'assessed'] as ExpressionSpecification
const IS_WARNING = ['==', ['get', 'band'], 'warning'] as ExpressionSpecification
/** The ring candidate's weight — S8-i's 1.25 px at 0.42 was lost among 115 tracks. */
const OPENED_RING = { widthPx: 2.25, opacity: 0.9 }
/**
 * A run's ink for a marker, its stroke, its label and its tick: the neutral, the warning colour
 * in Vigil on a track at warning, the opened grey where that candidate is drawn, and the
 * neutral again once handled — the hollow outline carries no colour.
 */
const runInk = (vigil: boolean): ExpressionSpecification =>
  [
    'case',
    IS_HANDLED,
    RAW_COLOR,
    ...(vigil ? [IS_WARNING, BAND_COLOR.warning] : []),
    ...(OPENED_MARK === 'grey' ? [IS_OPENED, OPENED_GREY] : []),
    RAW_COLOR,
  ] as ExpressionSpecification
const SELECT_SOURCE = 'selected-track'
const TRAIL_SOURCE = 'selected-trail'
const PROJECTION_SOURCE = 'selected-projection'
/** Where the projected path meets the ring (S10): the arrowhead and the entry reading. */
const ENTRY_SOURCE = 'selected-entry'
/** The glyphs rasterised at twice the ratio, so the edge stays crisp on a dense display (S9). */
const GLYPH_RATIO = 2
/**
 * The two marks' box on screen, pixels (S10, #182): the heading tick is the box's height — one
 * fixed on-screen length for every track, whatever the zoom, since a symbol is placed in screen
 * pixels — and the arrowhead the box's height too.
 */
const MARK_PX = 12
/**
 * Where a tick starts: at the marker's edge, not its centre (#182 item 5). The dot's edge is its
 * radius and stroke. The drone is drawn nose-up while the tick swings round it, so its edge
 * along the tick is the glyph's reach along that heading (#192, ruled 2) — the body on an
 * axis, a rotor's far edge on a diagonal — read from a table over the heading folded to 0–45°
 * by the glyph's four-fold and mirror symmetry, one entry a degree, to within a pixel. The
 * tick's centre sits half its length beyond the edge, along the heading — `icon-offset` is
 * read as if the rotated direction were up, so a negative y is forward.
 */
const DOT_EDGE_PX = 4.5 + 2
const tickOffset = (edgePx: number) => [0, -(edgePx + MARK_PX / 2)]
const droneEdgePx = (headingDeg: number) =>
  (reachAlong(GLYPHS.drone, headingDeg) / GLYPH_BOX) * GLYPH_PX
const DRONE_TICK_OFFSET = [
  'step',
  ['min', ['%', ['get', 'heading'], 90], ['-', 90, ['%', ['get', 'heading'], 90]]],
  ['literal', tickOffset(droneEdgePx(0))],
  ...Array.from({ length: 45 }, (_, i) => [
    i + 0.5,
    ['literal', tickOffset(droneEdgePx(i + 1))],
  ]).flat(),
] as ExpressionSpecification
/**
 * The arrowhead's tip is 0.5 units below the top of its box, and the anchor is the box's centre:
 * pushed back by the tip's distance from the centre, the tip sits on the entry point.
 */
const ARROW_TIP_OFFSET_PX = ((GLYPH_BOX / 2 - 0.5) / GLYPH_BOX) * MARK_PX
/**
 * Raw mode's one colour (S4a, #136, ruled A4; #131's fairness spec): every dot, every tick, every
 * label the same neutral — no band fill, no identity colour. Identity is read off the label.
 */
const RAW_COLOR = '#c5cfdc'
/** `--text` mirrored (R3 on #182): the path's arrowhead and its entry reading, to be seen. */
const TEXT_COLOR = '#e6edf3'
/**
 * The slowest track that carries a heading tick, knots (ruled R2 on #182): a tick asserts a
 * course, and a hover's drift under this is noise that would read as an inbound's. The
 * drawer's Heading row is untouched; this narrows S4a's predicate for the tick alone.
 */
const TICK_MIN_KT = 2
/**
 * Raw's label takes the side the tick is not on (ruled R1 on #182): a tick never runs under
 * its own track's label, so a track heading into the right-hand half — 20° to 160° — carries
 * its label on the left, and any other, or one with no tick, on the right.
 */
const LABEL_LEFT: ExpressionSpecification = [
  'all',
  ['get', 'tick'],
  ['>=', ['get', 'heading'], 20],
  ['<', ['get', 'heading'], 160],
]
/**
 * The font stack the map's text is set in — raw's labels, the path's entry reading — the one the
 * basemap's own symbol layers declare, so the glyph fetch that a `glyphs` root makes is one the
 * tile server serves (#148 review).
 */
const LABEL_FONT = [
  'Montserrat Regular',
  'Open Sans Regular',
  'Noto Sans Regular',
  'HanWangHeiLight Regular',
  'NanumBarunGothic Regular',
]

/** One frozen empty array, so the default prop is not a new identity every render. */
const NO_TERMINAL: readonly string[] = []
const NO_MARKS: ReadonlyMap<string, Mark> = new Map()
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
 * the band fill (#96), and it is not the trail's blue, which is the past. Since S10 (#182)
 * neither line leans on its hue: the trail fades to nothing at its old end and the path is
 * dashed with an arrowhead where it meets the ring.
 */
const PROJECTION_COLOR = '#8b98a9'
/**
 * The trail's fade (S10, #182 item 1): full strength at the track, nothing at the oldest point,
 * over the line's own progress. The curve is concave — the middle of the wake at three
 * quarters, the last tenth at a third — because a slow track's newest minute lies under its
 * marker and the selection ring (25 kt covers 13 px in a minute at the working zoom, the ring's
 * radius), so the part of the wake an operator can see is the older half; a straight fade
 * would leave it at half strength or less, which on this basemap is gone.
 */
const TRAIL_FADE: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['line-progress'],
  0,
  'rgba(76, 154, 255, 0)',
  0.1,
  'rgba(76, 154, 255, 0.32)',
  0.3,
  'rgba(76, 154, 255, 0.55)',
  0.6,
  'rgba(76, 154, 255, 0.77)',
  1,
  RING_COLOR,
]

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

/**
 * The drone glyph's fill (#186, ruled on R2): the band for caution and warning, off the same
 * score the dot's fill reads, and the cooperative layer's tone otherwise — calm or terminal —
 * since a heard, calm drone is cooperative traffic, the background a threat stands out against.
 * It wears no identity stroke in either mode: a drone glyph already says heard and associated,
 * so a stroke would carry nothing the shape has not said, and wrapped eight ring edges it
 * outweighed the dot beside it.
 */
const DRONE_FILL: ExpressionSpecification = [
  'match',
  ['get', 'band'],
  'caution',
  BAND_COLOR.caution,
  'warning',
  BAND_COLOR.warning,
  ADSB_COLOR,
]

function trackFeatures(
  tracks: AdsbTrack[],
  terminalIds: readonly string[],
  marks: ReadonlyMap<string, Mark>,
) {
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
        // The subject's own bookkeeping (S8, item 3), identical in both conditions: '' for a
        // track they have not touched, so one filter reads it.
        mark: marks.get(track.id) ?? '',
      },
    })),
  }
}

function injectFeatures(
  tracks: InjectTrack[],
  terminalIds: readonly string[],
  bands: ReadonlyMap<string, WarmBand>,
  marks: ReadonlyMap<string, Mark>,
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
        // Raw's heading tick (S10): an airborne inject with a heading, moving at TICK_MIN_KT or
        // more, gets one, drawn by the tick layer along `heading`; the aircraft glyph turns
        // instead and takes none (S9).
        tick:
          !track.onGround && track.headingDeg !== null && (track.groundSpeedKt ?? 0) >= TICK_MIN_KT,
        heading: track.headingDeg ?? 0,
        terminal: terminalIds.includes(track.id),
        mark: marks.get(track.id) ?? '',
        band: bands.get(track.id) ?? 'calm',
      },
    })),
  }
}

/**
 * Zero or one point: where the projected path meets the ring (S10), carrying the path's bearing
 * into it, for the arrowhead, and the entry reading — `enters m:ss`, saying what it is (R3);
 * empty for a course that misses.
 */
function entryFeature(points: readonly [number, number][], entryS: number | null) {
  const last = points[points.length - 1]
  const before = points[points.length - 2]
  // At the ring itself the estimate clamps the path to nothing and the entry point to the
  // position: nothing ahead to point at, and the row already says where the track is (#192,
  // ruled 3) — so two equal points draw neither.
  const ahead = last && before && (last[0] !== before[0] || last[1] !== before[1])
  return {
    type: 'FeatureCollection' as const,
    features:
      entryS !== null && ahead
        ? [
            {
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: [...last] },
              properties: {
                bearing: bearingDegrees([...before], [...last]),
                reading: `enters ${formatEntryClock(entryS)}`,
              },
            },
          ]
        : [],
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
  projectionEntryS = null,
  terminalIds = NO_TERMINAL,
  marks = NO_MARKS,
  bands = NO_BANDS,
  mode = 'vigil',
  run = false,
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
   * What the subject has done with each track (S8, #180 item 3): the mark the map wears beside
   * the marker, identical in both conditions. Absent for an untouched track.
   */
  marks?: ReadonlyMap<string, Mark>
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
   * The selected track's projected path (#102, S10): its position and the point where dead
   * reckoning meets a protected ring, or the course run out to the horizon when it meets none;
   * empty inside a ring or with nothing observed to project. Drawn only with the ring, like the
   * trail; dashed and neutral, ending in an arrowhead and the entry reading where it meets the
   * ring, in nothing where it does not.
   */
  projection?: readonly [number, number][]
  /** Seconds to that entry, the drawer's own number, or null for a course that misses. */
  projectionEntryS?: number | null
  /**
   * The study's condition (S4a, #136, ruled A4): in `raw` every shape wears one neutral colour,
   * a label prints each track's ident and a tick the heading of a drone or a dot, and the legend
   * is not drawn — the layers exist in both modes, toggled and repainted from an effect, since
   * the session may resolve after the map has built. `vigil` is the map as built.
   */
  mode?: Mode
  /**
   * A study run (S9b, #199): in Vigil the warning colour alone, the neutral on every other
   * track; in both conditions the opened mark on the marker itself; the legend withheld — the
   * brief carries it. The demo is the map as built.
   */
  run?: boolean
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
      // North-up, everywhere (#192, ruled; #36 [41]): the map neither rotates nor pitches — by
      // drag, touch or keyboard — and its bearing is held at 0. Rotation serves nothing here,
      // every frame and sheet is drawn north-up, one accidental right-drag in a run would turn
      // the picture with no obvious way back, and raw's label rule (R1 on #182) reads the true
      // heading, which is the screen's only while north is up.
      bearing: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
    })
    map.touchZoomRotate.disableRotation()
    map.keyboard.disableRotation()
    mapRef.current = map
    // Zoom only: a compass would offer a turn the map refuses.
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
      // The two marks (S10) the same way: the heading tick and the path's arrowhead.
      for (const mark of ['tick', 'arrow'] as const) {
        map.addImage(mark, glyphImage(MARKS[mark], MARK_PX, GLYPH_RATIO), {
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
      map.addSource(ADSB_SOURCE, {
        type: 'geojson',
        data: trackFeatures([], NO_TERMINAL, NO_MARKS),
      })
      // The one click target for an aircraft, invisible, under the glyph: a disc the inject
      // halo's size, which the 22 px glyph's box just covers — so the target is what the operator
      // sees, on the apron too, where a parked glyph is as visible as an airborne one now (S9).
      // The glyph layer itself is never in the click dispatch: a symbol is hit-tested by its
      // collision box, the padded quad of the whole image, axis-aligned around the rotated
      // glyph — up to twice the glyph's width — not by the silhouette drawn (#186 round 1).
      map.addLayer({
        id: `${ADSB_SOURCE}-hit`,
        type: 'circle',
        source: ADSB_SOURCE,
        paint: { 'circle-radius': 11, 'circle-opacity': 0 },
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
          'icon-color': hollowed(ADSB_COLOR),
          'icon-halo-color': ADSB_COLOR,
          'icon-halo-width': hollowHalo(0),
          // One expression, two conditions, one value — the Queue's own rule transplanted
          // (`.queue__row--ground, .queue__row--terminal { opacity: 0.55 }`), so a handled
          // ground track does not dim twice. Composing the two instead would put a terminal
          // ground glyph at 0.22, which on this background is gone (ruled on #61).
          'icon-opacity': ['case', ['any', ['get', 'terminal'], ['get', 'onGround']], 0.4, 0.8],
        },
      })
      map.addLayer({
        id: `${ADSB_SOURCE}-mark`,
        type: 'circle',
        source: ADSB_SOURCE,
        // Assessed alone: the faint ring the ruling kept. Handled is never a ring (R1).
        filter: ['==', ['get', 'mark'], 'assessed'],
        paint: {
          'circle-radius': MARK_RING.radiusPx,
          'circle-opacity': 0,
          'circle-stroke-width': MARK_RING.widthPx,
          'circle-stroke-color': MARK_RING.color,
          'circle-stroke-opacity': MARK_RING.opacity,
        },
      })
      // The breadcrumb trail (06b) sits under the injects and the ring: where the selected
      // track has been must never cover where it is. It fades toward its old end (S10, #182):
      // full strength at the track, nothing at the oldest point — the line's own progress, which
      // the source measures, so the fade is the trail's form and not its hue.
      map.addSource(TRAIL_SOURCE, { type: 'geojson', lineMetrics: true, data: lineFeature([]) })
      map.addLayer({
        id: `${TRAIL_SOURCE}-line`,
        type: 'line',
        source: TRAIL_SOURCE,
        paint: { 'line-gradient': TRAIL_FADE, 'line-width': 1.5, 'line-opacity': 0.55 },
      })
      // The projected path (#102) sits with the trail, under the injects: where the selected
      // track is going, from the dot to the ring — dashed (S10), so it is told from the trail
      // by form; the dot covers where it starts.
      map.addSource(PROJECTION_SOURCE, { type: 'geojson', data: lineFeature([]) })
      map.addLayer({
        id: `${PROJECTION_SOURCE}-line`,
        type: 'line',
        source: PROJECTION_SOURCE,
        paint: {
          'line-color': PROJECTION_COLOR,
          'line-width': 1.5,
          'line-opacity': 0.6,
          'line-dasharray': [2, 2],
        },
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
          'text-font': LABEL_FONT,
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
        data: injectFeatures([], NO_TERMINAL, NO_BANDS, NO_MARKS),
      })
      // Raw mode's heading tick (S4a; S10, #182 item 5): one mark per moving inject, from the
      // marker's edge along the observed heading, one screen length at any zoom — it carries
      // heading, never speed. Under the markers, hidden until the mode says raw; Vigil draws
      // none. An aircraft takes none: its glyph is turned to its heading.
      map.addLayer({
        id: `${INJECT_SOURCE}-tick`,
        type: 'symbol',
        source: INJECT_SOURCE,
        filter: ['get', 'tick'],
        layout: {
          visibility: 'none',
          'icon-image': 'tick',
          'icon-rotate': ['get', 'heading'],
          'icon-rotation-alignment': 'map',
          'icon-offset': [
            'case',
            ['==', ['get', 'shape'], 'drone'],
            DRONE_TICK_OFFSET,
            ['literal', tickOffset(DOT_EDGE_PX)],
          ],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: { 'icon-color': RAW_COLOR, 'icon-opacity': 0.9 },
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
          // Emptied where the track is handled, at its own size; the stroke below stays, so
          // the dot reads as an outline of itself rather than as a ring around a marker.
          'circle-opacity': [
            'case',
            IS_HANDLED,
            0,
            ['case', ['get', 'terminal'], 0.5, 0.95],
          ] as ExpressionSpecification,
          'circle-stroke-width': 2,
          'circle-stroke-color': IDENTITY_STROKE,
          'circle-stroke-opacity': ['case', ['get', 'terminal'], 0.5, 1],
        },
      })
      // The drone glyph (S9): a heard, associated Remote ID, drawn whatever it overlaps — the
      // fill by the rule above, the dot's dim, and no outline in either mode.
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
          'icon-color': hollowed(DRONE_FILL),
          'icon-opacity': ['case', ['get', 'terminal'], 0.5, 0.95],
          'icon-halo-color': DRONE_FILL,
          'icon-halo-width': hollowHalo(0),
        },
      })

      map.addLayer({
        id: `${INJECT_SOURCE}-mark`,
        type: 'circle',
        source: INJECT_SOURCE,
        // Assessed alone: the faint ring the ruling kept. Handled is never a ring (R1).
        filter: ['==', ['get', 'mark'], 'assessed'],
        paint: {
          'circle-radius': MARK_RING.radiusPx,
          'circle-opacity': 0,
          'circle-stroke-width': MARK_RING.widthPx,
          'circle-stroke-color': MARK_RING.color,
          'circle-stroke-opacity': MARK_RING.opacity,
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
          'text-font': LABEL_FONT,
          'text-size': 11,
          // The side the tick is not on (R1): anchored right, so it hangs to the left, for a
          // track heading into the right-hand half; anchored left, hanging right, otherwise.
          'text-anchor': ['case', LABEL_LEFT, 'right', 'left'],
          'text-offset': ['case', LABEL_LEFT, ['literal', [-1.2, 0]], ['literal', [1.2, 0]]],
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

      // Where the path meets the ring (S10): the arrowhead, its tip on the entry point, turned
      // to the path's bearing; and the entry reading beside it, set ahead of the arrowhead —
      // just inside the ring, clear of the track's own marker, which a close track's short path
      // ends beside — by the quadrant the path points into. Both in the bright text tone and
      // above the selection ring (ruled R3 on #182): a track a kilometre out has a 20 px path,
      // and its arrowhead was lost under the ring in the path's muted grey. The reading stands
      // 1.8 em off the point — MapLibre takes a 7/24 em baseline shift off a top or bottom
      // anchor's radial offset, so that is 16.6 px on those and 19.8 px on left and right,
      // every one past the ring's 13 px radius from any path's near end (#192, ruled 4).
      map.addSource(ENTRY_SOURCE, { type: 'geojson', data: entryFeature([], null) })
      map.addLayer({
        id: `${ENTRY_SOURCE}-arrow`,
        type: 'symbol',
        source: ENTRY_SOURCE,
        layout: {
          'icon-image': 'arrow',
          'icon-rotate': ['get', 'bearing'],
          'icon-rotation-alignment': 'map',
          'icon-offset': [0, ARROW_TIP_OFFSET_PX],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: { 'icon-color': TEXT_COLOR, 'icon-opacity': 0.95 },
      })
      map.addLayer({
        id: `${ENTRY_SOURCE}-reading`,
        type: 'symbol',
        source: ENTRY_SOURCE,
        layout: {
          'text-field': ['get', 'reading'],
          'text-font': LABEL_FONT,
          'text-size': 11,
          'text-anchor': [
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
          ],
          'text-radial-offset': 1.8,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': TEXT_COLOR, 'text-halo-color': '#0b1220', 'text-halo-width': 1 },
      })
      // Selection flows both ways (§7): a click selects the track, exactly as a row click does.
      // One registration, one dispatch, one selection: every clickable layer shares a single
      // array-form listener, so an overlap cannot fire two handlers and let the later one
      // overwrite the first — features[0] under a single dispatch is the top-rendered feature,
      // the one under the cursor visually. Each layer's disc is the whole target; the glyphs
      // stay out (their collision box is not their shape). Empty basemap clicks select nothing.
      map.on('click', [`${ADSB_SOURCE}-hit`, `${INJECT_SOURCE}-halo`], (event) => {
        // An armed map is placing a site, not selecting a track (08a).
        if (placingRef.current) return
        const id = event.features?.[0]?.properties?.id as unknown
        if (typeof id === 'string') onSelectRef.current?.(id)
      })
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
    map.getSource<GeoJSONSource>(ADSB_SOURCE)?.setData(trackFeatures(tracks, terminalIds, marks))
  }, [tracks, terminalIds, marks, styleReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    map
      .getSource<GeoJSONSource>(INJECT_SOURCE)
      ?.setData(injectFeatures(injects, terminalIds, bands, marks))
  }, [injects, terminalIds, bands, marks, styleReady])

  // Raw mode (S4a): the neutral paint on every dot, the labels and the ticks shown; Vigil's
  // paint and hidden layers otherwise. From an effect, since the mode resolves with the session.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    const raw = mode === 'raw'
    const visibility = raw ? 'visible' : 'none'
    for (const id of [`${INJECT_SOURCE}-tick`, `${ADSB_SOURCE}-label`, `${INJECT_SOURCE}-label`]) {
      map.setLayoutProperty(id, 'visibility', visibility)
    }
    // Each fill is re-set through `hollowed`, so a handled marker stays empty when the mode
    // resolves; without it the condition's own paint filled it back in (S8, ruled R1).
    // A study run paints one ink per track by the run's rule (S9b), in both conditions; the
    // demo's Vigil paint is the band fill and the identity stroke as built.
    const ink = run ? runInk(!raw) : null
    const adsbInk = ink ?? (raw ? RAW_COLOR : ADSB_COLOR)
    const droneInk = ink ?? (raw ? RAW_COLOR : DRONE_FILL)
    const dotFill = ink ?? (raw ? RAW_COLOR : BAND_FILL)
    const stroke = ink ?? (raw ? RAW_COLOR : IDENTITY_STROKE)
    map.setPaintProperty(`${ADSB_SOURCE}-glyph`, 'icon-color', hollowed(adsbInk))
    map.setPaintProperty(`${ADSB_SOURCE}-glyph`, 'icon-halo-color', adsbInk)
    map.setPaintProperty(`${INJECT_SOURCE}-halo`, 'circle-color', stroke)
    map.setPaintProperty(`${INJECT_SOURCE}-dot`, 'circle-color', dotFill)
    map.setPaintProperty(`${INJECT_SOURCE}-dot`, 'circle-stroke-color', stroke)
    map.setPaintProperty(`${INJECT_SOURCE}-glyph`, 'icon-color', hollowed(droneInk))
    map.setPaintProperty(`${INJECT_SOURCE}-glyph`, 'icon-halo-color', droneInk)
    // The opened grey reaches the label and the tick too, where raw draws them; the ring
    // candidate keeps its layers, at the weight that is found, and the grey withholds them.
    const textInk = run ? runInk(false) : RAW_COLOR
    for (const id of [`${ADSB_SOURCE}-label`, `${INJECT_SOURCE}-label`]) {
      map.setPaintProperty(id, 'text-color', textInk)
    }
    map.setPaintProperty(`${INJECT_SOURCE}-tick`, 'icon-color', textInk)
    for (const id of [`${ADSB_SOURCE}-mark`, `${INJECT_SOURCE}-mark`]) {
      map.setLayoutProperty(id, 'visibility', run && OPENED_MARK === 'grey' ? 'none' : 'visible')
      map.setPaintProperty(id, 'circle-stroke-width', run ? OPENED_RING.widthPx : MARK_RING.widthPx)
      map.setPaintProperty(
        id,
        'circle-stroke-opacity',
        run ? OPENED_RING.opacity : MARK_RING.opacity,
      )
    }
  }, [mode, run, styleReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    map.getSource<GeoJSONSource>(TRAIL_SOURCE)?.setData(lineFeature(selectionShown ? trail : []))
  }, [trail, selectionShown, styleReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    const shown = selectionShown ? projection : []
    map.getSource<GeoJSONSource>(PROJECTION_SOURCE)?.setData(lineFeature(shown))
    map
      .getSource<GeoJSONSource>(ENTRY_SOURCE)
      ?.setData(entryFeature(shown, selectionShown ? projectionEntryS : null))
  }, [projection, projectionEntryS, selectionShown, styleReady])

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
      {/* The legend is withheld in a study run (S9b): the brief carries it, and the map's
          eight-entry legend named paint the run no longer spends. */}
      {mode !== 'raw' && !run && <IdentityLegend />}
      {children}
    </div>
  )
}
