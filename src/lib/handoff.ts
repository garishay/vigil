/**
 * The escalation handoff as copyable text (§7.1), pure — the watch floor's act is a coordinated
 * notification with the evidence attached, and this is the evidence. Nothing is transmitted
 * (§2); the operator copies it and delivers it themselves until Phase 2.
 *
 * The layer is disclosed in the Track line because the recipient must know a synthetic track is
 * synthetic. An absent kinematic renders as `—`, never as a zero (#35). The score block is the
 * composite with its band, the per-factor contributions two to a line, and the ADS-B ceiling as
 * its own line when it bound — the breakdown travels with the record (§4.1, ruled A3 on #4).
 *
 * Line shape is load-bearing (#36 [5]): the record fits the drawer's ruled 26 rem without a
 * wrap, a scroll, or a smaller font, so the title and disclaimer are separate lines and the
 * kinematics break after the range. A test pins the maximum line length at the measured fit.
 */

import type { Contact } from '../config/contacts.ts'
import type { Disposition } from '../config/dispositions.ts'
import {
  capLine,
  describeEvent,
  eventClock,
  formatRangeKm,
  formatScore,
  roundHeading,
  scoreTotal,
  trackIdent,
} from './display.ts'
import { IDENTITY_LABEL } from './identity.ts'
import type { TrackEvent } from './lifecycle.ts'
import type { RankedTrack } from './ranking.ts'
import type { Track } from './tracks.ts'

/** Plain provenance for the recipient — the counterpart of the on-screen layer badge. */
const LAYER_DISCLOSURE: Record<Track['source'], string> = {
  adsb: 'recorded ADS-B',
  inject: 'synthetic inject',
}

const dash = <T>(value: T | null, render: (value: T) => string) =>
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
  const { track, rangeM, score } = entry
  const kinematics = [
    dash(track.altitudeFt, (v) => `${v} ft`),
    dash(track.groundSpeedKt, (v) => `${v} kt`),
    `hdg ${dash(track.headingDeg, (v) => `${roundHeading(v)}`)}`,
  ].join(' · ')
  // Two factors per line keeps every line inside the pinned fit. The factor lines sum to the
  // total on the Score line within rounding; that total, to one decimal, reproduces the score —
  // over the configured weights, then the ceiling (ruled on #63) — so the recipient can follow
  // the arithmetic to the same band.
  const factorLines: string[] = []
  for (let index = 0; index < score.factors.length; index += 2) {
    factorLines.push(
      '  ' +
        score.factors
          .slice(index, index + 2)
          .map((factor) => `${factor.label} ${Math.round(factor.contribution)}/${factor.weight}`)
          .join(' · '),
    )
  }
  return [
    'VIGIL HANDOFF',
    'Demonstration only — not for operational use',
    `To: ${recipient.name}`,
    `Track ${trackIdent(track)} · ${IDENTITY_LABEL[track.identity]} · ${LAYER_DISCLOSURE[track.source]}`,
    `Range ${formatRangeKm(rangeM)} to ${siteName}`,
    `  ${kinematics}`,
    `Score: ${formatScore(score)} (${score.band}) — ${score.capped ? 'capped, ' : ''}${scoreTotal(score)}`,
    ...factorLines,
    ...(score.capped ? [`  ${capLine(score)}`] : []),
    'Timeline:',
    ...log.map(
      (event) => `  ${eventClock(event.at)}  ${describeEvent(event, contacts, dispositions)}`,
    ),
  ].join('\n')
}
