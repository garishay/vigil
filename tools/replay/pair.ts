/**
 * The paired frame (S5d, #138, ruled A6 and N8; the pair block of the re-gate's E8 is the
 * referent): two frames side by side — any two runs, each labelled by its own condition — and
 * under them the block: the attention counts per condition, then one row per threat of the
 * roles table with the run's window as a shared time axis carrying each condition's first open
 * and escalation and the threat's ring entry, and beside it the standoff band for that threat
 * with one dot per condition. On the corroboration pair that is one row. Pure and deterministic.
 */

import type { RunRecord } from '../../src/lib/run.ts'
import {
  CONDITION_COLOR,
  frameDocument,
  mmss,
  THEME,
  type FrameInput,
  type FrameOptions,
} from './frame.ts'
import type { RunMetrics, ThreatMetrics } from './metrics.ts'

const FONT = 'system-ui, sans-serif'
const GAP = 20
const BLOCK_PAD = 30
const HEAD_H = 70
const ROW_H = 150
const FOOT_H = 60
/** The time axis: the run's window over 900 px. The standoff band: −3 … +3 km over 600 px. */
const TIME_X = 220
const TIME_W = 900
const BAND_X = 1180
const BAND_W = 600
const BAND_KM = 3

const esc = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const text = (x: number, y: number, content: string, attrs: string): string =>
  `<text x="${x}" y="${y}" font-family="${FONT}" ${attrs}>${esc(content)}</text>`
const round1 = (value: number): number => Math.round(value * 10) / 10

export interface PairInput {
  left: FrameInput
  right: FrameInput
}

/** The condition word a run is labelled by on the block. */
const conditionWord = (record: RunRecord): string => (record.mode === 'raw' ? 'raw' : 'Vigil')

/** A signed standoff in the block's words: `+0.8 km`, `−0.1 km`. */
const kmWord = (m: number): string => `${m >= 0 ? '+' : '−'}${(Math.abs(m) / 1000).toFixed(1)} km`

/** The order's words for the counts line: ✓, ✗ with the escalation order, or — with the reason. */
export function orderWords(m: RunMetrics): string {
  if (m.orderCorrect === true) return '✓'
  if (m.orderCorrect === false) {
    const order = [...m.threats]
      .filter((threat) => threat.timeToEscalateS !== null)
      .sort((a, b) => a.timeToEscalateS! - b.timeToEscalateS!)
      .map((threat) => threat.id)
    return `✗ (${order.join(' before ')})`
  }
  const missed = m.threats.filter((threat) => threat.miss).map((threat) => threat.id)
  return `— (${missed.length > 0 ? `${missed.join(', ')} missed` : 'one threat'})`
}

/** The counts line: each attention number for both conditions, the order last on the pair only. */
export function countsLine(a: RunMetrics, b: RunMetrics, aWord: string, bWord: string): string {
  const item = (label: string, x: string, y: string) => `${label} ${aWord} ${x} · ${bWord} ${y}`
  const items = [
    item(
      'opened before the first threat',
      String(a.openedBeforeFirstThreat),
      String(b.openedBeforeFirstThreat),
    ),
    item('false escalations', String(a.falseEscalations), String(b.falseEscalations)),
    item(
      'escalations of later entrants',
      String(a.escalationsOfLaterEntrants),
      String(b.escalationsOfLaterEntrants),
    ),
    ...(a.threats.length > 1 ? [item('order', orderWords(a), orderWords(b))] : []),
  ]
  return items.join('     |     ')
}

/** The file a pair is written to: `pair-<subject>-<scenario>.svg`, or both runs' names when they differ. */
export function pairName(left: RunRecord, right: RunRecord): string {
  const same = left.subject === right.subject && left.scenario === right.scenario
  return same
    ? `pair-${left.subject}-${left.scenario}.svg`
    : `pair-${left.subject}-${left.scenario}-${right.subject}-${right.scenario}.svg`
}

/** The paired frame as an SVG document. */
export function pairSvg({ left, right }: PairInput, options: FrameOptions = {}): string {
  const l = frameDocument(left, { ...options, clipId: 'panel-left' })
  const r = frameDocument(right, { ...options, clipId: 'panel-right' })
  const a = left.metrics
  const b = right.metrics
  const aWord = conditionWord(left.record)
  const bWord = conditionWord(right.record)
  const aColor = CONDITION_COLOR[left.record.mode]
  const bColor = CONDITION_COLOR[right.record.mode]
  const width = l.width + GAP + r.width
  const top = Math.max(l.height, r.height)
  const runS = Math.max(a.runS, b.runS)
  const rows = a.threats.length
  const blockH = HEAD_H + rows * ROW_H + FOOT_H
  const height = top + blockH
  const tX = (s: number) => round1(TIME_X + (s / runS) * TIME_W)
  const sX = (m: number) => round1(BAND_X + ((m + BAND_KM * 1000) / (2 * BAND_KM * 1000)) * BAND_W)
  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-left="${esc(left.record.subject)}-${esc(left.record.scenario)}-${left.record.mode}-${left.record.run}" data-right="${esc(right.record.subject)}-${esc(right.record.scenario)}-${right.record.mode}-${right.record.run}">`,
    `<rect width="${width}" height="${height}" fill="${THEME.bg}"/>`,
    `<svg class="frame-left" x="0" y="0" width="${l.width}" height="${l.height}" viewBox="0 0 ${l.width} ${l.height}">`,
    ...l.lines,
    '</svg>',
    `<svg class="frame-right" x="${l.width + GAP}" y="0" width="${r.width}" height="${r.height}" viewBox="0 0 ${r.width} ${r.height}">`,
    ...r.lines,
    '</svg>',
    `<rect class="block" x="0" y="${top}" width="${width}" height="${blockH}" fill="${THEME.panel}"/>`,
  )
  let y = top + 8
  parts.push(
    text(
      BLOCK_PAD,
      y + 24,
      'ATTENTION · STANDOFF AT DECISION',
      `class="block-title" font-size="18" font-weight="600" fill="${THEME.text}"`,
    ),
    `<circle cx="${width - 250}" cy="${y + 19}" r="5" fill="${aColor}"/>`,
    text(width - 240, y + 24, aWord, `class="legend" font-size="13" fill="${THEME.muted}"`),
    `<circle cx="${width - 180}" cy="${y + 19}" r="5" fill="${bColor}"/>`,
    text(width - 170, y + 24, bWord, `class="legend" font-size="13" fill="${THEME.muted}"`),
    text(
      BLOCK_PAD,
      y + 50,
      countsLine(a, b, aWord, bWord),
      `class="counts" font-size="14" fill="${THEME.text}"`,
    ),
  )
  y += HEAD_H
  a.threats.forEach((threat, i) => {
    const other: ThreatMetrics | undefined = b.threats[i]
    const ry = y
    const ay = ry + 100
    parts.push(
      `<line x1="${BLOCK_PAD}" y1="${ry}" x2="${width - BLOCK_PAD}" y2="${ry}" stroke="${THEME.line}"/>`,
      text(
        BLOCK_PAD,
        ry + 26,
        rows > 1 ? `threat ${i + 1} · ${threat.id}` : `the threat · ${threat.id}`,
        `class="row-title" data-id="${esc(threat.id)}" font-size="15" font-weight="600" fill="${THEME.text}"`,
      ),
      text(
        BLOCK_PAD,
        ry + 46,
        threat.entryT === null ? 'no ring entry' : `ring entry ${mmss(threat.entryT)}`,
        `class="row-entry" font-size="12" fill="${THEME.muted}"`,
      ),
      `<line class="time-axis" x1="${TIME_X}" y1="${ay}" x2="${TIME_X + TIME_W}" y2="${ay}" stroke="${THEME.faint}"/>`,
    )
    for (const s of [0, 60, 120, 180, 240, 300, runS]) {
      if (s > runS || (s !== runS && runS - s < 20)) continue
      parts.push(
        `<line x1="${tX(s)}" y1="${ay - 3}" x2="${tX(s)}" y2="${ay + 3}" stroke="${THEME.faint}"/>`,
        text(tX(s), ay + 18, mmss(s), `font-size="11" fill="${THEME.faint}" text-anchor="middle"`),
      )
    }
    if (threat.entryT !== null && threat.entryT <= runS) {
      parts.push(
        `<line class="entry-tick" x1="${tX(threat.entryT)}" y1="${ry + 56}" x2="${tX(threat.entryT)}" y2="${ay + 4}" stroke="${THEME.muted}" stroke-dasharray="3 3"/>`,
        text(
          tX(threat.entryT) + 5,
          ry + 64,
          `entry ${mmss(threat.entryT)}`,
          `font-size="11" fill="${THEME.muted}"`,
        ),
      )
    }
    const lanes: [string, ThreatMetrics | undefined, number, string, string][] = [
      [aWord, threat, ry + 72, aColor, 'left'],
      [bWord, other, ry + 88, bColor, 'right'],
    ]
    for (const [word, lane, ly, color, side] of lanes) {
      parts.push(
        text(TIME_X - 130, ly + 4, word, `font-size="11" fill="${color}" text-anchor="end"`),
      )
      if (!lane || lane.firstOpenS === null) {
        parts.push(
          text(
            tX(runS) + 8,
            ly + 4,
            lane && !lane.miss ? 'escalated unopened' : 'MISSED',
            `class="lane-${side}" data-id="${esc(threat.id)}" font-size="12" font-weight="600" fill="${THEME.warning}"`,
          ),
        )
        continue
      }
      const openX = tX(lane.firstOpenS)
      if (lane.timeToEscalateS !== null) {
        const escX = tX(lane.timeToEscalateS)
        parts.push(
          `<line x1="${openX}" y1="${ly}" x2="${escX}" y2="${ly}" stroke="${color}" stroke-width="2"/>`,
          `<circle class="lane-${side}-escalate" data-id="${esc(threat.id)}" cx="${escX}" cy="${ly}" r="4.5" fill="${color}"/>`,
          text(
            escX + 8,
            ly + 4,
            `escalated ${mmss(lane.timeToEscalateS)}`,
            `font-size="11" fill="${THEME.text}"`,
          ),
        )
      } else {
        parts.push(
          text(
            tX(runS) + 8,
            ly + 4,
            'MISSED',
            `class="lane-${side}" data-id="${esc(threat.id)}" font-size="12" font-weight="600" fill="${THEME.warning}"`,
          ),
        )
      }
      parts.push(
        `<circle class="lane-${side}-open" data-id="${esc(threat.id)}" cx="${openX}" cy="${ly}" r="4.5" fill="${THEME.panel}" stroke="${color}" stroke-width="2"/>`,
        text(
          openX - 8,
          ly + 4,
          `opened ${mmss(lane.firstOpenS)}`,
          `font-size="11" fill="${THEME.muted}" text-anchor="end"`,
        ),
      )
    }
    // The standoff band for this threat.
    const by = ry + 100
    parts.push(
      text(BAND_X, ry + 46, 'standoff at decision', `font-size="12" fill="${THEME.muted}"`),
      `<line class="band-axis" x1="${BAND_X}" y1="${by}" x2="${BAND_X + BAND_W}" y2="${by}" stroke="${THEME.faint}"/>`,
      `<line x1="${sX(0)}" y1="${by - 10}" x2="${sX(0)}" y2="${by + 10}" stroke="${THEME.muted}"/>`,
      text(sX(0), by + 26, 'ring', `font-size="11" fill="${THEME.muted}" text-anchor="middle"`),
      text(
        BAND_X,
        by + 26,
        `← inside · toward the asset · −${BAND_KM} km`,
        `font-size="11" fill="${THEME.faint}"`,
      ),
      text(
        BAND_X + BAND_W,
        by + 26,
        `+${BAND_KM} km · outside · standoff →`,
        `font-size="11" fill="${THEME.faint}" text-anchor="end"`,
      ),
    )
    const dots: [ThreatMetrics | undefined, number, string, string][] = [
      [threat, -6, aColor, 'left'],
      [other, 6, bColor, 'right'],
    ]
    for (const [lane, dy, color, side] of dots) {
      if (!lane || lane.standoffM === null || lane.timeToEscalateS === null) {
        parts.push(
          `<circle class="band-${side}-miss" data-id="${esc(threat.id)}" cx="${BAND_X + 6}" cy="${by + dy}" r="5" fill="none" stroke="${color}" stroke-width="2"/>`,
          text(BAND_X + 16, by + dy + 4, 'MISSED', `font-size="11" fill="${THEME.warning}"`),
        )
        continue
      }
      // Clamped to the band's ends: a standoff past ±3 km sits at the edge with its number.
      const clamped = Math.max(-BAND_KM * 1000, Math.min(BAND_KM * 1000, lane.standoffM))
      const relation =
        lane.entryT === null
          ? 'no ring entry'
          : lane.entryT >= lane.timeToEscalateS
            ? `${mmss(lane.entryT - lane.timeToEscalateS)} before entry`
            : `${mmss(lane.timeToEscalateS - lane.entryT)} after entry`
      parts.push(
        `<circle class="band-${side}" data-id="${esc(threat.id)}" cx="${sX(clamped)}" cy="${by + dy}" r="5" fill="${color}"/>`,
        text(
          sX(clamped) + 10,
          by + dy + 4,
          `${kmWord(lane.standoffM)} · ${relation}`,
          `font-size="11" fill="${THEME.text}"`,
        ),
      )
    }
    y += ROW_H
  })
  parts.push(
    `<line x1="${BLOCK_PAD}" y1="${y}" x2="${width - BLOCK_PAD}" y2="${y}" stroke="${THEME.line}"/>`,
    text(
      BLOCK_PAD,
      y + 22,
      `Standoff = range to the ring's centre at the first Escalate on that threat − 5 km, signed; a hollow mark at the inside end is a miss. The time axis runs the scenario's own window (${mmss(runS)}).`,
      `class="block-footnote" font-size="11" fill="${THEME.faint}"`,
    ),
    text(
      BLOCK_PAD,
      y + 40,
      'false escalations count tracks that never enter the ring inside the recording, and every real aircraft; escalations of later entrants — tracks entering after the run — stand on their own line, folded into neither.',
      `class="block-footnote" font-size="11" fill="${THEME.faint}"`,
    ),
    '</svg>',
    '',
  )
  return parts.join('\n')
}
