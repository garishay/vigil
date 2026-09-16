/**
 * The study's CSV (S5a, #138, ruled A7): one row per run, the columns in one order, sorted by
 * subject, then run, then scenario and mode — a subject's runs read down the page. A missing
 * number (a miss's standoff) is an empty cell; a boolean reads true or false; a string that
 * carries a comma, a quote, or a newline is quoted the CSV way.
 */

import type { RunMetrics } from './metrics.ts'

export const CSV_COLUMNS = [
  'subject',
  'scenario',
  'mode',
  'run',
  'build',
  'began_at',
  'freeze_t',
  'standoff_m',
  'time_to_escalate_s',
  'miss',
  'false_escalations',
  'looks_before_first_correct',
  'looks',
  'entry_t',
  'demand',
  'pressure',
  'confidence',
  'run_s',
  'opened_before_first_threat',
  'escalations_of_later_entrants',
  'order_correct',
  'first_open_s_1',
  'first_open_s_2',
  'time_to_escalate_s_2',
  'standoff_m_2',
  'miss_2',
  'entry_t_2',
] as const

const cell = (value: string | number | boolean | null): string => {
  if (value === null) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export const csvRow = (m: RunMetrics): string =>
  [
    m.subject,
    m.scenario,
    m.mode,
    m.run,
    m.build,
    m.began_at,
    m.freezeT,
    m.standoffM,
    m.timeToEscalateS,
    m.miss,
    m.falseEscalations,
    m.looksBeforeFirstCorrect,
    m.looks,
    m.entryT,
    m.answers.demand,
    m.answers.pressure,
    m.answers.confidence,
    m.runS,
    m.openedBeforeFirstThreat,
    m.escalationsOfLaterEntrants,
    m.orderCorrect,
    m.threats[0]?.firstOpenS ?? null,
    m.threats[1]?.firstOpenS ?? null,
    m.threats[1]?.timeToEscalateS ?? null,
    m.threats[1]?.standoffM ?? null,
    m.threats[1] === undefined ? null : m.threats[1].miss,
    m.threats[1]?.entryT ?? null,
  ]
    .map(cell)
    .join(',')

const byRun = (a: RunMetrics, b: RunMetrics): number =>
  a.subject.localeCompare(b.subject) ||
  a.run - b.run ||
  a.scenario.localeCompare(b.scenario) ||
  a.mode.localeCompare(b.mode)

/** The header and one row per run, sorted, newline-terminated. */
export const csvText = (metrics: readonly RunMetrics[]): string =>
  [CSV_COLUMNS.join(','), ...[...metrics].sort(byRun).map(csvRow)].join('\n') + '\n'
