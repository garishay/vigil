/**
 * The §7 display rules, in one place, so the Queue row and the Review drawer cannot drift.
 *
 * These are guardrail-bearing: `trackIdent` is what keeps ground truth off the screen (a track
 * with no broadcast identity reads `TRK-nn`, never its inject id), and the badge is the one
 * place the synthetic layer is disclosed.
 */

import type { Contact } from '../config/contacts.ts'
import type { Disposition } from '../config/dispositions.ts'
import { BANDS, BAND_LABEL } from '../config/scoring.ts'
import type { TrackEvent } from './lifecycle.ts'
import { formatClock, minuteOfDay, type Score } from './scoring.ts'
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
 * reason tag waits for PR 05's vocabulary (ruled on #4); this is what stands in.
 */
export const scoreSummary = (score: Score) => {
  const top = [...score.factors]
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3)
    .map((factor) => `${factor.label} ${Math.round(factor.contribution)}`)
    .join(' · ')
  return `${score.capped ? `${capLine(score)} · ` : ''}${top} (${scoreTotal(score)})`
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
 * band entered and the one left, up or down, in the words of the one band table (06b, #66).
 */
export function describeEvent(
  event: TrackEvent,
  contacts: readonly Contact[],
  dispositions: readonly Disposition[],
): string {
  switch (event.action) {
    case 'first-seen':
      return 'New — first seen'
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
