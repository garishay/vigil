import { describe, expect, it } from 'vitest'
import {
  STATUSES,
  appendEvent,
  bandCrossing,
  canAct,
  firstSeen,
  isTerminal,
  lastBand,
  observedSnapshot,
  statusOf,
  transition,
  type ActionInput,
  type LifecycleAction,
  type ObservedSnapshot,
  type Status,
  type TrackEvent,
} from './lifecycle'
import type { RankedTrack } from './ranking'
import { scoreTrack } from './scoring'
import type { InjectTrack } from './tracks'
import { AO } from '../config/ao'
import { SCORING, type FactorId } from '../config/scoring'

const OBSERVED: ObservedSnapshot = {
  identity: 'non-cooperative',
  rangeM: 7200.2,
  siteId: 'phl-airfield',
  altitudeFt: 63,
  groundSpeedKt: 19.1,
  headingDeg: 345.6,
  score: 82,
  uncapped: 82,
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
      altitudeFt: 63,
      groundSpeedKt: null,
      headingDeg: track.headingDeg,
      score: score.composite,
      uncapped: score.uncapped,
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
        'groundSpeedKt',
        'headingDeg',
        'identity',
        'rangeM',
        'score',
        'siteId',
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
