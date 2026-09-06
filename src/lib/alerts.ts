/**
 * The alert layer (#101, 101a), pure: a surface over the record. The events already exist in
 * the one log — a crossing, an onset, a first sight, a re-surface read off the dismissal — and
 * this module says which of them earn a card, which clear one, and in what order the stack
 * holds them. No React, no clock: the caller folds each track's new entries through it, and
 * says whether the entries were written by a tick of the clock or by a seek, which is the
 * difference between an interruption and a replay (ruled A1 on #101).
 *
 * Every word on a card is observed or derived — the band's word, the pattern's, or
 * *Re-surfaced* — never a generator label (§2).
 */

import { ALERTS, type AlertConfig, type AlertKind } from '../config/alerts.ts'
import {
  BANDS,
  BAND_LABEL,
  PATTERN_LABEL,
  SCORING,
  type Band,
  type ScoringConfig,
} from '../config/scoring.ts'
import { isTerminal, resurfaced, type TrackEvent } from './lifecycle.ts'
import { bandOf } from './scoring.ts'
import type { Track } from './tracks.ts'

export interface Alert {
  trackId: string
  kind: AlertKind
  /** What the card prints beside the track — the band's word, the pattern's, or Re-surfaced. */
  word: string
  /** The sim time of the entry that raised it; re-stamped when a pending kind fires again. */
  tSec: number
  /** The raising entry's sequence number in its track's log. */
  seq: number
}

export const RESURFACED_WORD = 'Re-surfaced'

const up = (from: Band, to: Band) => BANDS.indexOf(to) > BANDS.indexOf(from)

/**
 * The cards one entry earns, before the config and the never-alert rule are consulted. A
 * crossing up into a warm band earns that band's card; an onset earns the pattern's; and a
 * first-seen entry earns whatever the track opened with — a warm band, a pattern word, or both —
 * so a track that appears mid-play already loitering interrupts as a crossing would (A2 on
 * #101, as amended). Everything else — an end, a crossing down, Lost, Regained, the operator's
 * own actions — earns nothing.
 */
function cardsOf(
  event: TrackEvent,
  bands: ScoringConfig['bands'],
): { kind: AlertKind; word: string }[] {
  switch (event.action) {
    case 'band': {
      if (!event.band || !up(event.band.from, event.band.to)) return []
      const to = event.band.to
      return to === 'calm' ? [] : [{ kind: to, word: BAND_LABEL[to] }]
    }
    case 'pattern':
      return event.pattern?.to ? [{ kind: 'pattern', word: PATTERN_LABEL[event.pattern.to] }] : []
    case 'first-seen': {
      const band = bandOf(Math.round(event.observed.score), bands)
      return [
        ...(band === 'calm' ? [] : [{ kind: band, word: BAND_LABEL[band] }]),
        ...(event.observed.pattern
          ? [{ kind: 'pattern' as const, word: PATTERN_LABEL[event.observed.pattern] }]
          : []),
      ]
    }
    default:
      return []
  }
}

/** Whether an entry is the kind that re-surfaces a Dismissed track — `resurfaced`'s own test. */
const surfaces = (event: TrackEvent) =>
  (event.action === 'band' && event.band !== undefined && up(event.band.from, event.band.to)) ||
  (event.action === 'pattern' && event.pattern?.to != null)

/**
 * The stack with one card raised: newest on top, and one pending card per track per kind — a
 * repeat of a kind already pending re-stamps that card and lifts it, rather than adding another
 * (A4 on #101: on recording 001 one inject crosses into warning six times in seven minutes).
 */
export function raise(alerts: readonly Alert[], card: Alert): Alert[] {
  return [
    card,
    ...alerts.filter((alert) => !(alert.trackId === card.trackId && alert.kind === card.kind)),
  ]
}

/** The stack without a track's cards — the same array when it held none. */
export function clearFor(alerts: readonly Alert[], trackId: string): Alert[] {
  return alerts.some((alert) => alert.trackId === trackId)
    ? alerts.filter((alert) => alert.trackId !== trackId)
    : (alerts as Alert[])
}

/**
 * The stack after one track's record grew: its entries past `fromSeq`, in order. Each entry
 * clears first — an acknowledge, an action into a terminal status, or Lost drops the track's
 * cards (A8) — and then, only while `raising`, earns what the config lets it. `raising` is the
 * caller's word for how the clock moved: a tick raises, a seek — load included — replays the
 * record and raises nothing (A1).
 *
 * The never-alert rule is `resurfaced`'s guard transplanted (A3): a track observed on ADS-B, or
 * one under the friendly-launch condition at the entry, earns nothing — for onsets as for
 * crossings, since the fold logs a pattern on a real aircraft too. A Resolved track earns
 * nothing either: it is handled. A Dismissed one earns only *Re-surfaced*, in place of the
 * crossing's or onset's own card (A5), on the entry that makes `resurfaced` true — and again on
 * each later one, which re-stamps it.
 */
export function foldAlerts(
  alerts: readonly Alert[],
  log: readonly TrackEvent[],
  fromSeq: number,
  source: Track['source'],
  raising: boolean,
  config: AlertConfig = ALERTS,
  bands: ScoringConfig['bands'] = SCORING.bands,
): Alert[] {
  let out = alerts as Alert[]
  for (const event of log) {
    if (event.seq <= fromSeq) continue
    const enteredTerminal = event.from !== event.to && isTerminal(event.to)
    if (event.action === 'acknowledge' || event.action === 'lost' || enteredTerminal) {
      out = clearFor(out, event.trackId)
    }
    if (!raising || source === 'adsb' || event.observed.friendly) continue
    const stamp = { trackId: event.trackId, tSec: event.tSec, seq: event.seq }
    if (event.to === 'dismissed') {
      if (
        config.triggers.resurfaced &&
        surfaces(event) &&
        resurfaced(log.slice(0, event.seq), source, event.observed.friendly)
      ) {
        out = raise(out, { ...stamp, kind: 'resurfaced', word: RESURFACED_WORD })
      }
      continue
    }
    if (isTerminal(event.to)) continue
    for (const card of cardsOf(event, bands)) {
      if (config.triggers[card.kind]) out = raise(out, { ...stamp, ...card })
    }
  }
  return out
}
