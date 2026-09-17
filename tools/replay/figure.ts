/**
 * The study figure (S5d-ii, #138, ruled A7, N9, G4, H1–H4): one SVG over every run of the
 * study, by family — the prioritization pair (03a, 03b) first, its attention the headline
 * claim (the #131 amendment): the non-threats opened before any threat on a count axis, each
 * threat's first open on the family's longest window, the standoff per threat as the second
 * line, and the counts per condition; then the corroboration pair (02a, 02b) with the
 * dots-on-axis figure as A7 drew it and its counts. A family's threat count is its roles
 * table's, as the metrics and the pair read it. On every axis an unaided lane sits above the
 * line and a Vigil lane below, one dot per run with the subject code beside it; a lane's dots
 * within a label's width of each other stack outward from the axis in steps, by subject code,
 * the first nearest the axis, the x exact; a subject with a run in both conditions has its two
 * dots joined by a thin line in the neutral colour, drawn under the dots. A miss sits hollow at
 * the inside end; a never-opened threat sits hollow at its own run's window end. A raw run
 * reads *unaided* wherever the figure names it. Pure and deterministic.
 */

import { STUDY_CAST, type Family } from '../../scripts/study.ts'
import { CONDITION_COLOR, mmss, THEME } from './frame.ts'
import type { RunMetrics } from './metrics.ts'

export type { Family }

const FONT = 'system-ui, sans-serif'
const WIDTH = 1000
const PAD = 30
const AXIS_X = 200
const AXIS_W = 700
const BAND_KM = 3
/** A lane's first dot sits this far from the axis; a stack steps this much further. */
const LANE = 12
const STEP = 14
/** Two dots on one lane closer than a label's width stack (ruled H1). */
const CROWD_PX = 20
/** The axis title's row above the unaided lane's labels; the tick labels' row below the Vigil lane's. */
const TITLE_UP = 30
const TICKS_DOWN = 42
/** One axis's block, title to tick labels, before the room its stacks need. */
const AXIS_H = 100

const esc = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const text = (x: number, y: number, content: string, attrs: string): string =>
  `<text x="${x}" y="${y}" font-family="${FONT}" ${attrs}>${esc(content)}</text>`
const round1 = (value: number): number => Math.round(value * 10) / 10
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** A scenario's family: the bench's roles table's own declaration; a stranger throws in words (#162 round 1). */
export const familyOf = (scenario: string): Family => {
  const roles = STUDY_CAST[scenario]
  if (!roles) throw new Error(`${scenario}: not a study scenario the bench knows`)
  return roles.family
}

const MODES = ['raw', 'vigil'] as const
type Mode = (typeof MODES)[number]
/** The condition's word in the rendered text — *unaided* for a raw run (ruled G4). */
export const modeWord = (mode: Mode): string => (mode === 'raw' ? 'unaided' : 'Vigil')
/** A lane's side of the axis: unaided above, Vigil below (ruled H2). */
const side = (mode: Mode): 1 | -1 => (mode === 'raw' ? -1 : 1)

/** A run's dot on an axis, placed in x; hollow for a miss or a never-opened threat. */
export interface Placed {
  m: RunMetrics
  x: number
  hollow: boolean
}

/**
 * A lane's stacks: the dots in x order, each within a label's width of the one before it joining
 * its stack; within a stack by subject code, the first nearest the axis (ruled H1, H2).
 */
export function stacksOf(placed: readonly Placed[]): Placed[][] {
  const sorted = [...placed].sort((a, b) => a.x - b.x || a.m.subject.localeCompare(b.m.subject))
  const stacks: Placed[][] = []
  for (const dot of sorted) {
    const last = stacks[stacks.length - 1]
    if (last && dot.x - last[last.length - 1].x < CROWD_PX) last.push(dot)
    else stacks.push([dot])
  }
  return stacks.map((stack) =>
    [...stack].sort((a, b) => a.m.subject.localeCompare(b.m.subject) || a.m.run - b.m.run),
  )
}

/** The room an axis needs above and below: its deepest stack on either lane. */
const depthOf = (placed: readonly Placed[]): number =>
  Math.max(
    1,
    ...MODES.map((mode) =>
      Math.max(0, ...stacksOf(placed.filter(({ m }) => m.mode === mode)).map((s) => s.length)),
    ),
  )

/**
 * One axis's dots: each lane's stacks outward from the line, every dot labelled beside it; and
 * under them the subject connectors — a subject with a run in both conditions, by run index,
 * has its two dots joined in the neutral colour (ruled H1).
 */
function axisDots(y: number, placed: readonly Placed[], cls: string): string[] {
  const at = new Map<string, [number, number]>()
  const dots: string[] = []
  for (const mode of MODES) {
    for (const stack of stacksOf(placed.filter(({ m }) => m.mode === mode))) {
      stack.forEach(({ m, x, hollow }, k) => {
        const cy = y + side(mode) * (LANE + k * STEP)
        at.set(`${m.subject}|${m.run}|${mode}`, [x, cy])
        dots.push(
          `<circle class="${cls}-${mode}${hollow ? '-hollow' : ''}" data-subject="${esc(m.subject)}" cx="${x}" cy="${cy}" r="5" fill="${hollow ? 'none' : CONDITION_COLOR[mode]}" stroke="${CONDITION_COLOR[mode]}" stroke-width="2"/>`,
          text(
            round1(x + 9),
            cy + 4,
            m.subject,
            `class="label" font-size="10" fill="${THEME.muted}"`,
          ),
        )
      })
    }
  }
  const connectors: string[] = []
  const keys = [...new Set(placed.map(({ m }) => `${m.subject}|${m.run}`))].sort()
  for (const key of keys) {
    const a = at.get(`${key}|raw`)
    const b = at.get(`${key}|vigil`)
    if (a && b) {
      connectors.push(
        `<line class="connector" data-subject="${esc(key.split('|')[0])}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${THEME.faint}" stroke-width="1"/>`,
      )
    }
  }
  return [...connectors, ...dots]
}

/** An axis's fixed parts: the title above its stacks, the line, the end labels below them, the lane words. */
const axisFrame = (
  y: number,
  pad: number,
  title: string,
  left: string,
  right: string,
): string[] => [
  text(
    PAD,
    y - TITLE_UP - pad,
    title,
    `class="axis-title" font-size="13" font-weight="600" fill="${THEME.text}"`,
  ),
  `<line class="axis" x1="${AXIS_X}" y1="${y}" x2="${AXIS_X + AXIS_W}" y2="${y}" stroke="${THEME.faint}"/>`,
  text(AXIS_X, y + TICKS_DOWN + pad, left, `font-size="11" fill="${THEME.faint}"`),
  text(
    AXIS_X + AXIS_W,
    y + TICKS_DOWN + pad,
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

/** The standoff axis's x: −3 … +3 km over the axis. */
const sX = (m: number): number =>
  round1(AXIS_X + ((m + BAND_KM * 1000) / (2 * BAND_KM * 1000)) * AXIS_W)

/** The standoff axis's placement for one threat: a run without it draws nothing; a miss hollow at the inside end; the ends clamped. */
export function placeStandoff(runs: readonly RunMetrics[], threatIndex: number): Placed[] {
  return runs.flatMap((m): Placed[] => {
    const threat = m.threats[threatIndex]
    if (!threat) return []
    if (threat.standoffM === null) return [{ m, x: AXIS_X + 6, hollow: true }]
    const clamped = Math.max(-BAND_KM * 1000, Math.min(BAND_KM * 1000, threat.standoffM))
    return [{ m, x: sX(clamped), hollow: false }]
  })
}

/** The count axis's scale, at least 0 … 2 (ruled H3). */
export const countMax = (runs: readonly RunMetrics[], value: (m: RunMetrics) => number): number =>
  Math.max(2, ...runs.map(value))

/** The count axis's placement, one dot per run at its value. */
export function placeCount(
  runs: readonly RunMetrics[],
  value: (m: RunMetrics) => number,
  max: number,
): Placed[] {
  return runs.map((m) => ({ m, x: round1(AXIS_X + (value(m) / max) * AXIS_W), hollow: false }))
}

/**
 * The time axis's placement for one threat over the family's longest window: a run without the
 * threat draws nothing; one that never opened it sits hollow at its own window end (ruled G4).
 */
export function placeTime(
  runs: readonly RunMetrics[],
  runS: number,
  threatIndex: number,
): Placed[] {
  const tX = (s: number) => round1(AXIS_X + (s / runS) * AXIS_W)
  return runs.flatMap((m): Placed[] => {
    const threat = m.threats[threatIndex]
    if (!threat) return []
    if (threat.firstOpenS === null) return [{ m, x: tX(m.runS), hollow: true }]
    return [{ m, x: tX(threat.firstOpenS), hollow: false }]
  })
}

type AxisKind =
  { kind: 'standoff' } | { kind: 'count'; max: number } | { kind: 'time'; runS: number }

/** One axis at `y` with its stacks' room `pad` above and below: its frame, its ticks by kind, its dots and connectors. */
function axisAt(y: number, pad: number, title: string, kind: AxisKind, placed: Placed[]): string[] {
  const lines: string[] = []
  if (kind.kind === 'standoff') {
    lines.push(
      ...axisFrame(y, pad, title, `← inside · −${BAND_KM} km`, `+${BAND_KM} km · outside →`),
      `<line x1="${sX(0)}" y1="${y - 10}" x2="${sX(0)}" y2="${y + 10}" stroke="${THEME.muted}"/>`,
      text(
        sX(0),
        y + TICKS_DOWN + pad,
        'ring',
        `font-size="11" fill="${THEME.muted}" text-anchor="middle"`,
      ),
    )
  } else if (kind.kind === 'count') {
    lines.push(...axisFrame(y, pad, title, '0', String(kind.max)))
    for (let n = 0; n <= kind.max; n++) {
      const x = round1(AXIS_X + (n / kind.max) * AXIS_W)
      lines.push(`<line x1="${x}" y1="${y - 3}" x2="${x}" y2="${y + 3}" stroke="${THEME.faint}"/>`)
    }
  } else {
    lines.push(...axisFrame(y, pad, title, '0:00', mmss(kind.runS)))
    for (const s of [60, 120, 180, 240, 300]) {
      if (s >= kind.runS) continue
      const x = round1(AXIS_X + (s / kind.runS) * AXIS_W)
      lines.push(
        `<line x1="${x}" y1="${y - 3}" x2="${x}" y2="${y + 3}" stroke="${THEME.faint}"/>`,
        text(
          x,
          y + TICKS_DOWN + pad,
          mmss(s),
          `font-size="11" fill="${THEME.faint}" text-anchor="middle"`,
        ),
      )
    }
  }
  lines.push(...axisDots(y, placed, kind.kind))
  return lines
}

/**
 * The counts under a family's axes, one line per condition, and the sentence that gives the
 * early escalations their direction — the sheet's prose, so the three artifacts read alike
 * (#164). The order is over every threat, as the metrics define it.
 */
function countsLines(y: number, runs: readonly RunMetrics[], threats: number): string[] {
  const lines = MODES.map((mode, i) => {
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
      `false alarms ${of.reduce((sum, m) => sum + m.falseEscalations, 0)}`,
      `early escalations ${of.reduce((sum, m) => sum + m.escalationsOfLaterEntrants, 0)}`,
      ...(threats > 1
        ? [
            `order correct ${of.filter((m) => m.orderCorrect === true).length} of ${of.filter((m) => m.orderCorrect !== null).length} with every threat escalated`,
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
  return lines
}

/**
 * The sentence that gives the counts their direction, once at the foot — the sheet's prose, so
 * the three artifacts read alike (#164).
 */
const COUNTS_NOTE = [
  'A false alarm is a track that never enters the ring, and every real aircraft;',
  'an early escalation is a track that would have entered after the run — a dispatch that could have waited rather than a false alarm.',
] as const

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
  // A family's scenarios in their own order, whatever subject drew which (#162 round 1).
  const names = (family: readonly RunMetrics[]) =>
    [...new Set(family.map((m) => m.scenario))].sort().join(', ')
  // An axis takes the room its deepest stack needs above and below its block.
  const axis = (title: string, kind: AxisKind, placed: Placed[]) => {
    const pad = (depthOf(placed) - 1) * STEP
    body.push(...axisAt(y + pad, pad, title, kind, placed))
    y += AXIS_H + 2 * pad
  }
  /**
   * One family's panel: the attention axes where the family headlines attention, then the
   * standoff per threat and the counts — the threat count the family's, as the metrics carry it.
   */
  const panel = (family: readonly RunMetrics[], heading: string, attention: boolean) => {
    body.push(
      text(
        PAD,
        y + 20,
        heading,
        `class="family" font-size="15" font-weight="600" fill="${THEME.text}"`,
      ),
    )
    y += 70
    const threats = Math.max(...family.map((m) => m.threats.length))
    if (attention) {
      const runS = Math.max(...family.map((m) => m.runS))
      const opened = (m: RunMetrics) => m.openedBeforeFirstThreat
      const max = countMax(family, opened)
      axis(
        'non-threats opened before the first threat',
        { kind: 'count', max },
        placeCount(family, opened, max),
      )
      for (let t = 0; t < threats; t++) {
        axis(
          `first open of threat ${t + 1} on the run’s window`,
          { kind: 'time', runS },
          placeTime(family, runS, t),
        )
      }
    }
    for (let t = 0; t < threats; t++) {
      axis(
        threats > 1
          ? `standoff at decision · threat ${t + 1}`
          : 'standoff at the threat’s escalation',
        { kind: 'standoff' },
        placeStandoff(family, t),
      )
    }
    if (!attention) y -= 24
    body.push(...countsLines(y, family, threats))
    y += 60
  }
  if (prioritization.length > 0) {
    panel(prioritization, `Prioritization pair (${names(prioritization)}) — attention`, true)
  }
  if (corroboration.length > 0) {
    panel(
      corroboration,
      `Corroboration pair (${names(corroboration)}) — standoff at decision`,
      false,
    )
  }
  // Two lines: the sentence runs past this figure's 1 000 px, where the pair's 1 820 px holds
  // it whole (#171 round 1). With no family at all there are no counts, so no note either.
  if (prioritization.length > 0 || corroboration.length > 0) {
    body.push(
      ...COUNTS_NOTE.map((line, i) =>
        text(
          PAD,
          y - 30 + i * 14,
          line,
          `class="counts-note" font-size="11" fill="${THEME.faint}"`,
        ),
      ),
    )
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
