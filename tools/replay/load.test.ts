import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadStudy, parseRun, planFor, readRun, RunRefusal } from './load.ts'

// Vitest runs from the repo root, as the tool does; the fixtures are named from there.
const FIXTURES = 'tools/replay/__fixtures__/'
const fixture = (name: string) => readFileSync(FIXTURES + name, 'utf8')
const GOOD = JSON.parse(fixture('S03-02a-raw-1.json')) as Record<string, unknown>

/** The refusal's words for a record with one field changed, or null when it parses. */
const refusal = (patch: Record<string, unknown>, path = 'run.json') => {
  try {
    parseRun(JSON.stringify({ ...GOOD, ...patch }), path)
    return null
  } catch (error) {
    expect(error).toBeInstanceOf(RunRefusal)
    return (error as Error).message
  }
}
const withEvent = (event: unknown) => ({ events: [...(GOOD.events as unknown[]), event] })

describe('parseRun (S5a, #138, ruled A2)', () => {
  it('reads a run S4b wrote, byte for byte from the clipboard', () => {
    const run = parseRun(fixture('S03-02a-raw-1.json'), 'S03-02a-raw-1.json')
    expect(run).toEqual({
      subject: 'S03',
      scenario: '02a',
      mode: 'raw',
      run: 1,
      build: '2.60.0+efac241-dirty',
      began_at: '2026-09-15T23:38:09.494Z',
      events: [
        { t: 14, type: 'select', track: 'inject-11' },
        { t: 49, type: 'assess', track: 'inject-11' },
        { t: 58, type: 'escalate', track: 'inject-11' },
      ],
      answers: { demand: 6, pressure: 7, confidence: 5 },
    })
    expect(readRun(FIXTURES + 'S03-02a-vigil-1.json').mode).toBe('vigil')
  })

  it('refuses what is not a run, naming the path and the field', () => {
    expect(() => parseRun('{', 'bad.json')).toThrow(/^bad\.json: not JSON — /)
    expect(() => parseRun('[]', 'bad.json')).toThrow('bad.json: a run is one JSON object')
    expect(refusal({ events: undefined })).toBe('run.json: "events" is missing')
    expect(refusal({ subject: 'Gary Smith' })).toBe(
      'run.json: subject is a subject code, not "Gary Smith"',
    )
    expect(refusal({ scenario: '02c' })).toBe(
      'run.json: scenario "02c" — the registry knows default, 02a, 02b',
    )
    expect(refusal({ mode: 'fast' })).toBe('run.json: mode reads "fast", not raw or vigil')
    expect(refusal({ run: 0 })).toBe('run.json: run is a run number from 1, not 0')
    expect(refusal({ run: 1.5 })).toBe('run.json: run is a run number from 1, not 1.5')
    expect(refusal({ run: '1' })).toBe('run.json: run is a run number from 1, not "1"')
    expect(refusal({ build: '' })).toBe('run.json: build is the build string, not ""')
    expect(refusal({ began_at: 'yesterday' })).toBe(
      'run.json: began_at is an ISO time, not "yesterday"',
    )
    expect(refusal({ events: {} })).toBe('run.json: events is a list')
    expect(refusal(withEvent('select'))).toBe('run.json: events[3] is an object {t, type, track}')
    expect(refusal(withEvent({ t: 361, type: 'select', track: 'inject-11' }))).toBe(
      "run.json: events[3].t is 361 — a run's t runs 0 to 360",
    )
    expect(refusal(withEvent({ t: 1.5, type: 'select', track: 'inject-11' }))).toBe(
      "run.json: events[3].t is 1.5 — a run's t runs 0 to 360",
    )
    expect(refusal(withEvent({ t: 3, type: 'resolve', track: 'inject-11' }))).toBe(
      'run.json: events[3].type reads "resolve", not select | assess | escalate | dismiss | alert_ack',
    )
    expect(refusal(withEvent({ t: 3, type: 'select', track: '' }))).toBe(
      'run.json: events[3].track is a track id, not ""',
    )
    expect(refusal({ answers: [] })).toBe('run.json: answers is an object of the three questions')
    expect(refusal({ answers: { demand: 6, pressure: 7 } })).toBe(
      'run.json: answers.confidence is undefined — an answer is 1 to 10',
    )
    expect(refusal({ answers: { demand: 11, pressure: 7, confidence: 5 } })).toBe(
      'run.json: answers.demand is 11 — an answer is 1 to 10',
    )
    expect(refusal({ answers: { demand: 6, pressure: 7.5, confidence: 5 } })).toBe(
      'run.json: answers.pressure is 7.5 — an answer is 1 to 10',
    )
  })
})

describe('loadStudy and planFor', () => {
  it('loads the study recording indexed on its own frame grid, and plans a scenario on it from its seed', () => {
    const study = loadStudy()
    expect(study.recording.entry.id).toBe('vigil-phl-002')
    expect(study.index.durationS).toBe(1185)
    expect(study.timeline.intervalMs).toBe(15000)
    expect(study.timeline.frameTimesMs).toHaveLength(80)
    expect(planFor('02a', study.timeline).seed).toBe('study-02a')
    expect(planFor('02b', study.timeline).seed).toBe('study-02b')
    expect(planFor('02a', study.timeline)).toEqual(planFor('02a', study.timeline))
  })
})
