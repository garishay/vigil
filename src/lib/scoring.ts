/**
 * The scoring engine v1 (scope §6, PR 04, the pattern row 05a): six transparent factors, a 0–100
 * composite, and the per-factor breakdown kept beside it. Pure — no React, no DOM, no I/O, no clock, no network.
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
 * caution band, and the cap is reported on the score so the display prints it as its own line
 * (ruled A3 on #4). The factor lines sum to the weighted total within rounding; the total, to
 * one decimal, is what the score is made from — over the configured weights, then the ceiling
 * — so the printed division reproduces it, and both are on the score: nothing is hidden.
 *
 * Time is an input — `tSec` for the memory, `minuteOfDay` for the off-hours factor — which is
 * the seam PR 06's replay clock drives. **History is an input too** (05a): the pattern-of-life
 * factor reads each track's position history from the context, sampled by the replay module at
 * the frame-grid instants, so the detectors in `patterns.ts` see positions and nothing else.
 *
 * **Inside the ring the approach is complete** (ruled on #5, note 2): closing reads 100 for any
 * track inside a protected site's ring — the closest approach to the volume is now — where the
 * CPA/TCPA geometry, built for the approach, otherwise answers a question that no longer applies
 * and reads whichever way the nose happens to point. Outside the ring it is unchanged.
 *
 * **The site set is an input, and the score carries it** (08a, ruled on #86). The sites are the
 * session's — the operator's, seeded from config — and each protected site's tier scales its
 * closing and proximity value before the worst case across sites is taken, so the contribution
 * stays `value / 100 × weight` and the record keeps reconciling. The set as scored rides on the
 * score as `sites`, the way the weights ride on each factor: doctrine in force at the moment,
 * for the snapshot and the frozen handoff.
 */

import type { ProtectedSite, SiteRecord } from '../config/ao.ts'
import { KINEMATIC_CLASS } from '../config/airframes.ts'
import {
  SCORING,
  type Band,
  type FactorId,
  type PatternKind,
  type ScoringConfig,
} from '../config/scoring.ts'
import { closestApproach, distanceMeters } from './geo.ts'
import { detectPattern, type TrackHistories } from './patterns.ts'
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
  /** Each track's position history at `tSec` (05a); a track absent here has no history yet. */
  history?: TrackHistories
  config?: ScoringConfig
}

export interface Factor {
  id: FactorId
  /** The plain-English §6 UI label — what the breakdown bar says. */
  label: string
  /** 0–100. */
  value: number
  weight: number
  /** `value / 100 × weight` — the bar's fill; these sum to `weighted`, before rounding. */
  contribution: number
  /** One line saying what the value rests on, in observed terms. */
  detail: string
}

export interface Score {
  /** 0–100, after the ceiling. */
  composite: number
  /** The sum of the contributions before rounding. */
  weighted: number
  /**
   * `weighted` to one decimal — the total the Score line prints, and the number the score is
   * made from, so the division on that line reproduces the score by construction rather than
   * within a rounding error that can cross a band (#63, round 2).
   */
  total: number
  /** The sum of the configured weights — what `weighted` is over. */
  totalWeight: number
  /** 0–100, before the ceiling — equal to `composite` unless `capped`. */
  uncapped: number
  /** True when the ADS-B ceiling bound; the display prints the cap as its own line. */
  capped: boolean
  band: Band
  factors: Factor[]
  /**
   * The pattern the history names — loiter, orbit, revisit — or null (05a). The verdict word
   * lives here for the reason tag, the record, and the handoff, never on the breakdown row.
   */
  pattern: PatternKind | null
  /** Range to the nearest protected site, meters, and which site — shared with the Queue row. */
  rangeM: number
  siteId: string
  /** The site set the track was scored against — what the operator saw (08a, ruled on #86). */
  sites: readonly SiteRecord[]
}

/** The §6 table's UI labels and intent text, keyed by factor, in breakdown order. */
export const FACTORS: readonly { id: FactorId; label: string; intent: string }[] = [
  {
    // Named for what it measures — the identity state — not for a verdict, like the other
    // four; the value and the detail carry the judgement (ruled on #65).
    id: 'cooperativity',
    label: 'Identity',
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
    // Named for what it measures, as Identity is (ruled on #5, note 1a): the detail line carries
    // the evidence — a dwell, a turn, a return — and the detected word stays off the row.
    id: 'pattern',
    label: 'Pattern of life',
    intent: 'Loiter dwell, orbit detection (persistent turn rate), area revisit',
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

type Tiers = ScoringConfig['tierMultiplier']

/** The tier on the detail line when it scaled the value — ` · tier 2 × 0.5` — and nothing at 1. */
const tierNote = (site: ProtectedSite, tiers: Tiers) =>
  tiers[site.tier] === 1 ? '' : ` · tier ${site.tier} × ${tiers[site.tier]}`

interface Candidate {
  value: number
  detail: string
  rangeM: number
}

/**
 * The worst case across sites: the highest per-site value, and at a tie the nearer centre —
 * inside two rings the nearer enclosing site is named (#80 review), so the row's lines never
 * quote a range to a site they do not say.
 */
function worstCase(candidates: readonly Candidate[]): { value: number; detail: string } {
  let best: Candidate | null = null
  for (const candidate of candidates) {
    if (
      best === null ||
      candidate.value > best.value ||
      (candidate.value === best.value && candidate.rangeM < best.rangeM)
    ) {
      best = candidate
    }
  }
  return best
    ? { value: best.value, detail: best.detail }
    : { value: 0, detail: 'no protected site' }
}

function closing(
  track: ObservedTrack,
  sites: readonly ProtectedSite[],
  config: ScoringConfig['closing'],
  tiers: Tiers,
): { value: number; detail: string } {
  if (track.onGround) return ON_GROUND
  const candidates: Candidate[] = []
  for (const site of sites) {
    const rangeM = distanceMeters(site.center, track.position)
    const scale = tiers[site.tier]
    const note = tierNote(site, tiers)
    // Inside a ring the approach is complete, whichever way the track points (ruled on #5).
    if (rangeM <= site.radiusM) {
      const ring = sites.length > 1 ? `${site.name}'s ring` : 'the ring'
      candidates.push({
        value: 100 * scale,
        detail: `${km(rangeM)} — inside ${ring}, closest approach is now${note}`,
        rangeM,
      })
      continue
    }
    if (track.groundSpeedKt === null || track.headingDeg === null) {
      candidates.push({ value: 0, detail: 'speed or heading not observed', rangeM })
      continue
    }
    const approach = closestApproach(
      track.position,
      track.headingDeg,
      track.groundSpeedKt * KT_TO_MS,
      site.center,
    )
    if (approach === null) return { value: 0, detail: 'not moving' }
    const { cpaM, tcpaS } = approach
    candidates.push(
      tcpaS <= 0
        ? { value: 0, detail: 'opening — closest approach already passed', rangeM }
        : {
            value:
              ((rolloff(cpaM, site.radiusM, site.radiusM * config.cpaRolloffRadii) *
                rolloff(tcpaS / 60, config.tcpaFullMin, config.tcpaZeroMin)) /
                100) *
              scale,
            detail: `CPA ${km(cpaM)} in ${Math.round(tcpaS / 60)} min${note}`,
            rangeM,
          },
    )
  }
  return worstCase(candidates)
}

/**
 * Worst case across sites, as closing is: the highest per-site roll-off, not the nearest centre
 * — a track inside a large site's ring must not score 0 because a small site is nearer (#63
 * review). With one site this is the Queue's own range; with more, the detail names the site.
 */
function proximity(
  track: ObservedTrack,
  sites: readonly ProtectedSite[],
  config: ScoringConfig['proximity'],
  tiers: Tiers,
): { value: number; detail: string } {
  if (track.onGround) return ON_GROUND
  return worstCase(
    sites.map((site) => {
      const rangeM = distanceMeters(site.center, track.position)
      const inside = rangeM <= site.radiusM
      const ring = `${sites.length > 1 ? `${site.name}'s ` : 'the '}${km(site.radiusM)} ring`
      return {
        value:
          (inside ? 100 : rolloff(rangeM, site.radiusM, site.radiusM * config.rolloffRadii)) *
          tiers[site.tier],
        detail: `${km(rangeM)} — ${inside ? 'inside' : 'outside'} ${ring}${tierNote(site, tiers)}`,
        rangeM,
      }
    }),
  )
}

/** The set as the record carries it: the fields the operator saw, and the kind (08a). */
const siteRecords = (sites: readonly ProtectedSite[]): SiteRecord[] =>
  sites.map(({ id, name, tier, center, radiusM }) => ({
    id,
    name,
    kind: 'protected',
    tier,
    center,
    radiusM,
  }))

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

/**
 * Pattern of life (05a): the strongest of the three detectors over the track's position history,
 * with that detector's evidence as the detail. On the ground there is no pattern to read, as
 * there is no geometry.
 */
function patternOfLife(
  track: ObservedTrack,
  history: TrackHistories | undefined,
  config: ScoringConfig['pattern'],
): { value: number; detail: string; kind: PatternKind | null } {
  if (track.onGround) return { ...ON_GROUND, kind: null }
  const reading = detectPattern(history?.[track.id] ?? [], config)
  return { value: reading.value, detail: reading.detail, kind: reading.kind }
}

function timeContext(
  minute: number,
  config: ScoringConfig['operatingHours'],
): { value: number; detail: string } {
  const open = parseClock(config.open)
  const close = parseClock(config.close)
  // A window that crosses midnight (22:00–06:00, a night-watch AO) is the two half-days either
  // side of it; doctrine is configuration, so both shapes have to work (#63 review).
  const within = open <= close ? minute >= open && minute < close : minute >= open || minute < close
  return {
    value: within ? 0 : 100,
    detail: `${formatClock(minute)} local — ${within ? 'within' : 'outside'} ${config.open}–${config.close}`,
  }
}

export const bandOf = (composite: number, bands: ScoringConfig['bands']): Band =>
  composite >= bands.warning ? 'warning' : composite >= bands.caution ? 'caution' : 'calm'

/** One track's score against the protected sites, with the breakdown that explains it. */
export function scoreTrack(
  track: ObservedTrack,
  sites: readonly ProtectedSite[],
  context: ScoringContext,
): Score {
  if (sites.length === 0) throw new Error('scoreTrack needs at least one protected site')
  const config = context.config ?? SCORING
  const nearest = nearestSite(track.position, sites)
  const pattern = patternOfLife(track, context.history, config.pattern)
  const raw: Record<FactorId, { value: number; detail: string }> = {
    cooperativity: cooperativity(track, context, config.cooperativity),
    closing: closing(track, sites, config.closing, config.tierMultiplier),
    proximity: proximity(track, sites, config.proximity, config.tierMultiplier),
    pattern: { value: pattern.value, detail: pattern.detail },
    kinematic: kinematic(track, config.kinematic),
    time: timeContext(context.minuteOfDay, config.operatingHours),
  }
  const factors = FACTORS.map(({ id, label }): Factor => {
    const weight = config.weights[id]
    return { id, label, weight, ...raw[id], contribution: (raw[id].value / 100) * weight }
  })
  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0)
  const weighted = factors.reduce((sum, factor) => sum + factor.contribution, 0)
  // The score is made from the total as the record prints it, one decimal: a reader dividing
  // 65.6 by 80 lands on the same whole number and the same band as the chip, always.
  const total = Math.round(weighted * 10) / 10
  const uncapped = (total / totalWeight) * 100
  const capped = track.source === 'adsb' && uncapped > config.adsbCeiling
  const composite = capped ? config.adsbCeiling : uncapped
  return {
    composite,
    weighted,
    total,
    totalWeight,
    uncapped,
    capped,
    // Banded on the whole number the chip and the handoff print, so a 69.6 that prints as 70
    // reads warning, not caution: the word and the number beside it can never disagree (#63).
    band: bandOf(Math.round(composite), config.bands),
    factors,
    pattern: pattern.kind,
    rangeM: nearest.rangeM,
    siteId: nearest.site.id,
    sites: siteRecords(sites),
  }
}

/**
 * A score rebuilt from the record (06b): the factor values and the weights an event carries make
 * the same breakdown the operator saw, over the record's own doctrine rather than the live
 * config — the case #64 kept the weights for. The composite and its uncapped twin are the
 * snapshot's own; capped is their inequality. Factor detail lines are not in the record, and
 * say so. The range, the site it was measured to, the named pattern, and the site set in force
 * are the snapshot's too (#75 review; 05b; 08a).
 */
export function scoreFromSnapshot(
  observed: {
    score: number
    uncapped: number
    factors: Record<FactorId, number>
    weights: Record<FactorId, number>
    rangeM: number
    siteId: string
    pattern: PatternKind | null
    sites: readonly SiteRecord[]
  },
  config: ScoringConfig = SCORING,
): Score {
  const factors = FACTORS.map(({ id, label }): Factor => {
    const value = observed.factors[id]
    const weight = observed.weights[id]
    return {
      id,
      label,
      value,
      weight,
      contribution: (value / 100) * weight,
      detail: 'as recorded when the operator acted',
    }
  })
  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0)
  const weighted = factors.reduce((sum, factor) => sum + factor.contribution, 0)
  return {
    composite: observed.score,
    weighted,
    total: Math.round(weighted * 10) / 10,
    totalWeight,
    uncapped: observed.uncapped,
    capped: observed.score < observed.uncapped,
    band: bandOf(Math.round(observed.score), config.bands),
    factors,
    pattern: observed.pattern,
    rangeM: observed.rangeM,
    siteId: observed.siteId,
    sites: observed.sites,
  }
}
