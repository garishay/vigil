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
import { threatsOf, type RunMetrics } from './metrics.ts'
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

/** The looks the frozen frame shows: every select up to and including the freeze second. */
export const looksOnFrame = (record: RunRecord, freezeT: number): RunEvent[] =>
  record.events.filter((event) => event.type === 'select' && event.t <= freezeT)

const VERB: Partial<Record<RunEvent['type'], string>> = {
  assess: 'assessed',
  escalate: 'escalated',
  dismiss: 'dismissed',
}

/** The header's first line: the condition, and the moment the frame is frozen at. */
export const headerLine = (record: RunRecord, metrics: RunMetrics): string => {
  const missed = metrics.threats.filter((threat) => threat.miss)
  const many = metrics.threats.length > 1
  return `${record.mode === 'raw' ? 'UNAIDED' : 'WITH VIGIL'} · ${
    missed.length > 0
      ? `MISSED${many ? ` ${missed.map((threat) => threat.id).join(', ')}` : ''} — frozen at +${mmss(metrics.runS)}`
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
 * The caption box's lines, the same template in both modes: one pair per look at the threat on
 * the frame — what the subject did on it before their next look at it, and what it read as at
 * that second in the run's mode — then the decision line.
 */
export function captionLines({ record, metrics, study, plan }: FrameInput): string[] {
  // By position in the record, not by second: two looks on one second are two looks, and an
  // action belongs to the look before it in the record's order (#151 round 1).
  const looks = record.events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.type === 'select' && event.t <= metrics.freezeT)
  const threatIds = metrics.threats.map((threat) => threat.id)
  const many = threatIds.length > 1
  const name = (id: string) => (many ? `${id} (threat ${threatIds.indexOf(id) + 1})` : 'the threat')
  const threatLooks = looks
    .map(({ event, index }, i) => ({ event, index, k: i + 1 }))
    .filter(({ event }) => threatIds.includes(event.track))
  const lines: string[] = []
  threatLooks.forEach(({ event, index, k }, j) => {
    const nextIndex =
      threatLooks.slice(j + 1).find((look) => look.event.track === event.track)?.index ?? Infinity
    const actions = record.events
      .filter(
        (action, i) =>
          action.track === event.track &&
          VERB[action.type] !== undefined &&
          i > index &&
          i < nextIndex &&
          action.t <= metrics.freezeT,
      )
      .map((action) => `${VERB[action.type]} at ${mmss(action.t)}`)
    // On the pair the T0 range comes here from the map (ruled F2): the marks carry no labels.
    const first = many
      ? firstInWindow(plan, event.track, STUDY.beginS, STUDY.beginS + metrics.freezeT)
      : null
    const atT0 = first ? `, ${(rangeM(first.track) / 1000).toFixed(1)} km at T0` : ''
    lines.push(
      `Look #${k} · ${mmss(event.t)} — opened ${name(event.track)}${atT0}${actions.length > 0 ? `; ${actions.join(', ')}` : ''}.`,
    )
    const shown = trackAtSecond(study.index, plan, event.track, STUDY.beginS + event.t, record.mode)
    lines.push(
      shown
        ? `It read as ${trackIdent(shown)} · ${sourceWord(shown)}.`
        : 'It was not in the picture.',
    )
    // On a Vigil frame only: what Vigil read at that second, in the app's own words (C6, C7).
    if (record.mode === 'vigil' && shown) {
      const entry = rankedAtSecond(study, plan, STUDY.beginS + event.t).find(
        (ranked) => ranked.track.id === event.track,
      )
      if (entry) {
        lines.push(`${vigilReading(entry)}.`)
        if (entry.score.mismatch) lines.push(`${mismatchLine(entry.score.mismatch)}.`)
      }
    }
  })
  // The decision line, one per threat in the bench's row order: the escalation with its standoff
  // and its distance from the entry, or the miss; on one threat, S5b's line as it was.
  for (const threat of metrics.threats) {
    if (threat.miss || threat.standoffM === null || threat.timeToEscalateS === null) {
      const clock = many && threat.entryT !== null ? `; ring entry ${mmss(threat.entryT)}` : ''
      lines.push(
        `MISSED${many ? ` ${threat.id}` : ''} — never escalated; ${plural(looks.length, 'look')}${clock}.`,
      )
      continue
    }
    const last = [...threatLooks]
      .reverse()
      .find((look) => look.event.track === threat.id && look.event.t <= threat.timeToEscalateS!)
    const who = last ? `Look #${last.k} · ${mmss(threat.timeToEscalateS)} — ` : ''
    const km = (Math.abs(threat.standoffM) / 1000).toFixed(1)
    const side = threat.standoffM >= 0 ? 'outside' : 'inside'
    const entry =
      threat.entryT === null
        ? 'no ring entry'
        : threat.entryT >= threat.timeToEscalateS
          ? `${mmss(threat.entryT - threat.timeToEscalateS)} before entry`
          : `${mmss(threat.timeToEscalateS - threat.entryT)} after entry`
    const clock = many && threat.entryT !== null ? `, ring entry ${mmss(threat.entryT)}` : ''
    lines.push(
      `${who}escalated ${many ? threat.id : 'it'} ${km} km ${side} the ring · ${entry}${clock}.`,
    )
  }
  // The overlay's count in words, on the last decision line of a Vigil frame (C6).
  if (record.mode === 'vigil') {
    lines[lines.length - 1] +=
      ` ${neverOpenedWords(record, candidatesAt(rankedAtSecond(study, plan, STUDY.beginS + metrics.freezeT)))}`
  }
  return lines
}

/**
 * The one footnote sentence under the map (ruled on A5), on two lines: SVG text does not wrap,
 * and the sentence at 11 px runs past a 900 px panel in most faces (#151 round 1).
 */
export const FOOTNOTE_LINES = [
  '"never opened" marks the engine\'s above-calm tracks at the freeze that the run never opened:',
  "the analyst's overlay, drawn on both conditions; raw's screen never showed that set.",
] as const
export const FOOTNOTE = FOOTNOTE_LINES.join(' ')

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
  const looks = looksOnFrame(record, metrics.freezeT)
  const lines = captionLines(input)
  const captionH = 16 + lines.length * LINE_H + 12
  const parts: string[] = []

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

  // Each threat's trail from its first frame in the window to the freeze, its plan-known
  // continuation to the entry tick fainter, and the two marks — one threat on the corroboration
  // pair with the marks' two labels as S5b drew them; two on the prioritization pair, each trail
  // tagged by its id, the marks unlabelled and the threat carrying one map label below-right of
  // its dot at the freeze — on raw its id and the ring-entry clock, on Vigil the annotation's
  // (ruled F2); the T0 range and the entry clock are the caption's there.
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
    if (!many) {
      parts.push(
        text(
          round1(fx + 8),
          round1(fy + 14),
          `T0 · ${(rangeM(first.track) / 1000).toFixed(1)} km`,
          `font-size="11" fill="${COLOR.faint}"`,
        ),
      )
    }
    if (entryS !== null) {
      const atEntry = injectTracksAt(plan, entryS).find((track) => track.id === threat.id)
      if (atEntry) {
        const [ex, ey] = project(atEntry.position)
        parts.push(
          `<circle class="entry"${idAttr} cx="${ex}" cy="${ey}" r="3" fill="none" stroke="${COLOR.muted}" stroke-width="1.5"/>`,
        )
        if (!many) {
          parts.push(
            text(
              round1(ex + 8),
              round1(ey - 6),
              `${mmss(threat.entryT!)} ring entry`,
              `font-size="11" fill="${COLOR.faint}"`,
            ),
          )
        }
      }
    }
    // The pair's one map label per threat on a raw frame; a Vigil frame's is the annotation's.
    if (many && record.mode === 'raw' && trail.length > 0) {
      const [x, y] = trail[trail.length - 1]
      parts.push(
        text(
          round1(x + 9),
          round1(y + 16),
          `${threat.id}${threat.entryT === null ? '' : ` · ring entry ${mmss(threat.entryT)}`}`,
          `class="threat-label" data-id="${escAttr(threat.id)}" font-size="11" fill="${COLOR.faint}"`,
        ),
      )
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
  }

  // The looks as numbered hops at the selected track's regenerated position, the path through
  // them in order; the threat's looks in the warning colour.
  const hops = looks.map((event, i) => {
    const track = trackAtSecond(study.index, plan, event.track, beginS + event.t, record.mode)
    if (track === null) {
      throw new Error(
        `${record.subject} run ${record.run}: look #${i + 1} at t ${event.t} names ${event.track}, not in the picture then`,
      )
    }
    return { k: i + 1, event, point: project(track.position) }
  })
  parts.push(
    polyline(
      hops.map((hop) => hop.point),
      `class="path" stroke="${COLOR.accent}" stroke-opacity="0.5" stroke-width="1.5"`,
    ),
  )
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
  } of marked) {
    const fill = threatIds.includes(event.track) ? COLOR.warning : COLOR.accent
    const n = visits.get(event.track)!
    parts.push(
      `<circle class="hop" data-k="${k}"${n > 1 ? ` data-visits="${n}"` : ''} data-id="${escAttr(event.track)}" data-t="${event.t}" cx="${x}" cy="${y}" r="9" fill="${fill}"/>`,
      text(
        x,
        y + 4,
        String(k),
        `font-size="11" font-weight="700" text-anchor="middle" fill="${COLOR.bg}"`,
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
  }

  // The condition's own annotations, on a Vigil frame only (S5c-ii, C2–C5, C7): the warm labels
  // beside every above-calm inject, the Queue box, each threat's mismatch line when its score
  // read one, and the Entry row's estimate beside each threat's dot. Raw's screen showed none.
  if (record.mode === 'vigil') {
    for (const candidate of candidates) {
      // On the prioritization pair a threat's label is drawn with its entry estimate, below-right
      // (the threat block below); the marks crowd within a few pixels at 6 km.
      if (many && threatIds.includes(candidate.track.id)) continue
      const point = project(candidate.track.position)
      if (!inPanel(point)) continue
      const [x, y] = point
      parts.push(
        text(
          round1(x + 9),
          round1(y - 7),
          `${trackIdent(candidate.track)} · ${candidate.composite}`,
          `class="vigil-label" data-id="${escAttr(candidate.track.id)}" font-size="11" font-weight="600" fill="${bandFill(candidate.band)}"`,
        ),
      )
    }
    for (const threat of metrics.threats) {
      const entry = ranked.find((candidate) => candidate.track.id === threat.id)
      if (!entry) continue
      const [x, y] = project(entry.track.position)
      const { track, score } = entry
      if (score.mismatch && track.source === 'inject' && track.broadcast) {
        const [bx, by] = project(track.broadcast.position)
        parts.push(
          `<line class="vigil-mismatch" data-id="${escAttr(threat.id)}" x1="${x}" y1="${y}" x2="${bx}" y2="${by}" stroke="${COLOR.warning}" stroke-width="1" stroke-dasharray="4 3"/>`,
          `<circle class="vigil-broadcast" data-id="${escAttr(threat.id)}" cx="${bx}" cy="${by}" r="3" fill="none" stroke="${COLOR.warning}" stroke-width="1"/>`,
          text(
            round1(bx + 8),
            round1(by + 4),
            `Remote ID says here · ${(score.mismatch.distanceM / 1000).toFixed(1)} km`,
            `class="vigil-mismatch-label" font-size="11" fill="${COLOR.warning}"`,
          ),
        )
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
      // estimate below-right in the band's colour; on one threat, the S5c gate's two labels.
      const label = many
        ? `${trackIdent(track)} · ${entry.composite}${entryText ? ` · ${entryText}` : ''}`
        : entryText
      if (label) {
        parts.push(
          text(
            round1(x + 9),
            round1(y + 16),
            label,
            many
              ? `class="vigil-threat-label" data-id="${escAttr(threat.id)}" font-size="11" font-weight="600" fill="${bandFill(entry.band)}"`
              : `class="vigil-entry" data-id="${escAttr(threat.id)}" font-size="11" fill="${COLOR.text}"`,
          ),
        )
      }
    }
  }

  const beyond = hops.filter((hop) => !inPanel(hop.point)).length
  const header = [
    text(
      30,
      40,
      headerLine(record, metrics),
      `class="title" font-size="20" font-weight="700" fill="${COLOR.text}"`,
    ),
    text(
      30,
      64,
      // A look at a track beyond the panel keeps its hop off the panel, clipped; the count says
      // so, so the header and the frame agree (#151 round 1).
      `The subject's selection sequence from the run JSON, replayed as a path. ${plural(looks.length, 'look')}${beyond > 0 ? `, ${beyond} beyond the panel` : ''}.`,
      `class="subtitle" font-size="13" fill="${COLOR.muted}"`,
    ),
  ]
  const footY = HEADER_H + PANEL.height + 20
  // The Queue box on a Vigil frame (C2), under the map between the footnote and the caption:
  // every above-calm inject at the freeze in rank order, the rank in the band's colour, the
  // composite, and the Queue's own reason tag. On the map it would cover a threat when the
  // cast puts fourteen above calm (S5c-ii's gate).
  const queueY = HEADER_H + PANEL.height + FOOT_H
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
    ...lines.map((line, i) =>
      text(
        46,
        captionY + 16 + (i + 1) * LINE_H - 6,
        line,
        `class="caption" font-size="13" ${line.startsWith('Look') || line.startsWith('MISSED') ? `font-weight="600" fill="${COLOR.text}"` : `fill="${COLOR.muted}"`}`,
      ),
    ),
  ]

  const lines_ = [
    `<rect width="${PANEL.width}" height="${height}" fill="${COLOR.bg}"/>`,
    ...header,
    `<defs><clipPath id="${clipId}"><rect x="0" y="0" width="${PANEL.width}" height="${PANEL.height}"/></clipPath></defs>`,
    `<g class="map" transform="translate(0 ${HEADER_H})" clip-path="url(#${clipId})">`,
    `<rect width="${PANEL.width}" height="${PANEL.height}" fill="${COLOR.panel}"/>`,
    ...parts,
    '</g>',
    ...FOOTNOTE_LINES.map((line, i) =>
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
