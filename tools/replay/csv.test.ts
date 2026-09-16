import { describe, expect, it } from 'vitest'
import { CSV_COLUMNS, csvRow, csvText } from './csv.ts'
import type { RunMetrics } from './metrics.ts'

const row = (patch: Partial<RunMetrics> = {}): RunMetrics => ({
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
  ...patch,
})

describe('the study CSV (S5a, #138, ruled A7)', () => {
  it('prints the columns in one order and a fixture’s row exactly', () => {
    expect(CSV_COLUMNS.join(',')).toBe(
      'subject,scenario,mode,run,build,began_at,freeze_t,standoff_m,time_to_escalate_s,miss,false_escalations,looks_before_first_correct,looks,entry_t,demand,pressure,confidence,run_s,opened_before_first_threat,escalations_of_later_entrants,order_correct,first_open_s_1,first_open_s_2,time_to_escalate_s_2,standoff_m_2,miss_2,entry_t_2',
    )
    // The seventeen S5a cells in place, then the window, the attention numbers, and threat 2's
    // cells empty on a one-threat cast (S5c-i, ruled E2).
    expect(csvRow(row())).toBe(
      'S03,02a,raw,1,2.60.0+efac241-dirty,2026-09-15T23:38:09.494Z,58,1174,58,false,0,1,1,124,6,7,5,360,0,0,,14,,,,,',
    )
  })

  it('leaves a miss’s standoff and time empty, and quotes a cell that needs it', () => {
    expect(csvRow(row({ freezeT: 360, standoffM: null, timeToEscalateS: null, miss: true }))).toBe(
      'S03,02a,raw,1,2.60.0+efac241-dirty,2026-09-15T23:38:09.494Z,360,,,true,0,1,1,124,6,7,5,360,0,0,,14,,,,,',
    )
    expect(csvRow(row({ build: 'a,"b"' }))).toContain(',"a,""b""",')
  })

  it('sorts by subject, then run, then scenario and mode, newline-terminated', () => {
    const text = csvText([
      row({ subject: 'S04', run: 1, mode: 'vigil' }),
      row({ subject: 'S03', run: 2, scenario: '02b' }),
      row({ subject: 'S04', run: 1, mode: 'raw' }),
      row({ subject: 'S03', run: 1 }),
    ])
    const lines = text.split('\n')
    expect(lines[0]).toBe(CSV_COLUMNS.join(','))
    expect(lines.slice(1, 5).map((line) => line.split(',').slice(0, 4).join(','))).toEqual([
      'S03,02a,raw,1',
      'S03,02b,raw,2',
      'S04,02a,raw,1',
      'S04,02a,vigil,1',
    ])
    expect(text.endsWith('\n')).toBe(true)
    expect(lines).toHaveLength(6)
  })
})

describe('the study CSV on two threats (S5c-i, #138 re-gate, ruled E2)', () => {
  const two = (patch: Partial<RunMetrics> = {}) =>
    row({
      subject: 'S05',
      scenario: '03a',
      build: 'test',
      began_at: '2026-09-16T18:00:00.000Z',
      runS: 218,
      threats: [
        {
          id: 'inject-11',
          firstOpenS: 84,
          timeToEscalateS: 97,
          standoffM: 60,
          miss: false,
          entryT: 102,
        },
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
      falseEscalations: 0,
      escalationsOfLaterEntrants: 1,
      looksBeforeFirstCorrect: 3,
      looks: 6,
      openedBeforeFirstThreat: 2,
      orderCorrect: false,
      entryT: 102,
      answers: { demand: 5, pressure: 6, confidence: 4 },
      ...patch,
    })

  it('prints threat 1 in the S5a cells and threat 2 in the _2 cells, the order three-valued', () => {
    expect(csvRow(two())).toBe(
      'S05,03a,raw,1,test,2026-09-16T18:00:00.000Z,97,60,97,false,0,3,6,102,5,6,4,218,2,1,false,84,41,58,793,false,188',
    )
    const missedSecond = two({
      threats: [
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
      orderCorrect: null,
      runS: 179,
      entryT: 106,
    })
    expect(csvRow(missedSecond)).toBe(
      'S05,03a,raw,1,test,2026-09-16T18:00:00.000Z,179,-75,118,false,0,3,6,106,5,6,4,179,2,1,,95,,,,true,149',
    )
    expect(csvRow(two({ orderCorrect: true }))).toContain(',218,2,1,true,84,')
  })
})
