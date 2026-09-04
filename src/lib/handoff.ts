/**
 * The escalation handoff as copyable text (§7.1), pure — the watch floor's act is a coordinated
 * notification with the evidence attached, and this is the evidence. Nothing is transmitted
 * (§2); the operator copies it and delivers it themselves until Phase 2.
 *
 * **The evidence block is frozen at escalation** (06b, ruled on #6): the Track, Range,
 * kinematics, and Score lines print from the escalate event's own snapshot — what was known at
 * the moment the notification was made — and the Range line names that moment. The score is
 * rebuilt from the snapshot's factor values and weights, so the arithmetic on the page is the
 * record's, not the live picture's, and the Range line is captioned with the site the frozen
 * range was measured to — resolved from the snapshot's own site set (08a), so a site removed
 * after the escalation is still named, and described on its own line under the kinematics for
 * a recipient who has never heard of it. The Timeline stays live from the log, so a later
 * Resolve still appends. The ident is the track's name and prints live; the identity is the
 * snapshot's.
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
  formatRangeKm,
  formatScore,
  roundHeading,
  scoreTotal,
  siteLine,
  trackIdent,
} from './display.ts'
import { IDENTITY_LABEL } from './identity.ts'
import type { TrackEvent } from './lifecycle.ts'
import type { RankedTrack } from './ranking.ts'
import { scoreFromSnapshot } from './scoring.ts'
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
  recipient,
  log,
  contacts,
  dispositions,
  clock,
}: {
  entry: RankedTrack
  recipient: Contact
  /** Must hold the escalation whose snapshot the evidence block prints. */
  log: readonly TrackEvent[]
  contacts: readonly Contact[]
  dispositions: readonly Disposition[]
  /** Sim time as the record prints it — `HH:MM:SS` from a `tSec`. */
  clock: (tSec: number) => string
}): string {
  const escalation = log.findLast((event) => event.action === 'escalate')
  if (!escalation) throw new Error('handoffText needs a log with an escalation')
  const { track } = entry
  const observed = escalation.observed
  const score = scoreFromSnapshot(observed)
  // The site the frozen range was measured to, not whichever is nearest now (#75 review), read
  // off the snapshot's own set so a removed site is still named (08a).
  const site = observed.sites.find((candidate) => candidate.id === observed.siteId)
  const siteName = site?.name ?? observed.siteId
  const kinematics = [
    dash(observed.altitudeFt, (v) => `${v} ft`),
    dash(observed.groundSpeedKt, (v) => `${v} kt`),
    `hdg ${dash(observed.headingDeg, (v) => `${roundHeading(v)}`)}`,
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
    `Track ${trackIdent(track)} · ${IDENTITY_LABEL[observed.identity]} · ${LAYER_DISCLOSURE[track.source]}`,
    `Range ${formatRangeKm(observed.rangeM)} to ${siteName} at ${clock(escalation.tSec)}`,
    `  ${kinematics}`,
    ...(site ? [`  ${siteLine(site)}`] : []),
    `Score: ${formatScore(score)} (${score.band}) — ${score.capped ? 'capped, ' : ''}${scoreTotal(score)}`,
    ...factorLines,
    ...(score.capped ? [`  ${capLine(score)}`] : []),
    'Timeline:',
    ...log.map(
      (event) => `  ${clock(event.tSec)}  ${describeEvent(event, contacts, dispositions, clock)}`,
    ),
  ].join('\n')
}
