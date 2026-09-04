import { describe, expect, it } from 'vitest'
import {
  STATUSES,
  appendEvent,
  bandCrossing,
  canAct,
  canLose,
  canRegain,
  firstSeen,
  isTerminal,
  lastBand,
  lastPattern,
  lost,
  observedSnapshot,
  patternChange,
  regained,
  resurfaced,
  statusOf,
  transition,
  type ActionInput,
  type LifecycleAction,
  type ObservedSnapshot,
  type Status,
  type TrackEvent,
} from './lifecycle'
import type { RankedTrack } from './ranking'
import { bandOf, scoreTrack } from './scoring'
import type { InjectTrack } from './tracks'
import { AO } from '../config/ao'
import { SCORING, type FactorId, type PatternKind } from '../config/scoring'

const PHL_SITES = AO.protectedSites.map((site) => ({ ...site, kind: 'protected' as const }))
const OBSERVED: ObservedSnapshot = {
  identity: 'non-cooperative',
  rangeM: 7200.2,
  siteId: 'phl-airfield',
  sites: PHL_SITES,
  friendly: false,
  altitudeFt: 63,
  groundSpeedKt: 19.1,
  headingDeg: 345.6,
  score: 82,
  uncapped: 82,
  pattern: null,
  factors: {
    cooperativity: 100,
    closing: 44.4,
    proximity: 78,
    pattern: 0,
    kinematic: 100,
    time: 100,
  },
  weights: { cooperativity: 25, closing: 20, proximity: 15, pattern: 15, kinematic: 10, time: 10 },
}

const input = (over: Partial<ActionInput> = {}): ActionInput => ({
  at: '2026-09-01T12:06:02.000Z',
  tSec: 0,
  observed: OBSERVED,
  ...over,
})

const opened = () => firstSeen('inject-05', OBSERVED, '2026-09-01T12:04:31.000Z')

/**
 * Every (status, action) pair, exhaustively — the ruled table from #3: Escalate only from
 * Assessing, Resolve only from Escalated, Dismiss from New or Assessing, terminal states final.
 */
const TABLE: Record<Status, Record<LifecycleAction, Status | null>> = {
  new: { assess: 'assessing', escalate: null, dismiss: 'dismissed', resolve: null },
  assessing: { assess: null, escalate: 'escalated', dismiss: 'dismissed', resolve: null },
  escalated: { assess: null, escalate: null, dismiss: null, resolve: 'resolved' },
  resolved: { assess: null, escalate: null, dismiss: null, resolve: null },
  dismissed: { assess: null, escalate: null, dismiss: null, resolve: null },
}

describe('transition table', () => {
  for (const [status, actions] of Object.entries(TABLE) as [
    Status,
    Record<LifecycleAction, Status | null>,
  ][]) {
    for (const [action, next] of Object.entries(actions) as [LifecycleAction, Status | null][]) {
      if (next) {
        it(`allows ${action} from ${status} → ${next}`, () => {
          expect(canAct(status, action)).toBe(true)
          expect(transition(status, action)).toBe(next)
        })
      } else {
        it(`refuses ${action} from ${status}`, () => {
          expect(canAct(status, action)).toBe(false)
          expect(() => transition(status, action)).toThrow(/illegal lifecycle transition/)
        })
      }
    }
  }
})

describe('terminal states (03e)', () => {
  it('reads terminal off the table: exactly the statuses no action leaves', () => {
    for (const [status, actions] of Object.entries(TABLE) as [
      Status,
      Record<LifecycleAction, Status | null>,
    ][]) {
      const stuck = Object.values(actions).every((next) => next === null)
      expect(isTerminal(status), status).toBe(stuck)
    }
    expect(STATUSES.filter(isTerminal)).toEqual(['resolved', 'dismissed'])
  })
})

describe('event log', () => {
  it('opens with a synthetic first-seen entry, and status reads New', () => {
    const log = opened()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      trackId: 'inject-05',
      seq: 1,
      action: 'first-seen',
      from: null,
      to: 'new',
      tSec: 0,
    })
    expect(statusOf(log)).toBe('new')
    // A track whose log has not been opened yet is still New — nothing has happened to it.
    expect(statusOf(undefined)).toBe('new')
    expect(statusOf([])).toBe('new')
  })

  it('appends each action with sequence, from/to, and the caller-supplied clock', () => {
    let log = appendEvent(opened(), 'assess', input())
    log = appendEvent(
      log,
      'escalate',
      input({ at: '2026-09-01T12:07:45.000Z', recipient: 'phl-tower' }),
    )
    log = appendEvent(log, 'resolve', input({ disposition: 'benign' }))
    expect(log.map((event) => event.seq)).toEqual([1, 2, 3, 4])
    expect(log.map((event) => event.to)).toEqual(['new', 'assessing', 'escalated', 'resolved'])
    expect(log.map((event) => event.from)).toEqual([null, 'new', 'assessing', 'escalated'])
    expect(log[2].recipient).toBe('phl-tower')
    expect(log[2].at).toBe('2026-09-01T12:07:45.000Z')
    expect(log[3].disposition).toBe('benign')
    expect(statusOf(log)).toBe('resolved')
  })

  it('does not mutate the log it was given', () => {
    const log = opened()
    appendEvent(log, 'assess', input())
    expect(log).toHaveLength(1)
  })

  it('refuses an unopened log, an unaddressed escalation, and an unlabelled resolution', () => {
    expect(() => appendEvent([], 'assess', input())).toThrow(/firstSeen/)
    const assessing = appendEvent(opened(), 'assess', input())
    expect(() => appendEvent(assessing, 'escalate', input())).toThrow(/recipient/)
    const escalated = appendEvent(assessing, 'escalate', input({ recipient: 'phl-tower' }))
    expect(() => appendEvent(escalated, 'resolve', input())).toThrow(/disposition/)
  })

  it('drops a recipient or disposition from an action that does not define it', () => {
    const log = appendEvent(
      opened(),
      'assess',
      input({ recipient: 'phl-tower', disposition: 'benign' }),
    )
    expect('recipient' in log[1]).toBe(false)
    expect('disposition' in log[1]).toBe(false)
  })
})

describe('learner-ready shape (§8.3b)', () => {
  // Ground truth on purpose: the snapshot must carry none of it.
  const track: InjectTrack = {
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
    groundSpeedKt: null,
    headingDeg: 345.6,
    verticalRateFpm: 85,
    lastSeenSec: 0,
  }
  const score = scoreTrack(track, AO.protectedSites, { tSec: 0, minuteOfDay: 150, memory: {} })
  const entry: RankedTrack = { track, rank: 1, rangeM: 7200.2, siteId: 'phl-airfield', score }

  it('snapshots exactly what the operator saw — nullable kinematics included (#35)', () => {
    // The score is the composite the chip showed; the factors are each 0–100 value, by id, which
    // is what §8.3b learns from (ruled on #4) — never the detail text, never the label.
    expect(observedSnapshot(entry)).toEqual({
      identity: 'non-cooperative',
      rangeM: 7200.2,
      siteId: 'phl-airfield',
      sites: PHL_SITES,
      friendly: false,
      altitudeFt: 63,
      groundSpeedKt: null,
      headingDeg: track.headingDeg,
      score: score.composite,
      uncapped: score.uncapped,
      pattern: null,
      factors: {
        cooperativity: 100,
        closing: 0,
        proximity: score.factors[2].value,
        pattern: 0,
        kinematic: 0,
        time: 100,
      },
      weights: SCORING.weights,
    })
  })

  it('reconciles with its own composite after the weights move (#36 [8], #64)', () => {
    const observed = observedSnapshot(entry)
    const ids = Object.keys(observed.factors) as FactorId[]

    // The event's own arithmetic, read off the event and nothing else — no config import. Same
    // three steps the scorer takes, so the stored numbers reproduce the stored score exactly.
    const reconcile = (snap: ObservedSnapshot) => {
      const weighted = ids.reduce((sum, id) => sum + (snap.factors[id] / 100) * snap.weights[id], 0)
      const totalWeight = ids.reduce((sum, id) => sum + snap.weights[id], 0)
      return (Math.round(weighted * 10) / 10 / totalWeight) * 100
    }
    expect(reconcile(observed)).toBeCloseTo(observed.uncapped, 10)

    // PR 07 moves a slider. The same track under new doctrine scores somewhere else, and the
    // older event still reproduces its own number from the weights it stored — which is how a
    // learner tells a re-weighted picture from a scoring bug. Read against the live config
    // instead, the old event would now reconcile to the new number and the record would lie.
    const config = { ...SCORING, weights: { ...SCORING.weights, cooperativity: 5, time: 40 } }
    const later = observedSnapshot({
      ...entry,
      score: scoreTrack(track, AO.protectedSites, {
        tSec: 0,
        minuteOfDay: 150,
        memory: {},
        config,
      }),
    })
    expect(later.weights).not.toEqual(observed.weights)
    expect(later.uncapped).not.toBeCloseTo(observed.uncapped, 1)
    expect(reconcile(observed)).toBeCloseTo(observed.uncapped, 10)
    expect(reconcile(later)).toBeCloseTo(later.uncapped, 10)

    // The negative, which is the whole point, and it is worse than a number that fails to add
    // up: only the weights moved, so the older event's factors read against the newer doctrine
    // land *cleanly* on the newer composite and quietly disagree with the one the event stored.
    // An event without its weight set is not a number a learner cannot account for — it is a
    // number that accounts for itself under the wrong doctrine, so a re-weighted picture reads
    // as a correct record rather than as a change. Both halves are pinned: the cross-read hits
    // the new score exactly, and misses the stored one.
    const crossRead = reconcile({ ...observed, weights: later.weights })
    expect(crossRead).toBeCloseTo(later.uncapped, 10)
    expect(crossRead).not.toBeCloseTo(observed.uncapped, 1)
  })

  it('carries no ground-truth field anywhere in a fully walked log', () => {
    const observed = observedSnapshot(entry)
    let log = firstSeen(track.id, observed, '2026-09-01T12:04:31.000Z')
    log = appendEvent(log, 'assess', input({ observed }))
    log = appendEvent(log, 'escalate', input({ observed, recipient: 'phl-tower' }))
    log = appendEvent(log, 'resolve', input({ observed, disposition: 'benign' }))

    // The features are the label's whole vocabulary: nothing from the answer key (#4's rule).
    for (const event of log) {
      expect(Object.keys(event.observed).sort()).toEqual([
        'altitudeFt',
        'factors',
        'friendly',
        'groundSpeedKt',
        'headingDeg',
        'identity',
        'pattern',
        'rangeM',
        'score',
        'siteId',
        'sites',
        'uncapped',
        'weights',
      ])
    }
    const serialized = JSON.stringify(log)
    expect(serialized).not.toMatch(/behavior|remoteId|loiter|silent|intermittent|broadcasting/)
  })

  it('types the event for the learner: ids, not display names', () => {
    const log = appendEvent(
      appendEvent(opened(), 'assess', input()),
      'escalate',
      input({ recipient: 'airport-police-cuas' }),
    )
    const escalated = log[2] as TrackEvent
    expect(escalated.recipient).toBe('airport-police-cuas')
    expect(JSON.stringify(escalated)).not.toContain('Airport Police')
  })
})

describe('band crossings (06b)', () => {
  const ranked = (score: number, uncapped = score): RankedTrack => ({
    track: {
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
    },
    rank: 1,
    rangeM: 7200.2,
    siteId: 'phl-airfield',
    score: {
      composite: score,
      weighted: 0,
      total: 0,
      totalWeight: 80,
      uncapped,
      capped: score < uncapped,
      band: score >= 70 ? 'warning' : score >= 40 ? 'caution' : 'calm',
      factors: [],
      pattern: null,
      rangeM: 7200.2,
      siteId: 'phl-airfield',
      sites: PHL_SITES,
      friendly: false,
    },
  })
  const openedAt = (score: number) =>
    firstSeen('inject-05', { ...OBSERVED, score, uncapped: score }, '2026-09-01T12:04:31.000Z')

  it('logs a crossing up at sim time, statuses carried unchanged, and reads the new band next', () => {
    const log = bandCrossing(openedAt(38), ranked(72), '2026-09-01T12:06:02.000Z', 187)
    expect(log).not.toBeNull()
    expect(log![1]).toMatchObject({
      seq: 2,
      at: '2026-09-01T12:06:02.000Z',
      tSec: 187,
      action: 'band',
      from: 'new',
      to: 'new',
      band: { from: 'calm', to: 'warning' },
    })
    expect(log![1].observed.score).toBe(72)
    expect(statusOf(log!)).toBe('new')
    expect(lastBand(log!)).toBe('warning')
    // Settled: the same band again is no crossing.
    expect(bandCrossing(log!, ranked(75), '2026-09-01T12:06:03.000Z', 188)).toBeNull()
  })

  it('logs a crossing down too, and none when the band the record last saw is the band now', () => {
    expect(bandCrossing(openedAt(82), ranked(80), '2026-09-01T12:06:02.000Z', 5)).toBeNull()
    const down = bandCrossing(openedAt(82), ranked(55), '2026-09-01T12:06:02.000Z', 5)
    expect(down![1].band).toEqual({ from: 'warning', to: 'caution' })
  })

  it('compares against the last entry, so a seek logs one crossing rather than every band between', () => {
    // Calm → warning in one step: one entry, calm to warning, not two.
    const log = bandCrossing(openedAt(10), ranked(90), '2026-09-01T12:06:02.000Z', 900)
    expect(log).toHaveLength(2)
    expect(log![1].band).toEqual({ from: 'calm', to: 'warning' })
  })

  it('logs on a terminal track as well — evidence for a re-surface (#5), never a lifecycle change', () => {
    const dismissed = appendEvent(openedAt(38), 'dismiss', {
      at: '2026-09-01T12:05:00.000Z',
      tSec: 30,
      observed: { ...OBSERVED, score: 38, uncapped: 38 },
    })
    const log = bandCrossing(dismissed, ranked(72), '2026-09-01T12:06:02.000Z', 187)
    expect(log![2]).toMatchObject({ action: 'band', from: 'dismissed', to: 'dismissed' })
    expect(statusOf(log!)).toBe('dismissed')
    expect(isTerminal(statusOf(log!))).toBe(true)
  })

  it('bands the record the way the chip bands the score — on the rounded composite', () => {
    // 69.6 prints as 70 and reads warning on the chip; the record must agree (#63).
    expect(lastBand(openedAt(69.6))).toBe('warning')
    expect(lastBand(openedAt(39.4))).toBe('calm')
  })

  it('carries the heading the handoff prints (06b)', () => {
    expect(observedSnapshot(ranked(50)).headingDeg).toBe(345.6)
    const unheaded = { ...ranked(50), track: { ...ranked(50).track, headingDeg: null } }
    expect(observedSnapshot(unheaded).headingDeg).toBeNull()
  })
})

describe('band crossings are forward only (#75 review)', () => {
  const at = (score: number, tSec: number): RankedTrack => ({
    track: {
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
      lastSeenSec: tSec,
    },
    rank: 1,
    rangeM: 7200.2,
    siteId: 'phl-airfield',
    score: {
      composite: score,
      weighted: 0,
      total: 0,
      totalWeight: 80,
      uncapped: score,
      capped: false,
      band: score >= 70 ? 'warning' : score >= 40 ? 'caution' : 'calm',
      factors: [],
      pattern: null,
      rangeM: 7200.2,
      siteId: 'phl-airfield',
      sites: PHL_SITES,
      friendly: false,
    },
  })

  it('refuses a band read at a sim time earlier than the last entry — a rewind is not a crossing', () => {
    let log = firstSeen(
      'inject-05',
      { ...OBSERVED, score: 20, uncapped: 20 },
      '2026-09-01T12:04:31.000Z',
    )
    log = bandCrossing(log, at(90, 1030), '2026-09-01T12:21:41.000Z', 1030)!
    expect(log[1].band).toEqual({ from: 'calm', to: 'warning' })
    // Play again from the start: calm at 0 is the past the record already holds.
    expect(bandCrossing(log, at(20, 0), '2026-09-01T12:22:00.000Z', 0)).toBeNull()
    expect(bandCrossing(log, at(55, 600), '2026-09-01T12:32:00.000Z', 600)).toBeNull()
    // Back past the last entry, still warning: nothing; then a real later change is logged.
    expect(bandCrossing(log, at(90, 1100), '2026-09-01T12:40:00.000Z', 1100)).toBeNull()
    const later = bandCrossing(log, at(55, 1150), '2026-09-01T12:41:00.000Z', 1150)!
    expect(later[2]).toMatchObject({ tSec: 1150, band: { from: 'warning', to: 'caution' } })
    // The record never runs backwards.
    for (let i = 1; i < later.length; i++)
      expect(later[i].tSec).toBeGreaterThanOrEqual(later[i - 1].tSec)
  })
})

describe('pattern entries and the re-surface (05b, ruled on #5)', () => {
  const at = '2026-09-01T12:06:02.000Z'
  const drone: InjectTrack = {
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
  const scored = scoreTrack(drone, AO.protectedSites, { tSec: 0, minuteOfDay: 150, memory: {} })
  const withScore = (
    score: number,
    pattern: PatternKind | null,
    uncapped = score,
  ): RankedTrack => ({
    track: drone,
    rank: 1,
    rangeM: scored.rangeM,
    siteId: scored.siteId,
    score: {
      ...scored,
      composite: score,
      uncapped,
      capped: score < uncapped,
      band: bandOf(Math.round(score), SCORING.bands),
      pattern,
    },
  })
  const openedWith = (pattern: PatternKind | null, tSec = 0) =>
    firstSeen(drone.id, observedSnapshot(withScore(84, pattern)), at, tSec)
  const dismissedAt = (score: number, pattern: PatternKind | null = null, uncapped = score) =>
    appendEvent(
      firstSeen(drone.id, observedSnapshot(withScore(score, pattern, uncapped)), at),
      'dismiss',
      { at, tSec: 10, observed: observedSnapshot(withScore(score, pattern, uncapped)) },
    )

  it('logs an onset at sim time against the pattern the record last saw, statuses carried', () => {
    const log = patternChange(openedWith(null), withScore(95, 'loiter'), at, 990)!
    expect(log).toHaveLength(2)
    expect(log[1]).toMatchObject({
      seq: 2,
      tSec: 990,
      action: 'pattern',
      from: 'new',
      to: 'new',
      pattern: { from: null, to: 'loiter' },
    })
    expect(log[1].observed.pattern).toBe('loiter')
    expect(statusOf(log)).toBe('new')
    expect(lastPattern(log)).toBe('loiter')
  })

  it('logs nothing when the pattern is the one the record last saw, and never behind the frontier', () => {
    expect(patternChange(openedWith('loiter'), withScore(95, 'loiter'), at, 990)).toBeNull()
    // Opened with the word already on the first-seen entry: no onset, as ruled.
    expect(openedWith('loiter')[0].observed.pattern).toBe('loiter')
    // Rewound behind the last entry: the past the record already holds.
    expect(patternChange(openedWith(null, 600), withScore(95, 'loiter'), at, 300)).toBeNull()
    expect(() => patternChange([], withScore(95, 'loiter'), at, 1)).toThrow(/firstSeen/)
  })

  it('logs an end, a replacement, and on a terminal track too', () => {
    const ended = patternChange(openedWith('loiter'), withScore(84, null), at, 30)!
    expect(ended[1].pattern).toEqual({ from: 'loiter', to: null })
    const replaced = patternChange(openedWith('loiter'), withScore(90, 'orbit'), at, 30)!
    expect(replaced[1].pattern).toEqual({ from: 'loiter', to: 'orbit' })
    const onDismissed = patternChange(dismissedAt(60), withScore(95, 'loiter'), at, 990)!
    expect(onDismissed[2]).toMatchObject({ action: 'pattern', from: 'dismissed', to: 'dismissed' })
    expect(statusOf(onDismissed)).toBe('dismissed')
  })

  const surfaced = (log: readonly TrackEvent[] | undefined) => resurfaced(log, 'inject')

  it('never re-surfaces a real aircraft, keyed on the observed source as the ceiling is (4A, #82 review)', () => {
    // The same record that re-surfaces an inject — dismissed, then an upward crossing and an
    // onset — re-surfaces nothing when the track is ADS-B, capped or not.
    const up = bandCrossing(dismissedAt(20), withScore(45, null), at, 20)!
    const onset = patternChange(up, withScore(60, 'orbit'), at, 30)!
    expect(surfaced(onset)).toBe(true)
    expect(resurfaced(onset, 'adsb')).toBe(false)
  })

  it('re-surfaces nothing untouched, active, or freshly dismissed', () => {
    expect(surfaced(undefined)).toBe(false)
    expect(surfaced(openedWith(null))).toBe(false)
    expect(surfaced(dismissedAt(60))).toBe(false)
  })

  it('re-surfaces on an upward crossing since dismissal, not a downward one', () => {
    const up = bandCrossing(dismissedAt(60), withScore(84, null), at, 20)!
    expect(up[2].band).toEqual({ from: 'caution', to: 'warning' })
    expect(surfaced(up)).toBe(true)
    expect(statusOf(up)).toBe('dismissed')
    expect(surfaced(bandCrossing(dismissedAt(84), withScore(60, null), at, 20)!)).toBe(false)
  })

  it('re-surfaces on a pattern onset since dismissal, not an end', () => {
    expect(surfaced(patternChange(dismissedAt(84), withScore(100, 'loiter'), at, 20)!)).toBe(true)
    expect(surfaced(patternChange(dismissedAt(100, 'loiter'), withScore(84, null), at, 20)!)).toBe(
      false,
    )
  })

  it('ignores evidence from before the dismissal', () => {
    const openedCalm = firstSeen(drone.id, observedSnapshot(withScore(60, null)), at)
    const crossed = bandCrossing(openedCalm, withScore(84, null), at, 5)!
    const thenDismissed = appendEvent(crossed, 'dismiss', {
      at,
      tSec: 10,
      observed: observedSnapshot(withScore(84, null)),
    })
    expect(surfaced(thenDismissed)).toBe(false)
  })

  it('reads the source, not the cap: a capped record on a real aircraft never surfaces', () => {
    // Dismissed at the ceiling; the uncapped composite then climbs and a pattern names, and
    // every entry still carries score < uncapped, so none counts.
    const capped = patternChange(dismissedAt(30, null, 45), withScore(30, 'orbit', 60), at, 20)!
    expect(capped[2].observed).toMatchObject({ score: 30, uncapped: 60, pattern: 'orbit' })
    expect(resurfaced(capped, 'adsb')).toBe(false)
  })

  describe('the Lost line and the return (ruled on #71)', () => {
    // Claimed at 30 s while loitering in Warning; the picture last drew it at 84.
    const claimed = appendEvent(openedWith('loiter'), 'assess', {
      at,
      tSec: 30,
      observed: observedSnapshot(withScore(84, 'loiter')),
    })
    const held = observedSnapshot(withScore(84, 'loiter'))

    it('logs Lost at sim time with the held picture and the time last heard, status carried', () => {
      const log = lost(claimed, held, at, 121, 30)!
      expect(log).toHaveLength(3)
      expect(log[2]).toMatchObject({
        seq: 3,
        tSec: 121,
        action: 'lost',
        from: 'assessing',
        to: 'assessing',
        lost: { lastHeardTSec: 30 },
        observed: held,
      })
      expect(statusOf(log)).toBe('assessing')
      expect(canLose(log, 122)).toBe(false)
    })

    it('logs nothing on a terminal record, twice, or behind the frontier', () => {
      expect(lost(dismissedAt(60), held, at, 121, 30)).toBeNull()
      const resolved = appendEvent(
        appendEvent(claimed, 'escalate', { at, tSec: 40, observed: held, recipient: 'phl-tower' }),
        'resolve',
        { at, tSec: 50, observed: held, disposition: 'benign' },
      )
      expect(lost(resolved, held, at, 121, 30)).toBeNull()
      const once = lost(claimed, held, at, 121, 30)!
      expect(lost(once, held, at, 200, 30)).toBeNull()
      // Rewound to before first sight, the picture shows the track absent: not a loss.
      expect(lost(openedWith(null, 600), held, at, 300, 30)).toBeNull()
      expect(canLose(openedWith(null, 600), 300)).toBe(false)
      expect(() => lost([], held, at, 1, 30)).toThrow(/firstSeen/)
    })

    it('logs Regained with the return picture, only on a record that ends on Lost and forward of it', () => {
      const gone = lost(claimed, held, at, 121, 30)!
      const back = regained(gone, withScore(20, null), at, 180)!
      expect(back).toHaveLength(4)
      expect(back[3]).toMatchObject({
        seq: 4,
        tSec: 180,
        action: 'regained',
        from: 'assessing',
        to: 'assessing',
      })
      expect(back[3].observed).toMatchObject({ score: 20, pattern: null })
      expect(back[3].lost).toBeUndefined()
      // The pass's crossing and pattern change are read against the record before it: the band
      // left and the pattern ended across the hole are still there to be logged.
      expect(bandCrossing(gone, withScore(20, null), at, 180)![3].band).toEqual({
        from: 'warning',
        to: 'calm',
      })
      expect(patternChange(gone, withScore(20, null), at, 180)![3].pattern).toEqual({
        from: 'loiter',
        to: null,
      })
      expect(regained(claimed, withScore(20, null), at, 180)).toBeNull()
      expect(regained(gone, withScore(20, null), at, 100)).toBeNull()
      expect(canRegain(gone, 121)).toBe(true)
      expect(canRegain(back, 200)).toBe(false)
      expect(() => regained([], withScore(20, null), at, 1)).toThrow(/firstSeen/)
    })
  })
})

describe('the friendly-launch guard on re-surface (08b, ruled on #86)', () => {
  const at = '2026-09-01T12:06:02.000Z'
  const track: InjectTrack = {
    id: 'inject-02',
    source: 'inject',
    behavior: 'orbit',
    remoteId: 'broadcasting',
    uaType: null,
    identity: 'cooperative',
    callsign: 'UAS-A341',
    position: [-75.2819, 39.7859],
    altitudeFt: 230,
    onGround: false,
    groundSpeedKt: 20,
    headingDeg: 90,
    verticalRateFpm: 0,
    lastSeenSec: 0,
  }
  const entry = (score: number): RankedTrack => ({
    track,
    rank: 1,
    rangeM: 4700,
    siteId: 'phl-airfield',
    score: {
      composite: score,
      weighted: 0,
      total: 0,
      totalWeight: 95,
      uncapped: score,
      capped: false,
      friendly: false,
      band: bandOf(score, SCORING.bands),
      factors: [],
      pattern: null,
      rangeM: 4700,
      siteId: 'phl-airfield',
      sites: PHL_SITES,
    },
  })

  it('never re-surfaces a track under the condition, and lifts once the ident lapses', () => {
    // Dismissed calm, then a crossing up to warning since: re-surfaces as a drone, not as a
    // friendly one — keyed on the condition, never on the cap having bound.
    const calm = firstSeen('inject-02', { ...OBSERVED, score: 30, uncapped: 30 }, at)
    const dismissed = appendEvent(calm, 'dismiss', { at, tSec: 0, observed: calm[0].observed })
    const crossed = bandCrossing(dismissed, entry(84), at, 5)!
    expect(resurfaced(crossed, 'inject')).toBe(true)
    expect(resurfaced(crossed, 'inject', false)).toBe(true)
    expect(resurfaced(crossed, 'inject', true)).toBe(false)
    expect(resurfaced(crossed, 'adsb', false)).toBe(false)
  })
})
