/**
 * The frame (S5b, #138, ruled B2–B4; the S5 gate's A5a and A5b under the ruling on A5): one SVG
 * per run — the picture at the freeze, the ring, the threat's trail with its marks, every look
 * up to the freeze as a numbered hop on the path, the analyst's overlay, the header, and the
 * caption box — drawn identically in both modes. The only words that differ between a raw
 * frame and a Vigil frame of the same run are the header's condition and the ident a look read,
 * since that is what the run's screen showed; the Vigil-only readings are S5c's. Pure and
 * deterministic: the same record, study, and plan give the same bytes.
 */

import { THREAT_ID } from '../../scripts/study.ts'
import { AO } from '../../src/config/ao.ts'
import { STUDY } from '../../src/config/study.ts'
import { sourceWord, trackIdent } from '../../src/lib/display.ts'
import { injectTracksAt, type InjectPlan } from '../../src/lib/injects.ts'
import type { RunEvent, RunRecord } from '../../src/lib/run.ts'
import type { Track } from '../../src/lib/tracks.ts'
import { candidatesAt, rankedAtSecond } from './engine.ts'
import type { Study } from './load.ts'
import type { RunMetrics } from './metrics.ts'
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
export const headerLine = (record: RunRecord, metrics: RunMetrics): string =>
  `${record.mode === 'raw' ? 'UNAIDED' : 'WITH VIGIL'} · ${
    metrics.miss
      ? `MISSED — frozen at +${mmss(STUDY.runS)}`
      : `frozen at the moment of escalation — ${mmss(metrics.freezeT)}`
  }`

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

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
  const threatLooks = looks
    .map(({ event, index }, i) => ({ event, index, k: i + 1 }))
    .filter(({ event }) => event.track === THREAT_ID)
  const lines: string[] = []
  threatLooks.forEach(({ event, index, k }, j) => {
    const nextIndex = threatLooks[j + 1]?.index ?? Infinity
    const actions = record.events
      .filter(
        (action, i) =>
          action.track === THREAT_ID &&
          VERB[action.type] !== undefined &&
          i > index &&
          i < nextIndex &&
          action.t <= metrics.freezeT,
      )
      .map((action) => `${VERB[action.type]} at ${mmss(action.t)}`)
    lines.push(
      `Look #${k} · ${mmss(event.t)} — opened the threat${actions.length > 0 ? `; ${actions.join(', ')}` : ''}.`,
    )
    const shown = trackAtSecond(study.index, plan, THREAT_ID, STUDY.beginS + event.t, record.mode)
    lines.push(
      shown
        ? `It read as ${trackIdent(shown)} · ${sourceWord(shown)}.`
        : 'It was not in the picture.',
    )
  })
  if (metrics.miss || metrics.standoffM === null) {
    lines.push(`MISSED — never escalated; ${plural(looks.length, 'look')}.`)
    return lines
  }
  const last = threatLooks[threatLooks.length - 1]
  const who = last ? `Look #${last.k} · ${mmss(metrics.freezeT)} — ` : ''
  const km = (Math.abs(metrics.standoffM) / 1000).toFixed(1)
  const side = metrics.standoffM >= 0 ? 'outside' : 'inside'
  const entry =
    metrics.entryT === null
      ? 'no ring entry'
      : metrics.entryT >= metrics.freezeT
        ? `${mmss(metrics.entryT - metrics.freezeT)} before entry`
        : `${mmss(metrics.freezeT - metrics.entryT)} after entry`
  lines.push(`${who}escalated it ${km} km ${side} the ring · ${entry}.`)
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

const text = (x: number, y: number, content: string, attrs: string): string =>
  `<text x="${x}" y="${y}" font-family="${FONT}" ${attrs}>${esc(content)}</text>`

/** The threat's positions from one second to another, projected, for the trail. */
function trailPoints(plan: InjectPlan, fromS: number, toS: number): [number, number][] {
  const points: [number, number][] = []
  for (let tSec = fromS; tSec <= toS; tSec++) {
    const threat = injectTracksAt(plan, tSec).find((track) => track.id === THREAT_ID)
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
  const { record, metrics, study, plan } = input
  const { beginS } = STUDY
  const freezeS = beginS + metrics.freezeT
  const looks = looksOnFrame(record, metrics.freezeT)
  const lines = captionLines(input)
  const captionH = 16 + lines.length * LINE_H + 12
  const height = HEADER_H + PANEL.height + FOOT_H + captionH
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

  // The threat's trail from its first frame in the window to the freeze, its plan-known
  // continuation to the entry tick fainter, and the two marks.
  let firstS: number | null = null
  for (let tSec = beginS; tSec <= freezeS && firstS === null; tSec++) {
    if (injectTracksAt(plan, tSec).some((track) => track.id === THREAT_ID)) firstS = tSec
  }
  if (firstS !== null) {
    const trail = trailPoints(plan, firstS, freezeS)
    parts.push(
      polyline(
        trail,
        `class="trail" stroke="${COLOR.muted}" stroke-width="1.5" stroke-dasharray="2 4"`,
      ),
    )
    const entryS = metrics.entryT === null ? null : beginS + metrics.entryT
    if (entryS !== null && entryS > freezeS) {
      parts.push(
        polyline(
          trailPoints(plan, freezeS, entryS),
          `class="trail-ahead" stroke="${COLOR.faint}" stroke-width="1" stroke-dasharray="1 5"`,
        ),
      )
    }
    const first = injectTracksAt(plan, firstS).find((track) => track.id === THREAT_ID)!
    const [fx, fy] = project(first.position)
    parts.push(
      `<circle class="trail-first" cx="${fx}" cy="${fy}" r="2.5" fill="${COLOR.muted}"/>`,
      text(
        fx + 8,
        fy + 14,
        `T0 · ${(rangeM(first) / 1000).toFixed(1)} km`,
        `font-size="11" fill="${COLOR.faint}"`,
      ),
    )
    if (entryS !== null) {
      const atEntry = injectTracksAt(plan, entryS).find((track) => track.id === THREAT_ID)
      if (atEntry) {
        const [ex, ey] = project(atEntry.position)
        parts.push(
          `<circle class="entry" cx="${ex}" cy="${ey}" r="3" fill="none" stroke="${COLOR.muted}" stroke-width="1.5"/>`,
          text(
            ex + 8,
            ey - 6,
            `${mmss(metrics.entryT!)} ring entry`,
            `font-size="11" fill="${COLOR.faint}"`,
          ),
        )
      }
    }
  }

  // The analyst's overlay: the engine's above-calm injects at the freeze the run never opened.
  // "Never opened" is about the whole run, as the footnote says: a track opened after the freeze
  // is not marked (#151 round 1).
  const opened = new Set(
    record.events.filter((event) => event.type === 'select').map((event) => event.track),
  )
  const candidates = candidatesAt(rankedAtSecond(study, plan, freezeS))
  for (const candidate of candidates) {
    if (opened.has(candidate.track.id)) continue
    const point = project(candidate.track.position)
    if (!inPanel(point)) continue
    const [x, y] = point
    parts.push(
      `<circle class="never-opened" data-id="${escAttr(candidate.track.id)}" cx="${x}" cy="${y}" r="6" fill="none" stroke="${COLOR.faint}" stroke-width="1"/>`,
      text(
        x + 9,
        y + 4,
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
  for (const {
    k,
    event,
    point: [x, y],
  } of hops) {
    const fill = event.track === THREAT_ID ? COLOR.warning : COLOR.accent
    parts.push(
      `<circle class="hop" data-k="${k}" data-id="${escAttr(event.track)}" data-t="${event.t}" cx="${x}" cy="${y}" r="9" fill="${fill}"/>`,
      text(
        x,
        y + 4,
        String(k),
        `font-size="11" font-weight="700" text-anchor="middle" fill="${COLOR.bg}"`,
      ),
    )
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
  const captionY = HEADER_H + PANEL.height + FOOT_H
  const caption = [
    `<rect x="30" y="${captionY}" width="${PANEL.width - 60}" height="${captionH}" rx="6" fill="${COLOR.panel}" stroke="${COLOR.line}"/>`,
    ...lines.map((line, i) =>
      text(
        46,
        captionY + 16 + (i + 1) * LINE_H - 6,
        line,
        `class="caption" font-size="13" ${i === lines.length - 1 || line.startsWith('Look') ? `font-weight="600" fill="${COLOR.text}"` : `fill="${COLOR.muted}"`}`,
      ),
    ),
  ]

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL.width}" height="${height}" viewBox="0 0 ${PANEL.width} ${height}" data-subject="${escAttr(record.subject)}" data-scenario="${escAttr(record.scenario)}" data-mode="${record.mode}" data-run="${record.run}">`,
    `<rect width="${PANEL.width}" height="${height}" fill="${COLOR.bg}"/>`,
    ...header,
    `<defs><clipPath id="panel"><rect x="0" y="0" width="${PANEL.width}" height="${PANEL.height}"/></clipPath></defs>`,
    `<g class="map" transform="translate(0 ${HEADER_H})" clip-path="url(#panel)">`,
    `<rect width="${PANEL.width}" height="${PANEL.height}" fill="${COLOR.panel}"/>`,
    ...parts,
    '</g>',
    ...FOOTNOTE_LINES.map((line, i) =>
      text(30, footY + i * 14, line, `class="footnote" font-size="11" fill="${COLOR.faint}"`),
    ),
    ...caption,
    '</svg>',
    '',
  ].join('\n')
}

/** The file a run's frame is written to: `<subject>-<scenario>-<mode>-<run>.svg`. */
export const frameName = (record: RunRecord): string =>
  `${record.subject}-${record.scenario}-${record.mode}-${record.run}.svg`
