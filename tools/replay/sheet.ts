/**
 * The subject sheet (S5e, #164; the #131 amendment of 2026-09-16 evening): one document for a
 * subject's two runs — an unaided run on one scenario beside a Vigil run on the other, the
 * counterbalanced pair the pilot actually collects, which the pair refuses because its rows,
 * window, and order read one cast. The order a reader meets it: the headline in sentences the
 * tool writes from the metrics, one condition per pair of sentences, the counts among them as
 * prose and never as a key-value line; the two frames side by side, unaided left, Vigil right,
 * their Queue boxes capped as the pair's are; then one row per threat by role — threat 1 each
 * scenario's first entrant — with the time lane the pair draws, each condition's lane carrying
 * its own entry tick and its own window end on an axis running the longer window, and beside it,
 * in place of the standoff axis, the ring: the 5 km ring north up on an 8 km panel, the site at
 * its centre, each condition's escalation plotted at its true bearing and range at the second of
 * escalation — hollow inside the ring — and its scenario's entry point a tick on the ring in
 * that condition's colour. Pure and deterministic; the metrics and the CSV are untouched.
 */

import { bearingDegrees } from '../../src/lib/geo.ts'
import { injectTracksAt } from '../../src/lib/injects.ts'
import { STUDY } from '../../src/config/study.ts'
import type { RunRecord } from '../../src/lib/run.ts'
import {
  CONDITION_COLOR,
  frameDocument,
  mmss,
  THEME,
  type FrameInput,
  type FrameOptions,
} from './frame.ts'
import { familyOf } from './figure.ts'
import type { RunMetrics, ThreatMetrics } from './metrics.ts'
import { conditionWord } from './pair.ts'
import { rangeM, SITE, trackAtSecond } from './regenerate.ts'

const FONT = 'system-ui, sans-serif'
const GAP = 20
const PAD = 30
/** The headline block above the frames: the title's row and two rows of prose per condition. */
const HEAD_H = 150
const ROW_H = 320
const FOOT_H = 80
/** The time axis: the longer of the two windows over 900 px, as the pair scales its own. */
const TIME_X = 220
const TIME_W = 900
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
 * margin; a miss reads as a miss.
 */
export function openingSentence(m: RunMetrics): string {
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
  // The whole run's looks, which is the CSV's column — the frame's own subtitle counts the
  // looks up to its freeze, so the sentence names the span it means.
  return `${condition} on ${m.scenario}, ${m.subject} ${opened}, ${decisions}, in ${m.looks} ${plural(m.looks, 'look')} over the whole run.`
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
 * The headline's second sentence: the counts in prose (#164). *Escalations of later entrants*
 * reads as *early escalations* with the direction spelled out — a dispatch that could have
 * waited, not a false alarm — and the order is reported after them, never as the headline (#153).
 */
export function countsSentence(m: RunMetrics, record: RunRecord): string {
  const falseWords =
    m.falseEscalations === 0
      ? 'No false alarms'
      : // No gloss: a false alarm is a track that never enters the ring **and every real
        // aircraft whatever its path** (#36 [40] B), and naming both classes inline makes a
        // sentence a reader cannot parse beside the early-escalation clause. The direction the
        // Issue asked to be told is the early escalation's, and it is told below; the definition
        // is the one the pair and the figure carry in their shared footnote (#171 round 1).
        `${inWords(m.falseEscalations)} ${plural(m.falseEscalations, 'false alarm')}`
  const early =
    m.escalationsOfLaterEntrants === 0
      ? 'nothing escalated early'
      : `${inWords(m.escalationsOfLaterEntrants)} early ${plural(m.escalationsOfLaterEntrants, 'escalation')} — ${m.escalationsOfLaterEntrants === 1 ? 'a track that would have entered' : 'tracks that would have entered'} after the run, a dispatch that could have waited rather than a false alarm`
  const order =
    m.orderCorrect === null
      ? ''
      : m.orderCorrect
        ? '; the threats were escalated in entry order'
        : `; ${escalationOrderWords(m, record)}`
  return `${m.falseEscalations === 0 ? falseWords : falseWords.charAt(0).toUpperCase() + falseWords.slice(1)}, and ${early}${order}.`
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

/** The subject sheet as an SVG document. */
export function sheetSvg({ unaided, vigil }: SheetInput, options: FrameOptions = {}): string {
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
  const l = frameDocument(unaided, { ...options, clipId: 'sheet-unaided' })
  const r = frameDocument(vigil, { ...options, clipId: 'sheet-vigil' })
  const width = l.width + GAP + r.width
  const top = Math.max(l.height, r.height)
  const rows = a.threats.length
  const height = HEAD_H + top + rows * ROW_H + FOOT_H
  const runS = Math.max(a.runS, b.runS)
  const tX = (s: number) => round1(TIME_X + (s / runS) * TIME_W)
  const aColor = CONDITION_COLOR.raw
  const bColor = CONDITION_COLOR.vigil
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-unaided="${esc(a.subject)}-${esc(a.scenario)}-${a.mode}-${a.run}" data-vigil="${esc(b.subject)}-${esc(b.scenario)}-${b.mode}-${b.run}">`,
    `<rect width="${width}" height="${height}" fill="${THEME.bg}"/>`,
  ]

  // The headline: the title, then two sentences per condition in that condition's colour.
  const who = a.subject === b.subject ? a.subject : `${a.subject} · ${b.subject}`
  parts.push(
    text(
      PAD,
      34,
      `SUBJECT SHEET · ${who} · ${a.scenario} unaided, ${b.scenario} with Vigil`,
      `class="sheet-title" font-size="18" font-weight="600" fill="${THEME.text}"`,
    ),
  )
  const said: [RunMetrics, RunRecord, string, number][] = [
    [a, unaided.record, aColor, 62],
    [b, vigil.record, bColor, 114],
  ]
  for (const [m, record, color, y] of said) {
    parts.push(
      `<circle cx="${PAD + 5}" cy="${y - 5}" r="5" fill="${color}"/>`,
      text(
        PAD + 18,
        y,
        openingSentence(m),
        `class="headline" data-mode="${m.mode}" font-size="15" fill="${THEME.text}"`,
      ),
      text(
        PAD + 18,
        y + 22,
        countsSentence(m, record),
        `class="headline-counts" data-mode="${m.mode}" font-size="13" fill="${THEME.muted}"`,
      ),
    )
  }

  // The two frames, unaided left and Vigil right, each drawn as its own run's frame.
  parts.push(
    `<svg class="frame-unaided" x="0" y="${HEAD_H}" width="${l.width}" height="${l.height}" viewBox="0 0 ${l.width} ${l.height}">`,
    ...l.lines,
    '</svg>',
    `<svg class="frame-vigil" x="${l.width + GAP}" y="${HEAD_H}" width="${r.width}" height="${r.height}" viewBox="0 0 ${r.width} ${r.height}">`,
    ...r.lines,
    '</svg>',
  )

  // One row per threat by role: the time lane with a lane per condition, and the ring beside it.
  let y = HEAD_H + top
  a.threats.forEach((threat, i) => {
    const other = b.threats[i]
    const ry = y
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
        `unaided ${a.scenario} ${threat.id} · with Vigil ${b.scenario} ${other.id}`,
        `class="row-subtitle" font-size="12" fill="${THEME.muted}"`,
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
            `class="lane-${side}" data-id="${esc(lane.id)}" font-size="12" font-weight="600" fill="${THEME.warning}"`,
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
          `<circle class="lane-${side}-escalate" data-id="${esc(lane.id)}" cx="${escX}" cy="${ly}" r="4.5" fill="${color}"/>`,
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
          `<circle class="lane-${side}-open" data-id="${esc(lane.id)}" cx="${openX}" cy="${ly}" r="4.5" fill="${THEME.panel}" stroke="${color}" stroke-width="2"/>`,
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
          `<line class="ring-entry-${side}" data-id="${esc(lane.id)}" x1="${ix}" y1="${iy}" x2="${ox}" y2="${oy}" stroke="${color}" stroke-width="2.5"/>`,
        )
      }
      const at = atSecond(input, lane.id, lane.timeToEscalateS)
      if (at !== null && lane.standoffM !== null) {
        const [x, y_] = ringPoint(cy, at.bearing, at.rangeM)
        const inside = lane.standoffM < 0
        parts.push(
          `<circle class="ring-mark-${side}" data-id="${esc(lane.id)}" cx="${x}" cy="${y_}" r="4" fill="${inside ? 'none' : color}" stroke="${color}" stroke-width="2"/>`,
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
          `class="ring-legend-${side}" data-id="${esc(lane.id)}" font-size="11" fill="${THEME.text}"`,
        ),
      )
    })
    y += ROW_H
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
  ]
  parts.push(
    `<line x1="${PAD}" y1="${y}" x2="${width - PAD}" y2="${y}" stroke="${THEME.line}"/>`,
    ...footnotes.map((line, i) =>
      text(
        PAD,
        y + 22 + i * 18,
        line,
        `class="sheet-footnote" font-size="11" fill="${THEME.faint}"`,
      ),
    ),
    '</svg>',
    '',
  )
  return parts.join('\n')
}
