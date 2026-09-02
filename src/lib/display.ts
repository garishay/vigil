/**
 * The §7 display rules, in one place, so the Queue row and the Review drawer cannot drift.
 *
 * These are guardrail-bearing: `trackIdent` is what keeps ground truth off the screen (a track
 * with no broadcast identity reads `TRK-nn`, never its inject id), and the badge is the one
 * place the synthetic layer is disclosed.
 */

import type { Contact } from '../config/contacts.ts'
import type { Disposition } from '../config/dispositions.ts'
import type { TrackEvent } from './lifecycle.ts'
import type { Score } from './scoring.ts'
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
 * An event's wall clock as HH:MM:SSZ — normalized to UTC before the label, not sliced blind: a
 * caller supplying an offset form (`…+02:00`, a shape the PR 06 clock seam permits) must not see
 * local time labelled Zulu (#47 review). The mark itself is the point — an unlabelled 12:07
 * reads as local and makes the defensible record misreadable ([2c]). Zulu is also what the
 * recipient's own logs run on. Deterministic for tests whatever the environment's zone.
 */
export const eventClock = (at: string) => `${new Date(at).toISOString().slice(11, 19)}Z`

/**
 * One line of the event record, identical in the drawer's log and the handoff timeline. The
 * config lists are parameters, like the sites in `rankTracks` — ids stay in the log for the
 * learner (§8.3b); names are looked up only here, at display time.
 */
export function describeEvent(
  event: TrackEvent,
  contacts: readonly Contact[],
  dispositions: readonly Disposition[],
): string {
  switch (event.action) {
    case 'first-seen':
      return 'New — first seen'
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
