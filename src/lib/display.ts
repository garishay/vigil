/**
 * The §7 display rules, in one place, so the Queue row and the Review drawer cannot drift.
 *
 * These are guardrail-bearing: `trackIdent` is what keeps ground truth off the screen (a track
 * with no broadcast identity reads `TRK-nn`, never its inject id), and the badge is the one
 * place the synthetic layer is disclosed.
 */

import type { Contact } from '../config/contacts.ts'
import type { Disposition } from '../config/dispositions.ts'
import type { ProtectedSite, SiteRecord } from '../config/ao.ts'
import { BANDS, BAND_LABEL, PATTERN_LABEL } from '../config/scoring.ts'
import { distanceMeters } from './geo.ts'
import type { TrackEvent } from './lifecycle.ts'
import type { RankedTrack } from './ranking.ts'
import { formatClock, minuteOfDay, type Factor, type Score } from './scoring.ts'
import type { SessionSite } from './sites.ts'
import type { Track } from './tracks.ts'

/**
 * What the screen calls a track — observed or derived, never assigned. A broadcast ident when
 * there is one; the ICAO address a real aircraft broadcasts when it sends no flight ident; and
 * for a track with no broadcast identity at all, a neutral track number derived from its stable
 * id.
 */
export function trackIdent(track: Track): string {
  if (track.callsign) return track.callsign
  if (track.source === 'adsb') return track.icaoHex
  return `TRK-${track.id.slice(track.id.lastIndexOf('-') + 1)}`
}

/** The one place the layer is disclosed (§7). */
export const LAYER_BADGE: Record<Track['source'], string> = { adsb: 'ADS-B', inject: 'INJECT' }

/** Range to the protected site's center, km to one decimal (§7). */
export const formatRangeKm = (rangeM: number) => `${(rangeM / 1000).toFixed(1)} km`

/** The site row's second line (08a): the kind and the tier — `Protected · tier 1`. */
export const siteKindLine = (site: Pick<SiteRecord, 'tier'>) => `Protected · tier ${site.tier}`

/**
 * The site row's third line (08a): the ring, and where the site came from — `config`, or the
 * sim time the operator added it, printed by the record's clock.
 */
export const siteOriginLine = (site: SessionSite, clock: (tSec: number) => string) =>
  `${formatRangeKm(site.radiusM)} ring · ${site.addedTSec === null ? 'config' : clock(site.addedTSec)}`

/**
 * The handoff's site line (08a): the site the Range line was measured to, as the record carries
 * it — `PHL Airfield · protected · tier 1 · 5.0 km`. A 20-character name (the editor's cap)
 * lands the line on the drawer's 53-character fit exactly (#36 [5]).
 */
export const siteLine = (site: SiteRecord) =>
  `${site.name} · ${site.kind} · tier ${site.tier} · ${formatRangeKm(site.radiusM)}`

/** The composite as the chip and the handoff print it: a whole number, 0–100. */
export const formatScore = (score: Score) => String(Math.round(score.composite))

/**
 * The arithmetic behind the number, on the weight scale the factor lines use: `65.6/80`, or
 * `46.3/80 → 58` when the ceiling bound and the uncapped composite is the one the total makes.
 * The total is the engine's own one-decimal `total` (ruled on #63, round 2): the integer factor
 * lines sum to it within rounding, and because the score is made from it the division
 * reproduces the score exactly — a sum of rounded parts could miss by three points and cross a
 * band, and even a one-decimal print of the unrounded sum can flip the last digit.
 */
export const scoreTotal = (score: Score) => {
  const over = `${score.total.toFixed(1)}/${score.totalWeight}`
  return score.capped ? `${over} → ${Math.round(score.uncapped)}` : over
}

/** The cap as its own line — the handoff's and the hover's, one wording (ruled A3 on #4). */
export const capLine = (score: Score) => `Capped at ${formatScore(score)} — cooperative aircraft`

/**
 * The chip's hover: the three largest contributions and the total they are part of, so a row
 * explains itself before the drawer opens; a capped row leads with the cap (#63 review). The
 * reason tag below carries the words; this carries the numbers.
 */
export const scoreSummary = (score: Score) => {
  const top = [...score.factors]
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3)
    .map((factor) => `${factor.label} ${Math.round(factor.contribution)}`)
    .join(' · ')
  return `${score.capped ? `${capLine(score)} · ` : ''}${top} (${scoreTotal(score)})`
}

/** A pattern word in running text: `loitering`. */
const patternWord = (kind: keyof typeof PATTERN_LABEL) => PATTERN_LABEL[kind].toLowerCase()

/**
 * The §7 reason tag on the Queue row (05b, ruled on #5): the top-contributing factors in plain
 * English. Each factor has a word when its value is at least half the scale — Identity's is the
 * observed identity, Closing's only outside the ring (inside, Proximity says it), Proximity's
 * names the configured site — and the tag leads with the named pattern, then the two largest
 * other contributions. A real aircraft's row reads *Cooperative aircraft* and nothing else, so
 * it never wears a threat word (§2) — keyed on the observed source, as the ceiling is, since a
 * distant airliner sits under the ceiling uncapped and would otherwise read "Closing,
 * off-hours" on the strength of its own approach.
 */
export function reasonTag(entry: RankedTrack, sites: readonly ProtectedSite[]): string {
  const { track, score } = entry
  if (track.source === 'adsb') return 'Cooperative aircraft'
  const site = sites.find((candidate) => candidate.id === score.siteId)
  // Inside any configured ring, as closing reads it — not only the nearest centre's, which with
  // two sites can be a small ring the track is outside while a larger one encloses it (#82 review).
  const inside = sites.some(
    (candidate) => distanceMeters(candidate.center, track.position) <= candidate.radiusM,
  )
  const wordFor = (factor: Factor): string | null => {
    if (factor.value < 50) return null
    switch (factor.id) {
      case 'cooperativity':
        return track.identity === 'non-cooperative' ? 'non-cooperative' : 'ident unknown'
      case 'closing':
        return inside ? null : 'closing'
      case 'proximity':
        return inside ? 'inside the ring' : `near ${site?.name ?? 'the site'}`
      case 'kinematic':
        return 'low and slow'
      case 'time':
        return 'off-hours'
      case 'pattern':
        return null
    }
  }
  const others = [...score.factors]
    .sort((a, b) => b.contribution - a.contribution)
    .map(wordFor)
    .filter((word): word is string => word !== null)
  const words = score.pattern
    ? [patternWord(score.pattern), ...others.slice(0, 2)]
    : others.slice(0, 3)
  if (words.length === 0) return '—'
  const tag = words.join(', ')
  return tag[0].toUpperCase() + tag.slice(1)
}

/**
 * A heading as the whole degree the drawer and the handoff both print — one observation, one
 * number on both (#49). The model's headings live in [0, 360), so the round wraps: 359.7 reads 0,
 * as 0.3 already does, never an off-the-compass 360 (#51 review).
 */
export const roundHeading = (headingDeg: number) => Math.round(headingDeg) % 360

/**
 * One line of the event record, identical in the drawer's log and the handoff timeline. The
 * config lists are parameters, like the sites in `rankTracks` — ids stay in the log for the
 * learner (§8.3b); names are looked up only here, at display time. A band crossing names the
 * band entered and the one left, up or down, in the words of the one band table (06b, #66). A
 * pattern change names what began and what ended; a track first seen with a pattern already
 * named carries the word on its first line, so a cold open still hands off with it (05b). A
 * loss names the sim time the recording last heard the track, printed by the same clock that
 * marks the line — the fact the next operator needs, true whenever the line was stamped (#71,
 * #36 [11]).
 */
export function describeEvent(
  event: TrackEvent,
  contacts: readonly Contact[],
  dispositions: readonly Disposition[],
  clock: (tSec: number) => string,
): string {
  switch (event.action) {
    case 'first-seen':
      return `New — first seen${event.observed.pattern ? `, ${patternWord(event.observed.pattern)}` : ''}`
    case 'pattern': {
      const { from, to } = event.pattern ?? { from: null, to: null }
      if (to) return `${PATTERN_LABEL[to]} — began${from ? `, ${patternWord(from)} ended` : ''}`
      return from ? `${PATTERN_LABEL[from]} — ended` : 'Pattern — ended'
    }
    case 'lost':
      return event.lost ? `Lost — last heard ${clock(event.lost.lastHeardTSec)}` : 'Lost'
    case 'regained':
      return 'Regained'
    case 'band': {
      const { from, to } = event.band ?? { from: 'calm', to: 'calm' }
      const direction = BANDS.indexOf(to) > BANDS.indexOf(from) ? 'up' : 'down'
      return `${BAND_LABEL[to]} — ${direction} from ${from}`
    }
    case 'assess':
      return 'Assessing — claimed'
    case 'escalate':
      return `Escalated — to ${contacts.find((c) => c.id === event.recipient)?.name ?? event.recipient}`
    case 'dismiss':
      return 'Dismissed'
    case 'resolve':
      return `Resolved — ${dispositions.find((d) => d.id === event.disposition)?.label ?? event.disposition}`
  }
}

/**
 * The sim clock: the scenario's time of day at `tSec`, to the second — the strip's clock (06a)
 * and, from 06b, the mark on every line of the event log and the handoff timeline: "first
 * warning 02:33:00" is what a recipient wants to know (ruled on #6). The wall-clock `at` stays
 * on every event for the learner; it is simply not the time the record reads in.
 */
export const simClock = (startLocal: string, tSec: number) =>
  `${formatClock(minuteOfDay(startLocal, tSec))}:${String(Math.floor(tSec) % 60).padStart(2, '0')}`

/** Replay position as `MM:SS` — minutes unbounded, so a long recording never wraps. */
export const formatElapsed = (tSec: number) => {
  const whole = Math.floor(tSec)
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}
