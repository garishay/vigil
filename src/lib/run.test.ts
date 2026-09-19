import { describe, expect, it } from 'vitest'
import { runEvents, runJson, runRecord, type RunInput } from './run'
import {
  appendEvent,
  firstSeen,
  observedSnapshot,
  type ObservedSnapshot,
  type TrackEvent,
} from './lifecycle'
import { scoreTrack } from './scoring'
import type { SessionConfig } from './session'
import type { InjectTrack } from './tracks'
import { AO } from '../config/ao'

/** A silent inject, scored for real, so the snapshot the record keeps is a real one. */
const SILENT: InjectTrack = {
  id: 'inject-11',
  source: 'inject',
  uaType: null,
  broadcast: null,
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

/** A snapshot the record needs and the run JSON must never print. */
const OBSERVED: ObservedSnapshot = observedSnapshot({
  track: SILENT,
  rank: 1,
  rangeM: 7200.2,
  siteId: 'phl-airfield',
  score: scoreTrack(SILENT, AO.protectedSites, { tSec: 0, minuteOfDay: 150, memory: {} }),
})

const at = '2026-09-16T01:12:04.000Z'
const opened = (id: string, tSec: number) => firstSeen(id, OBSERVED, at, tSec)
const acted = (
  log: TrackEvent[],
  action: 'assess' | 'escalate' | 'dismiss' | 'acknowledge' | 'resolve' | 'open',
  tSec: number,
) =>
  appendEvent(log, action, {
    at,
    tSec,
    observed: OBSERVED,
    recipient: 'phl-tower',
    disposition: 'benign',
    // `open` is a study run's own action; the rest read the same off either table.
    run: action === 'open',
  })

const session = (mode: 'raw' | 'vigil'): SessionConfig => ({
  feeds: [{ kind: 'recording', id: 'vigil-phl-002' }],
  scenario: { on: true, name: '02a', seed: 'study-02a', runS: 360 },
  mode,
  study: { subject: 'S03', run: 1 },
})

const BEGIN = 480
const END = 840

/** The scripted run: two looks, then Assess and Escalate on the threat; an Acknowledge on another. */
const scripted = () => {
  const threat = acted(
    acted(opened('inject-11', BEGIN + 1), 'assess', BEGIN + 49),
    'escalate',
    BEGIN + 58,
  )
  const other = acted(opened('adsb-a06461', BEGIN), 'acknowledge', BEGIN + 120)
  const logs = { 'inject-11': threat, 'adsb-a06461': other }
  const selections = [
    { tSec: BEGIN + 14, trackId: 'inject-12' },
    { tSec: BEGIN + 31, trackId: 'inject-11' },
  ]
  return { logs, selections }
}

const input = (mode: 'raw' | 'vigil'): RunInput => ({
  session: session(mode),
  build: '2.60.0+efac241',
  beganAt: at,
  beginS: BEGIN,
  endS: END,
  ...scripted(),
  answers: { demand: 6, pressure: 7, confidence: 5 },
})

describe('runEvents (S4b, #137, ruled A5, A6)', () => {
  it('folds the selections and the record into the contract’s events, t from Begin, sorted', () => {
    const { logs, selections } = scripted()
    expect(runEvents(logs, selections, BEGIN, END)).toEqual([
      { t: 14, type: 'select', track: 'inject-12' },
      { t: 31, type: 'select', track: 'inject-11' },
      { t: 49, type: 'assess', track: 'inject-11' },
      { t: 58, type: 'escalate', track: 'inject-11' },
      { t: 120, type: 'alert_ack', track: 'adsb-a06461' },
    ])
  })

  it('puts a selection before an action at the same second, and keeps the record’s order otherwise', () => {
    const log = acted(opened('inject-11', BEGIN), 'assess', BEGIN + 20)
    const events = runEvents(
      { 'inject-11': log },
      [{ tSec: BEGIN + 20, trackId: 'inject-11' }],
      BEGIN,
      END,
    )
    expect(events.map((event) => event.type)).toEqual(['select', 'assess'])
  })

  it('puts an answered card before the selection its Open made at the same second (S8b, #202, item 2)', () => {
    // A card's Open writes the acknowledge line and then the select, at one second; the run
    // JSON reads them in that order, the selection still ahead of any action at the tie.
    const log = acted(
      acted(opened('inject-11', BEGIN), 'acknowledge', BEGIN + 20),
      'escalate',
      BEGIN + 20,
    )
    const events = runEvents(
      { 'inject-11': log },
      [{ tSec: BEGIN + 20, trackId: 'inject-11' }],
      BEGIN,
      END,
    )
    expect(events).toEqual([
      { t: 20, type: 'alert_ack', track: 'inject-11' },
      { t: 20, type: 'select', track: 'inject-11' },
      { t: 20, type: 'escalate', track: 'inject-11' },
    ])
  })

  it('orders only the pair Open writes — same track, same second; everything else keeps the order it happened in (#204 round 1, finding 4)', () => {
    // Planted: a select on inject-11, then Open on inject-12's card, in one second. The subject
    // acted in that order, and the record reads it so — inject-11's select, then inject-12's
    // line and its select. The mirror — Open first, the other row after — reads the mirror.
    const opened12 = acted(opened('inject-12', BEGIN), 'acknowledge', BEGIN + 20)
    const logs = { 'inject-11': opened('inject-11', BEGIN), 'inject-12': opened12 }
    expect(
      runEvents(
        logs,
        [
          { tSec: BEGIN + 20, trackId: 'inject-11' },
          { tSec: BEGIN + 20, trackId: 'inject-12' },
        ],
        BEGIN,
        END,
      ),
    ).toEqual([
      { t: 20, type: 'select', track: 'inject-11' },
      { t: 20, type: 'alert_ack', track: 'inject-12' },
      { t: 20, type: 'select', track: 'inject-12' },
    ])
    expect(
      runEvents(
        logs,
        [
          { tSec: BEGIN + 20, trackId: 'inject-12' },
          { tSec: BEGIN + 20, trackId: 'inject-11' },
        ],
        BEGIN,
        END,
      ),
    ).toEqual([
      { t: 20, type: 'alert_ack', track: 'inject-12' },
      { t: 20, type: 'select', track: 'inject-12' },
      { t: 20, type: 'select', track: 'inject-11' },
    ])
    // A × alone at the same second as another row's select: no pair, so the order stands.
    expect(
      runEvents(logs, [{ tSec: BEGIN + 20, trackId: 'inject-11' }], BEGIN, END).map((e) => e.type),
    ).toEqual(['select', 'alert_ack'])
  })

  it('writes a first open as its select and nothing else — the select is the record (S8-ii, amendment item 4)', () => {
    // Opening an untouched track moves it to Assessing on the record, and the run JSON's shape
    // does not move for it: no `open` type, no `assess` written on its behalf.
    const log = acted(opened('inject-11', BEGIN), 'open', BEGIN + 14)
    expect(log.at(-1)).toMatchObject({ action: 'open', from: 'new', to: 'assessing' })
    expect(
      runEvents({ 'inject-11': log }, [{ tSec: BEGIN + 14, trackId: 'inject-11' }], BEGIN, END),
    ).toEqual([{ t: 14, type: 'select', track: 'inject-11' }])
  })

  it('leaves out what is not the run’s: observations, a Resolve, and anything outside the window', () => {
    const log = acted(
      acted(acted(opened('inject-11', BEGIN - 10), 'assess', BEGIN - 5), 'escalate', BEGIN + 10),
      'resolve',
      BEGIN + 20,
    )
    const selections = [
      { tSec: BEGIN - 1, trackId: 'inject-11' },
      { tSec: END, trackId: 'inject-11' },
      { tSec: END + 1, trackId: 'inject-11' },
    ]
    expect(runEvents({ 'inject-11': log }, selections, BEGIN, END)).toEqual([
      { t: 10, type: 'escalate', track: 'inject-11' },
      { t: 360, type: 'select', track: 'inject-11' },
    ])
  })
})

describe('runRecord and runJson (S4b, ruled A6)', () => {
  it('builds the contract’s object in its key order, the build named, one shape in both modes', () => {
    const raw = runRecord(input('raw'))
    expect(Object.keys(raw)).toEqual([
      'subject',
      'scenario',
      'mode',
      'run',
      'build',
      'began_at',
      'events',
      'answers',
    ])
    expect(raw).toMatchObject({
      subject: 'S03',
      scenario: '02a',
      mode: 'raw',
      run: 1,
      build: '2.60.0+efac241',
      began_at: at,
      answers: { demand: 6, pressure: 7, confidence: 5 },
    })
    expect(Object.keys(raw.answers)).toEqual(['demand', 'pressure', 'confidence'])
    const vigil = runRecord(input('vigil'))
    expect({ ...vigil, mode: 'raw' }).toEqual(raw)
  })

  it('carries no position, score, band, label, or name — track ids only', () => {
    const text = runJson(input('vigil'))
    for (const leak of [
      'position',
      '-75.2',
      'score',
      'band',
      'factors',
      'identity',
      'UAS-',
      'TRK-',
    ]) {
      expect(text).not.toContain(leak)
    }
    expect(text).toContain('"track":"inject-11"')
  })

  it('prints one event per line, and parses back to the record', () => {
    const text = runJson(input('raw'))
    expect(JSON.parse(text)).toEqual(runRecord(input('raw')))
    const lines = text.split('\n')
    expect(lines.filter((line) => line.includes('"type":')).length).toBe(5)
    expect(lines[0]).toBe('{')
    expect(lines[1]).toBe('  "subject": "S03",')
    expect(lines[lines.length - 1]).toBe('}')
    expect(runJson({ ...input('raw'), logs: {}, selections: [] })).toContain('"events": [],')
  })

  it('refuses a session that is not a run, and one with the scenario off — the resolver refuses both first (#36 [36])', () => {
    const off = { ...session('raw'), scenario: { on: false as const } }
    expect(() => runRecord({ ...input('raw'), session: off })).toThrow(/scenario/)
    const demo = { ...session('raw'), study: null }
    expect(() => runRecord({ ...input('raw'), session: demo })).toThrow(/study run/)
  })
})
