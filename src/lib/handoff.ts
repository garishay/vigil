/**
 * The escalation handoff as copyable text (§7.1), pure — the watch floor's act is a coordinated
 * notification with the evidence attached, and this is the evidence. Nothing is transmitted
 * (§2); the operator copies it and delivers it themselves until Phase 2.
 *
 * The layer is disclosed in the Track line because the recipient must know a synthetic track is
 * synthetic. An absent kinematic renders as `—`, never as a zero (#35). The score line stays a
 * dash until PR 04 scores the picture.
 *
 * Line shape is load-bearing (#36 [5]): the record fits the drawer's ruled 26 rem without a
 * wrap, a scroll, or a smaller font, so the title and disclaimer are separate lines and the
 * kinematics break after the range. A test pins the maximum line length at the measured fit.
 */

import type { Contact } from '../config/contacts.ts'
import type { Disposition } from '../config/dispositions.ts'
import { describeEvent, eventClock, formatRangeKm, trackIdent } from './display.ts'
import { IDENTITY_LABEL } from './identity.ts'
import type { TrackEvent } from './lifecycle.ts'
import type { RankedTrack } from './ranking.ts'
import type { Track } from './tracks.ts'

/** Plain provenance for the recipient — the counterpart of the on-screen layer badge. */
const LAYER_DISCLOSURE: Record<Track['source'], string> = {
  adsb: 'recorded ADS-B',
  inject: 'synthetic inject',
}

const dash = <T,>(value: T | null, render: (value: T) => string) =>
  value === null ? '—' : render(value)

export function handoffText({
  entry,
  siteName,
  recipient,
  log,
  contacts,
  dispositions,
}: {
  entry: RankedTrack
  /** Name of the site `entry.rangeM` was measured to — the caller resolves `entry.siteId`. */
  siteName: string
  recipient: Contact
  log: readonly TrackEvent[]
  contacts: readonly Contact[]
  dispositions: readonly Disposition[]
}): string {
  const { track, rangeM } = entry
  const kinematics = [
    dash(track.altitudeFt, (v) => `${v} ft`),
    dash(track.groundSpeedKt, (v) => `${v} kt`),
    `hdg ${dash(track.headingDeg, (v) => `${Math.round(v)}`)}`,
  ].join(' · ')
  return [
    'VIGIL HANDOFF',
    'Demonstration only — not for operational use',
    `To: ${recipient.name}`,
    `Track ${trackIdent(track)} · ${IDENTITY_LABEL[track.identity]} · ${LAYER_DISCLOSURE[track.source]}`,
    `Range ${formatRangeKm(rangeM)} to ${siteName}`,
    `  ${kinematics}`,
    'Score: — (scoring engine arrives in PR 04)',
    'Timeline:',
    ...log.map((event) => `  ${eventClock(event.at)}  ${describeEvent(event, contacts, dispositions)}`),
  ].join('\n')
}
