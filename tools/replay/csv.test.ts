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
    { id: 'inject-11', firstOpenS: 14, timeToEscalateS: 58, standoffM: 1174, miss: false, entryT: 124 },
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
      'subject,scenario,mode,run,build,began_at,freeze_t,standoff_m,time_to_escalate_s,miss,false_escalations,looks_before_first_correct,looks,entry_t,demand,pressure,confidence',
    )
    expect(csvRow(row())).toBe(
      'S03,02a,raw,1,2.60.0+efac241-dirty,2026-09-15T23:38:09.494Z,58,1174,58,false,0,1,1,124,6,7,5',
    )
  })

  it('leaves a miss’s standoff and time empty, and quotes a cell that needs it', () => {
    expect(csvRow(row({ freezeT: 360, standoffM: null, timeToEscalateS: null, miss: true }))).toBe(
      'S03,02a,raw,1,2.60.0+efac241-dirty,2026-09-15T23:38:09.494Z,360,,,true,0,1,1,124,6,7,5',
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
