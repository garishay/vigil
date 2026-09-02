/**
 * The scoring engine v1 (scope §6, PR 04): five transparent factors, a 0–100 composite, and the
 * per-factor breakdown kept beside it. Pure — no React, no DOM, no I/O, no clock, no network.
 * Every number comes from `config/scoring.ts`; the module holds the shapes and the arithmetic.
 *
 * **Scores the observation, never the label** (ruled on #4). The input type is `ObservedTrack`
 * — the track model with the answer key removed — so a factor that reaches for `remoteId`,
 * `behavior`, or the display enrichment does not compile. Cooperativity reads the per-frame
 * identity and an `IdentityMemory` of when an ident was last heard; both are observations, and
 * an intermittent inject that has not yet been heard is, correctly, indistinguishable from a
 * silent one.
 *
 * **Real aircraft are never the threat** (§2), as arithmetic rather than as weights: after the
 * sum, a track whose observed `source` is ADS-B is capped at the configured ceiling, below the
 * elevated band, and the cap is reported on the score so the display prints it as its own line
 * (ruled A3 on #4). The bars still sum to the uncapped composite; nothing is hidden.
 *
 * Time is an input — `tSec` for the memory, `minuteOfDay` for the off-hours factor — which is
 * the seam PR 06's replay clock drives.
 */

import type { ProtectedSite } from '../config/ao.ts'
import { KINEMATIC_CLASS } from '../config/airframes.ts'
import { SCORING, type Band, type FactorId, type ScoringConfig } from '../config/scoring.ts'
import { closestApproach, distanceMeters } from './geo.ts'
import type { Track } from './tracks.ts'

export type { Band, FactorId }

const KT_TO_MS = 0.514444

/** The fields the scorer must never see: the generator's answer key and the display lookups. */
type AnswerKey = 'behavior' | 'remoteId' | 'uaType' | 'category' | 'registry'

/**
 * What the engine is allowed to read. Distributive over the union, so each layer keeps its own
 * literal `source` and `identity`; every `Track` is assignable to it, and no factor can read what
 * it strips. This is the type-level half of the #4 ruling — the runtime half is the test that
 * scores two tracks differing only in `remoteId` identically.
 */
type Observed<T> = T extends unknown ? Omit<T, AnswerKey> : never
export type ObservedTrack = Observed<Track>

/** When each track's ident was last heard, by id; a track absent here has never been heard. */
export type IdentityMemory = Readonly<Record<string, { lastHeardTSec: number | null }>>

export interface ScoringContext {
  /** Scenario time of the picture being scored, seconds. */
  tSec: number
  /** Local time of day, minutes from midnight, for the off-hours factor. */
  minuteOfDay: number
  memory: IdentityMemory
  config?: ScoringConfig
}

export interface Factor {
  id: FactorId
  /** The plain-English §6 UI label — what the breakdown bar says. */
  label: string
  /** 0–100. */
  value: number
  weight: number
  /** `value / 100 × weight` — the bar's fill, and what sums to the uncapped composite. */
  contribution: number
  /** One line saying what the value rests on, in observed terms. */
  detail: string
}

export interface Score {
  /** 0–100, after the ceiling. */
  composite: number
  /** 0–100, before the ceiling — equal to `composite` unless `capped`. */
  uncapped: number
  /** True when the ADS-B ceiling bound; the display prints the cap as its own line. */
  capped: boolean
  band: Band
  factors: Factor[]
  /** Range to the nearest protected site, meters, and which site — shared with the Queue row. */
  rangeM: number
  siteId: string
}

/** The §6 table's UI labels and intent text, keyed by factor, in breakdown order. */
export const FACTORS: readonly { id: FactorId; label: string; intent: string }[] = [
  {
    id: 'cooperativity',
    label: 'Non-cooperative',
    intent:
      'Silence carries the burden of proof — a spectrum: ADS-B aircraft near-floor, Remote ID drones low, silent tracks high',
  },
  {
    id: 'closing',
    label: 'Closing',
    intent: 'CPA distance and time-to-CPA relative to the protected site',
  },
  {
    id: 'proximity',
    label: 'Proximity',
    intent:
      'Current range to the protected site, decaying with distance — the curve spikes inside the protection ring',
  },
  {
    id: 'kinematic',
    label: 'Flight profile',
    intent: 'Low-and-slow small-UAS envelope vs. conventional aircraft envelope',
  },
  {
    id: 'time',
    label: 'Off-hours',
    intent: 'Activity outside normal operating hours scores higher',
  },
]

export const FACTOR_LABEL: Record<FactorId, string> = Object.fromEntries(
  FACTORS.map((factor) => [factor.id, factor.label]),
) as Record<FactorId, string>

const clamp = (value: number) => Math.max(0, Math.min(100, value))

/** 100 at or below `full`, 0 at or above `zero`, linear between. */
const rolloff = (reading: number, full: number, zero: number) =>
  clamp(100 * (1 - (reading - full) / (zero - full)))

/** Minutes from midnight for an `HH:MM` local time. */
export function parseClock(hhmm: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!match) throw new Error(`clock time must be HH:MM, got "${hhmm}"`)
  const [hours, minutes] = [Number(match[1]), Number(match[2])]
  if (hours > 23 || minutes > 59) throw new Error(`clock time out of range: "${hhmm}"`)
  return hours * 60 + minutes
}

/** The local minute of day `tSec` after a clock start, wrapping at midnight. */
export function minuteOfDay(startLocal: string, tSec: number): number {
  const minutes = parseClock(startLocal) + Math.floor(tSec / 60)
  return ((minutes % 1440) + 1440) % 1440
}

/** `HH:MM` for a minute of day — the strip's sim clock and the off-hours detail line. */
export const formatClock = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

/**
 * The memory after one more frame: every inject heard this frame — its identity reads
 * cooperative because its ident arrived — stamps `tSec`; every other track keeps what it had,
 * or opens as never heard. Pure and immutable, so the app folds it per frame and a test folds
 * a whole sequence. ADS-B tracks are cooperative by construction and need no memory.
 */
export function rememberIdentities(
  memory: IdentityMemory,
  tracks: readonly ObservedTrack[],
  tSec: number,
): IdentityMemory {
  const next: Record<string, { lastHeardTSec: number | null }> = { ...memory }
  for (const track of tracks) {
    if (track.source !== 'inject') continue
    const heard = track.identity === 'cooperative'
    next[track.id] = heard ? { lastHeardTSec: tSec } : (next[track.id] ?? { lastHeardTSec: null })
  }
  return next
}

/** The nearest protected site and the range to its center — the Queue's range column. */
function nearestSite(
  position: [number, number],
  sites: readonly ProtectedSite[],
): { site: ProtectedSite; rangeM: number } {
  let best = { site: sites[0], rangeM: distanceMeters(sites[0].center, position) }
  for (const site of sites.slice(1)) {
    const rangeM = distanceMeters(site.center, position)
    if (rangeM < best.rangeM) best = { site, rangeM }
  }
  return best
}

const km = (meters: number) => `${(meters / 1000).toFixed(1)} km`

function cooperativity(
  track: ObservedTrack,
  context: ScoringContext,
  config: ScoringConfig['cooperativity'],
): { value: number; detail: string } {
  if (track.source === 'adsb')
    return { value: config.adsb, detail: 'ADS-B, cooperative by construction' }
  if (track.identity === 'cooperative')
    return { value: config.heard, detail: 'Remote ID heard this frame' }
  const lastHeard = context.memory[track.id]?.lastHeardTSec ?? null
  if (lastHeard === null) return { value: config.silent, detail: 'no ident heard' }
  const sinceS = Math.max(0, context.tSec - lastHeard)
  if (sinceS <= config.dwellS) {
    return { value: config.heard, detail: `ident last heard ${sinceS} s ago — holding` }
  }
  const fraction = Math.min(1, (sinceS - config.dwellS) / config.decayS)
  const value = config.heard + (config.unknown - config.heard) * fraction
  return {
    value,
    detail: `ident last heard ${sinceS} s ago — ${fraction < 1 ? 'degrading' : 'unknown'}`,
  }
}

const ON_GROUND = { value: 0, detail: 'on ground — not in the airspace' }

function closing(
  track: ObservedTrack,
  sites: readonly ProtectedSite[],
  config: ScoringConfig['closing'],
): { value: number; detail: string } {
  if (track.onGround) return ON_GROUND
  if (track.groundSpeedKt === null || track.headingDeg === null) {
    return { value: 0, detail: 'speed or heading not observed' }
  }
  // Worst case across sites: the approach that scores highest is the one worth showing.
  let best: { value: number; detail: string } | null = null
  for (const site of sites) {
    const approach = closestApproach(
      track.position,
      track.headingDeg,
      track.groundSpeedKt * KT_TO_MS,
      site.center,
    )
    if (approach === null) return { value: 0, detail: 'not moving' }
    const { cpaM, tcpaS } = approach
    const candidate =
      tcpaS <= 0
        ? { value: 0, detail: 'opening — closest approach already passed' }
        : {
            value:
              (rolloff(cpaM, site.radiusM, site.radiusM * config.cpaRolloffRadii) *
                rolloff(tcpaS / 60, config.tcpaFullMin, config.tcpaZeroMin)) /
              100,
            detail: `CPA ${km(cpaM)} in ${Math.round(tcpaS / 60)} min`,
          }
    if (best === null || candidate.value > best.value) best = candidate
  }
  return best ?? { value: 0, detail: 'no protected site' }
}

function proximity(
  track: ObservedTrack,
  site: ProtectedSite,
  rangeM: number,
  config: ScoringConfig['proximity'],
): { value: number; detail: string } {
  if (track.onGround) return ON_GROUND
  const inside = rangeM <= site.radiusM
  return {
    value: inside ? 100 : rolloff(rangeM, site.radiusM, site.radiusM * config.rolloffRadii),
    detail: `${km(rangeM)} — ${inside ? 'inside' : 'outside'} the ${km(site.radiusM)} ring`,
  }
}

function kinematic(
  track: ObservedTrack,
  config: ScoringConfig['kinematic'],
): { value: number; detail: string } {
  if (track.onGround) return ON_GROUND
  const { altitudeFt, groundSpeedKt } = track
  // A null is a gap, not a low number (#35): no evidence of the envelope either way.
  if (altitudeFt === null || groundSpeedKt === null) {
    return { value: 0, detail: 'altitude or speed not observed' }
  }
  const value = Math.min(
    rolloff(altitudeFt, KINEMATIC_CLASS.maxAltitudeFt, config.altitudeZeroFt),
    rolloff(groundSpeedKt, KINEMATIC_CLASS.maxGroundSpeedKt, config.speedZeroKt),
  )
  const where = value === 100 ? 'inside' : value > 0 ? 'near' : 'outside'
  return {
    value,
    detail: `${altitudeFt} ft · ${Math.round(groundSpeedKt)} kt — ${where} the small-UAS envelope`,
  }
}

function timeContext(
  minute: number,
  config: ScoringConfig['operatingHours'],
): { value: number; detail: string } {
  const open = parseClock(config.open)
  const close = parseClock(config.close)
  const within = minute >= open && minute < close
  return {
    value: within ? 0 : 100,
    detail: `${formatClock(minute)} local — ${within ? 'within' : 'outside'} ${config.open}–${config.close}`,
  }
}

export const bandOf = (composite: number, bands: ScoringConfig['bands']): Band =>
  composite >= bands.alarm ? 'alarm' : composite >= bands.elevated ? 'elevated' : 'calm'

/** One track's score against the protected sites, with the breakdown that explains it. */
export function scoreTrack(
  track: ObservedTrack,
  sites: readonly ProtectedSite[],
  context: ScoringContext,
): Score {
  if (sites.length === 0) throw new Error('scoreTrack needs at least one protected site')
  const config = context.config ?? SCORING
  const nearest = nearestSite(track.position, sites)
  const raw: Record<FactorId, { value: number; detail: string }> = {
    cooperativity: cooperativity(track, context, config.cooperativity),
    closing: closing(track, sites, config.closing),
    proximity: proximity(track, nearest.site, nearest.rangeM, config.proximity),
    kinematic: kinematic(track, config.kinematic),
    time: timeContext(context.minuteOfDay, config.operatingHours),
  }
  const factors = FACTORS.map(({ id, label }): Factor => {
    const weight = config.weights[id]
    return { id, label, weight, ...raw[id], contribution: (raw[id].value / 100) * weight }
  })
  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0)
  const uncapped =
    (factors.reduce((sum, factor) => sum + factor.contribution, 0) / totalWeight) * 100
  const capped = track.source === 'adsb' && uncapped > config.adsbCeiling
  const composite = capped ? config.adsbCeiling : uncapped
  return {
    composite,
    uncapped,
    capped,
    band: bandOf(composite, config.bands),
    factors,
    rangeM: nearest.rangeM,
    siteId: nearest.site.id,
  }
}
