/**
 * The frame (S5b, #138, ruled B2–B4; the S5 gate's A5a and A5b under the ruling on A5): one SVG
 * per run — the picture at the freeze, the ring, the threat's trail with its marks, one numbered
 * marker per distinct track looked at up to the freeze, the path through every look, the
 * analyst's overlay, the header, and the caption box — drawn identically in both modes. The only words that differ between a raw
 * frame and a Vigil frame of the same run are the header's condition, the ident a look read,
 * and on the prioritization pair each threat's one map label (S5c-ii, ruled F2), since that is
 * what the run's screen showed. The Vigil annotations (S5c-ii, C1–C7) draw on a Vigil frame
 * only, every element under a `vigil-` class: the warm labels, the Queue box under the map, a
 * threat's mismatch line and entry estimate, the caption's Vigil line after each threat look
 * and the overlay's count on the last decision line — the app's own readings through the
 * engine. Pure and deterministic: the same record, study, and plan give the same bytes.
 */

import { AO } from '../../src/config/ao.ts'
import { type Band } from '../../src/config/scoring.ts'
import { STUDY } from '../../src/config/study.ts'
import {
  BAND_COLOR,
  mismatchLine,
  reasonTag,
  sourceWord,
  trackIdent,
} from '../../src/lib/display.ts'
import { KT_TO_MS } from '../../src/lib/geo.ts'
import { injectTracksAt, type InjectPlan } from '../../src/lib/injects.ts'
import { timeToEntry, type Projectable } from '../../src/lib/projection.ts'
import type { RunEvent, RunRecord } from '../../src/lib/run.ts'
import type { Track } from '../../src/lib/tracks.ts'
import { candidatesAt, rankedAtSecond, type RankedAt } from './engine.ts'
import type { Study } from './load.ts'
import { otherEscalations, threatsOf, type OtherEscalation, type RunMetrics } from './metrics.ts'
import { pictureAtSecond, rangeM, SITE, trackAtSecond } from './regenerate.ts'

/** The map panel: 30 km by 23.3 km at 30 px per km, the ring's centre at its middle. */
export const PANEL = { width: 900, height: 700, pxPerKm: 30 } as const
const HEADER_H = 80
const FOOT_H = 48
const LINE_H = 22
const FONT = 'system-ui, sans-serif'
/** The theme's tokens (src/index.css), fixed here: an SVG carries no stylesheet. */
const COLOR = {
  bg: '#0b0f14',
  panel: '#121821',
  line: '#1f2a37',
  text: '#e6edf3',
  muted: '#8b98a9',
  faint: '#63707f',
  accent: '#4c9aff',
  warning: '#ff6b57',
} as const

const round1 = (value: number): number => Math.round(value * 10) / 10

/**
 * Equirectangular about the AO centre: metres per degree of longitude scaled by the cosine of
 * the centre's latitude, x east and y south, the centre at the panel's middle, to a tenth of a
 * pixel. At 20 km the difference from the map's Mercator is under a pixel.
 */
export function project([lon, lat]: readonly [number, number]): [number, number] {
  const mPerDegLat = 111_320
  const mPerDegLon = mPerDegLat * Math.cos((AO.center[1] * Math.PI) / 180)
  const x = PANEL.width / 2 + (((lon - AO.center[0]) * mPerDegLon) / 1000) * PANEL.pxPerKm
  const y = PANEL.height / 2 - (((lat - AO.center[1]) * mPerDegLat) / 1000) * PANEL.pxPerKm
  return [round1(x), round1(y)]
}

const inPanel = ([x, y]: readonly [number, number]): boolean =>
  x >= 0 && x <= PANEL.width && y >= 0 && y <= PANEL.height

/** Sim seconds from Begin as the frame prints them: `0:58`, `2:04`; before Begin, `-1:40` (#151 round 1). */
export const mmss = (seconds: number): string => {
  const whole = Math.abs(seconds)
  return `${seconds < 0 ? '-' : ''}${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** Text content: the three characters XML reserves; a quote is plain text there. */
const esc = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** An attribute value: the same, and the quote that would end it. */
const escAttr = (text: string): string => esc(text).replace(/"/g, '&quot;')

export interface FrameInput {
  record: RunRecord
  metrics: RunMetrics
  study: Study
  plan: InjectPlan
}

/** Every look the run made, in the record's order — the path draws them all (S5f, #173). */
export const looksOfRun = (record: RunRecord): RunEvent[] =>
  record.events.filter((event) => event.type === 'select')

const VERB: Partial<Record<RunEvent['type'], string>> = {
  assess: 'assessed',
  escalate: 'escalated',
  dismiss: 'dismissed',
}

/** The header's first line: the condition, and the moment the frame is frozen at. */
export const headerLine = (input: FrameInput): string => {
  const { record, metrics } = input
  const missed = metrics.threats.filter((threat) => threat.miss)
  const many = metrics.threats.length > 1
  // A missed threat is named as the log names it, not by its id: one name per track means the
  // header too, which is the one word a reader sees that still read `inject-23` (#176 round 1).
  const { ident } = trackNamer(input)
  return `${record.mode === 'raw' ? 'UNAIDED' : 'WITH VIGIL'} · ${
    missed.length > 0
      ? `MISSED${many ? ` ${missed.map((threat) => ident(threat.id)).join(', ')}` : ''} — frozen at +${mmss(metrics.runS)}`
      : `frozen at the moment of ${many ? 'the last ' : ''}escalation — ${mmss(metrics.freezeT)}`
  }`
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * The Entry row's reading at a second, in the frame's words — `timeToEntry` on the study's ring,
 * the row's own function with its horizon and its ground guard (#160 round 1): the estimate,
 * inside, none within the horizon, or null for a track on the ground.
 */
export const entryWords = (track: Projectable): string | null => {
  const estimate = timeToEntry(track, [SITE])
  if (estimate === null) return null
  return estimate.kind === 'entry'
    ? `ring entry in ${mmss(Math.round(estimate.tSec))}`
    : estimate.kind === 'inside'
      ? 'inside the ring'
      : `no ring entry within ${Math.round(estimate.horizonS / 60)} min`
}

/** A band's colour for a label: the warm bands' own, the neutral text colour for calm (#160 round 1). */
export const bandFill = (band: Band): string => (band === 'calm' ? COLOR.text : BAND_COLOR[band])

/**
 * What Vigil read on a track at a second — the caption's Vigil line (S5c-ii, C6): the rank, the
 * band and composite the chip printed, the closing speed, and the Entry row's estimate; the
 * drawer's mismatch line, when the score read one, is the caption's next line, since the two
 * together overrun the box (#160 round 1). The app's own words, through the engine.
 */
const vigilReading = (entry: RankedAt): string => {
  const { track } = entry
  const speed = track.groundSpeedKt === null ? null : Math.round(track.groundSpeedKt * KT_TO_MS)
  const entry_ = entryWords(track)
  return [
    `Vigil read it rank ${entry.rank} · ${entry.band} ${entry.composite}`,
    speed === null ? 'speed unobserved' : `closing at ${speed} m/s`,
    ...(entry_ === null ? [] : [entry_]),
  ].join(' · ')
}

/** The above-calm injects at the freeze the run never opened — the overlay's set, whole run. */
const neverOpened = (record: RunRecord, candidates: readonly RankedAt[]): RankedAt[] => {
  const opened = new Set(
    record.events.filter((event) => event.type === 'select').map((event) => event.track),
  )
  return candidates.filter((candidate) => !opened.has(candidate.track.id))
}

/**
 * The overlay's count in words for the last decision line: the marks the frame draws, and any
 * of the set beyond the panel named apart, as the header names hops beyond it (#160 round 1).
 */
export const neverOpenedWords = (record: RunRecord, candidates: readonly RankedAt[]): string => {
  const never = neverOpened(record, candidates)
  const beyond = never.filter((candidate) => !inPanel(project(candidate.track.position))).length
  return `${plural(never.length - beyond, 'candidate')} never opened${beyond > 0 ? `, ${beyond} beyond the panel` : ''}.`
}

/**
 * What the frame calls a track (S5g, #175): the ident the screen showed, and the role in words
 * where the track has one. One name per track **on the frame** — the log, the map label and the
 * header — so a frame, and a pair's two frames, do not give a reader two names for one thing. The
 * sheet's own rows and sentences still name a track their own way; that is #177's. The ident is read at the freeze — the second the
 * frame is of — and, for a track the picture no longer holds there, at its last event in the run:
 * on the 02b Vigil fixture one track reads UAS-8F21 at its first look and TRK-11 at its second,
 * which is the case that makes "the name the screen showed" need a second to be read at. The ids
 * the CSV and the metrics carry are untouched.
 */
export interface TrackNames {
  /** The ident alone, as the map labels a track. */
  ident: (id: string) => string
  /** The ident with the role in words, as the log names it. */
  name: (id: string) => string
}

export function trackNamer({ record, metrics, study, plan }: FrameInput): TrackNames {
  const { beginS } = STUDY
  const threatIds = metrics.threats.map((threat) => threat.id)
  const many = threatIds.length > 1
  const role = (id: string) => {
    const i = threatIds.indexOf(id)
    return i < 0 ? '' : many ? ` (threat ${i + 1})` : ' (the threat)'
  }
  // Memoised: the log asks for a track's name on every line it writes about it, and each ask
  // reads the regenerated picture from the freeze back through that track's events.
  const idents = new Map<string, string>()
  const ident = (id: string) => {
    const hit = idents.get(id)
    if (hit !== undefined) return hit
    const seconds = [
      metrics.freezeT,
      ...record.events
        .filter((event) => event.track === id)
        .map((event) => event.t)
        .reverse(),
    ]
    const found =
      seconds
        .map((t) => trackAtSecond(study.index, plan, id, beginS + t, record.mode))
        .find((track) => track !== null) ?? null
    const name = found === null ? id : trackIdent(found)
    idents.set(id, name)
    return name
  }
  return { ident, name: (id: string) => `${ident(id)}${role(id)}` }
}

/**
 * A line of the caption box and the weight it draws in (S5g, #175): a decision on a threat keeps
 * the weight the box has always given a decision line, and every other line is muted — the
 * non-threats' decisions among them, so a reader's eye finds the threats down a long log.
 */
export interface CaptionLine {
  text: string
  /**
   * Drawn in the box's own weight rather than muted: every line about a threat, and **every
   * escalation whatever the track** (ruled R3) — an escalation is the run's only irreversible
   * act, and a run's most consequential lines can be escalations of tracks that are not threats.
   */
  bold: boolean
  /** The freeze's own rule across the box rather than a decision line (ruled R2). */
  rule?: true
}

/**
 * The caption box: the run's decisions as a log (S5g, #175). One line per decision — open,
 * dismiss, escalate — in the clock's order over the whole run, each tagged with the look it came
 * off, and each fact said once: an open line carries what the track read as and its T0 range, the
 * escalation's own line carries the standoff and the margin, and neither carries the other's
 * clock. A threat's lines keep the weight the frame gave them and the rest are muted. The Vigil
 * reading stays under the line it belongs to; a miss is stated once beneath the log; the
 * overlay's count is the foot's own line.
 */
export function captionLines(input: FrameInput): CaptionLine[] {
  const { record, metrics, study, plan } = input
  const { beginS } = STUDY
  const threatIds = metrics.threats.map((threat) => threat.id)
  const many = threatIds.length > 1
  const { ident, name: named } = trackNamer(input)
  const others = otherEscalations(record, study.index, plan)
  // By position in the record, not by second: two looks on one second are two looks, and an
  // action belongs to the look before it in the record's order (#151 round 1). The whole run,
  // as the map draws it since S5f (#173).
  let k = 0
  const looks = new Map<string, number>()
  const lines: CaptionLine[] = []
  const line = (text: string, id: string | null, escalation = false): CaptionLine => ({
    text,
    bold: escalation || (id !== null && threatIds.includes(id)),
  })
  // The freeze's rule, before the first line the run wrote after it (ruled R2): the header names
  // the second and the map draws a late look lighter, but the log is the artifact that runs on
  // the clock, and the split between handling the threats and working on after them is what a
  // reader is looking for. Nothing after the freeze, no rule.
  let ruled = false
  /**
   * The rule is laid down by the line that follows it, not by the event that would have: an
   * `alert_ack` is not a decision and writes no line, so a run whose only work after the freeze
   * is an acknowledgement gets no rule and no hairline over its foot (#176 round 1).
   */
  const ruledPush = (t: number, line: CaptionLine) => {
    if (!ruled && t > metrics.freezeT) {
      ruled = true
      lines.push({ text: `frozen at ${mmss(metrics.freezeT)}`, bold: false, rule: true })
    }
    lines.push(line)
  }
  for (const event of record.events) {
    if (event.type === 'select') {
      k += 1
      looks.set(event.track, k)
    }
    const tag = looks.has(event.track) ? `Look #${looks.get(event.track)}` : 'Unopened'
    const head = `${tag} · ${mmss(event.t)} — `
    if (event.type === 'select') {
      const shown = trackAtSecond(study.index, plan, event.track, beginS + event.t, record.mode)
      // On the pair the T0 range comes to the caption from the map (ruled F2): the marks carry
      // no labels there.
      const first =
        many && threatIds.includes(event.track)
          ? firstInWindow(plan, event.track, beginS, beginS + metrics.freezeT)
          : null
      const read = shown ? ` · ${sourceWord(shown)}` : ' · not in the picture'
      const atT0 = first ? `, ${(rangeM(first.track) / 1000).toFixed(1)} km at T0` : ''
      // Where the screen's ident at this look is not the name the log gives the track, the line
      // says what it read then (ruled R1): one name still rules the log, and what this keeps is
      // that the screen said something else at that second — on the corroboration pair, the
      // thing the run is about. Only where they differ, so no 03 line carries it.
      const then =
        shown && trackIdent(shown) !== ident(event.track)
          ? `, reading ${trackIdent(shown)} then`
          : ''
      ruledPush(
        event.t,
        line(`${head}opened ${named(event.track)}${read}${then}${atT0}.`, event.track),
      )
      // On a Vigil frame only: what Vigil read at that second, in the app's own words (C6, C7).
      // The frame's key says the Queue box and every reading are the frozen second's, so a look
      // after the freeze carries no reading — the engine at that later second would put a second,
      // contradicting reading on one frame (#176 round 1).
      if (record.mode === 'vigil' && shown && event.t <= metrics.freezeT) {
        const entry = rankedAtSecond(study, plan, beginS + event.t).find(
          (ranked) => ranked.track.id === event.track,
        )
        if (entry) {
          lines.push(line(`${vigilReading(entry)}.`, null))
          if (entry.score.mismatch) lines.push(line(`${mismatchLine(entry.score.mismatch)}.`, null))
        }
      }
      continue
    }
    if (event.type === 'assess' || event.type === 'dismiss') {
      ruledPush(event.t, line(`${head}${VERB[event.type]} ${named(event.track)}.`, event.track))
      continue
    }
    if (event.type !== 'escalate') continue
    const threat = metrics.threats.find((candidate) => candidate.id === event.track)
    if (threat && threat.standoffM !== null && threat.timeToEscalateS === event.t) {
      const km = (Math.abs(threat.standoffM) / 1000).toFixed(1)
      const side = threat.standoffM >= 0 ? 'outside' : 'inside'
      const margin =
        threat.entryT === null
          ? 'no ring entry'
          : threat.entryT >= event.t
            ? `${mmss(threat.entryT - event.t)} before entry`
            : `${mmss(event.t - threat.entryT)} after entry`
      const clock = threat.entryT === null ? '' : `, ring entry ${mmss(threat.entryT)}`
      ruledPush(
        event.t,
        line(
          `${head}escalated ${named(event.track)} ${km} km ${side} the ring · ${margin}${clock}.`,
          event.track,
          true,
        ),
      )
      continue
    }
    const other = others.find(
      (candidate) => candidate.id === event.track && candidate.t === event.t,
    )
    if (other)
      ruledPush(
        event.t,
        line(`${head}escalated ${named(event.track)} · ${outcomeWords(other)}.`, event.track, true),
      )
  }
  // A miss, once, beneath the log, with the ring entry it crossed while the run watched.
  for (const threat of metrics.threats) {
    if (!threat.miss) continue
    const clock = threat.entryT === null ? '' : `; ring entry ${mmss(threat.entryT)}`
    lines.push(line(`MISSED ${named(threat.id)} — never escalated${clock}.`, threat.id))
  }
  // The overlay's count on its own line at the foot of a Vigil frame (C6, S5g).
  if (record.mode === 'vigil') {
    lines.push(
      line(
        neverOpenedWords(
          record,
          candidatesAt(rankedAtSecond(study, plan, beginS + metrics.freezeT)),
        ),
        null,
      ),
    )
  }
  return lines
}
/**
 * What an escalated non-threat turned out to be, in the sheet's and the frame's one wording
 * (S5f, #173, the wording ruled at the gate): a real aircraft is named as one, since the brief
 * calls escalating a cooperative aircraft an error whatever its path (#36 [40] B); an inject
 * either never enters the ring or enters after the window closed — an inject inside it is the
 * metrics' throw — and a due-later inbound is never called a non-threat.
 */
export const outcomeWords = (other: OtherEscalation): string =>
  other.real
    ? 'a real aircraft — cooperative traffic, never a threat'
    : other.entryT === null
      ? 'never enters the ring'
      : `enters the ring at ${mmss(other.entryT)}, after the window closed`

/**
 * The one footnote sentence under the map (ruled on A5), on two lines: SVG text does not wrap,
 * and the sentence at 11 px runs past a 900 px panel in most faces (#151 round 1).
 */
export const FOOTNOTE_LINES = [
  '"never opened" marks the engine\'s above-calm tracks at the freeze that the run never opened:',
  "the analyst's overlay, drawn on both conditions; raw's screen never showed that set.",
] as const
export const FOOTNOTE = FOOTNOTE_LINES.join(' ')

/**
 * The key to the later part of the path (S5f, #173), on a frame that has one: the picture is the
 * frozen second's and the path is the whole run's, so the marks made after the freeze say so —
 * including the clause for a look the picture cannot place, which is left undrawn (ruled R2).
 * Two lines for the same reason as the overlay's: SVG text does not wrap, and the sentence with
 * that clause runs past a 900 px panel at 11 px.
 */
export const LATE_FOOTNOTE_LINES = [
  'A look after the freeze is drawn as a dashed outline on a dashed path, and one the regenerated picture no longer holds is not drawn at all:',
  "the background picture, the Queue box and every reading are the frozen second's.",
] as const

/** The theme's tokens, for the pair and the study figure (S5d) — one palette, fixed in the SVGs. */
export const THEME = COLOR
/** The two conditions' dot colours on the pair's block and the study figure (S5d): raw amber, Vigil the accent. */
export const CONDITION_COLOR = { raw: '#c9a227', vigil: COLOR.accent } as const

/** A frame drawn into a larger document (S5d): the clip id it may use, and the Queue box's cap. */
export interface FrameOptions {
  /** The clip path's id — unique within a document that holds two frames. */
  clipId?: string
  /** The Queue box's rows on the pair: its top rows and a count of the rest; every row when absent. */
  queueCap?: number
}

/** A frame's document without its `<svg>` wrapper: its size and its lines, for the frame and the pair. */
export interface FrameDocument {
  width: number
  height: number
  lines: string[]
}

const text = (x: number, y: number, content: string, attrs: string): string =>
  `<text x="${x}" y="${y}" font-family="${FONT}" ${attrs}>${esc(content)}</text>`

/** A threat's first frame in the window up to a second — the second and the track — or null when it never appears. */
function firstInWindow(
  plan: InjectPlan,
  id: string,
  fromS: number,
  toS: number,
): { tSec: number; track: Track } | null {
  for (let tSec = fromS; tSec <= toS; tSec++) {
    const track = injectTracksAt(plan, tSec).find((candidate) => candidate.id === id)
    if (track) return { tSec, track }
  }
  return null
}

/** A threat's positions from one second to another, projected, for its trail. */
function trailPoints(plan: InjectPlan, id: string, fromS: number, toS: number): [number, number][] {
  const points: [number, number][] = []
  for (let tSec = fromS; tSec <= toS; tSec++) {
    const threat = injectTracksAt(plan, tSec).find((track) => track.id === id)
    if (threat) points.push(project(threat.position))
  }
  return points
}

/** A box on the map panel — what the one placement the frame computes reads (#170). */
interface Box {
  x: number
  y: number
  w: number
  h: number
}
/**
 * A label's box from its baseline. An SVG carries no font engine and this module is pure, so the
 * width is estimated rather than measured: every label the frame draws measures between 0.408
 * and 0.507 of the font size per character in a browser, so 0.53 never under-reads one and over-
 * reads the longest by under a third. The ascent and the height are the measured 1.10 and 1.364
 * of the size, rounded up. Over-reading costs a label a spot it could have had; under-reading
 * would let one draw over another, which is the thing being fixed.
 */
const LABEL_PER_CHAR = 0.53
/** That estimate on its own, for any text an SVG must fit into a fixed width. */
export const estimateWidth = (content: string, size: number): number =>
  LABEL_PER_CHAR * size * content.length

/**
 * A sentence broken onto lines that fit a width (#174 round 1): SVG text does not wrap, and a
 * sentence that names every escalation a run made runs past a fixed edge once the run made
 * enough of them — five, measured at 1 839 px on an 1 820 px sheet. Words are kept whole, and
 * the width is the estimate above, which never under-reads: it wraps a line early rather than
 * letting one run long, which is the thing being fixed.
 */
export function wrapText(chunks: readonly string[], size: number, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const chunk of chunks) {
    const next = line === '' ? chunk : `${line} ${chunk}`
    if (line !== '' && estimateWidth(next, size) > width) {
      lines.push(line)
      line = chunk
    } else {
      line = next
    }
  }
  return [...lines, line]
}

export function textBox(
  x: number,
  baseline: number,
  size: number,
  content: string,
  end = false,
): Box {
  const w = estimateWidth(content, size)
  return {
    x: (end ? x - w : x) - 0.1 * size,
    y: baseline - 1.15 * size,
    w: w + 0.2 * size,
    h: 1.45 * size,
  }
}
const markBox = (cx: number, cy: number, r: number): Box => ({
  x: cx - r,
  y: cy - r,
  w: 2 * r,
  h: 2 * r,
})
const hits = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const boxInPanel = (b: Box): boolean =>
  b.x >= 0 && b.y >= 0 && b.x + b.w <= PANEL.width && b.y + b.h <= PANEL.height

/**
 * Where a threat's label may sit around its dot (#170): its own place first — below-right, where
 * F2 put it — then the other three corners, then a ring further out. The first spot whose box
 * clears everything already drawn wins.
 */
const LABEL_SPOTS: readonly (readonly [number, number, boolean])[] = [
  [9, 16, false],
  [9, -10, false],
  [-9, 16, true],
  [-9, -10, true],
  [9, 31, false],
  [-9, 31, true],
  [9, -25, false],
  [-9, -25, true],
]

/** A drawn line a label would sit across: a segment of the look path (#170, ruled R1). */
export type Segment = readonly [readonly [number, number], readonly [number, number]]

/** Whether a segment enters a box — the four edges, and the case of a segment wholly inside. */
export function crossesBox(box: Box, [[x1, y1], [x2, y2]]: Segment): boolean {
  const inside = (x: number, y: number) =>
    x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h
  if (inside(x1, y1) || inside(x2, y2)) return true
  const side = (px: number, py: number) => (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)
  const corners: [number, number][] = [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x + box.w, box.y + box.h],
    [box.x, box.y + box.h],
  ]
  // The segment's line must separate the corners, and the box's span must reach the segment's.
  const signs = corners.map((c) => Math.sign(side(c[0], c[1])))
  if (signs.every((v) => v > 0) || signs.every((v) => v < 0)) return false
  return (
    Math.max(x1, x2) >= box.x &&
    Math.min(x1, x2) <= box.x + box.w &&
    Math.max(y1, y2) >= box.y &&
    Math.min(y1, y2) <= box.y + box.h
  )
}

/**
 * Whether a circle's own outline enters a box (#170, ruled R1) — the 5 km ring, which is a line
 * on the map and not a disc: the box straddles it when its nearest point is inside the radius
 * and its farthest corner is outside.
 */
export function crossesRing(box: Box, cx: number, cy: number, r: number): boolean {
  const nx = Math.max(box.x, Math.min(cx, box.x + box.w))
  const ny = Math.max(box.y, Math.min(cy, box.y + box.h))
  const near = Math.hypot(cx - nx, cy - ny)
  const far = Math.max(
    Math.hypot(cx - box.x, cy - box.y),
    Math.hypot(cx - (box.x + box.w), cy - box.y),
    Math.hypot(cx - (box.x + box.w), cy - (box.y + box.h)),
    Math.hypot(cx - box.x, cy - (box.y + box.h)),
  )
  return near <= r && far >= r
}

/**
 * The spot a threat's label takes (#170, ruled R1 and R2): the spots are searched twice — first
 * for one that clears every mark and label **and** is crossed by no line, the ring or a segment
 * of the look path; then, if none, for one that clears the marks and labels alone. Only then the
 * fallback, its own place, which the label draws last from, so it is on top of what crowds it
 * rather than under. A spot must lie wholly inside the panel in either pass (R2), so no label is
 * cut by the panel's edge.
 *
 * The path and the threat's label are what a debrief reads, so a label across the path costs the
 * reader something even though nothing is hidden — hence the second pass rather than one.
 */
export function placeLabel(
  x: number,
  y: number,
  size: number,
  content: string,
  occupied: readonly Box[],
  lines: readonly Segment[] = [],
  ring: { cx: number; cy: number; r: number } | null = null,
): { x: number; y: number; end: boolean; pass: 0 | 1 | 2 } {
  const clears = (box: Box) => boxInPanel(box) && !occupied.some((other) => hits(box, other))
  const noLine = (box: Box) =>
    !lines.some((line) => crossesBox(box, line)) &&
    !(ring !== null && crossesRing(box, ring.cx, ring.cy, ring.r))
  for (const pass of [1, 2] as const) {
    for (const [dx, dy, end] of LABEL_SPOTS) {
      const box = textBox(x + dx, y + dy, size, content, end)
      if (!clears(box)) continue
      if (pass === 1 && !noLine(box)) continue
      return { x: round1(x + dx), y: round1(y + dy), end, pass }
    }
  }
  const [dx, dy, end] = LABEL_SPOTS[0]
  return { x: round1(x + dx), y: round1(y + dy), end, pass: 0 }
}

const polyline = (points: readonly (readonly [number, number])[], attrs: string): string =>
  points.length < 2
    ? ''
    : `<polyline points="${points.map(([x, y]) => `${x},${y}`).join(' ')}" fill="none" ${attrs}/>`

/** The frame as an SVG document. */
export function frameSvg(input: FrameInput): string {
  const { width, height, lines } = frameDocument(input)
  const { record } = input
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-subject="${escAttr(record.subject)}" data-scenario="${escAttr(record.scenario)}" data-mode="${record.mode}" data-run="${record.run}">`,
    ...lines,
    '</svg>',
    '',
  ].join('\n')
}

/** The frame's document body: everything between the wrapper's tags, in order. */
export function frameDocument(input: FrameInput, options: FrameOptions = {}): FrameDocument {
  const { record, metrics, study, plan } = input
  const clipId = options.clipId ?? 'panel'
  const { beginS } = STUDY
  const freezeS = beginS + metrics.freezeT
  const lines = captionLines(input)
  // One name per track, the log’s (S5g, #175): the ident without the role, for the map.
  const { ident } = trackNamer(input)
  const captionH = 16 + lines.length * LINE_H + 12
  const parts: string[] = []
  // What the map has already drawn, for the one label whose place is computed (#170): a threat's
  // own label is held back to the end and put where it clears these.
  const occupied: Box[] = []
  const pending: { x: number; y: number; content: string; attrs: (end: boolean) => string }[] = []

  // The picture at the freeze: every track inside the panel, a small grey dot, in id order.
  const picture = pictureAtSecond(study.index, plan, freezeS, record.mode)
  const dots = [...picture]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((track): [Track, [number, number]] => [track, project(track.position)])
    .filter(([, point]) => inPanel(point))
  for (const [track, [x, y]] of dots) {
    parts.push(
      `<circle class="track" data-id="${escAttr(track.id)}" cx="${x}" cy="${y}" r="3" fill="${COLOR.faint}"/>`,
    )
    // A track's own dot is a mark like any other: a label over one hides a track (#172 round 1).
    occupied.push(markBox(x, y, 3))
  }

  // The ring, its centre, and its label — the site's own name.
  const [cx, cy] = project(SITE.center)
  const r = round1((SITE.radiusM / 1000) * PANEL.pxPerKm)
  parts.push(
    `<circle class="ring" cx="${cx}" cy="${cy}" r="${r}" fill="${COLOR.accent}" fill-opacity="0.08" stroke="${COLOR.accent}" stroke-width="1.5"/>`,
    `<rect x="${cx - 4}" y="${cy - 4}" width="8" height="8" fill="${COLOR.accent}"/>`,
    text(
      cx + 10,
      cy + 22,
      `${SITE.name} · ${SITE.radiusM / 1000} km ring`,
      `font-size="13" fill="${COLOR.muted}"`,
    ),
  )
  occupied.push(textBox(cx + 10, cy + 22, 13, `${SITE.name} · ${SITE.radiusM / 1000} km ring`))

  // Each threat's trail from its first frame in the window to the freeze, its plan-known
  // continuation to the entry tick fainter, and the two marks — one threat on the corroboration
  // pair with the marks' two labels as S5b drew them; two on the prioritization pair, each trail
  // tagged by its id, the marks unlabelled and the threat carrying one map label at a spot around
  // its dot at the freeze — on raw its id and the ring-entry clock, on Vigil the annotation's
  // (ruled F2), placed where the map is clear (#170); the T0 range and the entry clock are the
  // caption's there.
  const threatIds = threatsOf(record.scenario)
  const many = threatIds.length > 1
  for (const threat of metrics.threats) {
    const first = firstInWindow(plan, threat.id, beginS, freezeS)
    if (first === null) continue
    const firstS = first.tSec
    const idAttr = many ? ` data-id="${escAttr(threat.id)}"` : ''
    const trail = trailPoints(plan, threat.id, firstS, freezeS)
    parts.push(
      polyline(
        trail,
        `class="trail"${idAttr} stroke="${COLOR.muted}" stroke-width="1.5" stroke-dasharray="2 4"`,
      ),
    )
    const entryS = threat.entryT === null ? null : beginS + threat.entryT
    if (entryS !== null && entryS > freezeS) {
      parts.push(
        polyline(
          trailPoints(plan, threat.id, freezeS, entryS),
          `class="trail-ahead"${idAttr} stroke="${COLOR.faint}" stroke-width="1" stroke-dasharray="1 5"`,
        ),
      )
    }
    const [fx, fy] = project(first.track.position)
    parts.push(
      `<circle class="trail-first"${idAttr} cx="${fx}" cy="${fy}" r="2.5" fill="${COLOR.muted}"/>`,
    )
    occupied.push(markBox(fx, fy, 2.5))
    if (!many) {
      const t0 = `T0 · ${(rangeM(first.track) / 1000).toFixed(1)} km`
      parts.push(text(round1(fx + 8), round1(fy + 14), t0, `font-size="11" fill="${COLOR.faint}"`))
      occupied.push(textBox(round1(fx + 8), round1(fy + 14), 11, t0))
    }
    if (entryS !== null) {
      const atEntry = injectTracksAt(plan, entryS).find((track) => track.id === threat.id)
      if (atEntry) {
        const [ex, ey] = project(atEntry.position)
        parts.push(
          `<circle class="entry"${idAttr} cx="${ex}" cy="${ey}" r="3" fill="none" stroke="${COLOR.muted}" stroke-width="1.5"/>`,
        )
        occupied.push(markBox(ex, ey, 3))
        if (!many) {
          const entryLabel = `${mmss(threat.entryT!)} ring entry`
          parts.push(
            text(
              round1(ex + 8),
              round1(ey - 6),
              entryLabel,
              `font-size="11" fill="${COLOR.faint}"`,
            ),
          )
          occupied.push(textBox(round1(ex + 8), round1(ey - 6), 11, entryLabel))
        }
      }
    }
    // The pair's one map label per threat on a raw frame; a Vigil frame's is the annotation's.
    // Held back to the end and placed where the map is clear (#170). It names the track as the
    // log names it (S5g, #175), so a sheet's two maps call one track one thing; the role stays
    // in the log's prose, where a reader is reading rather than scanning a map.
    if (many && record.mode === 'raw' && trail.length > 0) {
      const [x, y] = trail[trail.length - 1]
      pending.push({
        x,
        y,
        content: `${ident(threat.id)}${threat.entryT === null ? '' : ` · ring entry ${mmss(threat.entryT)}`}`,
        attrs: (end) =>
          `class="threat-label" data-id="${escAttr(threat.id)}" font-size="11"${end ? ' text-anchor="end"' : ''} fill="${COLOR.faint}"`,
      })
    }
  }

  // The analyst's overlay: the engine's above-calm injects at the freeze the run never opened.
  // "Never opened" is about the whole run, as the footnote says: a track opened after the freeze
  // is not marked (#151 round 1).
  const ranked = rankedAtSecond(study, plan, freezeS)
  const candidates = candidatesAt(ranked)
  for (const candidate of neverOpened(record, candidates)) {
    const point = project(candidate.track.position)
    if (!inPanel(point)) continue
    const [x, y] = point
    parts.push(
      `<circle class="never-opened" data-id="${escAttr(candidate.track.id)}" cx="${x}" cy="${y}" r="6" fill="none" stroke="${COLOR.faint}" stroke-width="1"/>`,
      text(
        round1(x + 9),
        round1(y + 4),
        'never opened',
        `font-size="11" font-style="italic" fill="${COLOR.faint}"`,
      ),
    )
    occupied.push(markBox(x, y, 6), textBox(round1(x + 9), round1(y + 4), 11, 'never opened'))
  }

  // The looks as numbered hops at the selected track's regenerated position, the path through
  // them in order; the threat's looks in the warning colour. The whole run's looks, not the
  // frozen second's (S5f, #173): the two conditions' frames otherwise cover different spans and
  // the quieter one is overstated. A look after the freeze is the same hop, drawn as a dashed
  // outline in its track’s colour and filled with the panel’s (ruled R1); the marker below says why.
  const looks = looksOfRun(record)
  const hops = looks.flatMap((event, i) => {
    const track = trackAtSecond(study.index, plan, event.track, beginS + event.t, record.mode)
    const late = event.t > metrics.freezeT
    if (track === null) {
      // A look up to the freeze names the picture the frame is of, so a track the picture does
      // not hold stops the tool, as it always has. A look after it is outside that picture's
      // second: it is left undrawn and the footnote's key says so (S5f, #173, ruled R2).
      if (!late) {
        throw new Error(
          `${record.subject} run ${record.run}: look #${i + 1} at t ${event.t} names ${event.track}, not in the picture then`,
        )
      }
      return []
    }
    return [{ k: i + 1, event, point: project(track.position), late }]
  })
  // The path in two pieces: up to the freeze as it was drawn, and the rest lighter and dashed —
  // the segment that joins them belongs to the later piece, since it leaves the frozen second.
  const onTime = hops.filter((hop) => !hop.late)
  const late = hops.slice(onTime.length)
  // Whether the run looked at anything after the freeze at all — every look up to it is drawn or
  // throws, so this counts the ones R2 may leave undrawn as well as the ones the map shows.
  const afterFreeze = looks.length > onTime.length
  parts.push(
    polyline(
      onTime.map((hop) => hop.point),
      `class="path" stroke="${COLOR.accent}" stroke-opacity="0.5" stroke-width="1.5"`,
    ),
  )
  if (late.length > 0) {
    parts.push(
      polyline(
        hops.slice(Math.max(onTime.length - 1, 0)).map((hop) => hop.point),
        `class="path-late" stroke="${COLOR.accent}" stroke-opacity="0.35" stroke-width="1.5" stroke-dasharray="4 4"`,
      ),
    )
  }
  // One marker per distinct track visited (S5e, #164): at that track's first look, labelled with
  // its number and a `×N` badge when the run came back to it. The path still runs through every
  // visit, so a revisit reads as a bend; a marker per visit stacks them where the track barely moved.
  const visits = new Map<string, number>()
  for (const hop of hops) visits.set(hop.event.track, (visits.get(hop.event.track) ?? 0) + 1)
  // The marker sits at the track's first look **on the panel**: a hop off it is clipped, and
  // before this change every look had its own circle, so a track looked at once off-panel and
  // once on kept a visible marker (#171 round 1). With none on the panel, the first look stands.
  const marked = [...new Set(hops.map((hop) => hop.event.track))].map((track) => {
    const its = hops.filter((hop) => hop.event.track === track)
    return its.find((hop) => inPanel(hop.point)) ?? its[0]
  })
  for (const {
    k,
    event,
    point: [x, y],
    late: isLate,
  } of marked) {
    const fill = threatIds.includes(event.track) ? COLOR.warning : COLOR.accent
    const n = visits.get(event.track)!
    // A marker whose own look is after the freeze is drawn as a dashed outline in the same
    // colour, its numeral in that colour rather than knocked out of a solid disc; one the run
    // came back to after the freeze keeps its weight, since it was made at the frozen second.
    // Lighter by ink and not by opacity: dimming the disc takes the numeral's contrast to 1.6
    // against the panel, where the outline holds it at 6.3 — the number is what the caption is
    // keyed to. The outline is filled with the panel's own colour (ruled R1), so the numeral
    // reads over the panel wherever the marker lands and never over the ring, a trail or a dot.
    parts.push(
      `<circle class="${isLate ? 'hop-late' : 'hop'}" data-k="${k}"${n > 1 ? ` data-visits="${n}"` : ''} data-id="${escAttr(event.track)}" data-t="${event.t}" cx="${x}" cy="${y}" r="9" ${isLate ? `fill="${COLOR.panel}" stroke="${fill}" stroke-width="1.5" stroke-dasharray="3 2"` : `fill="${fill}"`}/>`,
      text(
        x,
        y + 4,
        String(k),
        `font-size="11" font-weight="700" text-anchor="middle" fill="${isLate ? fill : COLOR.bg}"`,
      ),
      ...(n > 1
        ? [
            text(
              round1(x + 11),
              round1(y - 5),
              `×${n}`,
              `class="hop-visits" data-id="${escAttr(event.track)}" font-size="10" font-weight="700" fill="${fill}"`,
            ),
          ]
        : []),
    )
    // The marker's own disc covers its numeral; the badge sits beside it.
    occupied.push(markBox(x, y, 9))
    if (n > 1) occupied.push(textBox(round1(x + 11), round1(y - 5), 10, `×${n}`))
  }

  // The condition's own annotations, on a Vigil frame only (S5c-ii, C2–C5, C7): the warm labels
  // beside every above-calm inject, the Queue box, each threat's mismatch line when its score
  // read one, and the Entry row's estimate beside each threat's dot. Raw's screen showed none.
  if (record.mode === 'vigil') {
    for (const candidate of candidates) {
      // On the prioritization pair a threat's label is drawn with its entry estimate in one label
      // (the threat block below); the marks crowd within a few pixels at 6 km.
      if (many && threatIds.includes(candidate.track.id)) continue
      const point = project(candidate.track.position)
      if (!inPanel(point)) continue
      const [x, y] = point
      const warm = `${trackIdent(candidate.track)} · ${candidate.composite}`
      parts.push(
        text(
          round1(x + 9),
          round1(y - 7),
          warm,
          `class="vigil-label" data-id="${escAttr(candidate.track.id)}" font-size="11" font-weight="600" fill="${bandFill(candidate.band)}"`,
        ),
      )
      occupied.push(textBox(round1(x + 9), round1(y - 7), 11, warm))
    }
    for (const threat of metrics.threats) {
      const entry = ranked.find((candidate) => candidate.track.id === threat.id)
      if (!entry) continue
      const [x, y] = project(entry.track.position)
      const { track, score } = entry
      if (score.mismatch && track.source === 'inject' && track.broadcast) {
        const [bx, by] = project(track.broadcast.position)
        const says = `Remote ID says here · ${(score.mismatch.distanceM / 1000).toFixed(1)} km`
        parts.push(
          `<line class="vigil-mismatch" data-id="${escAttr(threat.id)}" x1="${x}" y1="${y}" x2="${bx}" y2="${by}" stroke="${COLOR.warning}" stroke-width="1" stroke-dasharray="4 3"/>`,
          `<circle class="vigil-broadcast" data-id="${escAttr(threat.id)}" cx="${bx}" cy="${by}" r="3" fill="none" stroke="${COLOR.warning}" stroke-width="1"/>`,
          text(
            round1(bx + 8),
            round1(by + 4),
            says,
            `class="vigil-mismatch-label" font-size="11" fill="${COLOR.warning}"`,
          ),
        )
        occupied.push(markBox(bx, by, 3), textBox(round1(bx + 8), round1(by + 4), 11, says))
      }
      // The Entry row's estimate beside the dot; nothing when the row reads none or the track
      // is on the ground.
      const estimate = timeToEntry(track, [SITE])
      const entryText =
        estimate === null
          ? null
          : estimate.kind === 'entry'
            ? `entry in ${mmss(Math.round(estimate.tSec))}`
            : estimate.kind === 'inside'
              ? 'inside the ring'
              : null
      // The threat's one map label on the pair (ruled F2): ident, composite, and the entry
      // estimate in the band's colour, at a spot the placement gives it (#170); on one threat,
      // the S5c gate's two labels.
      const label = many
        ? `${trackIdent(track)} · ${entry.composite}${entryText ? ` · ${entryText}` : ''}`
        : entryText
      if (label) {
        pending.push({
          x,
          y,
          content: label,
          attrs: (end) =>
            many
              ? `class="vigil-threat-label" data-id="${escAttr(threat.id)}" font-size="11" font-weight="600"${end ? ' text-anchor="end"' : ''} fill="${bandFill(entry.band)}"`
              : `class="vigil-entry" data-id="${escAttr(threat.id)}" font-size="11"${end ? ' text-anchor="end"' : ''} fill="${COLOR.text}"`,
        })
      }
    }
  }

  // The threats' own labels, last on the map and each at the first spot around its dot that
  // clears what is already there (#170). A label placed takes its own place among the obstacles,
  // so two threats' labels do not land on one another.
  // The look path's own segments and the ring are the lines the first pass avoids (R1).
  const pathLines: Segment[] = hops.slice(1).map((hop, i): Segment => [hops[i].point, hop.point])
  const ringLine = { cx, cy, r }
  for (const label of pending) {
    const spot = placeLabel(label.x, label.y, 11, label.content, occupied, pathLines, ringLine)
    parts.push(text(spot.x, spot.y, label.content, label.attrs(spot.end)))
    occupied.push(textBox(spot.x, spot.y, 11, label.content, spot.end))
  }

  const beyond = hops.filter((hop) => !inPanel(hop.point)).length
  // Both counts, as the frame now draws both spans (S5f, #173): the whole run, and how much of
  // it stands at the frozen second. A run with nothing after the freeze reads as it always did —
  // and the treatment itself is the footnote's, beside the overlay's, since the subtitle carrying
  // both counts and a key measured 842 px of the panel's 900 in a browser.
  // The counts are the run's own, not the drawn marks': a late look the picture cannot place is
  // still a look the subject took (R2), and the key line accounts for it.
  const span = afterFreeze
    ? `${plural(looks.length, 'look')} over the whole run, ${onTime.length} to the freeze`
    : plural(looks.length, 'look')
  const header = [
    text(
      30,
      40,
      headerLine(input),
      `class="title" font-size="20" font-weight="700" fill="${COLOR.text}"`,
    ),
    text(
      30,
      64,
      // A look at a track beyond the panel keeps its hop off the panel, clipped; the count says
      // so, so the header and the frame agree (#151 round 1).
      `The subject's selection sequence from the run JSON, replayed as a path. ${span}${beyond > 0 ? `, ${beyond} beyond the panel` : ''}.`,
      `class="subtitle" font-size="13" fill="${COLOR.muted}"`,
    ),
  ]
  const footY = HEADER_H + PANEL.height + 20
  // The footnote takes the key’s line only on a frame that has a look after the freeze, so a
  // frame without one keeps its height to the byte (S5f, #173).
  const footnotes = afterFreeze ? [...FOOTNOTE_LINES, ...LATE_FOOTNOTE_LINES] : [...FOOTNOTE_LINES]
  const footH = FOOT_H + (afterFreeze ? 28 : 0)
  // The Queue box on a Vigil frame (C2), under the map between the footnote and the caption:
  // every above-calm inject at the freeze in rank order, the rank in the band's colour, the
  // composite, and the Queue's own reason tag. On the map it would cover a threat when the
  // cast puts fourteen above calm (S5c-ii's gate).
  const queueY = HEADER_H + PANEL.height + footH
  // On the pair the box shows its top rows and counts the rest (S5d); the frame every row.
  const shown =
    options.queueCap !== undefined && candidates.length > options.queueCap
      ? candidates.slice(0, options.queueCap)
      : candidates
  const more = candidates.length - shown.length
  const queueRows = shown.length + (more > 0 ? 1 : 0)
  const queueH = record.mode === 'vigil' ? 30 + queueRows * 18 + 6 : 0
  const queue =
    record.mode === 'vigil'
      ? [
          `<rect class="vigil-queue" x="30" y="${queueY}" width="${PANEL.width - 60}" height="${queueH}" rx="6" fill="${COLOR.panel}" stroke="${COLOR.line}"/>`,
          text(
            46,
            queueY + 20,
            `Queue at ${mmss(metrics.freezeT)} · ${candidates.length} above calm`,
            `class="vigil-queue-title" font-size="12" font-weight="700" fill="${COLOR.text}"`,
          ),
          ...shown.map(
            (candidate, i) =>
              `<text x="46" y="${queueY + 38 + i * 18}" font-family="${FONT}" class="vigil-queue-line" data-id="${escAttr(candidate.track.id)}" font-size="11" fill="${COLOR.muted}"><tspan font-weight="700" fill="${bandFill(candidate.band)}">${candidate.rank}</tspan> ${esc(`${trackIdent(candidate.track)} ${candidate.composite} · ${reasonTag(candidate, AO.protectedSites)}`)}</text>`,
          ),
          ...(more > 0
            ? [
                text(
                  46,
                  queueY + 38 + shown.length * 18,
                  `… ${more} more above calm, on the run's own frame`,
                  `class="vigil-queue-more" font-size="11" font-style="italic" fill="${COLOR.faint}"`,
                ),
              ]
            : []),
        ]
      : []
  const captionY = queueY + (record.mode === 'vigil' ? queueH + 12 : 0)
  const height = captionY + captionH
  const caption = [
    `<rect x="30" y="${captionY}" width="${PANEL.width - 60}" height="${captionH}" rx="6" fill="${COLOR.panel}" stroke="${COLOR.line}"/>`,
    ...lines.flatMap((line, i) => {
      const y = captionY + 16 + (i + 1) * LINE_H - 6
      if (line.rule !== true) {
        return [
          text(
            46,
            y,
            line.text,
            `class="caption" font-size="13" ${line.bold ? `font-weight="600" fill="${COLOR.text}"` : `fill="${COLOR.muted}"`}`,
          ),
        ]
      }
      // The rule sits on the line's own middle, its label to the left of it (R2).
      const from = round1(46 + estimateWidth(line.text, 11) + 8)
      return [
        text(
          46,
          y - 3,
          line.text,
          `class="caption-rule-label" font-size="11" fill="${COLOR.faint}"`,
        ),
        `<line class="caption-rule" x1="${from}" y1="${y - 7}" x2="${PANEL.width - 46}" y2="${y - 7}" stroke="${COLOR.line}"/>`,
      ]
    }),
  ]

  const lines_ = [
    `<rect width="${PANEL.width}" height="${height}" fill="${COLOR.bg}"/>`,
    ...header,
    `<defs><clipPath id="${clipId}"><rect x="0" y="0" width="${PANEL.width}" height="${PANEL.height}"/></clipPath></defs>`,
    `<g class="map" transform="translate(0 ${HEADER_H})" clip-path="url(#${clipId})">`,
    `<rect width="${PANEL.width}" height="${PANEL.height}" fill="${COLOR.panel}"/>`,
    ...parts,
    '</g>',
    ...footnotes.map((line, i) =>
      text(30, footY + i * 14, line, `class="footnote" font-size="11" fill="${COLOR.faint}"`),
    ),
    ...queue,
    ...caption,
  ]
  return { width: PANEL.width, height, lines: lines_ }
}

/** The file a run's frame is written to: `<subject>-<scenario>-<mode>-<run>.svg`. */
export const frameName = (record: RunRecord): string =>
  `${record.subject}-${record.scenario}-${record.mode}-${record.run}.svg`
