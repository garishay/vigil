import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseResults, parseRun, planFor, RunRefusal, runSOf, runsIn } from './load.ts'
import { loadStudy, readRuns } from './files.ts'

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
    expect(readRuns(FIXTURES + 'S03-02a-vigil-1.json')[0].mode).toBe('vigil')
  })

  it('refuses what is not a run, naming the path and the field', () => {
    expect(() => parseRun('{', 'bad.json')).toThrow(/^bad\.json: not JSON — /)
    expect(() => parseRun('[]', 'bad.json')).toThrow('bad.json: a run is one JSON object')
    expect(refusal({ events: undefined })).toBe('run.json: "events" is missing')
    expect(refusal({ subject: 'Gary Smith' })).toBe(
      'run.json: subject is a subject code, not "Gary Smith"',
    )
    // A study scenario only: the default deal has no cast, so its run has no threat to measure;
    // every scenario the bench baselines, since S5c-i (#138 re-gate).
    expect(refusal({ scenario: '02c' })).toBe(
      'run.json: scenario "02c" — the replay reads a study scenario: 02a, 02b, 03a, 03b',
    )
    expect(refusal({ scenario: 'default' })).toBe(
      'run.json: scenario "default" — the replay reads a study scenario: 02a, 02b, 03a, 03b',
    )
    expect(refusal({ mode: 'fast' })).toBe('run.json: mode reads "fast", not raw or vigil')
    expect(refusal({ run: 0 })).toBe('run.json: run is a run number from 1, not 0')
    expect(refusal({ run: 1.5 })).toBe('run.json: run is a run number from 1, not 1.5')
    expect(refusal({ run: '1' })).toBe('run.json: run is a run number from 1, not "1"')
    expect(refusal({ build: '' })).toBe('run.json: build is the build string, not ""')
    // The ISO form S4b writes; a bare digit, a locale date, and a normalised impossible date
    // all parse under Date.parse and are refused here (#150 round 1).
    for (const bad of ['yesterday', '1', 'September 16, 2026', '2026-02-30T00:00:00.000Z']) {
      expect(refusal({ began_at: bad })).toBe(
        `run.json: began_at is an ISO time like 2026-09-16T00:31:10.057Z, not ${JSON.stringify(bad)}`,
      )
    }
    expect(refusal({ began_at: '2026-09-16T00:31:10Z' })).toBeNull()
    expect(refusal({ events: {} })).toBe('run.json: events is a list')
    // In t order, as the contract writes them (#150 round 1).
    expect(
      refusal({
        events: [
          { t: 100, type: 'escalate', track: 'inject-11' },
          { t: 50, type: 'select', track: 'inject-11' },
        ],
      }),
    ).toBe("run.json: events[1].t is 50, before events[0].t 100 — a run's events are in t order")
    expect(
      refusal({
        events: [
          { t: 50, type: 'select', track: 'inject-11' },
          { t: 50, type: 'escalate', track: 'inject-11' },
        ],
      }),
    ).toBeNull()
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

describe('the loader on the prioritization pair (S5c-i, #138 re-gate, ruled N2)', () => {
  const on = (scenario: string, t: number) =>
    refusal({ scenario, events: [{ t, type: 'select', track: 'inject-11' }] })

  it('reads a 03 record with the registry’s window as its bound — 218 on both since S7d, 360 on 02', () => {
    expect(runSOf('02a')).toBe(360)
    expect(runSOf('02b')).toBe(360)
    expect(runSOf('03a')).toBe(218)
    expect(runSOf('03b')).toBe(218)
    expect(on('03a', 218)).toBeNull()
    expect(on('03a', 219)).toBe("run.json: events[0].t is 219 — a run's t runs 0 to 218")
    expect(on('03b', 218)).toBeNull()
    expect(on('03b', 219)).toBe("run.json: events[0].t is 219 — a run's t runs 0 to 218")
    expect(on('02b', 360)).toBeNull()
    expect(on('02b', 361)).toBe("run.json: events[0].t is 361 — a run's t runs 0 to 360")
    expect(planFor('03a', loadStudy().timeline).seed).toBe('study-03a')
  })
})

describe('parseResults and runsIn — the results file (S6a-i, #165, ruled A5)', () => {
  const VIGIL = JSON.parse(fixture('S03-02a-vigil-1.json')) as Record<string, unknown>
  const envelope = (patch: Record<string, unknown> = {}) => ({
    subject: 'S03',
    build: GOOD.build,
    runs: [GOOD, { ...VIGIL, run: 2 }],
    ...patch,
  })
  /** The refusal's words for an envelope with one field changed, or null when it parses. */
  const refuseResults = (patch: Record<string, unknown>, path = 'results.json') => {
    try {
      parseResults(JSON.stringify(envelope(patch)), path)
      return null
    } catch (error) {
      expect(error).toBeInstanceOf(RunRefusal)
      return (error as Error).message
    }
  }

  it('reads a subject’s two runs under one envelope, every run through parseRun', () => {
    const results = parseResults(JSON.stringify(envelope()), 'results.json')
    expect(results.subject).toBe('S03')
    expect(results.runs.map((run) => `${run.mode} ${run.run}`)).toEqual(['raw 1', 'vigil 2'])
    // The runs are the loader's own records, not the envelope's raw objects: an event list the
    // loader would refuse in a run file is refused inside an envelope too, naming where it sat.
    expect(refuseResults({ runs: [GOOD, { ...VIGIL, run: 2, scenario: '02c' }] })).toBe(
      'results.json runs[1]: scenario "02c" — the replay reads a study scenario: 02a, 02b, 03a, 03b',
    )
  })

  it('refuses what is not a results file, naming the path and the field', () => {
    expect(() => parseResults('{', 'bad.json')).toThrow(/^bad\.json: not JSON — /)
    expect(() => parseResults('[]', 'bad.json')).toThrow(
      'bad.json: a results file is one JSON object',
    )
    expect(refuseResults({ runs: undefined })).toBe('results.json: "runs" is missing')
    expect(refuseResults({ subject: 'Gary Smith' })).toBe(
      'results.json: subject is a subject code, not "Gary Smith"',
    )
    expect(refuseResults({ build: '' })).toBe('results.json: build is the build string, not ""')
    expect(refuseResults({ runs: [] })).toBe('results.json: runs is a list of runs')
    expect(refuseResults({ runs: {} })).toBe('results.json: runs is a list of runs')
    // The envelope carries nothing the runs do not: a run of another subject, or runs out of run
    // order, is refused rather than resolved by precedence.
    expect(refuseResults({ runs: [GOOD, { ...VIGIL, run: 2, subject: 'S04' }] })).toBe(
      'results.json: runs[1] is subject S04, not S03',
    )
    expect(refuseResults({ runs: [GOOD, VIGIL] })).toBe(
      'results.json: runs[1] is run 1, not after run 1',
    )
    expect(refuseResults({ runs: [{ ...VIGIL, run: 2 }, GOOD] })).toBe(
      'results.json: runs[1] is run 1, not after run 2',
    )
  })

  it('tells the two files apart by the envelope’s own key', () => {
    expect(runsIn(JSON.stringify(envelope()), 'results.json')).toHaveLength(2)
    expect(runsIn(fixture('S03-02a-raw-1.json'), 'run.json')).toHaveLength(1)
    expect(runsIn(fixture('S03-02a-raw-1.json'), 'run.json')[0].mode).toBe('raw')
    // A file with `runs` is read as an envelope and refused as one; a file without it is read as
    // a run, so neither refusal can be reached by guessing at the other shape.
    expect(() => runsIn('{"runs":[]}', 'bad.json')).toThrow('bad.json: "subject" is missing')
    expect(() => runsIn('{"subject":"S03"}', 'bad.json')).toThrow('bad.json: "scenario" is missing')
    expect(() => runsIn('{', 'bad.json')).toThrow(/^bad\.json: not JSON — /)
  })
})
