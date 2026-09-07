import { describe, expect, it } from 'vitest'
import { RESURFACED_WORD, clearFor, foldAlerts, raise, type Alert } from './alerts'
import type { ObservedSnapshot, Status, TrackEvent } from './lifecycle'
import { ALERTS } from '../config/alerts'
import { AO } from '../config/ao'

const SITES = AO.protectedSites.map((site) => ({ ...site, kind: 'protected' as const }))

const observed = (over: Partial<ObservedSnapshot> = {}): ObservedSnapshot => ({
  identity: 'non-cooperative',
  rangeM: 7200,
  siteId: 'phl-airfield',
  altitudeFt: 210,
  groundSpeedKt: 4.2,
  headingDeg: 118,
  score: 72,
  uncapped: 72,
  pattern: null,
  factors: {
    cooperativity: 100,
    closing: 44,
    proximity: 78,
    pattern: 0,
    kinematic: 100,
    time: 100,
  },
  weights: { cooperativity: 25, closing: 20, proximity: 15, pattern: 15, kinematic: 10, time: 10 },
  sites: SITES,
  friendly: false,
  entry: null,
  ...over,
})

/** A log built by hand, one entry per call, sequenced and stamped in order. */
function log(...entries: Partial<TrackEvent>[]): TrackEvent[] {
  let status: Status = 'new'
  return entries.map((entry, i) => {
    const to = entry.to ?? status
    const out: TrackEvent = {
      trackId: 'inject-05',
      seq: i + 1,
      at: '2026-09-01T12:04:31.000Z',
      tSec: entry.tSec ?? i * 60,
      action: entry.action ?? 'band',
      from: status,
      to,
      observed: entry.observed ?? observed(),
      ...(entry.band ? { band: entry.band } : {}),
      ...(entry.pattern ? { pattern: entry.pattern } : {}),
      ...(entry.lost ? { lost: entry.lost } : {}),
    }
    status = to
    return out
  })
}

const opened = (over: Partial<TrackEvent> = {}): Partial<TrackEvent> => ({
  action: 'first-seen',
  to: 'new',
  observed: observed({ score: 30 }),
  ...over,
})
const upToWarning: Partial<TrackEvent> = {
  action: 'band',
  band: { from: 'caution', to: 'warning' },
}
const upToCaution: Partial<TrackEvent> = { action: 'band', band: { from: 'calm', to: 'caution' } }
const onset: Partial<TrackEvent> = { action: 'pattern', pattern: { from: null, to: 'loiter' } }

const fold = (
  entries: readonly TrackEvent[],
  over: { alerts?: Alert[]; from?: number; source?: 'adsb' | 'inject'; raising?: boolean } = {},
) =>
  foldAlerts(
    over.alerts ?? [],
    entries,
    over.from ?? 0,
    over.source ?? 'inject',
    over.raising ?? true,
  )

describe('foldAlerts — what earns a card (#101)', () => {
  it('raises Warning on an upward crossing into warning, stamped with the entry', () => {
    const entries = log(opened(), { ...upToWarning, tSec: 495 })
    expect(fold(entries)).toEqual([
      { trackId: 'inject-05', kind: 'warning', word: 'Warning', tSec: 495, seq: 2 },
    ])
  })

  it('raises Caution only when its trigger is on — off by default', () => {
    const entries = log(opened(), upToCaution)
    expect(fold(entries)).toEqual([])
    const on = { triggers: { ...ALERTS.triggers, caution: true } }
    expect(foldAlerts([], entries, 0, 'inject', true, on)).toMatchObject([
      { kind: 'caution', word: 'Caution' },
    ])
  })

  it('raises the pattern word on an onset, and nothing on an end or a crossing down', () => {
    const entries = log(
      opened(),
      onset,
      { action: 'pattern', pattern: { from: 'loiter', to: null } },
      { action: 'band', band: { from: 'warning', to: 'caution' } },
    )
    expect(fold(entries)).toMatchObject([{ kind: 'pattern', word: 'Loitering', seq: 2 }])
  })

  it('raises what a track opened with — a warm band, a pattern word, or both (A2 as amended)', () => {
    const both = log(opened({ observed: observed({ score: 82, pattern: 'orbit' }) }))
    expect(fold(both).map((alert) => alert.word)).toEqual(['Orbiting', 'Warning'])
    const calm = log(opened())
    expect(fold(calm)).toEqual([])
  })

  it('raises nothing on Lost, Regained, or the operator’s own actions', () => {
    const entries = log(
      opened({ observed: observed({ score: 82 }) }),
      { action: 'lost', lost: { lastHeardTSec: 30 } },
      { action: 'regained', observed: observed({ score: 82 }) },
      { action: 'assess', to: 'assessing' },
    )
    expect(fold(entries, { from: 1 })).toEqual([])
  })
})

describe('foldAlerts — the never-alert rule and the clock’s word', () => {
  it('raises nothing for a track observed on ADS-B, or under the friendly condition (A3)', () => {
    const entries = log(opened(), upToWarning, onset)
    expect(fold(entries, { source: 'adsb' })).toEqual([])
    const friendly = log(
      opened(),
      { ...upToWarning, observed: observed({ friendly: true }) },
      { ...onset, observed: observed({ friendly: true }) },
    )
    expect(fold(friendly)).toEqual([])
  })

  it('raises nothing on a seek — but still clears (A1, A8)', () => {
    const pending: Alert[] = [
      { trackId: 'inject-05', kind: 'warning', word: 'Warning', tSec: 60, seq: 2 },
      { trackId: 'inject-06', kind: 'warning', word: 'Warning', tSec: 60, seq: 2 },
    ]
    const entries = log(opened(), upToWarning, onset, {
      action: 'lost',
      lost: { lastHeardTSec: 90 },
    })
    // Read from the second entry on: the onset would raise on a tick; on a seek only the Lost
    // line acts, and it clears this track's card alone.
    expect(fold(entries, { alerts: pending, from: 2, raising: false })).toEqual([pending[1]])
  })

  it('folds only the entries past what was read, so nothing is raised twice', () => {
    const entries = log(opened(), upToWarning, onset)
    const first = fold(entries, { from: 0 })
    expect(first).toHaveLength(2)
    expect(fold(entries, { alerts: first, from: 3 })).toBe(first)
  })
})

describe('foldAlerts — one pending card per track per kind (A4), Re-surfaced (A5)', () => {
  it('re-stamps and lifts a pending kind rather than adding a second card', () => {
    const entries = log(
      opened(),
      { ...upToWarning, tSec: 100 },
      { ...onset, tSec: 130 },
      { action: 'band', band: { from: 'warning', to: 'caution' }, tSec: 150 },
      { ...upToWarning, tSec: 160 },
    )
    const stack = fold(entries)
    expect(stack.map((alert) => [alert.kind, alert.tSec])).toEqual([
      ['warning', 160],
      ['pattern', 130],
    ])
  })

  it('raises a fresh card for a kind the operator acknowledged and that fired again', () => {
    const entries = log(
      opened(),
      { ...upToWarning, tSec: 100 },
      { action: 'acknowledge', to: 'assessing', tSec: 110 },
      { action: 'band', band: { from: 'warning', to: 'caution' }, tSec: 150 },
      { ...upToWarning, tSec: 160 },
    )
    expect(fold(entries)).toMatchObject([{ kind: 'warning', tSec: 160 }])
  })

  it('raises Re-surfaced in place of the crossing’s card on a Dismissed track, and re-stamps it', () => {
    const entries = log(
      opened(),
      { action: 'dismiss', to: 'dismissed', tSec: 360 },
      { ...upToWarning, tSec: 495 },
      { ...onset, tSec: 600 },
    )
    const stack = fold(entries)
    expect(stack).toEqual([
      { trackId: 'inject-05', kind: 'resurfaced', word: RESURFACED_WORD, tSec: 600, seq: 4 },
    ])
    expect(stack.some((alert) => alert.kind === 'warning')).toBe(false)
  })

  it('raises nothing on a Resolved track — it is handled', () => {
    const entries = log(
      opened(),
      { action: 'assess', to: 'assessing' },
      { action: 'escalate', to: 'escalated' },
      { action: 'resolve', to: 'resolved' },
      upToWarning,
      onset,
    )
    expect(fold(entries)).toEqual([])
  })
})

describe('the clears (A8)', () => {
  const pending: Alert[] = [
    { trackId: 'inject-05', kind: 'pattern', word: 'Loitering', tSec: 60, seq: 2 },
    { trackId: 'inject-05', kind: 'warning', word: 'Warning', tSec: 30, seq: 1 },
    { trackId: 'inject-06', kind: 'warning', word: 'Warning', tSec: 30, seq: 1 },
  ]

  it.each([
    ['an acknowledge', { action: 'acknowledge', to: 'assessing' } as Partial<TrackEvent>],
    ['a dismissal', { action: 'dismiss', to: 'dismissed' } as Partial<TrackEvent>],
    ['a Lost line', { action: 'lost', lost: { lastHeardTSec: 30 } } as Partial<TrackEvent>],
  ])('drops the track’s cards on %s, and no other track’s', (_, entry) => {
    const entries = log(opened(), entry)
    expect(fold(entries, { alerts: pending, from: 1 })).toEqual([pending[2]])
  })

  it('drops them on a resolution too, and leaves the stack alone when it held none', () => {
    const entries = log(
      opened(),
      { action: 'assess', to: 'assessing' },
      { action: 'escalate', to: 'escalated' },
      { action: 'resolve', to: 'resolved' },
    )
    expect(fold(entries, { alerts: pending, from: 1 })).toEqual([pending[2]])
    const untouched: Alert[] = [pending[2]]
    expect(clearFor(untouched, 'inject-05')).toBe(untouched)
  })

  it('raise puts the card first and replaces its own kind only', () => {
    const card: Alert = { trackId: 'inject-05', kind: 'warning', word: 'Warning', tSec: 90, seq: 3 }
    expect(raise(pending, card)).toEqual([card, pending[0], pending[2]])
  })
})
