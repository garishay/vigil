import { describe, expect, it } from 'vitest'
import { AO } from '../config/ao'
import { CONTACTS } from '../config/contacts'
import { DISPOSITIONS } from '../config/dispositions'
import { simClock } from './display'
import { handoffText } from './handoff'
import { appendEvent, bandCrossing, firstSeen, observedSnapshot } from './lifecycle'
import type { RankedTrack } from './ranking'
import { scoreTrack } from './scoring'
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

/** Scored for real, at the scenario's 02:30 with nothing yet heard — the picture the app opens on. */
const entry = (track: InjectTrack | AdsbTrack): RankedTrack => ({
  track,
  rank: 1,
  rangeM: 7200.2,
  siteId: 'phl-airfield',
  score: scoreTrack(track, AO.protectedSites, { tSec: 0, minuteOfDay: 150, memory: {} }),
})

const PHL_TOWER = CONTACTS.find((contact) => contact.id === 'phl-tower')!

/** The record's clock: the scenario's 02:30 start plus the event's `tSec` (06b). */
const clock = (tSec: number) => simClock('02:30', tSec)

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
    sites: AO.protectedSites,
    recipient: PHL_TOWER,
    log,
    contacts: CONTACTS,
    dispositions: DISPOSITIONS,
    clock,
  })

describe('handoffText', () => {
  it('renders the whole summary in the ruled shape (#36 [5]: reflowed to fit 26 rem)', () => {
    expect(text(entry(INJECT))).toBe(
      [
        'VIGIL HANDOFF',
        'Demonstration only — not for operational use',
        'To: PHL Tower',
        'Track TRK-05 · Non-cooperative · synthetic inject',
        'Range 7.2 km to PHL Airfield at 02:30:00',
        '  63 ft · 19.1 kt · hdg 346',
        // The factor lines sum to the total on the Score line within rounding (25 + 9 + 12 + 10
        // + 10 = 66 ≈ 65.6); the total reproduces the score — 65.6 / 80 = 82 % — which a sum of
        // rounded parts would not (66 / 80 = 82.5 %) (ruled on #63, rounds 1 and 2).
        'Score: 82 (warning) — 65.6/80',
        '  Identity 25/25 · Closing 9/20',
        '  Proximity 12/15 · Flight profile 10/10',
        '  Off-hours 10/10',
        'Timeline:',
        '  02:30:00  New — first seen',
        '  02:30:00  Assessing — claimed',
        '  02:30:00  Escalated — to PHL Tower',
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
            sites: [{ id: 'phl-airfield', name: site.name }],
            recipient: contact,
            log,
            contacts: CONTACTS,
            dispositions: DISPOSITIONS,
            clock,
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
    expect(text(ranked, log)).toContain('  02:30:00  Resolved — Handled by escalation target')
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
    expect(text(entry(adsb))).not.toContain('Capped at')
  })

  it('prints the ADS-B ceiling as its own line when it bound — the guardrail is visible (A3)', () => {
    // An arrival: inside the ring, straight in, seconds out. Uncapped it would read 58.
    const arrival: AdsbTrack = {
      id: 'adsb-a06461',
      source: 'adsb',
      icaoHex: 'a06461',
      identity: 'cooperative',
      callsign: 'AAL423',
      position: [-75.2411, 39.8901],
      altitudeFt: 1000,
      onGround: false,
      groundSpeedKt: 174,
      headingDeg: 180,
      verticalRateFpm: -640,
      lastSeenSec: 0,
      category: null,
      registry: null,
    }
    const summary = text(entry(arrival))
    // 1.25 + 20 + 15 + 0 + 10 = 46.25 over 80 makes 58; the ceiling then holds it at 30.
    expect(summary).toContain('\nScore: 30 (calm) — capped, 46.3/80 → 58\n')
    expect(summary).toContain('  Identity 1/25 · Closing 20/20\n')
    expect(summary).toContain('  Off-hours 10/10\n  Capped at 30 — cooperative aircraft\nTimeline:')
  })

  it('carries no ground truth — the answer key stays out of the record (§8.3b)', () => {
    expect(text(entry(INJECT))).not.toMatch(/loiter|silent|intermittent|broadcasting|inject-\d/)
  })
})

describe('handoffText — the evidence block is the escalation’s (06b)', () => {
  it('freezes Range, kinematics, and Score at the escalate snapshot while the timeline stays live', () => {
    const then = entry(INJECT)
    const log = walkToEscalated(then)
    // The picture moves on: nearer, lower, faster, a different heading, a different score.
    const now: RankedTrack = {
      ...entry({ ...INJECT, altitudeFt: 40, groundSpeedKt: 28.4, headingDeg: 12 }),
      rangeM: 1900,
    }
    const frozen = text(then, log)
    const later = text(now, log)
    expect(later).toBe(frozen)
    expect(later).toContain('Range 7.2 km to PHL Airfield at 02:30:00\n  63 ft · 19.1 kt · hdg 346')
    const resolved = appendEvent(log, 'resolve', {
      at: '2026-09-01T12:09:12.000Z',
      tSec: 187,
      observed: observedSnapshot(now),
      disposition: 'benign',
    })
    expect(text(now, resolved)).toContain(
      '  02:30:00  Escalated — to PHL Tower\n  02:33:07  Resolved — Benign',
    )
    expect(text(now, resolved).split('Timeline:')[0]).toBe(frozen.split('Timeline:')[0])
  })

  it('captions the frozen range with the site it was measured to, not the nearest now (#75 review)', () => {
    const then = entry(INJECT)
    const log = walkToEscalated(then)
    const drifted: RankedTrack = { ...then, siteId: 'decoy', rangeM: 900 }
    const summary = handoffText({
      entry: drifted,
      sites: [
        { id: 'decoy', name: 'Decoy Stadium' },
        { id: 'phl-airfield', name: 'PHL Airfield' },
      ],
      recipient: PHL_TOWER,
      log,
      contacts: CONTACTS,
      dispositions: DISPOSITIONS,
      clock,
    })
    expect(summary).toContain('Range 7.2 km to PHL Airfield at 02:30:00')
    expect(summary).not.toContain('Decoy')
  })

  it('carries a band crossing in the timeline, marked in sim time', () => {
    const then = entry(INJECT)
    const crossed = bandCrossing(
      firstSeen(
        then.track.id,
        { ...observedSnapshot(then), score: 20, uncapped: 20 },
        '2026-09-01T12:04:31.000Z',
      ),
      then,
      '2026-09-01T12:05:01.000Z',
      30,
    )!
    let log = appendEvent(crossed, 'assess', {
      at: '2026-09-01T12:06:02.000Z',
      tSec: 40,
      observed: observedSnapshot(then),
    })
    log = appendEvent(log, 'escalate', {
      at: '2026-09-01T12:07:45.000Z',
      tSec: 45,
      observed: observedSnapshot(then),
      recipient: 'phl-tower',
    })
    expect(text(then, log)).toContain(
      '  02:30:00  New — first seen\n  02:30:30  Warning — up from calm\n  02:30:40  Assessing — claimed',
    )
  })
})
