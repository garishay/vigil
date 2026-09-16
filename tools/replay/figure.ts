/**
 * The study figure (S5d-ii, #138, ruled A7, N9, G4): one SVG over every run of the study, by
 * family. The corroboration pair (02a, 02b) keeps the dots-on-axis figure as A7 drew it — one
 * dot per run per condition on the standoff axis, the subject code beside each, a miss hollow
 * at the inside end, the counts under it. The prioritization pair (03a, 03b) headlines
 * attention (the #131 amendment): the non-threats opened before any threat on a count axis,
 * each threat's first open on the family's longest window, the standoff per threat as the
 * second line, and the counts per condition — misses per threat, false escalations,
 * escalations of later entrants on their own item, the order as a count of the runs with every
 * threat escalated. G4's rules: a raw run reads *unaided*; on a count axis the dots stack at
 * their value, one per run, the subject label beside each; on a continuous axis two dots within
 * a dozen pixels take their labels on alternate sides; a never-opened threat sits hollow at its
 * own run's window end. Pure and deterministic.
 */

import { CONDITION_COLOR, mmss, THEME } from './frame.ts'
import type { RunMetrics } from './metrics.ts'

const FONT = 'system-ui, sans-serif'
const WIDTH = 1000
const PAD = 30
const AXIS_X = 200
const AXIS_W = 700
const BAND_KM = 3
/** A lane's first dot sits this far from the axis; a stack steps this much further. */
const LANE = 12
const STEP = 14
/** Two dots on one lane closer than a label's width take their labels on alternate sides. */
const CROWD_PX = 20
/** The axis title's row above the unaided lane's labels; the tick labels' row below the Vigil lane's. */
const TITLE_UP = 30
const TICKS_DOWN = 42
/** One axis's block, title to tick labels. */
const AXIS_H = 100

const esc = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const text = (x: number, y: number, content: string, attrs: string): string =>
  `<text x="${x}" y="${y}" font-family="${FONT}" ${attrs}>${esc(content)}</text>`
const round1 = (value: number): number => Math.round(value * 10) / 10
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export type Family = 'corroboration' | 'prioritization'
/** A scenario's family by its name: the 02 pair corroborates, the 03 pair prioritizes. */
export const familyOf = (scenario: string): Family =>
  scenario.startsWith('03') ? 'prioritization' : 'corroboration'

const MODES = ['raw', 'vigil'] as const
type Mode = (typeof MODES)[number]
/** The condition's word in the rendered text — *unaided* for a raw run (ruled G4). */
export const modeWord = (mode: Mode): string => (mode === 'raw' ? 'unaided' : 'Vigil')
/** A lane's side of the axis: unaided above, Vigil below. */
const side = (mode: Mode): 1 | -1 => (mode === 'raw' ? -1 : 1)

/** A dot with its subject label: `above` or `below` on a continuous axis, `beside` on a stack. */
const dot = (
  x: number,
  y: number,
  color: string,
  label: string,
  cls: string,
  hollow: boolean,
  labelAt: 'above' | 'below' | 'beside',
): string =>
  [
    `<circle class="${cls}" cx="${x}" cy="${y}" r="5" fill="${hollow ? 'none' : color}" stroke="${color}" stroke-width="2"/>`,
    labelAt === 'beside'
      ? text(round1(x + 9), y + 4, label, `class="label" font-size="10" fill="${THEME.muted}"`)
      : text(
          x,
          labelAt === 'above' ? y - 9 : y + 16,
          label,
          `class="label" font-size="10" fill="${THEME.muted}" text-anchor="middle"`,
        ),
  ].join('\n')

/** An axis's fixed parts: the title, the line, the end labels, the lane words. */
const axis = (y: number, title: string, left: string, right: string, titleY: number): string[] => [
  text(
    PAD,
    titleY,
    title,
    `class="axis-title" font-size="13" font-weight="600" fill="${THEME.text}"`,
  ),
  `<line class="axis" x1="${AXIS_X}" y1="${y}" x2="${AXIS_X + AXIS_W}" y2="${y}" stroke="${THEME.faint}"/>`,
  text(AXIS_X, y + TICKS_DOWN, left, `font-size="11" fill="${THEME.faint}"`),
  text(
    AXIS_X + AXIS_W,
    y + TICKS_DOWN,
    right,
    `font-size="11" fill="${THEME.faint}" text-anchor="end"`,
  ),
  ...MODES.map((mode) =>
    text(
      AXIS_X - 12,
      y + side(mode) * LANE + 4,
      modeWord(mode),
      `class="lane-word" font-size="11" fill="${CONDITION_COLOR[mode]}" text-anchor="end"`,
    ),
  ),
]

interface Placed {
  m: RunMetrics
  x: number
  hollow: boolean
}

/**
 * A continuous axis's dots, one lane per condition: in x order, and where two on one lane fall
 * within a dozen pixels the later takes its label on the other side (ruled G4, P7).
 */
function continuousDots(y: number, placed: readonly Placed[], cls: string): string[] {
  const lines: string[] = []
  for (const mode of MODES) {
    const lane = placed
      .filter(({ m }) => m.mode === mode)
      .sort((a, b) => a.x - b.x || a.m.subject.localeCompare(b.m.subject))
    let lastX = -Infinity
    let flipped = false
    for (const { m, x, hollow } of lane) {
      flipped = x - lastX < CROWD_PX ? !flipped : false
      lastX = x
      const outward = mode === 'raw' ? 'above' : 'below'
      const inward = mode === 'raw' ? 'below' : 'above'
      lines.push(
        dot(
          x,
          y + side(mode) * LANE,
          CONDITION_COLOR[mode],
          m.subject,
          `${cls}-${mode}${hollow ? '-hollow' : ''}`,
          hollow,
          flipped ? inward : outward,
        ),
      )
    }
  }
  return lines
}

/** The standoff axis, −3 … +3 km: one dot per run per condition; a miss hollow at the inside end. */
function standoffAxis(
  y: number,
  titleY: number,
  title: string,
  runs: readonly RunMetrics[],
  threatIndex: number,
): string[] {
  const sX = (m: number) => round1(AXIS_X + ((m + BAND_KM * 1000) / (2 * BAND_KM * 1000)) * AXIS_W)
  const lines = axis(y, title, `← inside · −${BAND_KM} km`, `+${BAND_KM} km · outside →`, titleY)
  lines.push(
    `<line x1="${sX(0)}" y1="${y - 10}" x2="${sX(0)}" y2="${y + 10}" stroke="${THEME.muted}"/>`,
    text(
      sX(0),
      y + TICKS_DOWN,
      'ring',
      `font-size="11" fill="${THEME.muted}" text-anchor="middle"`,
    ),
  )
  const placed: Placed[] = runs.flatMap((m): Placed[] => {
    const threat = m.threats[threatIndex]
    if (!threat) return []
    if (threat.standoffM === null) return [{ m, x: AXIS_X + 6, hollow: true }]
    const clamped = Math.max(-BAND_KM * 1000, Math.min(BAND_KM * 1000, threat.standoffM))
    return [{ m, x: sX(clamped), hollow: false }]
  })
  lines.push(...continuousDots(y, placed, 'standoff'))
  return lines
}

/**
 * A count axis, 0 to `max`: the dots stack at their value, one per run, the subject beside each
 * (ruled G4).
 */
function countAxis(
  y: number,
  titleY: number,
  title: string,
  runs: readonly RunMetrics[],
  value: (m: RunMetrics) => number,
): string[] {
  const max = Math.max(2, ...runs.map(value))
  const cX = (n: number) => round1(AXIS_X + (n / max) * AXIS_W)
  const lines = axis(y, title, '0', String(max), titleY)
  for (let n = 0; n <= max; n++) {
    lines.push(
      `<line x1="${cX(n)}" y1="${y - 3}" x2="${cX(n)}" y2="${y + 3}" stroke="${THEME.faint}"/>`,
    )
  }
  for (const mode of MODES) {
    const stacks = new Map<number, RunMetrics[]>()
    for (const m of runs.filter((run) => run.mode === mode)) {
      const n = value(m)
      stacks.set(n, [...(stacks.get(n) ?? []), m])
    }
    for (const [n, stack] of [...stacks.entries()].sort((a, b) => a[0] - b[0])) {
      stack
        .sort((a, b) => a.subject.localeCompare(b.subject))
        .forEach((m, k) => {
          lines.push(
            dot(
              cX(n),
              y + side(mode) * (LANE + k * STEP),
              CONDITION_COLOR[mode],
              m.subject,
              `count-${mode}`,
              false,
              'beside',
            ),
          )
        })
    }
  }
  return lines
}

/** The deepest stack a count axis draws, for the room above and below it. */
const stackDepth = (runs: readonly RunMetrics[], value: (m: RunMetrics) => number): number =>
  Math.max(
    1,
    ...MODES.map((mode) => {
      const counts = new Map<number, number>()
      for (const m of runs.filter((run) => run.mode === mode)) {
        counts.set(value(m), (counts.get(value(m)) ?? 0) + 1)
      }
      return Math.max(0, ...counts.values())
    }),
  )

/**
 * A time axis over the family's longest window: one dot per run per condition; a never-opened
 * threat hollow at its own run's window end (ruled G4).
 */
function timeAxis(
  y: number,
  titleY: number,
  title: string,
  runs: readonly RunMetrics[],
  runS: number,
  value: (m: RunMetrics) => number | null,
): string[] {
  const tX = (s: number) => round1(AXIS_X + (s / runS) * AXIS_W)
  const lines = axis(y, title, '0:00', mmss(runS), titleY)
  for (const s of [60, 120, 180, 240, 300]) {
    if (s < runS) {
      lines.push(
        `<line x1="${tX(s)}" y1="${y - 3}" x2="${tX(s)}" y2="${y + 3}" stroke="${THEME.faint}"/>`,
        text(
          tX(s),
          y + TICKS_DOWN,
          mmss(s),
          `font-size="11" fill="${THEME.faint}" text-anchor="middle"`,
        ),
      )
    }
  }
  const placed: Placed[] = runs.map((m) => {
    const v = value(m)
    return v === null ? { m, x: tX(m.runS), hollow: true } : { m, x: tX(v), hollow: false }
  })
  lines.push(...continuousDots(y, placed, 'time'))
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
  const family = (name: string) => {
    body.push(
      text(
        PAD,
        y + 20,
        name,
        `class="family" font-size="15" font-weight="600" fill="${THEME.text}"`,
      ),
    )
    y += 70
  }
  if (corroboration.length > 0) {
    family(
      `Corroboration pair (${[...new Set(corroboration.map((m) => m.scenario))].join(', ')}) — standoff at decision`,
    )
    body.push(
      ...standoffAxis(y, y - TITLE_UP, 'standoff at the threat’s escalation', corroboration, 0),
    )
    y += AXIS_H - 24
    body.push(...countsLines(y, corroboration, 1))
    y += 60
  }
  if (prioritization.length > 0) {
    family(
      `Prioritization pair (${[...new Set(prioritization.map((m) => m.scenario))].join(', ')}) — attention`,
    )
    const threats = Math.max(...prioritization.map((m) => m.threats.length))
    const runS = Math.max(...prioritization.map((m) => m.runS))
    // The count axis takes the room its deepest stack needs, above and below.
    const opened = (m: RunMetrics) => m.openedBeforeFirstThreat
    const extra = (stackDepth(prioritization, opened) - 1) * STEP
    body.push(
      ...countAxis(
        y + extra,
        y - TITLE_UP,
        'non-threats opened before the first threat',
        prioritization,
        opened,
      ),
    )
    y += AXIS_H + 2 * extra
    for (let t = 0; t < threats; t++) {
      body.push(
        ...timeAxis(
          y,
          y - TITLE_UP,
          `first open of threat ${t + 1} on the run’s window`,
          prioritization,
          runS,
          (m) => m.threats[t]?.firstOpenS ?? null,
        ),
      )
      y += AXIS_H
    }
    for (let t = 0; t < threats; t++) {
      body.push(
        ...standoffAxis(
          y,
          y - TITLE_UP,
          `standoff at decision · threat ${t + 1}`,
          prioritization,
          t,
        ),
      )
      y += AXIS_H
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
