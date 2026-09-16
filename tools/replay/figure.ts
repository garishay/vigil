/**
 * The study figure (S5d, #138, ruled A7 and N9): one SVG over every run of the study, by
 * family. The corroboration pair (02a, 02b) keeps the dots-on-axis figure as A7 drew it — one
 * dot per run per condition on the standoff axis, the subject code beside each, a miss hollow
 * at the inside end, the counts under it. The prioritization pair (03a, 03b) headlines
 * attention (the #131 amendment): the non-threats opened before any threat on a count axis, each
 * threat's first open on the run's window, the standoff per threat as the second line, and the
 * counts per condition — misses per threat, false escalations, escalations of later entrants on
 * their own line, the order as a count of the runs with every threat escalated. Pure.
 */

import { CONDITION_COLOR, mmss, THEME } from './frame.ts'
import type { RunMetrics } from './metrics.ts'

const FONT = 'system-ui, sans-serif'
const WIDTH = 1000
const PAD = 30
const AXIS_X = 200
const AXIS_W = 700
const BAND_KM = 3

const esc = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const text = (x: number, y: number, content: string, attrs: string): string =>
  `<text x="${x}" y="${y}" font-family="${FONT}" ${attrs}>${esc(content)}</text>`
const round1 = (value: number): number => Math.round(value * 10) / 10
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

type Family = 'corroboration' | 'prioritization'
/** A scenario's family by its name: the 02 pair corroborates, the 03 pair prioritizes. */
export const familyOf = (scenario: string): Family =>
  scenario.startsWith('03') ? 'prioritization' : 'corroboration'

const MODES = ['raw', 'vigil'] as const
const modeWord = (mode: 'raw' | 'vigil') => (mode === 'raw' ? 'raw' : 'Vigil')

/** One dot with its subject code beside it, offset so two on one x read apart. */
const dot = (x: number, y: number, color: string, label: string, cls: string, hollow = false) =>
  [
    `<circle class="${cls}" cx="${x}" cy="${y}" r="5" fill="${hollow ? 'none' : color}" stroke="${color}" stroke-width="2"/>`,
    text(x, y - 9, label, `font-size="10" fill="${THEME.muted}" text-anchor="middle"`),
  ].join('\n')

/** An axis with a title and end labels; returns its lines. */
const axis = (y: number, title: string, left: string, right: string): string[] => [
  text(
    PAD,
    y - 22,
    title,
    `class="axis-title" font-size="13" font-weight="600" fill="${THEME.text}"`,
  ),
  `<line class="axis" x1="${AXIS_X}" y1="${y}" x2="${AXIS_X + AXIS_W}" y2="${y}" stroke="${THEME.faint}"/>`,
  text(AXIS_X, y + 24, left, `font-size="11" fill="${THEME.faint}"`),
  text(AXIS_X + AXIS_W, y + 24, right, `font-size="11" fill="${THEME.faint}" text-anchor="end"`),
]

/** The standoff axis with one dot per run per condition — the corroboration figure, and the pair's second line per threat. */
function standoffAxis(
  y: number,
  title: string,
  runs: readonly RunMetrics[],
  threatIndex: number,
): string[] {
  const sX = (m: number) => round1(AXIS_X + ((m + BAND_KM * 1000) / (2 * BAND_KM * 1000)) * AXIS_W)
  const lines = axis(y, title, `← inside · −${BAND_KM} km`, `+${BAND_KM} km · outside →`)
  lines.push(
    `<line x1="${sX(0)}" y1="${y - 10}" x2="${sX(0)}" y2="${y + 10}" stroke="${THEME.muted}"/>`,
    text(sX(0), y + 24, 'ring', `font-size="11" fill="${THEME.muted}" text-anchor="middle"`),
  )
  for (const mode of MODES) {
    const dy = mode === 'raw' ? -12 : 12
    lines.push(
      text(
        AXIS_X - 12,
        y + dy + 4,
        modeWord(mode),
        `font-size="11" fill="${CONDITION_COLOR[mode]}" text-anchor="end"`,
      ),
    )
    for (const m of runs.filter((run) => run.mode === mode)) {
      const threat = m.threats[threatIndex]
      if (!threat) continue
      const label = `${m.subject}`
      if (threat.standoffM === null) {
        lines.push(
          dot(AXIS_X + 6, y + dy, CONDITION_COLOR[mode], label, `standoff-miss-${mode}`, true),
        )
        continue
      }
      const clamped = Math.max(-BAND_KM * 1000, Math.min(BAND_KM * 1000, threat.standoffM))
      lines.push(dot(sX(clamped), y + dy, CONDITION_COLOR[mode], label, `standoff-${mode}`))
    }
  }
  return lines
}

/** A count axis, 0 to `max`, one dot per run per condition. */
function countAxis(
  y: number,
  title: string,
  runs: readonly RunMetrics[],
  value: (m: RunMetrics) => number,
): string[] {
  const max = Math.max(2, ...runs.map(value))
  const cX = (n: number) => round1(AXIS_X + (n / max) * AXIS_W)
  const lines = axis(y, title, '0', String(max))
  for (let n = 0; n <= max; n++) {
    lines.push(
      `<line x1="${cX(n)}" y1="${y - 3}" x2="${cX(n)}" y2="${y + 3}" stroke="${THEME.faint}"/>`,
    )
  }
  for (const mode of MODES) {
    const dy = mode === 'raw' ? -12 : 12
    lines.push(
      text(
        AXIS_X - 12,
        y + dy + 4,
        modeWord(mode),
        `font-size="11" fill="${CONDITION_COLOR[mode]}" text-anchor="end"`,
      ),
    )
    for (const m of runs.filter((run) => run.mode === mode)) {
      lines.push(dot(cX(value(m)), y + dy, CONDITION_COLOR[mode], m.subject, `count-${mode}`))
    }
  }
  return lines
}

/** A time axis over the family's longest window, one dot per run per condition; a never-opened threat hollow at the end. */
function timeAxis(
  y: number,
  title: string,
  runs: readonly RunMetrics[],
  runS: number,
  value: (m: RunMetrics) => number | null,
): string[] {
  const tX = (s: number) => round1(AXIS_X + (s / runS) * AXIS_W)
  const lines = axis(y, title, '0:00', mmss(runS))
  for (const s of [60, 120, 180]) {
    if (s < runS) {
      lines.push(
        `<line x1="${tX(s)}" y1="${y - 3}" x2="${tX(s)}" y2="${y + 3}" stroke="${THEME.faint}"/>`,
        text(tX(s), y + 24, mmss(s), `font-size="11" fill="${THEME.faint}" text-anchor="middle"`),
      )
    }
  }
  for (const mode of MODES) {
    const dy = mode === 'raw' ? -12 : 12
    lines.push(
      text(
        AXIS_X - 12,
        y + dy + 4,
        modeWord(mode),
        `font-size="11" fill="${CONDITION_COLOR[mode]}" text-anchor="end"`,
      ),
    )
    for (const m of runs.filter((run) => run.mode === mode)) {
      const v = value(m)
      if (v === null)
        lines.push(
          dot(tX(runS) - 6, y + dy, CONDITION_COLOR[mode], m.subject, `time-never-${mode}`, true),
        )
      else lines.push(dot(tX(v), y + dy, CONDITION_COLOR[mode], m.subject, `time-${mode}`))
    }
  }
  return lines
}

/** The counts under a family's axes, one line per condition. */
function countsLines(y: number, runs: readonly RunMetrics[], threats: number): string[] {
  return MODES.map((mode, i) => {
    const of = runs.filter((run) => run.mode === mode)
    const misses = Array.from(
      { length: threats },
      (_, t) => of.filter((m) => m.threats[t]?.miss).length,
    )
    const items = [
      `${plural(of.length, 'run')}`,
      threats > 1
        ? `misses ${misses.map((n, t) => `threat ${t + 1} ${n}`).join(' · ')}`
        : `misses ${misses[0] ?? 0}`,
      `false escalations ${of.reduce((sum, m) => sum + m.falseEscalations, 0)}`,
      `escalations of later entrants ${of.reduce((sum, m) => sum + m.escalationsOfLaterEntrants, 0)}`,
      ...(threats > 1
        ? [
            `order correct ${of.filter((m) => m.orderCorrect === true).length} of ${of.filter((m) => m.orderCorrect !== null).length} with both escalated`,
          ]
        : []),
    ]
    return text(
      PAD,
      y + i * 18,
      `${modeWord(mode)}: ${items.join(' · ')}`,
      `class="counts-${mode}" font-size="12" fill="${CONDITION_COLOR[mode]}"`,
    )
  })
}

/** The study figure over every run, by family, as an SVG document. */
export function studySvg(runs: readonly RunMetrics[]): string {
  const sorted = [...runs].sort(
    (a, b) =>
      a.subject.localeCompare(b.subject) || a.scenario.localeCompare(b.scenario) || a.run - b.run,
  )
  const corroboration = sorted.filter((m) => familyOf(m.scenario) === 'corroboration')
  const prioritization = sorted.filter((m) => familyOf(m.scenario) === 'prioritization')
  const subjects = new Set(sorted.map((m) => m.subject)).size
  const body: string[] = []
  let y = 60
  body.push(
    text(
      PAD,
      40,
      `Study — ${plural(sorted.length, 'run')} · ${plural(subjects, 'subject')}`,
      `class="title" font-size="20" font-weight="700" fill="${THEME.text}"`,
    ),
  )
  if (corroboration.length > 0) {
    const scenarios = [...new Set(corroboration.map((m) => m.scenario))].join(', ')
    body.push(
      text(
        PAD,
        y + 20,
        `Corroboration pair (${scenarios}) — standoff at decision`,
        `class="family" font-size="15" font-weight="600" fill="${THEME.text}"`,
      ),
    )
    y += 70
    body.push(...standoffAxis(y, 'standoff at the threat’s escalation', corroboration, 0))
    y += 60
    body.push(...countsLines(y, corroboration, 1))
    y += 60
  }
  if (prioritization.length > 0) {
    const scenarios = [...new Set(prioritization.map((m) => m.scenario))].join(', ')
    const threats = Math.max(...prioritization.map((m) => m.threats.length))
    const runS = Math.max(...prioritization.map((m) => m.runS))
    body.push(
      text(
        PAD,
        y + 20,
        `Prioritization pair (${scenarios}) — attention`,
        `class="family" font-size="15" font-weight="600" fill="${THEME.text}"`,
      ),
    )
    y += 70
    body.push(
      ...countAxis(
        y,
        'non-threats opened before the first threat',
        prioritization,
        (m) => m.openedBeforeFirstThreat,
      ),
    )
    y += 80
    for (let t = 0; t < threats; t++) {
      body.push(
        ...timeAxis(
          y,
          `first open of threat ${t + 1} on the run’s window`,
          prioritization,
          runS,
          (m) => m.threats[t]?.firstOpenS ?? null,
        ),
      )
      y += 80
    }
    for (let t = 0; t < threats; t++) {
      body.push(...standoffAxis(y, `standoff at decision · threat ${t + 1}`, prioritization, t))
      y += 80
    }
    body.push(...countsLines(y, prioritization, threats))
    y += 60
  }
  const height = y + 10
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" data-runs="${sorted.length}">`,
    `<rect width="${WIDTH}" height="${height}" fill="${THEME.bg}"/>`,
    ...body,
    '</svg>',
    '',
  ].join('\n')
}
