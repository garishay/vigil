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
import type { AdsbTrack, AircraftRegistry } from './tracks.ts'
import type { AreaOfOperations } from '../config/ao.ts'

/**
 * One aircraft as adsb.lol v2 returns it. Every field is optional because the feed omits whatever
 * a given airframe does not broadcast — this is the untrusted outside edge, and the normalizer's
 * job is to turn it into something the rest of Vigil can rely on.
 *
 * The enrichment fields are kept for display only (§5.1). `category` is broadcast by the aircraft
 * — an observation. `t`, `desc`, and `r` are the aggregator's registry lookups — what the
 * airframe is registered as, not anything it transmitted. Vigil scores what a track does, not
 * what it claims to be: nothing in the scoring path reads any of them.
 *
 * The feed's `ownOp` (registered owner/operator) is deliberately not typed and never mapped: for
 * GA traffic it is often a natural person's name, and Vigil displays what is broadcast or what a
 * public type registry says about the airframe — it never resolves a tail number to a person
 * (§2, §5.1). An airline operator, if ever wanted, comes from a callsign-prefix table, which can
 * only name a company. A test pins the refusal.
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
}

export interface AdsbLolResponse {
  ac?: AdsbLolAircraft[]
}

/**
 * One aircraft as the fixture stores it: the fields the aircraft broadcast, plus the registry
 * lookups the aggregator returned alongside them. The two halves are kept apart and labelled by
 * provenance (§5.1) — `registry` is display-only and never scored, and that split is the point:
 * what a track *did* is observed, what it is *registered as* is somebody's database.
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
  /** Omitted when the aircraft broadcast no ground speed — never coerced to zero (#35). */
  groundSpeedKt?: number
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

/**
 * A trimmed string, or undefined for absent, blank, and non-string values. The typeof guard is
 * load-bearing: the recording is parsed with an unchecked cast, so a malformed field must degrade
 * softly like every other field on the read path, not throw inside the app's render.
 */
const text = (value: unknown) => (typeof value === 'string' && value.trim()) || undefined

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
  // `A0`/`B0`/`C0`/`D0` encode "no emitter category information" — the aircraft saying it has
  // none, which is the same thing as the field being absent.
  const rawCategory = text(raw.category)
  const category = rawCategory && !NO_CATEGORY.has(rawCategory) ? rawCategory : undefined
  // Each bound once: a guard and a value that are separate expressions are two places to keep
  // in step, and the one that drifts stores the thing the other just rejected.
  const typeCode = text(raw.t)
  const typeDesc = text(raw.desc)
  const registration = text(raw.r)
  const registry: AircraftRegistry = {
    ...(typeCode ? { typeCode } : {}),
    ...(typeDesc ? { typeDesc } : {}),
    ...(registration ? { registration } : {}),
  }

  return {
    hex,
    ...(callsign ? { callsign } : {}),
    // Five decimals is roughly a metre — finer than ADS-B position accuracy, and it keeps the
    // committed fixture from storing float noise 240 frames deep.
    position: [round(lon, 5), round(lat, 5)],
    ...(altitudeFt !== undefined ? { altitudeFt } : {}),
    ...(onGround ? { onGround: true as const } : {}),
    ...(typeof raw.gs === 'number' ? { groundSpeedKt: round(raw.gs, 1) } : {}),
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
    groundSpeedKt: record.groundSpeedKt ?? null,
    headingDeg: record.headingDeg ?? null,
    verticalRateFpm: record.verticalRateFpm ?? null,
    lastSeenSec: record.lastSeenSec ?? 0,
    // Blank/trim and the no-category sentinels are enforced at capture time too, but this record
    // may not have come from our capture script — a hand-built fixture, or Phase 2's live feed.
    // The read path applies the same rules, so the invariants hold wherever the record came from.
    category: cleanCategory(record.category),
    registry: cleanRegistry(record.registry),
  }
}

/** The category as the display may use it: trimmed, and null for blanks and the sentinels. */
function cleanCategory(category: string | undefined): string | null {
  const trimmed = text(category)
  return trimmed && !NO_CATEGORY.has(trimmed) ? trimmed : null
}

/**
 * The registry with blank values dropped, or null when nothing usable remains — an empty lookup
 * is the same as no lookup, and the `AdsbTrack.registry` contract says null.
 */
function cleanRegistry(registry: AircraftRegistry | undefined): AircraftRegistry | null {
  if (!registry) return null
  // Built field-by-name, never by copying keys: a foreign record's registry could carry fields
  // the model refuses (an owner name, say), and a whitelist is what keeps them off the track.
  const typeCode = text(registry.typeCode)
  const typeDesc = text(registry.typeDesc)
  const registration = text(registry.registration)
  if (!typeCode && !typeDesc && !registration) return null
  return {
    ...(typeCode ? { typeCode } : {}),
    ...(typeDesc ? { typeDesc } : {}),
    ...(registration ? { registration } : {}),
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
  /**
   * The share of a run's frames that may be missing before the recording is refused. A rate,
   * with a floor under it — see `gapBudget` (#36 [3]).
   */
  maxMissingRate: 0.1,
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

/** Where the run stands after a frame — everything the next-frame decision reads. */
export interface FrameSchedule {
  /** The frame just attempted. Slot `i` is due at `startedAt + i * intervalMs`. */
  attempted: number
  startedAt: number
  intervalMs: number
}

/** Which frame to capture next, and how long to wait first. */
export interface NextFrame {
  index: number
  waitMs: number
}

/**
 * When the next frame is due, against a schedule fixed when the run began.
 *
 * The naive answer — sleep until `dueAt + intervalMs` — goes negative for every slot a backoff
 * ran past, so the loop fired the whole backlog with no delay at all: back-to-back requests
 * breaking the same floor the script enforces on its own arguments, in the moments right after
 * the service asked us to slow down. That is the failure this exists to make impossible.
 *
 * Every request is issued **on a slot**, and the answer is always the first slot still ahead of
 * us. Slots the run has fallen past are skipped rather than crowded in, which is what keeps
 * `tMs` honest — a gap in the recording is by design (a dropped frame already leaves one), a
 * frame stamped with a time it was not taken is not. Because the wait always lands on the slot
 * the index names, those two can never disagree.
 *
 * Etiquette then falls out of the grid instead of being clamped on top of it. An earlier version
 * clamped the wait at the floor and kept the index it had already chosen, which reintroduced the
 * restamping this is here to prevent: at `--interval 10` the clamp won every iteration by the
 * sleep overshoot, the schedule never re-synced, and the error grew without bound. `minSlots`
 * puts the same guarantee on the grid, where it cannot drift — it is 1 for every interval
 * `parseArgs` accepts, and larger only if a caller ever schedules below the floor.
 */
export function scheduleNextFrame(
  schedule: FrameSchedule,
  nowMs: number = Date.now(),
  etiquette: typeof CAPTURE_ETIQUETTE = CAPTURE_ETIQUETTE,
): NextFrame {
  const { attempted, startedAt, intervalMs } = schedule
  const minSlots = Math.max(1, Math.ceil((etiquette.minIntervalS * 1000) / intervalMs))
  const firstAhead = Math.ceil((nowMs - startedAt) / intervalMs)
  const index = Math.max(attempted + minSlots, firstAhead)
  return { index, waitMs: Math.max(startedAt + index * intervalMs - nowMs, 0) }
}

/**
 * Whether a backoff would end past the run's last slot — decided before the sleep, never after.
 *
 * `Retry-After: 3600` on frame 5 of 80 used to be slept through in full, only for the loop to
 * wake, find every remaining slot behind it, and throw (#41). The projection is the scheduler's
 * own answer at the moment the backoff would end, so the two can never disagree about which slot
 * comes next.
 */
export function backoffOutlastsWindow(
  schedule: FrameSchedule,
  backOffS: number,
  frameCount: number,
  nowMs: number = Date.now(),
  etiquette: typeof CAPTURE_ETIQUETTE = CAPTURE_ETIQUETTE,
): boolean {
  return scheduleNextFrame(schedule, nowMs + backOffS * 1000, etiquette).index >= frameCount
}

/**
 * How many frames a run may be missing and still be written.
 *
 * A rate alone made a short capture fragile: `--minutes 5` gives twenty frames and a budget of
 * two, and the one 429 the etiquette deliberately tolerates costs five — the failed request plus
 * the four slots a 60 s backoff runs past — so the capture was discarded for an event the rules
 * permit (#36 [3]). The floor is that event's cost at the fallback backoff: the budget is never
 * smaller than what the etiquette itself allows, and a long capture keeps the rate, which is
 * larger.
 */
export function gapBudget(
  frameCount: number,
  intervalMs: number,
  etiquette: typeof CAPTURE_ETIQUETTE = CAPTURE_ETIQUETTE,
): number {
  const oneRateLimit = 1 + Math.ceil((etiquette.rateLimitBackoffS * 1000) / intervalMs)
  return Math.max(Math.floor(etiquette.maxMissingRate * frameCount), oneRateLimit)
}
