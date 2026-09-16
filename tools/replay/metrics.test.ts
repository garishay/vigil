import { describe, expect, it } from 'vitest'
import { THREAT_ID } from '../../scripts/study.ts'
import type { RunEvent, RunRecord } from '../../src/lib/run.ts'
import { loadStudy, planFor, readRun } from './load.ts'
import { runMetrics } from './metrics.ts'

// Vitest runs from the repo root, as the tool does; the fixtures are named from there.
const fixturePath = (name: string) => `tools/replay/__fixtures__/${name}`
const study = loadStudy()
const plans = { '02a': planFor('02a', study.timeline), '02b': planFor('02b', study.timeline) }
const metricsOf = (name: string) => {
  const record = readRun(fixturePath(name))
  return runMetrics(record, study.index, plans[record.scenario as '02a' | '02b'])
}
const record = (events: RunEvent[], patch: Partial<RunRecord> = {}): RunRecord => ({
  subject: 'S09',
  scenario: '02a',
  mode: 'vigil',
  run: 1,
  build: 'test',
  began_at: '2026-09-16T01:00:00.000Z',
  events,
  answers: { demand: 1, pressure: 2, confidence: 3 },
  ...patch,
})

describe('runMetrics (S5a, #138, ruled A4) — the hand calculation on the fixtures', () => {
  it('02a raw: escalated at +58, 6 174 m out — standoff +1 174 m, 66 s before the entry at +124, one look', () => {
    expect(metricsOf('S03-02a-raw-1.json')).toEqual({
      subject: 'S03',
      scenario: '02a',
      mode: 'raw',
      run: 1,
      build: '2.60.0+efac241-dirty',
      began_at: '2026-09-15T23:38:09.494Z',
      freezeT: 58,
      standoffM: 1174,
      timeToEscalateS: 58,
      miss: false,
      falseEscalations: 0,
      looksBeforeFirstCorrect: 1,
      looks: 1,
      entryT: 124,
      answers: { demand: 6, pressure: 7, confidence: 5 },
    })
  })

  it('02a vigil: the same decision, the second look after it counted in looks but not before first correct', () => {
    expect(metricsOf('S03-02a-vigil-1.json')).toMatchObject({
      mode: 'vigil',
      freezeT: 58,
      standoffM: 1174,
      timeToEscalateS: 58,
      miss: false,
      falseEscalations: 0,
      looksBeforeFirstCorrect: 1,
      looks: 2,
      entryT: 124,
    })
  })

  it('02b, both modes: escalated at +58 after the lie began at +30 — 6 153 m out, standoff +1 153 m, 65 s before the entry at +123', () => {
    expect(metricsOf('S04-02b-raw-1.json')).toMatchObject({
      subject: 'S04',
      scenario: '02b',
      mode: 'raw',
      build: '2.60.0+c9c80e3',
      freezeT: 58,
      standoffM: 1153,
      timeToEscalateS: 58,
      miss: false,
      falseEscalations: 0,
      looksBeforeFirstCorrect: 1,
      looks: 1,
      entryT: 123,
    })
    expect(metricsOf('S04-02b-vigil-1.json')).toMatchObject({
      mode: 'vigil',
      standoffM: 1153,
      looksBeforeFirstCorrect: 1,
      looks: 2,
      entryT: 123,
    })
  })
})

describe('runMetrics — the definitions', () => {
  it('a miss freezes at the run’s end with no standoff and no time, every look counted', () => {
    const missed = runMetrics(
      record([
        { t: 10, type: 'select', track: 'inject-12' },
        { t: 200, type: 'select', track: 'inject-13' },
        { t: 300, type: 'assess', track: 'inject-13' },
      ]),
      study.index,
      plans['02a'],
    )
    expect(missed).toMatchObject({
      freezeT: 360,
      standoffM: null,
      timeToEscalateS: null,
      miss: true,
      falseEscalations: 0,
      looksBeforeFirstCorrect: 2,
      looks: 2,
      entryT: 124,
    })
  })

  it('counts a false escalation, and the looks before the threat’s Escalate — the threat’s own included', () => {
    const metrics = runMetrics(
      record([
        { t: 10, type: 'select', track: 'inject-12' },
        { t: 20, type: 'escalate', track: 'inject-12' },
        { t: 50, type: 'select', track: THREAT_ID },
        { t: 100, type: 'escalate', track: THREAT_ID },
        { t: 120, type: 'select', track: 'inject-14' },
        { t: 130, type: 'escalate', track: 'inject-14' },
      ]),
      study.index,
      plans['02a'],
    )
    expect(metrics).toMatchObject({
      freezeT: 100,
      timeToEscalateS: 100,
      miss: false,
      falseEscalations: 2,
      looksBeforeFirstCorrect: 2,
      looks: 3,
    })
    // The standoff at +100 on 02a: inside 6 174 m and outside the ring still.
    expect(metrics.standoffM).toBeGreaterThan(0)
    expect(metrics.standoffM).toBeLessThan(1174)
  })

  it('counts a look tied with the Escalate on one second — the record writes the look first (#150 round 1)', () => {
    const tied = runMetrics(
      record([
        { t: 10, type: 'select', track: 'inject-12' },
        { t: 100, type: 'select', track: THREAT_ID },
        { t: 100, type: 'escalate', track: THREAT_ID },
        { t: 100, type: 'select', track: 'inject-13' },
      ]),
      study.index,
      plans['02a'],
    )
    expect(tied).toMatchObject({ freezeT: 100, looksBeforeFirstCorrect: 2, looks: 3 })
  })

  it('reads the standoff negative inside the ring, and throws for an Escalate on a tick the threat is not in the picture', () => {
    const inside = runMetrics(
      record([{ t: 200, type: 'escalate', track: THREAT_ID }]),
      study.index,
      plans['02a'],
    )
    expect(inside.standoffM).toBeLessThan(0)
    expect(() =>
      runMetrics(record([{ t: 0, type: 'escalate', track: THREAT_ID }]), study.index, plans['02a']),
    ).toThrow('S09 run 1: the threat inject-11 is not in the picture at t 0')
  })
})
