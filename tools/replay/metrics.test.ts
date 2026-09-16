import { describe, expect, it } from 'vitest'
import { THREAT_ID } from '../../scripts/study.ts'
import { SCENARIO_03A } from '../../src/config/scenarios/03a.ts'
import { at, silentAt } from '../../src/config/scenarios/cast.ts'
import { STUDY } from '../../src/config/study.ts'
import { planScenario } from '../../src/lib/injects.ts'
import { pictureAt } from '../../src/lib/replay.ts'
import type { RunEvent, RunRecord } from '../../src/lib/run.ts'
import { loadStudy, planFor, readRun } from './load.ts'
import { BEYOND_S, runMetrics, threatsOf } from './metrics.ts'
import { entrySecondOf } from './regenerate.ts'

// Vitest runs from the repo root, as the tool does; the fixtures are named from there.
const fixturePath = (name: string) => `tools/replay/__fixtures__/${name}`
const study = loadStudy()
const plans = {
  '02a': planFor('02a', study.timeline),
  '02b': planFor('02b', study.timeline),
  '03a': planFor('03a', study.timeline),
  '03b': planFor('03b', study.timeline),
}
type Study = keyof typeof plans
const metricsOf = (name: string) => {
  const record = readRun(fixturePath(name))
  return runMetrics(record, study.index, plans[record.scenario as Study])
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
      runS: 360,
      threats: [
        {
          id: 'inject-11',
          firstOpenS: 14,
          timeToEscalateS: 58,
          standoffM: 1174,
          miss: false,
          entryT: 124,
        },
      ],
      freezeT: 58,
      standoffM: 1174,
      timeToEscalateS: 58,
      miss: false,
      falseEscalations: 0,
      escalationsOfLaterEntrants: 0,
      looksBeforeFirstCorrect: 1,
      looks: 1,
      openedBeforeFirstThreat: 0,
      orderCorrect: null,
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

describe('the attention numbers on two threats (S5c-i, #138 re-gate; the owner note and its addendum)', () => {
  const on03a = (events: RunEvent[], patch: Partial<RunRecord> = {}) =>
    runMetrics(
      record(events, { scenario: '03a', mode: 'raw', ...patch }),
      study.index,
      plans['03a'],
    )
  // The S05 03a raw shape of the re-gate: two baits first, threat 2 before threat 1, a band row.
  const shape: RunEvent[] = [
    { t: 12, type: 'select', track: 'inject-13' },
    { t: 27, type: 'select', track: 'inject-14' },
    { t: 41, type: 'select', track: 'inject-12' },
    { t: 58, type: 'escalate', track: 'inject-12' },
    { t: 66, type: 'select', track: 'inject-42' },
    { t: 84, type: 'select', track: 'inject-11' },
    { t: 97, type: 'escalate', track: 'inject-11' },
    { t: 130, type: 'select', track: 'inject-41' },
    { t: 150, type: 'escalate', track: 'inject-41' },
  ]

  it('reads the threat set from the bench’s roles table, in its row order — never a list of its own (N1)', () => {
    expect(threatsOf('02a')).toEqual(['inject-11'])
    expect(threatsOf('02b')).toEqual(['inject-11'])
    expect(threatsOf('03a')).toEqual(['inject-11', 'inject-12'])
    expect(threatsOf('03b')).toEqual(['inject-11', 'inject-12'])
    expect(() => threatsOf('02c')).toThrow('02c: not a study scenario the bench knows')
  })

  it('carries one entry per threat, freezes at the last escalation, and keeps the S5a fields as threat 1’s (N3, E3)', () => {
    const m = on03a(shape)
    expect(m.runS).toBe(218)
    expect(m.threats.map((threat) => threat.id)).toEqual(['inject-11', 'inject-12'])
    expect(m.threats[0]).toMatchObject({
      firstOpenS: 84,
      timeToEscalateS: 97,
      miss: false,
      entryT: 102,
    })
    expect(m.threats[1]).toMatchObject({
      firstOpenS: 41,
      timeToEscalateS: 58,
      miss: false,
      entryT: 188,
    })
    // Standoff against the cast's speeds: 25 kt for 5 s before the entry, 12 kt for 130 s.
    expect(m.threats[0].standoffM).toBeGreaterThan(40)
    expect(m.threats[0].standoffM).toBeLessThan(80)
    expect(m.threats[1].standoffM).toBeGreaterThan(760)
    expect(m.threats[1].standoffM).toBeLessThan(830)
    expect(m.freezeT).toBe(97)
    expect(m).toMatchObject({
      standoffM: m.threats[0].standoffM,
      timeToEscalateS: 97,
      miss: false,
      entryT: 102,
    })
  })

  it('counts the distinct non-threats opened before any threat, and the looks before the first Escalate on either (N4, E4)', () => {
    const m = on03a(shape)
    expect(m.openedBeforeFirstThreat).toBe(2)
    expect(m.looksBeforeFirstCorrect).toBe(3)
    expect(m.looks).toBe(6)
    // Distinct: the hover opened twice is one; with no threat ever opened, every non-threat counts.
    const noThreat = on03a([
      { t: 12, type: 'select', track: 'inject-13' },
      { t: 40, type: 'select', track: 'inject-13' },
      { t: 60, type: 'select', track: 'inject-14' },
    ])
    expect(noThreat.openedBeforeFirstThreat).toBe(2)
    expect(noThreat.looksBeforeFirstCorrect).toBe(3)
    expect(noThreat).toMatchObject({ miss: true, freezeT: 218, orderCorrect: null })
    expect(noThreat.threats.map((threat) => threat.miss)).toEqual([true, true])
  })

  it('classes every non-threat escalation by its ring entry over the recording: never entering is false, entering after the run is a later entrant, folded into neither (the addendum)', () => {
    const m = on03a(shape)
    // inject-41 enters at Begin + 419, past the window of 218 and inside the recording.
    expect(m).toMatchObject({ falseEscalations: 0, escalationsOfLaterEntrants: 1 })
    const hover = on03a([
      { t: 10, type: 'select', track: 'inject-13' },
      { t: 20, type: 'escalate', track: 'inject-13' },
      { t: 30, type: 'select', track: 'inject-14' },
      { t: 40, type: 'escalate', track: 'inject-14' },
      { t: 50, type: 'select', track: 'inject-42' },
      { t: 60, type: 'escalate', track: 'inject-42' },
    ])
    // The hover and the tangential never enter; inject-42 enters at Begin + 392.
    expect(hover).toMatchObject({ falseEscalations: 2, escalationsOfLaterEntrants: 1 })
  })

  it('reads the order three-valued: true or false once every threat is escalated, null before (N4, #153)', () => {
    expect(on03a(shape).orderCorrect).toBe(false)
    expect(
      on03a([
        { t: 11, type: 'select', track: 'inject-11' },
        { t: 38, type: 'escalate', track: 'inject-11' },
        { t: 52, type: 'select', track: 'inject-12' },
        { t: 71, type: 'escalate', track: 'inject-12' },
      ]),
    ).toMatchObject({ orderCorrect: true, freezeT: 71, openedBeforeFirstThreat: 0 })
    const oneMissed = on03a([
      { t: 11, type: 'select', track: 'inject-11' },
      { t: 38, type: 'escalate', track: 'inject-11' },
    ])
    expect(oneMissed).toMatchObject({ orderCorrect: null, freezeT: 218, miss: false })
    expect(oneMissed.threats[1]).toMatchObject({ miss: true, firstOpenS: null, standoffM: null })
  })

  it('throws in words for a non-threat inside the ring within the run, and for one whose plan enters the ring past the recording’s end (E5, extended)', () => {
    const rows = SCENARIO_03A.cast!
    const T0 = STUDY.beginS
    const withRow13 = (row: (typeof rows)[number]) =>
      planScenario(study.timeline, {
        ...SCENARIO_03A,
        cast: [rows[0], rows[1], row, ...rows.slice(3)],
      })
    const escalate13 = record(
      [
        { t: 5, type: 'select', track: 'inject-13' },
        { t: 10, type: 'escalate', track: 'inject-13' },
      ],
      { scenario: '03a', mode: 'raw' },
    )
    // A 20 kt inbound at 5.3 km enters the ring about half a minute after Begin.
    expect(() =>
      runMetrics(escalate13, study.index, withRow13(silentAt(at(100, 5.3), 280, 20, T0))),
    ).toThrow(
      /S09 run 1: inject-13 is not a threat but is inside the ring within the run \(entry \d+ s from Begin\) — neither a never-entrant nor a later entrant/,
    )
    // An 8 kt inbound at 12 km reaches the ring some 1 700 s after Begin — past the recording's
    // 1 185 s, inside the hour the plan is read for (BEYOND_S).
    expect(BEYOND_S).toBe(3600)
    expect(() =>
      runMetrics(escalate13, study.index, withRow13(silentAt(at(100, 12), 280, 8, T0))),
    ).toThrow(
      /S09 run 1: inject-13 is not a threat but is on an entering course — its entry lies \d+ s past the recording's end — not a never-entrant, so never a false escalation/,
    )
    // The hover row as cut: a false escalation, no throw.
    expect(runMetrics(escalate13, study.index, plans['03a']).falseEscalations).toBe(1)
  })
})

describe('runMetrics — the hand calculation on the 03 fixtures (S5c-i, #138 re-gate, ruled E9)', () => {
  // Four real headless runs on the prioritization pair, the four event shapes the re-gate named;
  // the entries are the S7b baselines' (582 / 668 on 03a, 586 / 629 on 03b, from Begin at 480),
  // the standoffs the cast's speeds over the seconds to entry.
  it('S05 03a raw: two baits opened first, threat 2 escalated before threat 1, a band row escalated — order ✗, one later entrant', () => {
    expect(metricsOf('S05-03a-raw-1.json')).toEqual({
      subject: 'S05',
      scenario: '03a',
      mode: 'raw',
      run: 1,
      build: '2.60.0+80c9a10',
      began_at: '2026-09-16T17:42:37.615Z',
      runS: 218,
      threats: [
        // 25 kt for the 5 s to its entry at 1:42: 64 m on the ground, 60 on the second.
        {
          id: 'inject-11',
          firstOpenS: 84,
          timeToEscalateS: 97,
          standoffM: 60,
          miss: false,
          entryT: 102,
        },
        // 12 kt for the 130 s to its entry at 3:08: 802 m on the ground, 793 on the second.
        {
          id: 'inject-12',
          firstOpenS: 41,
          timeToEscalateS: 58,
          standoffM: 793,
          miss: false,
          entryT: 188,
        },
      ],
      freezeT: 97,
      standoffM: 60,
      timeToEscalateS: 97,
      miss: false,
      falseEscalations: 0,
      // inject-41 enters at Begin + 419, after the window of 218 and inside the recording.
      escalationsOfLaterEntrants: 1,
      // The looks at 0:12, 0:27, and 0:41 precede the first Escalate on either threat at 0:58.
      looksBeforeFirstCorrect: 3,
      looks: 6,
      // The hover and the tangential, before threat 2's open at 0:41.
      openedBeforeFirstThreat: 2,
      orderCorrect: false,
      entryT: 102,
      answers: { demand: 5, pressure: 6, confidence: 4 },
    })
  })

  it('S05 03a Vigil: in order, the hover opened after — 0 before the first threat, order ✓, frozen at the second escalation', () => {
    expect(metricsOf('S05-03a-vigil-1.json')).toMatchObject({
      runS: 218,
      threats: [
        // 25 kt for 64 s: 823 m on the ground.
        {
          id: 'inject-11',
          firstOpenS: 11,
          timeToEscalateS: 38,
          standoffM: 814,
          miss: false,
          entryT: 102,
        },
        // 12 kt for 117 s: 722 m.
        {
          id: 'inject-12',
          firstOpenS: 52,
          timeToEscalateS: 71,
          standoffM: 714,
          miss: false,
          entryT: 188,
        },
      ],
      freezeT: 71,
      standoffM: 814,
      timeToEscalateS: 38,
      miss: false,
      falseEscalations: 0,
      escalationsOfLaterEntrants: 0,
      looksBeforeFirstCorrect: 1,
      looks: 3,
      openedBeforeFirstThreat: 0,
      orderCorrect: true,
      entryT: 102,
    })
  })

  it('S06 03b raw: a band row and the hover escalated, threat 1 escalated after its entry, threat 2 never opened — false 1, later 1, MISSED, order empty', () => {
    expect(metricsOf('S06-03b-raw-1.json')).toMatchObject({
      runS: 179,
      threats: [
        // 12 kt for the 12 s after its entry at 1:46: 74 m inside.
        {
          id: 'inject-11',
          firstOpenS: 95,
          timeToEscalateS: 118,
          standoffM: -75,
          miss: false,
          entryT: 106,
        },
        {
          id: 'inject-12',
          firstOpenS: null,
          timeToEscalateS: null,
          standoffM: null,
          miss: true,
          entryT: 149,
        },
      ],
      freezeT: 179,
      standoffM: -75,
      timeToEscalateS: 118,
      miss: false,
      // inject-13 hovers and never enters; inject-42 enters at Begin + 392.
      falseEscalations: 1,
      escalationsOfLaterEntrants: 1,
      looksBeforeFirstCorrect: 3,
      looks: 4,
      openedBeforeFirstThreat: 2,
      orderCorrect: null,
      entryT: 106,
    })
  })

  it('S06 03b Vigil: in order with a band row opened between — 0 before the first threat, order ✓', () => {
    expect(metricsOf('S06-03b-vigil-1.json')).toMatchObject({
      runS: 179,
      threats: [
        // 12 kt for 76 s: 469 m.
        {
          id: 'inject-11',
          firstOpenS: 9,
          timeToEscalateS: 30,
          standoffM: 465,
          miss: false,
          entryT: 106,
        },
        // 25 kt for 61 s: 784 m.
        {
          id: 'inject-12',
          firstOpenS: 61,
          timeToEscalateS: 88,
          standoffM: 775,
          miss: false,
          entryT: 149,
        },
      ],
      freezeT: 88,
      standoffM: 465,
      timeToEscalateS: 30,
      falseEscalations: 0,
      escalationsOfLaterEntrants: 0,
      looksBeforeFirstCorrect: 1,
      looks: 3,
      openedBeforeFirstThreat: 0,
      orderCorrect: true,
      entryT: 106,
    })
  })
})

describe('the attention numbers — round 1 (#159)', () => {
  const on03a = (events: RunEvent[]) =>
    runMetrics(record(events, { scenario: '03a', mode: 'raw' }), study.index, plans['03a'])
  const plan = plans['03a']
  const durationS = study.index.durationS

  it('classes an escalated real aircraft from the recording: inside the run throws, never entering is false, entering after the run is a later entrant', () => {
    // A PHL arrival crossing the ring inside the run: the third class, refused in words.
    expect(entrySecondOf(study.index, plan, 'adsb-a43667', 0, durationS)).toBe(527)
    expect(() =>
      on03a([
        { t: 10, type: 'select', track: 'adsb-a43667' },
        { t: 20, type: 'escalate', track: 'adsb-a43667' },
      ]),
    ).toThrow(
      'S09 run 1: adsb-a43667 is not a threat but is inside the ring within the run (entry 47 s from Begin) — neither a never-entrant nor a later entrant',
    )
    // Real tracks in the picture at Begin + 10, classed by the recording's own positions.
    const real = pictureAt(study.index, STUDY.beginS + 10)
    const entries = real.map(
      (track) => [track.id, entrySecondOf(study.index, plan, track.id, 0, durationS)] as const,
    )
    const never = entries.find(([, entry]) => entry === null)!
    const later = entries.find(([, entry]) => entry !== null && entry - STUDY.beginS > 218)!
    expect(never).toBeDefined()
    expect(later).toBeDefined()
    expect(
      on03a([
        { t: 10, type: 'select', track: never[0] },
        { t: 12, type: 'escalate', track: never[0] },
      ]),
    ).toMatchObject({ falseEscalations: 1, escalationsOfLaterEntrants: 0 })
    expect(
      on03a([
        { t: 10, type: 'select', track: later[0] },
        { t: 12, type: 'escalate', track: later[0] },
      ]),
    ).toMatchObject({ falseEscalations: 0, escalationsOfLaterEntrants: 1 })
  })

  it('settles a tie between a bait’s open and the first threat’s open by record position, as every tie is', () => {
    expect(
      on03a([
        { t: 41, type: 'select', track: 'inject-13' },
        { t: 41, type: 'select', track: 'inject-12' },
      ]).openedBeforeFirstThreat,
    ).toBe(1)
    expect(
      on03a([
        { t: 41, type: 'select', track: 'inject-12' },
        { t: 41, type: 'select', track: 'inject-13' },
      ]).openedBeforeFirstThreat,
    ).toBe(0)
  })

  it('reads the order of two escalations on one second from their positions in the record', () => {
    const inOrder = on03a([
      { t: 10, type: 'select', track: 'inject-11' },
      { t: 12, type: 'select', track: 'inject-12' },
      { t: 20, type: 'escalate', track: 'inject-11' },
      { t: 20, type: 'escalate', track: 'inject-12' },
    ])
    expect(inOrder.orderCorrect).toBe(true)
    const reversed = on03a([
      { t: 10, type: 'select', track: 'inject-11' },
      { t: 12, type: 'select', track: 'inject-12' },
      { t: 20, type: 'escalate', track: 'inject-12' },
      { t: 20, type: 'escalate', track: 'inject-11' },
    ])
    expect(reversed.orderCorrect).toBe(false)
  })

  it('holds the roles table’s row order to entry order: a table whose rows enter out of order throws in words', () => {
    const rows = SCENARIO_03A.cast!
    const swapped = planScenario(study.timeline, {
      ...SCENARIO_03A,
      cast: [rows[1], rows[0], ...rows.slice(2)],
    })
    expect(() =>
      runMetrics(
        record([{ t: 5, type: 'select', track: 'inject-11' }], { scenario: '03a', mode: 'raw' }),
        study.index,
        swapped,
      ),
    ).toThrow(
      "03a: the roles table's row order is not entry order — inject-11 enters 188, inject-12 enters 102 (seconds from Begin)",
    )
  })
})
