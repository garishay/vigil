import { describe, expect, it } from 'vitest'
import {
  STATUSES,
  appendEvent,
  canAct,
  firstSeen,
  isTerminal,
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

const OBSERVED: ObservedSnapshot = {
  identity: 'non-cooperative',
  rangeM: 7200.2,
  altitudeFt: 63,
  groundSpeedKt: 19.1,
  score: 82,
  factors: { cooperativity: 100, closing: 44.4, proximity: 78, kinematic: 100, time: 100 },
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
      altitudeFt: 63,
      groundSpeedKt: null,
      score: score.composite,
      factors: {
        cooperativity: 100,
        closing: 0,
        proximity: score.factors[2].value,
        kinematic: 0,
        time: 100,
      },
    })
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
        'identity',
        'rangeM',
        'score',
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
