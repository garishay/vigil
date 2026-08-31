/**
 * Normalizing the adsb.lol feed into Vigil's track model (scope §5.1).
 *
 * Pure — no fetch, no filesystem, no clock. `scripts/capture-adsb.ts` owns the I/O and calls in
 * here, which is what lets the normalization be unit-tested directly, without a network.
 *
 * Node resolves ESM specifiers literally, and the capture script imports this module directly, so
 * the relative imports below carry their extensions. Vite and both tsconfig projects accept them.
 */

import { distanceMeters, round } from './geo.ts'
import type { AdsbTrack } from './tracks.ts'
import type { AreaOfOperations } from '../config/ao.ts'

/**
 * One aircraft as adsb.lol v2 returns it. Every field is optional because the feed omits whatever
 * a given airframe does not broadcast — this is the untrusted outside edge, and the normalizer's
 * job is to turn it into something the rest of Vigil can rely on.
 *
 * The enrichment fields are kept for display only (§5.1). `category` is broadcast by the aircraft
 * — an observation. `t`, `desc`, `r`, and `ownOp` are the aggregator's registry lookups — what
 * the airframe is registered as, not anything it transmitted. Vigil scores what a track does, not
 * what it claims to be: nothing in the scoring path reads any of them.
 */
export interface AdsbLolAircraft {
  hex?: string
  flight?: string
  lat?: number
  lon?: number
  /** Feet, or the string `'ground'` for an aircraft that is parked or taxiing. */
  alt_baro?: number | 'ground'
  gs?: number
  track?: number
  baro_rate?: number
  geom_rate?: number
  seen?: number
  /** ADS-B emitter category, e.g. `A3` — broadcast, so observed. */
  category?: string
  /** ICAO type designator from the registry, e.g. `B738`. */
  t?: string
  /** Registry type description, e.g. `BOEING 737-800`. */
  desc?: string
  /** Registration, from the registry. */
  r?: string
  /** Registered operator, from the registry. */
  ownOp?: string
}

/**
 * What the registry says about an airframe, as opposed to what the airframe broadcast. Kept apart
 * from the observed fields so a display can label it as a lookup, and so the scoring path has
 * nothing to reach for by accident.
 */
export interface AircraftRegistry {
  typeCode?: string
  typeDesc?: string
  registration?: string
  operator?: string
}

export interface AdsbLolResponse {
  ac?: AdsbLolAircraft[]
}

/**
 * One aircraft as the fixture stores it: what the aircraft broadcast, and nothing else.
 *
 * `source` and `identity` are absent by design. A track's cooperativity is not data to be read
 * from a file that anyone could hand-edit — it is stamped in code by `toTrack`, which means the
 * fixture format is structurally incapable of describing a real aircraft as a threat (§2).
 *
 * Fields the aircraft did not broadcast are omitted rather than stored as null. That mirrors the
 * feed's own semantics and keeps a 240-frame recording from paying for absent data on every line.
 */
export interface CaptureRecord {
  hex: string
  callsign?: string
  /** [longitude, latitude] — GeoJSON order, matching the AO config and MapLibre. */
  position: [number, number]
  /** Omitted when the aircraft broadcast no altitude. Zero only alongside `onGround`. */
  altitudeFt?: number
  /** Omitted, rather than false, for an airborne aircraft. */
  onGround?: true
  groundSpeedKt: number
  headingDeg?: number
  verticalRateFpm?: number
  /** Omitted when the track updated within the last second. */
  lastSeenSec?: number
  /** Broadcast emitter category. Omitted when the aircraft sent none. Display only. */
  category?: string
  /** Registry lookups, omitted when the aggregator had none. Display only, labelled as lookups. */
  registry?: AircraftRegistry
}

/** One instant of the real picture. */
export interface CaptureFrame {
  /** Milliseconds since the capture began. */
  tMs: number
  records: CaptureRecord[]
}

/** The committed fixture: recorded once, replayed on a clock, never polled at runtime. */
export interface AdsbCapture {
  /** The AO this was recorded over — a fixture from one AO must not be replayed against another. */
  ao: string
  source: string
  capturedAt: string
  intervalMs: number
  /** The bounding box records were filtered to, [west, south, east, north]. */
  bbox: [number, number, number, number]
  frames: CaptureFrame[]
}

export function isWithinBbox(
  bbox: [number, number, number, number],
  [lon, lat]: [number, number],
): boolean {
  const [west, south, east, north] = bbox
  return lon >= west && lon <= east && lat >= south && lat <= north
}

/**
 * The smallest radius, in nautical miles, that reaches every corner of the AO bounding box from
 * the AO center.
 *
 * adsb.lol v2 queries by radius, not by box, so the capture over-pulls a circle and filters back
 * down to the box. Deriving the radius here keeps `ao.ts` the single source of truth for the
 * geography — the API's shape never leaks into configuration.
 */
export function captureRadiusNm(ao: AreaOfOperations): number {
  const [west, south, east, north] = ao.bbox
  const corners: [number, number][] = [
    [west, south],
    [west, north],
    [east, south],
    [east, north],
  ]
  const farthestM = Math.max(...corners.map((corner) => distanceMeters(ao.center, corner)))
  return Math.ceil(farthestM / 1852)
}

/** The emitter-category codes that mean "no category information" in each ADS-B category set. */
const NO_CATEGORY: ReadonlySet<string> = new Set(['A0', 'B0', 'C0', 'D0'])

/** One raw record to one storable record, or null when it carries no usable position. */
export function normalizeAircraft(raw: AdsbLolAircraft): CaptureRecord | null {
  const { hex, lat, lon } = raw
  if (!hex || typeof lat !== 'number' || typeof lon !== 'number') return null

  const onGround = raw.alt_baro === 'ground'
  // 'ground' is a real reading; a missing alt_baro is not, and must not be flattened into zero.
  const altitudeFt = onGround
    ? 0
    : typeof raw.alt_baro === 'number'
      ? Math.round(raw.alt_baro)
      : undefined
  // The feed pads `flight` to eight characters; an all-blank ident means none was broadcast.
  const callsign = raw.flight?.trim()
  // Barometric rate is the primary; geometric is the fallback the feed offers when it is absent.
  const verticalRate = raw.baro_rate ?? raw.geom_rate
  const lastSeenSec = round(raw.seen ?? 0, 1)
  const text = (value: string | undefined) => value?.trim() || undefined
  // `A0`/`B0`/`C0`/`D0` encode "no emitter category information" — the aircraft saying it has
  // none, which is the same thing as the field being absent.
  const rawCategory = text(raw.category)
  const category = rawCategory && !NO_CATEGORY.has(rawCategory) ? rawCategory : undefined
  const registry: AircraftRegistry = {
    ...(text(raw.t) ? { typeCode: text(raw.t) } : {}),
    ...(text(raw.desc) ? { typeDesc: text(raw.desc) } : {}),
    ...(text(raw.r) ? { registration: text(raw.r) } : {}),
    ...(text(raw.ownOp) ? { operator: text(raw.ownOp) } : {}),
  }

  return {
    hex,
    ...(callsign ? { callsign } : {}),
    // Five decimals is roughly a metre — finer than ADS-B position accuracy, and it keeps the
    // committed fixture from storing float noise 240 frames deep.
    position: [round(lon, 5), round(lat, 5)],
    ...(altitudeFt !== undefined ? { altitudeFt } : {}),
    ...(onGround ? { onGround: true as const } : {}),
    groundSpeedKt: round(raw.gs ?? 0, 1),
    ...(typeof raw.track === 'number' ? { headingDeg: round(raw.track, 1) } : {}),
    ...(typeof verticalRate === 'number' ? { verticalRateFpm: Math.round(verticalRate) } : {}),
    ...(lastSeenSec > 0 ? { lastSeenSec } : {}),
    ...(category ? { category } : {}),
    ...(Object.keys(registry).length > 0 ? { registry } : {}),
  }
}

/**
 * A whole response to the records inside the AO, ordered by ICAO hex.
 *
 * The sort is not cosmetic: the feed returns aircraft in arrival order, so without it the same
 * traffic would produce a different byte sequence every frame and the fixture's diffs would be
 * noise.
 *
 * Codepoint order, not `localeCompare`: the feed prefixes non-ICAO (TIS-B, MLAT) addresses with
 * `~`, and where a tilde sorts under ICU collation depends on the locale and the ICU build. A
 * recapture on a differently configured machine would then diff as reordering — which is the
 * very thing the sort exists to prevent.
 */
export function normalizeResponse(
  response: AdsbLolResponse,
  bbox: [number, number, number, number],
): CaptureRecord[] {
  return (response.ac ?? [])
    .map(normalizeAircraft)
    .filter(
      (record): record is CaptureRecord => record !== null && isWithinBbox(bbox, record.position),
    )
    .sort((a, b) => (a.hex < b.hex ? -1 : a.hex > b.hex ? 1 : 0))
}

/**
 * A stored record to a track the rest of Vigil can consume.
 *
 * This is the only place an `AdsbTrack` is created, and its `identity` is the literal
 * `'cooperative'` from the type. Real aircraft are cooperative by construction, and the
 * construction is right here (§2).
 */
export function toTrack(record: CaptureRecord): AdsbTrack {
  return {
    id: `adsb-${record.hex}`,
    source: 'adsb',
    icaoHex: record.hex,
    identity: 'cooperative',
    callsign: record.callsign ?? null,
    position: record.position,
    altitudeFt: record.altitudeFt ?? null,
    onGround: record.onGround ?? false,
    groundSpeedKt: record.groundSpeedKt,
    headingDeg: record.headingDeg ?? null,
    verticalRateFpm: record.verticalRateFpm ?? null,
    lastSeenSec: record.lastSeenSec ?? 0,
    category: record.category ?? null,
    registry: record.registry ?? null,
  }
}

/**
 * Capture etiquette.
 *
 * adsb.lol is free, open-data, and run on receivers people donated. Polling it every five seconds
 * earned a 429 and then an IP block — and the first version of the capture script made that worse
 * by catching each failure and firing again, pushing roughly 190 further requests after the
 * service had already said stop. These limits exist so that cannot happen twice.
 *
 * The decision logic lives here, pure and tested, rather than in the script: it is the part that
 * bit us, and `fetch` is the only thing left that a test cannot reach.
 */
export const CAPTURE_ETIQUETTE = {
  /** Requests closer together than this are refused outright. */
  minIntervalS: 10,
  /** A 429 means we are already over the line. A second one ends the run. */
  maxRateLimits: 2,
  /** Used when the service rate-limits us without saying for how long. */
  rateLimitBackoffS: 60,
  /** A feed that has gone away stops the run rather than burning the whole window on it. */
  maxConsecutiveFailures: 3,
} as const

/** Why a frame could not be fetched. */
export interface CaptureFailure {
  /** True only for HTTP 429 — the service explicitly telling us to slow down. */
  rateLimited: boolean
  /** The `Retry-After` header, verbatim, or null when it was absent. */
  retryAfter: string | null
  message: string
}

/** Failure counts for the run so far, including the failure being judged. */
export interface CaptureFailureState {
  rateLimits: number
  consecutiveFailures: number
}

export type CaptureDecision =
  { action: 'continue'; backOffS: number } | { action: 'abort'; reason: string }

/**
 * `Retry-After` in seconds. The header is legally either a delay in seconds or an HTTP date, and
 * it may be absent, empty, or malformed — every one of those falls back to the configured backoff rather
 * than retrying hot.
 */
export function retryAfterSeconds(
  header: string | null,
  nowMs: number = Date.now(),
  fallbackS: number = CAPTURE_ETIQUETTE.rateLimitBackoffS,
): number {
  // Empty is checked explicitly: `Number("")` is a perfectly finite zero, and zero is a hot retry.
  if (header === null || header.trim() === '') return fallbackS
  const seconds = Number(header.trim())
  if (Number.isFinite(seconds)) return seconds > 0 ? seconds : 0
  const dateMs = Date.parse(header)
  if (Number.isNaN(dateMs)) return fallbackS
  return Math.max(0, Math.ceil((dateMs - nowMs) / 1000))
}

/**
 * What the capture should do after a failed frame.
 *
 * Rate limiting is treated as categorically different from a dropped connection: a 429 is the
 * service asking us to stop, so the run ends on the second one, while a flaky connection is
 * ridden out until it looks permanent.
 */
export function decideAfterFailure(
  failure: CaptureFailure,
  state: CaptureFailureState,
  nowMs: number = Date.now(),
  etiquette: typeof CAPTURE_ETIQUETTE = CAPTURE_ETIQUETTE,
): CaptureDecision {
  if (failure.rateLimited && state.rateLimits >= etiquette.maxRateLimits) {
    return {
      action: 'abort',
      reason: `rate limited ${state.rateLimits}x — stopping rather than pushing toward a ban`,
    }
  }
  if (state.consecutiveFailures >= etiquette.maxConsecutiveFailures) {
    return {
      action: 'abort',
      reason: `${state.consecutiveFailures} consecutive failures — stopping; the feed is gone`,
    }
  }
  return {
    action: 'continue',
    backOffS: failure.rateLimited
      ? retryAfterSeconds(failure.retryAfter, nowMs, etiquette.rateLimitBackoffS)
      : 0,
  }
}
