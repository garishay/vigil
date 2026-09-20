/**
 * The subject sheet (S5e, #164; the #131 amendment of 2026-09-16 evening): one document for a
 * subject's two runs — an unaided run on one scenario beside a Vigil run on the other, the
 * counterbalanced pair the pilot actually collects, which the pair refuses because its rows,
 * window, and order read one cast. The order a reader meets it (S5g, #194): the headline per
 * condition — one tally line of the counts and times the sheet already computes (S5h, #207),
 * then one sentence the tool writes from the metrics, the escalations besides the threats said
 * as counts and never by ident, since the row below lists every one; the two frames' pictures
 * side by side, unaided left, Vigil right; then one row per threat by role — threat 1 each
 * scenario's first entrant — with the time lane the pair draws, each condition's lane carrying
 * its own entry tick and its own window end on an axis running the longer window, and beside
 * it, in place of the standoff axis, the ring: the 5 km ring north up on an 8 km panel, the site
 * at its centre, each condition's escalation plotted at its true bearing and range at the second
 * of escalation — hollow inside the ring — and its scenario's entry point a tick on the ring in
 * that condition's colour; the other escalations; then the two frames' logs side by side with
 * Vigil's Queue box capped as the pair's is, and the footnotes last. The sheet is drawn as
 * blocks, each from its own y — a page breaks only between them, never through a log line —
 * that the browser mounts one by one and the CLI stacks into one file. Pure and deterministic;
 * the metrics and the CSV are untouched.
 */

import { bearingDegrees } from '../../src/lib/geo.ts'
import { injectTracksAt } from '../../src/lib/injects.ts'
import { STUDY } from '../../src/config/study.ts'
import type { RunRecord } from '../../src/lib/run.ts'
import {
  CAPTION,
  CONDITION_COLOR,
  captionText,
  escAttr,
  frameParts,
  looksOfRun,
  mmss,
  PANEL,
  outcomeWords,
  THEME,
  trackNamer,
  type FrameInput,
  type FrameOptions,
  type FrameParts,
} from './frame.ts'
import { familyOf } from './figure.ts'
import { otherEscalations, type RunMetrics, type ThreatMetrics } from './metrics.ts'
import { conditionWord } from './pair.ts'
import { rangeM, SITE, trackAtSecond } from './regenerate.ts'

const FONT = 'system-ui, sans-serif'
const GAP = 20
const PAD = 30
/** Where the headline’s prose starts, clear of its condition dot. */
const TEXT_X = 48
/**
 * The headline block above the frames: the title's row, then per condition its tally line and
 * its sentence (S5h, #207). Two lines each whatever the run did — the sentence counts the
 * escalations besides the threats rather than naming them, so it never wraps — and the block
 * stands 150, as S5e drew it: the fixtures' sheet keeps its one printed page (#194 R5).
 */
const HEAD_TOP = 62
const TALLY_GAP = 22
const HEAD_GAP = 30
const HEAD_BOTTOM = 14
const HEAD_H = HEAD_TOP + 2 * TALLY_GAP + HEAD_GAP + HEAD_BOTTOM
const ROW_H = 320
const FOOT_H = 80
/** The time axis: the longer of the two windows over 900 px, as the pair scales its own. */
const TIME_X = 220
const TIME_W = 900
/** The other-escalations row (S5f, #173): its title, two lanes and its own axis, above its words. */
const OTHER_TOP = 200
/** The logs' row (S5g, #194): its title and subtitle, then both panels' tops above the first line. */
const LOG_TOP = 66
/**
 * How far each block's ground and panel run on under the block below (S5g, #194): a page and a
 * viewer lay the blocks out at a fractional scale, and two rects that merely meet leave a
 * hairline of the paper between their antialiased edges. The block below paints over the
 * overrun, so nothing shows but the join closing.
 */
const OVERLAP = 8
/** The ring panel: 8 km from its centre to the outer circle, at 15 px per km. */
const RING_CX = 1480
const RING_KM = 8
const RING_R = 120
const RING_PX_PER_KM = RING_R / RING_KM

const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const text = (x: number, y: number, content: string, attrs: string): string =>
  `<text x="${x}" y="${y}" font-family="${FONT}" ${attrs}>${esc(content)}</text>`
const round1 = (value: number): number => Math.round(value * 10) / 10

/** A count in the headline's words: a zero reads *no*, and the small numbers read as words. */
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const inWords = (n: number): string => (n < WORDS.length ? WORDS[n] : String(n))
const plural = (n: number, word: string): string => `${word}${n === 1 ? '' : 's'}`
/** A signed standoff in the sheet's words, as the pair writes it: `+0.8 km`, `−0.1 km`. */
const kmWord = (m: number): string => `${m >= 0 ? '+' : '−'}${(Math.abs(m) / 1000).toFixed(1)} km`
/** How far an escalation stands from that threat's ring entry, in the pair's words. */
const relationWords = (threat: ThreatMetrics): string =>
  threat.entryT === null || threat.timeToEscalateS === null
    ? 'no ring entry'
    : threat.entryT >= threat.timeToEscalateS
      ? `${mmss(threat.entryT - threat.timeToEscalateS)} before entry`
      : `${mmss(threat.timeToEscalateS - threat.entryT)} after entry`

/** A threat by its role on the sheet: the role is the reader's handle, since the two scenarios differ. */
const roleWord = (i: number, of: number): string => (of > 1 ? `threat ${i + 1}` : 'the threat')
/** Its place in entry order, in words — the row's own ordinal, never a hardcoded two. */
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'] as const
export const ordinalWord = (i: number): string => ORDINALS[i] ?? `${i + 1}th`

/**
 * The headline's first sentence: the condition and the scenario, what the subject opened first,
 * what they escalated with how much room, and the looks it took. **Every threat is named** (ruled
 * R1): a margin belongs to a threat by name, and a contraction would leave a reader to guess
 * which is which — the order clause of the second sentence makes the wrong guess the likelier
 * one. The repeated verb is elided and *to spare* is said once, on the first clause that states a
 * margin; a miss reads as a miss. The looks it took are the looks to the last threat escalation,
 * with the whole run's count — the CSV's column — after them in parentheses (S5g, #194): a run
 * that had both threats escalated at 0:30 in 6 looks is not a run of 43 looks first. With no
 * threat escalated the whole-run count stands alone, as it did; and when the run looked at
 * nothing after its last escalation the two counts are one, said once.
 */
export function openingSentence({
  metrics: m,
  record,
}: Pick<FrameInput, 'metrics' | 'record'>): string {
  const condition = m.mode === 'raw' ? 'Unaided' : 'With Vigil'
  // A run with no select at all is not a run that opened a threat first: the Queue can be
  // worked and a track escalated without ever being selected, and the lane below says as much
  // (#171 round 1).
  const opened =
    m.looks === 0
      ? 'opened nothing'
      : m.threats.every((threat) => threat.firstOpenS === null)
        ? `opened ${inWords(m.openedBeforeFirstThreat)} ${plural(m.openedBeforeFirstThreat, 'non-threat')} and never a threat`
        : m.openedBeforeFirstThreat === 0
          ? 'opened a threat first'
          : `opened ${inWords(m.openedBeforeFirstThreat)} ${plural(m.openedBeforeFirstThreat, 'non-threat')} first`
  const all = m.threats.length
  let spare = false
  const decisions = joinClauses(
    m.threats.map((threat, i) => {
      const role = roleWord(i, all)
      if (threat.standoffM === null || threat.timeToEscalateS === null)
        return ['missed', role] as const
      if (threat.standoffM < 0) return ['escalated', `${role} inside the ring`] as const
      // *to spare* on the first margin only; the reader carries it to the rest (R1).
      const tail = spare ? '' : ' to spare'
      spare = true
      return [
        'escalated',
        `${role} with ${(threat.standoffM / 1000).toFixed(1)} km${tail}`,
      ] as const
    }),
  )
  const escalated = m.threats.flatMap((threat) =>
    threat.timeToEscalateS === null ? [] : [threat.timeToEscalateS],
  )
  const toLast =
    escalated.length === 0
      ? m.looks
      : looksOfRun(record).filter((event) => event.t <= Math.max(...escalated)).length
  const looks =
    toLast === m.looks
      ? `in ${m.looks} ${plural(m.looks, 'look')} over the whole run`
      : `in ${toLast} ${plural(toLast, 'look')} (${m.looks} over the whole run)`
  return `${condition} on ${m.scenario}, ${m.subject} ${opened}, ${decisions}, ${looks}.`
}

/** Clauses joined with *and*, a verb dropped when it repeats the clause before it. */
function joinClauses(clauses: readonly (readonly [string, string])[]): string {
  const parts = clauses.map(([verb, rest], i) =>
    i > 0 && clauses[i - 1][0] === verb ? rest : `${verb} ${rest}`,
  )
  return parts.length < 2
    ? parts.join('')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * The condition's tally line (S5h, #207), the same fields in the same order on every sheet: the
 * threats stopped of the threats cast, the first threat escalation's clock, each threat's
 * standoff in role order as the ring legend writes it or *MISSED*, then the early escalations and
 * the false alarms as the figure's items count them (K7, K8 B) — digits, a zero included. Every
 * number is one the CSV already carries; no composite and no percentage (#131's read does not move).
 */
export function tallyLine({ metrics: m }: Pick<FrameInput, 'metrics'>): string {
  const stopped = m.threats.filter((threat) => !threat.miss).length
  const escalated = m.threats.flatMap((threat) =>
    threat.timeToEscalateS === null ? [] : [threat.timeToEscalateS],
  )
  const spare = m.threats
    .map((threat) => (threat.standoffM === null ? 'MISSED' : kmWord(threat.standoffM)))
    .join(', ')
  return [
    `threats stopped ${stopped} of ${m.threats.length}`,
    escalated.length === 0
      ? 'no threat escalated'
      : `first escalation at ${mmss(Math.min(...escalated))}`,
    `to spare ${spare}`,
    `early escalations ${m.escalationsOfLaterEntrants}`,
    `false alarms ${m.falseEscalations}`,
  ].join(' · ')
}

/**
 * The headline's sentence, whole (#164; S5f, #173; S5h, #207): the opening sentence — the
 * threats and the looks — carrying the escalations the run made besides the threats **as
 * counts** in the footnote's two classes, where a second sentence named each one before. A
 * subject who works down the list makes many, and a list of idents here repeated the row below,
 * which keeps every ident. A class with none is left unsaid; with neither, the sentence ends on
 * the looks. The order is reported last, never as the headline (#153).
 */
export function headlineSentence(input: Pick<FrameInput, 'metrics' | 'record'>): string {
  const { metrics: m, record } = input
  const order =
    m.orderCorrect === null
      ? ''
      : m.orderCorrect
        ? '; the threats were escalated in entry order'
        : `; ${escalationOrderWords(m, record)}`
  const early = m.escalationsOfLaterEntrants
  const alarms = m.falseEscalations
  const counts = [
    ...(early > 0 ? [`${inWords(early)} early ${plural(early, 'escalation')}`] : []),
    ...(alarms > 0 ? [`${inWords(alarms)} false ${plural(alarms, 'alarm')}`] : []),
  ]
  const others = counts.length === 0 ? '' : `, with ${counts.join(' and ')}`
  return `${openingSentence(input).slice(0, -1)}${others}${order}.`
}

/** The roles in the order the record escalated them: *threat 2 was escalated before threat 1*. */
function escalationOrderWords(m: RunMetrics, record: RunRecord): string {
  const at = (id: string) =>
    record.events.findIndex((event) => event.type === 'escalate' && event.track === id)
  const roles = m.threats
    .map((threat, i) => ({ role: roleWord(i, m.threats.length), at: at(threat.id) }))
    .filter((entry) => entry.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.role)
  return `${roles[0]} was escalated before ${roles.slice(1).join(', ')}`
}

export interface SheetInput {
  /** The unaided run — the sheet's left frame and upper lane. */
  unaided: FrameInput
  /** The Vigil run — the sheet's right frame and lower lane. */
  vigil: FrameInput
}

/** The file a sheet is written to: both scenario codes, and both subject codes when they differ. */
export function sheetName(unaided: RunRecord, vigil: RunRecord): string {
  const who =
    unaided.subject === vigil.subject ? unaided.subject : `${unaided.subject}-${vigil.subject}`
  return `sheet-${who}-${unaided.scenario}-${vigil.scenario}.svg`
}

/** A threat's bearing and range from the ring's centre at a second of the run, or null. */
function atSecond(
  input: FrameInput,
  id: string,
  t: number | null,
): { bearing: number; rangeM: number } | null {
  if (t === null) return null
  const track = trackAtSecond(
    input.study.index,
    input.plan,
    id,
    STUDY.beginS + t,
    input.record.mode,
  )
  return track === null
    ? null
    : { bearing: bearingDegrees(SITE.center, track.position), rangeM: rangeM(track) }
}

/** The same, from the plan alone — the entry point, which the run's own mode cannot move. */
function planAtSecond(input: FrameInput, id: string, t: number | null): number | null {
  if (t === null) return null
  const track = injectTracksAt(input.plan, STUDY.beginS + t).find(
    (candidate) => candidate.id === id,
  )
  return track === null || track === undefined ? null : bearingDegrees(SITE.center, track.position)
}

/** A point on the ring panel: a bearing true and a range in metres, north up, clamped to the panel. */
const ringPoint = (cy: number, bearing: number, m: number): [number, number] => {
  const r = Math.min(RING_KM * 1000, m) * (RING_PX_PER_KM / 1000)
  const rad = (bearing * Math.PI) / 180
  return [round1(RING_CX + Math.sin(rad) * r), round1(cy - Math.cos(rad) * r)]
}

/**
 * A block of the sheet (S5g, #194): what it is, its height, and its lines drawn from its own
 * y = 0. The browser mounts each as its own `<svg>` so a printed page breaks only between
 * blocks; the CLI stacks the same blocks into one file.
 */
export interface SheetBlock {
  name: string
  height: number
  lines: string[]
}

/**
 * A block as the `<svg>` both the browser and the CLI's file carry, byte for byte: its ground
 * runs `OVERLAP` under the block below, and `overflow` lets it.
 */
const blockSvg = (block: SheetBlock, width: number): string =>
  [
    `<svg class="block" data-block="${block.name}" width="${width}" height="${block.height}" viewBox="0 0 ${width} ${block.height}" overflow="visible">`,
    `<rect width="${width}" height="${block.height + OVERLAP}" fill="${THEME.bg}"/>`,
    ...block.lines,
    '</svg>',
  ].join('\n')

/** One condition's column of the logs' rows: the unaided frame's own x, or Vigil's past the gap. */
const column = (x: number, lines: readonly string[]): string[] =>
  lines.length === 0
    ? []
    : x === 0
      ? [...lines]
      : [`<g transform="translate(${x} 0)">`, ...lines, '</g>']

/** The subject sheet laid out as blocks, in the order a reader meets them. */
function sheetLayout(
  { unaided, vigil }: SheetInput,
  options: FrameOptions,
): { width: number; blocks: SheetBlock[]; attrs: string } {
  const a = unaided.metrics
  const b = vigil.metrics
  // The refusals in the order a reader would ask them: the family first, since two scenarios of
  // unlike families share neither a claim nor a role; then the conditions, then the roles table.
  if (familyOf(a.scenario) !== familyOf(b.scenario)) {
    throw new Error(
      `a sheet reads one family — ${a.subject}'s ${a.scenario} is ${familyOf(a.scenario)} and ${b.subject}'s ${b.scenario} is ${familyOf(b.scenario)}`,
    )
  }
  if (a.scenario === b.scenario) {
    throw new Error(
      `a sheet reads two scenarios — ${a.subject} and ${b.subject} both ran ${a.scenario}; two runs of one scenario are the pair's`,
    )
  }
  if (unaided.record.mode !== 'raw' || vigil.record.mode !== 'vigil') {
    throw new Error(
      `a sheet reads one unaided run and one Vigil run — ${unaided.record.subject}'s ${unaided.record.scenario} is ${conditionWord(unaided.record)} and ${vigil.record.subject}'s ${vigil.record.scenario} is ${conditionWord(vigil.record)}`,
    )
  }
  if (a.threats.length !== b.threats.length) {
    throw new Error(
      `a sheet pairs threats by role — ${a.scenario} casts ${a.threats.length} and ${b.scenario} casts ${b.threats.length}`,
    )
  }
  const l = frameParts(unaided, { ...options, clipId: 'sheet-unaided' })
  const r = frameParts(vigil, { ...options, clipId: 'sheet-vigil' })
  const width = l.width + GAP + r.width
  const top = Math.max(l.top.height, r.top.height)
  const rows = a.threats.length
  const aColor = CONDITION_COLOR.raw
  const bColor = CONDITION_COLOR.vigil
  // Each run names its own tracks by the frame's rule, so a row's two sides read as the two
  // frames above them do — and where the two conditions' screens differed, the subtitle shows
  // that difference rather than hiding it behind an id neither screen printed (#177).
  const unaidedNames = trackNamer(unaided)
  const vigilNames = trackNamer(vigil)
  // The other escalations, per condition (S5f, #173): the row below exists when either run made
  // one, and its height is its own — a lane apiece and a line of words per escalation.
  const others: [FrameInput, string, string][] = [
    [unaided, aColor, 'unaided'],
    [vigil, bColor, 'vigil'],
  ]
  const otherRows = others.map(
    ([input]) => otherEscalations(input.record, input.study.index, input.plan).length,
  )
  const otherH =
    otherRows[0] + otherRows[1] === 0 ? 0 : OTHER_TOP + (otherRows[0] + otherRows[1]) * 18 + 20
  // The foot takes one more line when the row is there, for the counts sentence under it.
  const footH = FOOT_H + (otherH > 0 ? 18 : 0)
  const said: [FrameInput, string][] = [
    [unaided, aColor],
    [vigil, bColor],
  ]
  const runS = Math.max(a.runS, b.runS)
  const tX = (s: number) => round1(TIME_X + (s / runS) * TIME_W)
  const blocks: SheetBlock[] = []

  // The headline — the title, then per condition its tally line in that condition's colour and
  // its sentence under it (S5h, #207) — and under them the two frames' pictures, unaided left
  // and Vigil right, each its own run's frame above its log: one block, since a headline alone
  // on a page would head nothing.
  const who = a.subject === b.subject ? a.subject : `${a.subject} · ${b.subject}`
  const headline: string[] = [
    text(
      PAD,
      34,
      `SUBJECT SHEET · ${who} · ${a.scenario} unaided, ${b.scenario} with Vigil`,
      `class="sheet-title" font-size="18" font-weight="600" fill="${THEME.text}"`,
    ),
  ]
  said.forEach(([input, color], k) => {
    const m = input.metrics
    const y = HEAD_TOP + k * (TALLY_GAP + HEAD_GAP)
    headline.push(
      `<circle cx="${PAD + 5}" cy="${y - 4}" r="5" fill="${color}"/>`,
      text(
        TEXT_X,
        y,
        tallyLine(input),
        `class="headline-tally" data-mode="${m.mode}" font-size="13" font-weight="600" fill="${color}"`,
      ),
      text(
        TEXT_X,
        y + TALLY_GAP,
        headlineSentence(input),
        `class="headline" data-mode="${m.mode}" font-size="15" fill="${THEME.text}"`,
      ),
    )
  })
  headline.push(
    `<svg class="frame-unaided" x="0" y="${HEAD_H}" width="${l.width}" height="${l.top.height}" viewBox="0 0 ${l.width} ${l.top.height}">`,
    ...l.top.lines,
    '</svg>',
    `<svg class="frame-vigil" x="${l.width + GAP}" y="${HEAD_H}" width="${r.width}" height="${r.top.height}" viewBox="0 0 ${r.width} ${r.top.height}">`,
    ...r.top.lines,
    '</svg>',
  )
  blocks.push({ name: 'headline', height: HEAD_H + top, lines: headline })

  // The axis’s own ticks at a lane block’s baseline: every minute the window reaches, and its
  // end, with a minute dropped when the end would crowd it. The third row runs the same scale
  // as the threats’ rows, so it draws the same ticks (#174 round 1).
  const ticks = (ay: number): string[] =>
    [...new Set([0, 60, 120, 180, 240, 300, runS])].flatMap((s) =>
      s > runS || (s !== runS && runS - s < 20)
        ? []
        : [
            `<line x1="${tX(s)}" y1="${ay - 3}" x2="${tX(s)}" y2="${ay + 3}" stroke="${THEME.faint}"/>`,
            text(
              tX(s),
              ay + 18,
              mmss(s),
              `font-size="11" fill="${THEME.faint}" text-anchor="middle"`,
            ),
          ],
    )

  // One row per threat by role, a block each: the time lane with a lane per condition, and the
  // ring beside it.
  a.threats.forEach((threat, i) => {
    const other = b.threats[i]
    const parts: string[] = []
    const ry = 0
    const ay = ry + 196
    parts.push(
      `<line x1="${PAD}" y1="${ry}" x2="${width - PAD}" y2="${ry}" stroke="${THEME.line}"/>`,
      text(
        PAD,
        ry + 26,
        rows > 1
          ? `${roleWord(i, rows)} · each scenario's ${ordinalWord(i)} entrant`
          : `${roleWord(i, rows)}`,
        `class="row-title" font-size="15" font-weight="600" fill="${THEME.text}"`,
      ),
      text(
        PAD,
        ry + 46,
        `unaided ${a.scenario} ${unaidedNames.ident(threat.id)} · with Vigil ${b.scenario} ${vigilNames.ident(other.id)}`,
        `class="row-subtitle" font-size="12" fill="${THEME.muted}"`,
      ),
      `<line class="time-axis" x1="${TIME_X}" y1="${ay}" x2="${TIME_X + TIME_W}" y2="${ay}" stroke="${THEME.faint}"/>`,
    )
    parts.push(...ticks(ay))
    // The two lanes 50 px apart: each carries its own entry clock above it and its escalation
    // below, and the two scenarios' entries fall within seconds of each other on the axis.
    const lanes: [RunMetrics, ThreatMetrics, number, string, string][] = [
      [a, threat, ry + 100, aColor, 'unaided'],
      [b, other, ry + 150, bColor, 'vigil'],
    ]
    for (const [m, lane, ly, color, side] of lanes) {
      parts.push(
        text(
          PAD,
          ly + 4,
          `${side === 'unaided' ? 'unaided' : 'Vigil'} · ${m.scenario}`,
          `class="lane-label" font-size="12" font-weight="600" fill="${color}"`,
        ),
        // The lane's own window end: the two scenarios run different lengths (#131's rule).
        `<line class="lane-end" data-lane="${side}" x1="${tX(m.runS)}" y1="${ly - 9}" x2="${tX(m.runS)}" y2="${ly + 9}" stroke="${color}" stroke-opacity="0.5"/>`,
      )
      // The lane's own entry tick, dashed, its clock above it.
      if (lane.entryT !== null && lane.entryT >= 0 && lane.entryT <= m.runS) {
        parts.push(
          `<line class="entry-tick" data-lane="${side}" x1="${tX(lane.entryT)}" y1="${ly - 13}" x2="${tX(lane.entryT)}" y2="${ly + 13}" stroke="${color}" stroke-dasharray="3 3"/>`,
          text(
            tX(lane.entryT) + 5,
            ly - 15,
            `entry ${mmss(lane.entryT)}`,
            `font-size="11" fill="${color}"`,
          ),
        )
      }
      // A miss, or an escalation off the Queue with no look: the word sits at the axis's end.
      if (lane.timeToEscalateS === null || lane.firstOpenS === null) {
        parts.push(
          text(
            tX(m.runS) + 8,
            ly + 4,
            lane.miss ? 'MISSED' : 'escalated unopened',
            `class="lane-${side}" data-id="${escAttr(lane.id)}" font-size="12" font-weight="600" fill="${THEME.warning}"`,
          ),
        )
      }
      // The escalation is drawn wherever it happened — the lane's whole job is *when* — and
      // only the open mark and the segment that joins them need a look (#171 round 1).
      if (lane.timeToEscalateS !== null) {
        const escX = tX(lane.timeToEscalateS)
        if (lane.firstOpenS !== null) {
          parts.push(
            `<line x1="${tX(lane.firstOpenS)}" y1="${ly}" x2="${escX}" y2="${ly}" stroke="${color}" stroke-width="2"/>`,
          )
        }
        parts.push(
          `<circle class="lane-${side}-escalate" data-id="${escAttr(lane.id)}" cx="${escX}" cy="${ly}" r="4.5" fill="${color}"/>`,
          text(
            escX + 8,
            ly + 16,
            `escalated ${mmss(lane.timeToEscalateS)}`,
            `font-size="11" fill="${THEME.text}"`,
          ),
        )
      }
      if (lane.firstOpenS !== null) {
        const openX = tX(lane.firstOpenS)
        parts.push(
          `<circle class="lane-${side}-open" data-id="${escAttr(lane.id)}" cx="${openX}" cy="${ly}" r="4.5" fill="${THEME.panel}" stroke="${color}" stroke-width="2"/>`,
          text(
            openX - 8,
            ly + 4,
            `opened ${mmss(lane.firstOpenS)}`,
            `font-size="11" fill="${THEME.muted}" text-anchor="end"`,
          ),
        )
      }
    }

    // The ring, in place of the standoff axis: north up, the 5 km ring on an 8 km panel, the
    // site at its centre, each condition's escalation at its true bearing and range, and each
    // scenario's entry point a tick on the ring in that condition's colour.
    const cy = ry + 146
    const ringR = round1(SITE.radiusM * (RING_PX_PER_KM / 1000))
    parts.push(
      text(
        RING_CX - RING_R,
        ry + 26,
        'where it was escalated',
        `font-size="12" fill="${THEME.muted}"`,
      ),
      `<circle class="ring-edge" cx="${RING_CX}" cy="${cy}" r="${RING_R}" fill="none" stroke="${THEME.line}" stroke-dasharray="2 4"/>`,
      `<circle class="ring" cx="${RING_CX}" cy="${cy}" r="${ringR}" fill="${THEME.accent}" fill-opacity="0.08" stroke="${THEME.accent}" stroke-width="1.5"/>`,
      `<rect x="${RING_CX - 3}" y="${cy - 3}" width="6" height="6" fill="${THEME.accent}"/>`,
      `<line x1="${RING_CX}" y1="${cy - RING_R}" x2="${RING_CX}" y2="${cy - RING_R + 10}" stroke="${THEME.faint}"/>`,
      text(
        RING_CX,
        cy - RING_R + 24,
        'N',
        `font-size="11" fill="${THEME.faint}" text-anchor="middle"`,
      ),
      text(RING_CX + RING_R + 6, cy + 4, `${RING_KM} km`, `font-size="11" fill="${THEME.faint}"`),
    )
    const marks: [ThreatMetrics, FrameInput, string, string][] = [
      [threat, unaided, aColor, 'unaided'],
      [other, vigil, bColor, 'vigil'],
    ]
    marks.forEach(([lane, input, color, side], k) => {
      // The entry point on the ring: the scenario's own, whatever the run did.
      const entryBearing = planAtSecond(input, lane.id, lane.entryT)
      if (entryBearing !== null) {
        const [ix, iy] = ringPoint(cy, entryBearing, SITE.radiusM - 700)
        const [ox, oy] = ringPoint(cy, entryBearing, SITE.radiusM + 700)
        parts.push(
          `<line class="ring-entry-${side}" data-id="${escAttr(lane.id)}" x1="${ix}" y1="${iy}" x2="${ox}" y2="${oy}" stroke="${color}" stroke-width="2.5"/>`,
        )
      }
      const at = atSecond(input, lane.id, lane.timeToEscalateS)
      if (at !== null && lane.standoffM !== null) {
        const [x, y_] = ringPoint(cy, at.bearing, at.rangeM)
        const inside = lane.standoffM < 0
        parts.push(
          `<circle class="ring-mark-${side}" data-id="${escAttr(lane.id)}" cx="${x}" cy="${y_}" r="4" fill="${inside ? 'none' : color}" stroke="${color}" stroke-width="2"/>`,
        )
      }
      parts.push(
        `<circle cx="${RING_CX - RING_R + 5}" cy="${cy + RING_R + 24 + k * 16 - 4}" r="4" fill="${color}"/>`,
        text(
          RING_CX - RING_R + 16,
          cy + RING_R + 24 + k * 16,
          at === null || lane.standoffM === null
            ? `${side === 'unaided' ? 'unaided' : 'Vigil'} · MISSED — never escalated`
            : `${side === 'unaided' ? 'unaided' : 'Vigil'} · ${kmWord(lane.standoffM)} · ${relationWords(lane)}`,
          `class="ring-legend-${side}" data-id="${escAttr(lane.id)}" font-size="11" fill="${THEME.text}"`,
        ),
      )
    })
    blocks.push({ name: `threat-${i + 1}`, height: ROW_H, lines: parts })
  })

  // The third row (S5f, #173): every escalation the run made that is no row above, one lane per
  // condition on the same axis, each mark carrying the track as the run read it and each line
  // beneath saying what it turned out to be. Absent when neither condition made one — and a
  // condition that made none says so on its lane, since the row is the other condition's.
  if (otherH > 0) {
    const parts: string[] = []
    const ry = 0
    const ay = ry + 156
    parts.push(
      `<line x1="${PAD}" y1="${ry}" x2="${width - PAD}" y2="${ry}" stroke="${THEME.line}"/>`,
      text(
        PAD,
        ry + 26,
        'other escalations',
        `class="row-title" font-size="15" font-weight="600" fill="${THEME.text}"`,
      ),
      text(
        PAD,
        ry + 46,
        'every escalation the run made besides the threats above, and what each track turned out to be',
        `class="row-subtitle" font-size="12" fill="${THEME.muted}"`,
      ),
      `<line class="time-axis" x1="${TIME_X}" y1="${ay}" x2="${TIME_X + TIME_W}" y2="${ay}" stroke="${THEME.faint}"/>`,
    )
    parts.push(...ticks(ay))
    let line = 0
    others.forEach(([input, color, side], k) => {
      const ly = ry + 86 + k * 40
      const m = input.metrics
      const made = otherEscalations(input.record, input.study.index, input.plan)
      parts.push(
        text(
          PAD,
          ly + 4,
          `${side === 'unaided' ? 'unaided' : 'Vigil'} · ${m.scenario}`,
          `class="lane-label" font-size="12" font-weight="600" fill="${color}"`,
        ),
        `<line class="lane-end" data-lane="${side}" x1="${tX(m.runS)}" y1="${ly - 9}" x2="${tX(m.runS)}" y2="${ly + 9}" stroke="${color}" stroke-opacity="0.5"/>`,
      )
      if (made.length === 0) {
        parts.push(
          text(
            TIME_X + 8,
            ly + 4,
            'nothing else escalated',
            `class="other-none-${side}" font-size="11" font-style="italic" fill="${THEME.faint}"`,
          ),
        )
        return
      }
      const { ident } = side === 'unaided' ? unaidedNames : vigilNames
      for (const other of made) {
        parts.push(
          `<circle class="other-mark-${side}" data-id="${escAttr(other.id)}" data-t="${other.t}" cx="${tX(other.t)}" cy="${ly}" r="4.5" fill="${color}"/>`,
          text(
            tX(other.t),
            ly - 10,
            ident(other.id),
            `font-size="11" fill="${color}" text-anchor="middle"`,
          ),
        )
        // The words under the row, in the lane's colour and in the run's order: the mark says
        // when, the line says what it turned out to be — never "a non-threat" for a due-later
        // inbound, which is what the run could not have known.
        parts.push(
          `<circle cx="${PAD + 5}" cy="${ry + OTHER_TOP + line * 18 - 4}" r="4" fill="${color}"/>`,
          text(
            PAD + 16,
            ry + OTHER_TOP + line * 18,
            `${side === 'unaided' ? 'unaided' : 'Vigil'} · ${ident(other.id)} escalated ${mmss(other.t)} — ${outcomeWords(other)}`,
            `class="other-legend-${side}" data-id="${escAttr(other.id)}" font-size="11" fill="${THEME.text}"`,
          ),
        )
        line += 1
      }
    })
    blocks.push({ name: 'other', height: otherH, lines: parts })
  }

  // The logs (S5g, #194): each frame's decision log, the lines the frame's own caption box
  // draws, side by side under the comparison — unaided left, Vigil right, where their frames
  // stand — one block per line so a printed page breaks between lines and never through one,
  // and Vigil's Queue box, capped as the pair's is, after them. A panel is drawn as slices, one
  // per block: its top above the first line, a slice under each, its bottom under the last.
  const columns: [FrameParts, number][] = [
    [l, 0],
    [r, l.width + GAP],
  ]
  const panelX = 30
  const panelW = PANEL.width - 60
  const slice = (y: number, h: number): string =>
    `<rect x="${panelX}" y="${y}" width="${panelW}" height="${h + OVERLAP}" fill="${THEME.panel}"/>`
  const longest = Math.max(...columns.map(([frame]) => frame.lines.length))
  blocks.push({
    name: 'logs',
    height: LOG_TOP + CAPTION.top,
    lines: [
      `<line x1="${PAD}" y1="0" x2="${width - PAD}" y2="0" stroke="${THEME.line}"/>`,
      text(
        PAD,
        26,
        'the look logs',
        `class="row-title" font-size="15" font-weight="600" fill="${THEME.text}"`,
      ),
      text(
        PAD,
        46,
        "Every look and action in each run, in time order — unaided left, Vigil right. Under Vigil's log, the list as Vigil showed it at the freeze.",
        `class="row-subtitle" font-size="12" fill="${THEME.muted}"`,
      ),
      ...columns.flatMap(([frame, x]) =>
        column(x, frame.lines.length === 0 ? [] : [slice(LOG_TOP, CAPTION.top)]),
      ),
    ],
  })
  for (let i = 0; i < longest; i++) {
    blocks.push({
      name: `log-${i + 1}`,
      height: CAPTION.line,
      lines: columns.flatMap(([frame, x]) =>
        column(
          x,
          i < frame.lines.length
            ? [slice(0, CAPTION.line), ...captionText(frame.lines[i], CAPTION.line - 6)]
            : i === frame.lines.length && i > 0
              ? [slice(0, CAPTION.bottom)]
              : [],
        ),
      ),
    })
  }
  // The Queue box, its gap above it the panels' bottom where a log ran to the last line.
  const queue = r.queue(12)
  blocks.push({
    name: 'queue',
    height: 12 + queue.height,
    lines: [
      ...columns.flatMap(([frame, x]) =>
        column(x, frame.lines.length === longest && longest > 0 ? [slice(0, CAPTION.bottom)] : []),
      ),
      ...column(l.width + GAP, queue.lines),
    ],
  })

  // The footnotes, a line each: SVG text does not wrap, and the role rule with R4's sentence
  // behind it runs 1 839 px on an 1 820 px sheet (#164 R4).
  const footnotes = [
    `The two runs are different scenarios of one family${
      rows > 1
        ? ", so a threat is named by its role: threat 1 is each scenario's first entrant"
        : ''
    }. The time axis runs the longer window (${mmss(runS)}); each lane carries its own entry and its own end.`,
    ...(familyOf(a.scenario) === 'prioritization'
      ? [
          '03a and 03b are one cast turned around the site under different labels, so a row’s two tracks match in range, speed and entry time; only their bearing and label differ.',
        ]
      : []),
    `The ring panel is north up, the site at its centre, the 5 km ring on an ${RING_KM} km panel: each condition's mark is where that threat stood when it was escalated — hollow inside the ring — and the thick tick is where that scenario's threat crossed. Standoff is the range less 5 km, signed.`,
    // The classes the CSV counts, under the row that shows the events they count — the pair's
    // and the figure's own sentence (K8 B), which the headline said inline before S5f (#173).
    ...(otherH > 0
      ? [
          'A false alarm is a track that never enters the ring, and every real aircraft; an early escalation is a track that would have entered after the run — a dispatch that could have waited rather than a false alarm.',
        ]
      : []),
  ]
  blocks.push({
    name: 'footnotes',
    height: footH,
    lines: [
      `<line x1="${PAD}" y1="0" x2="${width - PAD}" y2="0" stroke="${THEME.line}"/>`,
      ...footnotes.map((line, i) =>
        text(PAD, 22 + i * 18, line, `class="sheet-footnote" font-size="11" fill="${THEME.faint}"`),
      ),
    ],
  })

  const attrs = `data-unaided="${escAttr(a.subject)}-${escAttr(a.scenario)}-${a.mode}-${a.run}" data-vigil="${escAttr(b.subject)}-${escAttr(b.scenario)}-${b.mode}-${b.run}"`
  return { width, blocks, attrs }
}

/** The subject sheet drawn: its blocks, and the CLI's one file of the same blocks. */
export interface SheetDocument {
  /** Each block a complete `<svg>` (S5g, #194): what the browser mounts, one element per block, so its print breaks only between them. */
  blocks: string[]
  /** One SVG document, the CLI's file: the same blocks, byte for byte, each stacked at its y inside a `<g>` — the wrapper is the only line the file adds. */
  svg: string
}

/**
 * The subject sheet, laid out once (round 1 on #195): the layout is the expensive half of the
 * render — both frames' parts, every look placed, the engine at the freeze — and the blocks
 * and the file are two readings of it, so `compose` takes both from one call.
 */
export function sheetDocument(input: SheetInput, options: FrameOptions = {}): SheetDocument {
  const { width, blocks, attrs } = sheetLayout(input, options)
  const drawn = blocks.map((block) => blockSvg(block, width))
  const height = blocks.reduce((sum, block) => sum + block.height, 0)
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ${attrs}>`,
  ]
  let y = 0
  blocks.forEach((block, i) => {
    parts.push(`<g transform="translate(0 ${y})">`, drawn[i], '</g>')
    y += block.height
  })
  parts.push('</svg>', '')
  return { blocks: drawn, svg: parts.join('\n') }
}

/** The blocks alone, for a reader that wants nothing else. */
export const sheetBlocks = (input: SheetInput, options: FrameOptions = {}): string[] =>
  sheetDocument(input, options).blocks

/** The file alone, for a reader that wants nothing else. */
export const sheetSvg = (input: SheetInput, options: FrameOptions = {}): string =>
  sheetDocument(input, options).svg
