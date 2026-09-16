/**
 * The frame (S5b, #138, ruled B2–B4; the S5 gate's A5a and A5b under the ruling on A5): one SVG
 * per run — the picture at the freeze, the ring, the threat's trail with its marks, every look
 * up to the freeze as a numbered hop on the path, the analyst's overlay, the header, and the
 * caption box — drawn identically in both modes. The only words that differ between a raw
 * frame and a Vigil frame of the same run are the header's condition and the ident a look read,
 * since that is what the run's screen showed; the Vigil-only readings are S5c's. Pure and
 * deterministic: the same record, study, and plan give the same bytes.
 */

import { AO } from '../../src/config/ao.ts'
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
import { entryAt } from '../../src/lib/projection.ts'
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

/** The Entry row's reading at a second, in the frame's words: the dead-reckoned estimate `entryAt` gives. */
const entryWords = (track: Track): string => {
  const path = entryAt(track, SITE)
  return path.kind === 'entry'
    ? `ring entry in ${mmss(Math.round(path.tSec))}`
    : path.kind === 'inside'
      ? 'inside the ring'
      : 'not closing'
}

/**
 * What Vigil read on a track at a second — the caption's Vigil line (S5c-ii, C6): the rank, the
 * band and composite the chip printed, the drawer's mismatch line when the score read one, the
 * closing speed, and the Entry row's estimate. The app's own words, through the engine.
 */
const vigilReading = (entry: RankedAt): string => {
  const { track, score } = entry
  const speed = track.groundSpeedKt === null ? null : Math.round(track.groundSpeedKt * KT_TO_MS)
  return [
    `Vigil read it rank ${entry.rank} · ${entry.band} ${entry.composite}`,
    ...(score.mismatch ? [mismatchLine(score.mismatch)] : []),
    speed === null ? 'speed unobserved' : `closing at ${speed} m/s`,
    entryWords(track),
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
    lines.push(
      `Look #${k} · ${mmss(event.t)} — opened ${name(event.track)}${actions.length > 0 ? `; ${actions.join(', ')}` : ''}.`,
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
      if (entry) lines.push(`${vigilReading(entry)}.`)
    }
  })
  // The decision line, one per threat in the bench's row order: the escalation with its standoff
  // and its distance from the entry, or the miss; on one threat, S5b's line as it was.
  for (const threat of metrics.threats) {
    if (threat.miss || threat.standoffM === null || threat.timeToEscalateS === null) {
      lines.push(
        `MISSED${many ? ` ${threat.id}` : ''} — never escalated; ${plural(looks.length, 'look')}.`,
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
    lines.push(`${who}escalated ${many ? threat.id : 'it'} ${km} km ${side} the ring · ${entry}.`)
  }
  // The overlay's count in words, on the last decision line of a Vigil frame (C6).
  if (record.mode === 'vigil') {
    const never = neverOpened(
      record,
      candidatesAt(rankedAtSecond(study, plan, STUDY.beginS + metrics.freezeT)),
    )
    lines[lines.length - 1] += ` ${plural(never.length, 'candidate')} never opened.`
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

const text = (x: number, y: number, content: string, attrs: string): string =>
  `<text x="${x}" y="${y}" font-family="${FONT}" ${attrs}>${esc(content)}</text>`

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
  const { record, metrics, study, plan } = input
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
  // pair, two on the prioritization pair, each marked by its id where there are two.
  const threatIds = threatsOf(record.scenario)
  const many = threatIds.length > 1
  for (const threat of metrics.threats) {
    let firstS: number | null = null
    for (let tSec = beginS; tSec <= freezeS && firstS === null; tSec++) {
      if (injectTracksAt(plan, tSec).some((track) => track.id === threat.id)) firstS = tSec
    }
    if (firstS === null) continue
    // The id on the prioritization pair's trails, where there are two to tell apart; the
    // corroboration frame is S5b's byte for byte.
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
    const first = injectTracksAt(plan, firstS).find((track) => track.id === threat.id)!
    const [fx, fy] = project(first.position)
    const tag = many ? `${threat.id} · ` : ''
    // Two labels on a short trail collide at x + 8 (the re-gate's mockup); on the pair the T0
    // label goes below-left, anchored end, the entry label above-right (E6).
    const t0X = many ? fx - 8 : fx + 8
    const t0Anchor = many ? ' text-anchor="end"' : ''
    parts.push(
      `<circle class="trail-first"${idAttr} cx="${fx}" cy="${fy}" r="2.5" fill="${COLOR.muted}"/>`,
      text(
        t0X,
        round1(fy + 14),
        `${tag}T0 · ${(rangeM(first) / 1000).toFixed(1)} km`,
        `font-size="11" fill="${COLOR.faint}"${t0Anchor}`,
      ),
    )
    if (entryS !== null) {
      const atEntry = injectTracksAt(plan, entryS).find((track) => track.id === threat.id)
      if (atEntry) {
        const [ex, ey] = project(atEntry.position)
        parts.push(
          `<circle class="entry"${idAttr} cx="${ex}" cy="${ey}" r="3" fill="none" stroke="${COLOR.muted}" stroke-width="1.5"/>`,
          text(
            round1(ex + 8),
            round1(ey - 6),
            `${tag}${mmss(threat.entryT!)} ring entry`,
            `font-size="11" fill="${COLOR.faint}"`,
          ),
        )
      }
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
  for (const {
    k,
    event,
    point: [x, y],
  } of hops) {
    const fill = threatIds.includes(event.track) ? COLOR.warning : COLOR.accent
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
          `class="vigil-label" data-id="${escAttr(candidate.track.id)}" font-size="11" font-weight="600" fill="${BAND_COLOR[candidate.band === 'calm' ? 'caution' : candidate.band]}"`,
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
      const path = entryAt(track, SITE)
      const entryText =
        path.kind === 'entry'
          ? `entry in ${mmss(Math.round(path.tSec))}`
          : path.kind === 'inside'
            ? 'inside the ring'
            : null
      // The threat's own label on the pair: ident, composite, and the entry estimate in one line
      // below-right, in the band's colour; on one threat, the S5c gate's two labels as mocked.
      const label = many
        ? `${trackIdent(track)} · ${entry.composite}${entryText ? ` · ${entryText}` : ''}`
        : entryText
      if (label) {
        parts.push(
          text(
            round1(x + 9),
            round1(y + 16),
            label,
            `class="vigil-entry" data-id="${escAttr(threat.id)}" font-size="11"${many ? ' font-weight="600"' : ''} fill="${many ? BAND_COLOR[entry.band === 'calm' ? 'caution' : entry.band] : COLOR.text}"`,
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
  const queueH = record.mode === 'vigil' ? 30 + candidates.length * 18 + 6 : 0
  const queue =
    record.mode === 'vigil'
      ? [
          `<rect class="vigil-queue" x="30" y="${queueY}" width="${PANEL.width - 60}" height="${queueH}" rx="6" fill="${COLOR.panel}" stroke="${COLOR.line}"/>`,
          text(
            46,
            queueY + 20,
            `Queue at ${mmss(metrics.freezeT)} · ${plural(candidates.length, 'candidate')} above calm`,
            `class="vigil-queue-title" font-size="12" font-weight="700" fill="${COLOR.text}"`,
          ),
          ...candidates.map(
            (candidate, i) =>
              `<text x="46" y="${queueY + 38 + i * 18}" font-family="${FONT}" class="vigil-queue-line" data-id="${escAttr(candidate.track.id)}" font-size="11" fill="${COLOR.muted}"><tspan font-weight="700" fill="${BAND_COLOR[candidate.band === 'calm' ? 'caution' : candidate.band]}">${candidate.rank}</tspan> ${esc(`${trackIdent(candidate.track)} ${candidate.composite} · ${reasonTag(candidate, AO.protectedSites)}`)}</text>`,
          ),
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
    ...queue,
    ...caption,
    '</svg>',
    '',
  ].join('\n')
}

/** The file a run's frame is written to: `<subject>-<scenario>-<mode>-<run>.svg`. */
export const frameName = (record: RunRecord): string =>
  `${record.subject}-${record.scenario}-${record.mode}-${record.run}.svg`
