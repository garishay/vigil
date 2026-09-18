/**
 * The paired frame (S5d, #138, ruled A6 and N8; the pair block of the re-gate's E8 is the
 * referent): two frames side by side — any two runs, each labelled by its own condition — and
 * under them the block: the attention counts per condition, then one row per threat of the
 * roles table with the run's window as a shared time axis carrying each condition's first open
 * and escalation and the threat's ring entry, and beside it the standoff band for that threat
 * with one dot per condition. On the corroboration pair that is one row. A raw run reads
 * *unaided* wherever the block names it (ruled G3), and the counts read *false alarms* and *early
 * escalations* as the sheet and the figure do, over the same footnote (ruled K8 on #164); its
 * Queue box is capped at its top rows (ruled G2). Two runs of one scenario pair, whatever their
 * modes or subjects; runs of unlike scenarios are refused in words, since the rows, the window,
 * and the order read one cast (#161 round 1). Pure and deterministic.
 */

import type { RunRecord } from '../../src/lib/run.ts'
import {
  CONDITION_COLOR,
  escAttr,
  frameDocument,
  mmss,
  THEME,
  type FrameInput,
  type FrameOptions,
  trackNamer,
} from './frame.ts'
import type { ThreatMetrics } from './metrics.ts'

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

/** The condition word a run is labelled by on the block — *unaided* for a raw run (ruled G3). */
export const conditionWord = (record: RunRecord): string =>
  record.mode === 'raw' ? 'unaided' : 'Vigil'

/** A signed standoff in the block's words: `+0.8 km`, `−0.1 km`. */
const kmWord = (m: number): string => `${m >= 0 ? '+' : '−'}${(Math.abs(m) / 1000).toFixed(1)} km`

/**
 * The order's words for the counts line: ✓, ✗ with the escalation order, or — with the reason.
 * The order is the escalations' positions in the record — the verdict's own reading, so two on
 * one second keep the order the record writes (#161 round 1).
 */
export function orderWords(input: FrameInput): string {
  const { metrics: m, record } = input
  // The threats are named as the frames above the block name them (#177, R1): the run's own
  // screen name at its freeze, never the study's id, which no screen printed.
  const { ident } = trackNamer(input)
  if (m.orderCorrect === true) return '✓'
  if (m.orderCorrect === false) {
    const at = (id: string) =>
      record.events.findIndex((event) => event.type === 'escalate' && event.track === id)
    const order = [...m.threats]
      .filter((threat) => at(threat.id) >= 0)
      .sort((a, b) => at(a.id) - at(b.id))
      .map((threat) => ident(threat.id))
    return `✗ (${order.join(' before ')})`
  }
  const missed = m.threats.filter((threat) => threat.miss).map((threat) => ident(threat.id))
  return `— (${missed.length > 0 ? `${missed.join(', ')} missed` : 'one threat'})`
}

/** The counts line: each attention number for both conditions, the order last on the pair only. */
export function countsLine(
  [left, right]: [FrameInput, FrameInput],
  aWord: string,
  bWord: string,
): string {
  // The two runs once: the numbers and the order clause read the same pair, which a separate
  // pair of metrics could not be held to (#178 round 1).
  const a = left.metrics
  const b = right.metrics
  const item = (label: string, x: string, y: string) => `${label} ${aWord} ${x} · ${bWord} ${y}`
  const items = [
    item(
      'opened before the first threat',
      String(a.openedBeforeFirstThreat),
      String(b.openedBeforeFirstThreat),
    ),
    item('false alarms', String(a.falseEscalations), String(b.falseEscalations)),
    item(
      'early escalations',
      String(a.escalationsOfLaterEntrants),
      String(b.escalationsOfLaterEntrants),
    ),
    ...(a.threats.length > 1 ? [item('order', orderWords(left), orderWords(right))] : []),
  ]
  return items.join('     |     ')
}

/** The file a pair is written to: `pair-<subject>-<scenario>.svg`, or both subjects' names when they differ. */
export function pairName(left: RunRecord, right: RunRecord): string {
  return left.subject === right.subject
    ? `pair-${left.subject}-${left.scenario}.svg`
    : `pair-${left.subject}-${right.subject}-${left.scenario}.svg`
}

/** The paired frame as an SVG document. */
export function pairSvg({ left, right }: PairInput, options: FrameOptions = {}): string {
  const l = frameDocument(left, { ...options, clipId: 'panel-left' })
  const r = frameDocument(right, { ...options, clipId: 'panel-right' })
  const a = left.metrics
  const b = right.metrics
  if (left.record.scenario !== right.record.scenario) {
    throw new Error(
      `a pair reads one scenario — ${left.record.subject} ${left.record.scenario} and ${right.record.subject} ${right.record.scenario} differ`,
    )
  }
  const aWord = conditionWord(left.record)
  const bWord = conditionWord(right.record)
  // What tells the two runs apart, for a row that must say which name is whose: the condition
  // word where the modes differ, else the subject, else the run index. The pair takes two runs
  // of one scenario "whatever their modes or subjects", so the condition word alone would label
  // both sides of a same-mode pair the same way (#178 round 1).
  const [aSide, bSide] =
    aWord !== bWord
      ? [aWord, bWord]
      : left.record.subject !== right.record.subject
        ? [left.record.subject, right.record.subject]
        : [`run ${left.record.run}`, `run ${right.record.run}`]
  // The row names its track the way each run's screen named it, the frame's rule (#177, R1): the
  // two frames stand on this same document, so an id neither screen printed would be a third
  // name for one track. A pair reads one scenario, so the two names agree unless the screens
  // differed — which is what F2 protects, and what the 02 cast does.
  const aNames = trackNamer(left)
  const bNames = trackNamer(right)
  const rowName = (id: string) =>
    aNames.ident(id) === bNames.ident(id)
      ? aNames.ident(id)
      : `${aNames.ident(id)} ${aSide}, ${bNames.ident(id)} ${bSide}`
  const aColor = CONDITION_COLOR[left.record.mode]
  const bColor = CONDITION_COLOR[right.record.mode]
  const width = l.width + GAP + r.width
  const top = Math.max(l.height, r.height)
  const runS = a.runS
  const rows = a.threats.length
  const blockH = HEAD_H + rows * ROW_H + FOOT_H
  const height = top + blockH
  const tX = (s: number) => round1(TIME_X + (s / runS) * TIME_W)
  const sX = (m: number) => round1(BAND_X + ((m + BAND_KM * 1000) / (2 * BAND_KM * 1000)) * BAND_W)
  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-left="${escAttr(left.record.subject)}-${escAttr(left.record.scenario)}-${left.record.mode}-${left.record.run}" data-right="${escAttr(right.record.subject)}-${escAttr(right.record.scenario)}-${right.record.mode}-${right.record.run}">`,
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
      countsLine([left, right], aWord, bWord),
      `class="counts" font-size="14" fill="${THEME.text}"`,
    ),
  )
  y += HEAD_H
  a.threats.forEach((threat, i) => {
    // The same scenario, so the same roles table: the rows pair by threat, held rather than assumed.
    const other: ThreatMetrics | undefined = b.threats[i]
    if (other === undefined || other.id !== threat.id) {
      throw new Error(
        `a pair reads one roles table — ${left.record.subject}'s threat ${i + 1} is ${threat.id}, ${right.record.subject}'s ${other?.id ?? 'absent'}`,
      )
    }
    const ry = y
    const ay = ry + 100
    parts.push(
      `<line x1="${BLOCK_PAD}" y1="${ry}" x2="${width - BLOCK_PAD}" y2="${ry}" stroke="${THEME.line}"/>`,
      text(
        BLOCK_PAD,
        ry + 26,
        `${rows > 1 ? `threat ${i + 1}` : 'the threat'} · ${rowName(threat.id)}`,
        `class="row-title" data-id="${escAttr(threat.id)}" font-size="15" font-weight="600" fill="${THEME.text}"`,
      ),
      text(
        BLOCK_PAD,
        ry + 46,
        threat.entryT === null ? 'no ring entry' : `ring entry ${mmss(threat.entryT)}`,
        `class="row-entry" font-size="12" fill="${THEME.muted}"`,
      ),
      `<line class="time-axis" x1="${TIME_X}" y1="${ay}" x2="${TIME_X + TIME_W}" y2="${ay}" stroke="${THEME.faint}"/>`,
    )
    for (const s of [...new Set([0, 60, 120, 180, 240, 300, runS])]) {
      if (s > runS || (s !== runS && runS - s < 20)) continue
      parts.push(
        `<line x1="${tX(s)}" y1="${ay - 3}" x2="${tX(s)}" y2="${ay + 3}" stroke="${THEME.faint}"/>`,
        text(tX(s), ay + 18, mmss(s), `font-size="11" fill="${THEME.faint}" text-anchor="middle"`),
      )
    }
    // The tick only inside the window: a threat inside the ring before Begin has a negative
    // entry, which the row's subtitle names and the axis cannot hold (#161 round 1).
    if (threat.entryT !== null && threat.entryT >= 0 && threat.entryT <= runS) {
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
            `class="lane-${side}" data-id="${escAttr(threat.id)}" font-size="12" font-weight="600" fill="${THEME.warning}"`,
          ),
        )
        continue
      }
      const openX = tX(lane.firstOpenS)
      if (lane.timeToEscalateS !== null) {
        const escX = tX(lane.timeToEscalateS)
        parts.push(
          `<line x1="${openX}" y1="${ly}" x2="${escX}" y2="${ly}" stroke="${color}" stroke-width="2"/>`,
          `<circle class="lane-${side}-escalate" data-id="${escAttr(threat.id)}" cx="${escX}" cy="${ly}" r="4.5" fill="${color}"/>`,
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
            `class="lane-${side}" data-id="${escAttr(threat.id)}" font-size="12" font-weight="600" fill="${THEME.warning}"`,
          ),
        )
      }
      parts.push(
        `<circle class="lane-${side}-open" data-id="${escAttr(threat.id)}" cx="${openX}" cy="${ly}" r="4.5" fill="${THEME.panel}" stroke="${color}" stroke-width="2"/>`,
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
          `<circle class="band-${side}-miss" data-id="${escAttr(threat.id)}" cx="${BAND_X + 6}" cy="${by + dy}" r="5" fill="none" stroke="${color}" stroke-width="2"/>`,
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
        `<circle class="band-${side}" data-id="${escAttr(threat.id)}" cx="${sX(clamped)}" cy="${by + dy}" r="5" fill="${color}"/>`,
        // Past the band's last 160 px the label would leave the document: it sits left of
        // its dot there, anchored end (#161 round 1).
        ...(sX(clamped) > BAND_X + BAND_W - 160
          ? [
              text(
                sX(clamped) - 10,
                by + dy + 4,
                `${kmWord(lane.standoffM)} · ${relation}`,
                `font-size="11" fill="${THEME.text}" text-anchor="end"`,
              ),
            ]
          : [
              text(
                sX(clamped) + 10,
                by + dy + 4,
                `${kmWord(lane.standoffM)} · ${relation}`,
                `font-size="11" fill="${THEME.text}"`,
              ),
            ]),
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
      'A false alarm is a track that never enters the ring, and every real aircraft; an early escalation is a track that would have entered after the run — a dispatch that could have waited rather than a false alarm.',
      `class="block-footnote" font-size="11" fill="${THEME.faint}"`,
    ),
    '</svg>',
    '',
  )
  return parts.join('\n')
}
