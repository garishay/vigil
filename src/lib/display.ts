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

/**
 * An event's wall clock as HH:MM:SS, sliced from the ISO string — UTC by construction, so the
 * drawer's log and the handoff timeline read the same instant whatever the environment's zone.
 */
export const eventClock = (at: string) => at.slice(11, 19)

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
