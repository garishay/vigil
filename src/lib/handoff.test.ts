import { describe, expect, it } from 'vitest'
import { AO } from '../config/ao'
import { CONTACTS } from '../config/contacts'
import { DISPOSITIONS } from '../config/dispositions'
import { handoffText } from './handoff'
import { appendEvent, firstSeen, observedSnapshot } from './lifecycle'
import type { RankedTrack } from './ranking'
import type { AdsbTrack, InjectTrack } from './tracks'

const INJECT: InjectTrack = {
  id: 'inject-05',
  source: 'inject',
  behavior: 'loiter',
  remoteId: 'silent',
  uaType: null,
  identity: 'non-cooperative',
  callsign: null,
  position: [-75.20547, 39.81341],
  altitudeFt: 63,
  onGround: false,
  groundSpeedKt: 19.1,
  headingDeg: 345.6,
  verticalRateFpm: 85,
  lastSeenSec: 0,
}

const entry = (track: InjectTrack | AdsbTrack): RankedTrack => ({
  track,
  rank: 1,
  rangeM: 7200.2,
  siteId: 'phl-airfield',
})

const PHL_TOWER = CONTACTS.find((contact) => contact.id === 'phl-tower')!

const walkToEscalated = (ranked: RankedTrack) => {
  const observed = observedSnapshot(ranked)
  const base = { tSec: 0, observed }
  let log = firstSeen(ranked.track.id, observed, '2026-09-01T12:04:31.000Z')
  log = appendEvent(log, 'assess', { ...base, at: '2026-09-01T12:06:02.000Z' })
  return appendEvent(log, 'escalate', {
    ...base,
    at: '2026-09-01T12:07:45.000Z',
    recipient: 'phl-tower',
  })
}

const text = (ranked: RankedTrack, log = walkToEscalated(ranked)) =>
  handoffText({
    entry: ranked,
    siteName: 'PHL Airfield',
    recipient: PHL_TOWER,
    log,
    contacts: CONTACTS,
    dispositions: DISPOSITIONS,
  })

describe('handoffText', () => {
  it('renders the whole summary in the ruled shape (#36 [5]: reflowed to fit 26 rem)', () => {
    expect(text(entry(INJECT))).toBe(
      [
        'VIGIL HANDOFF',
        'Demonstration only — not for operational use',
        'To: PHL Tower',
        'Track TRK-05 · Non-cooperative · synthetic inject',
        'Range 7.2 km to PHL Airfield',
        '  63 ft · 19.1 kt · hdg 346',
        'Score: — (scoring engine arrives in PR 04)',
        'Timeline:',
        '  12:04:31Z  New — first seen',
        '  12:06:02Z  Assessing — claimed',
        '  12:07:45Z  Escalated — to PHL Tower',
      ].join('\n'),
    )
  })

  it('keeps every line within the measured 26 rem fit, for every configured contact and disposition (#36 [5])', () => {
    // 53 characters is the measured fit of the drawer's handoff block at 26 rem in 12 px mono
    // (re-measured with the Z-marked clock). This pin is what keeps the re-gate closed: a longer
    // contact name, site name, new disposition, or a PR 04 factor line that overflows the column
    // fails here, not on screen. Sites sweep the AO config too — the range line carries them.
    const MAX_LINE = 53
    for (const site of AO.protectedSites) {
      for (const contact of CONTACTS) {
        for (const disposition of DISPOSITIONS) {
          const ranked = entry(INJECT)
          const observed = observedSnapshot(ranked)
          let log = firstSeen(ranked.track.id, observed, '2026-09-01T12:04:31.000Z')
          log = appendEvent(log, 'assess', { at: '2026-09-01T12:06:02.000Z', tSec: 0, observed })
          log = appendEvent(log, 'escalate', {
            at: '2026-09-01T12:07:45.000Z',
            tSec: 0,
            observed,
            recipient: contact.id,
          })
          log = appendEvent(log, 'resolve', {
            at: '2026-09-01T12:09:12.000Z',
            tSec: 0,
            observed,
            disposition: disposition.id,
          })
          const summary = handoffText({
            entry: { ...ranked, rangeM: 19700.4 },
            siteName: site.name,
            recipient: contact,
            log,
            contacts: CONTACTS,
            dispositions: DISPOSITIONS,
          })
          for (const line of summary.split('\n')) expect(line.length).toBeLessThanOrEqual(MAX_LINE)
        }
      }
    }
  })

  it('keeps the timeline growing through resolution, with the disposition label', () => {
    const ranked = entry(INJECT)
    const log = appendEvent(walkToEscalated(ranked), 'resolve', {
      at: '2026-09-01T12:09:12.000Z',
      tSec: 0,
      observed: observedSnapshot(ranked),
      disposition: 'handled-by-target',
    })
    expect(text(ranked, log)).toContain('  12:09:12Z  Resolved — Handled by escalation target')
  })

  it('dashes an absent kinematic, never a zero (#35)', () => {
    const silentKinematics = entry({
      ...INJECT,
      altitudeFt: null,
      groundSpeedKt: null,
      headingDeg: null,
    })
    // The whole value dashes, unit included — same rule as the drawer: a unit on a missing
    // reading would imply a number that was never broadcast.
    expect(text(silentKinematics)).toContain('\n  — · — · hdg —\n')
  })

  it('wraps a heading that rounds up to north, never printing hdg 360 (#51 review)', () => {
    expect(text(entry({ ...INJECT, headingDeg: 359.7 }))).toContain('· hdg 0\n')
  })

  it('discloses a recorded track as ADS-B, by ident rather than inject naming', () => {
    const adsb: AdsbTrack = {
      id: 'adsb-a06461',
      source: 'adsb',
      icaoHex: 'a06461',
      identity: 'cooperative',
      callsign: 'AAL423',
      position: [-75.1, 39.7],
      altitudeFt: 12000,
      onGround: false,
      groundSpeedKt: 275,
      headingDeg: 88.2,
      verticalRateFpm: -640,
      lastSeenSec: 0,
      category: null,
      registry: null,
    }
    expect(text(entry(adsb))).toContain('Track AAL423 · Cooperative · recorded ADS-B')
  })

  it('carries no ground truth — the answer key stays out of the record (§8.3b)', () => {
    expect(text(entry(INJECT))).not.toMatch(/loiter|silent|intermittent|broadcasting|inject-\d/)
  })
})
