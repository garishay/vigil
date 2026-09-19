import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { THREAT_ID } from '../../scripts/study.ts'
import { AO } from '../../src/config/ao.ts'
import { STUDY } from '../../src/config/study.ts'
import { distanceMeters } from '../../src/lib/geo.ts'
import { injectTracksAt } from '../../src/lib/injects.ts'
import type { RunEvent, RunRecord } from '../../src/lib/run.ts'
import {
  CAPTION,
  captionLines,
  captionText,
  frameParts,
  FOOTNOTE,
  FOOTNOTE_LINES,
  LATE_FOOTNOTE_LINES,
  bandFill,
  entryWords,
  frameDocument,
  frameName,
  frameSvg,
  headerLine,
  mmss,
  neverOpenedWords,
  PANEL,
  placeLabel,
  project,
  crossesBox,
  crossesRing,
  textBox,
  wrapText,
  estimateWidth,
  type Segment,
} from './frame.ts'
import { candidatesAt, rankedAtSecond } from './engine.ts'
import { planFor } from './load.ts'
import { loadStudy, readRuns } from './files.ts'
import { runMetrics } from './metrics.ts'
import { pictureAtSecond, trackAtSecond } from './regenerate.ts'

const study = loadStudy()
const plans = {
  '02a': planFor('02a', study.timeline),
  '02b': planFor('02b', study.timeline),
  '03a': planFor('03a', study.timeline),
  '03b': planFor('03b', study.timeline),
}
type Study = keyof typeof plans
const fixture = (name: string) => {
  const record = readRuns(`tools/replay/__fixtures__/${name}.json`)[0]
  const plan = plans[record.scenario as Study]
  return { record, plan, study, metrics: runMetrics(record, study.index, plan) }
}
const synthetic = (events: RunEvent[], patch: Partial<RunRecord> = {}) => {
  const record: RunRecord = {
    subject: 'S09',
    scenario: '02a',
    mode: 'raw',
    run: 1,
    build: 'test',
    began_at: '2026-09-16T01:00:00.000Z',
    events,
    answers: { demand: 1, pressure: 2, confidence: 3 },
    ...patch,
  }
  const plan = plans[record.scenario as Study]
  return { record, plan, study, metrics: runMetrics(record, study.index, plan) }
}

/** The projection, written out again here so a hop's pixel is checked against the formula, not the code. */
/** The eight spots a threat's label may take around its dot, written out again here (#170). */
const SPOTS: [number, number, boolean][] = [
  [9, 16, false],
  [9, -10, false],
  [-9, 16, true],
  [-9, -10, true],
  [9, 31, false],
  [-9, 31, true],
  [9, -25, false],
  [-9, -25, true],
]
const expectedPx = ([lon, lat]: readonly [number, number]) => {
  const kmPerDegLat = 111.32
  const kmPerDegLon = 111.32 * Math.cos((AO.center[1] * Math.PI) / 180)
  return [
    Math.round((450 + (lon - AO.center[0]) * kmPerDegLon * 30) * 10) / 10,
    Math.round((350 - (lat - AO.center[1]) * kmPerDegLat * 30) * 10) / 10,
  ]
}
const attrs = (tag: string) =>
  Object.fromEntries([...tag.matchAll(/([a-z-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]))
const tagsOf = (svg: string, cls: string) =>
  [...svg.matchAll(new RegExp(`<[a-z]+ [^>]*class="${cls}"[^>]*>`, 'g'))].map((match) =>
    attrs(match[0]),
  )
/** The log's words alone; the weight each line carries is pinned where it is the subject. */
const captionTexts = (input: Parameters<typeof captionLines>[0]) =>
  captionLines(input).map((line) => line.text)
const textsOf = (svg: string, cls: string) =>
  [...svg.matchAll(new RegExp(`<text[^>]*class="${cls}"[^>]*>([^<]*)</text>`, 'g'))].map(
    (match) => match[1],
  )

describe('the frame (S5b, #138, ruled B2, B3) — the scene', () => {
  it('projects at 30 px per km about the AO centre, the ring at (450, 350) with radius 150', () => {
    expect(project(AO.center)).toEqual([450, 350])
    expect(PANEL).toEqual({ width: 900, height: 700, pxPerKm: 30 })
    const svg = frameSvg(fixture('S03-02a-raw-1'))
    const [ring] = tagsOf(svg, 'ring')
    expect(ring).toMatchObject({ cx: '450', cy: '350', r: '150' })
    expect(svg).toContain('PHL Airfield · 5 km ring')
    expect(svg).toContain('<g class="map" transform="translate(0 80)" clip-path="url(#panel)">')
  })

  it('draws every track inside the panel at the freeze as a dot, in id order — 32 of 99 on 02a', () => {
    const input = fixture('S03-02a-raw-1')
    const svg = frameSvg(input)
    const dots = tagsOf(svg, 'track')
    expect(dots).toHaveLength(32)
    const picture = pictureAtSecond(study.index, input.plan, STUDY.beginS + 58, 'raw')
    expect(picture).toHaveLength(99)
    const ids = dots.map((dot) => dot['data-id'])
    expect(ids).toEqual([...ids].sort())
    for (const dot of dots) {
      const track = picture.find((candidate) => candidate.id === dot['data-id'])!
      expect([Number(dot.cx), Number(dot.cy)]).toEqual(expectedPx(track.position))
      expect(Number(dot.cx)).toBeGreaterThanOrEqual(0)
      expect(Number(dot.cy)).toBeLessThanOrEqual(700)
    }
  })

  it('places each look up to the freeze as a numbered hop at its track’s regenerated position — the threat’s in the warning colour', () => {
    const input = fixture('S03-02a-vigil-1')
    const svg = frameSvg(input)
    const hops = tagsOf(svg, 'hop')
    // The Vigil fixture looked twice; the second look, at +80, is after the freeze at +58, and
    // the frame draws the whole run (S5f, #173). Both looks are on one track, so there is one
    // marker — the solid one, made at the first look — with a badge counting both (S5e K5).
    expect(hops).toHaveLength(1)
    expect(hops[0]['data-visits']).toBe('2')
    expect(hops[0]).toMatchObject({
      'data-k': '1',
      'data-id': THREAT_ID,
      'data-t': '14',
      r: '9',
      fill: '#ff6b57',
    })
    const threat = injectTracksAt(input.plan, STUDY.beginS + 14).find(
      (track) => track.id === THREAT_ID,
    )!
    expect([Number(hops[0].cx), Number(hops[0].cy)]).toEqual(expectedPx(threat.position))
    expect([Number(hops[0].cx), Number(hops[0].cy)]).toEqual([260.5, 438.5])
    expect(
      Math.round(distanceMeters(AO.protectedSites[0].center, threat.position) / 100) / 10,
    ).toBe(7)
    // One hop draws no path; two or more draw the path through them in order.
    expect(tagsOf(svg, 'path')).toHaveLength(0)
    const two = frameSvg(
      synthetic([
        { t: 10, type: 'select', track: 'inject-12' },
        { t: 20, type: 'select', track: THREAT_ID },
        { t: 30, type: 'escalate', track: THREAT_ID },
      ]),
    )
    const twoHops = tagsOf(two, 'hop')
    expect(twoHops.map((hop) => hop.fill)).toEqual(['#4c9aff', '#ff6b57'])
    expect(tagsOf(two, 'path')[0].points).toBe(
      twoHops.map((hop) => `${hop.cx},${hop.cy}`).join(' '),
    )
  })

  it('draws the threat’s trail from its first frame to the freeze with T0 and the ring-entry mark, the continuation fainter', () => {
    const svg = frameSvg(fixture('S03-02a-raw-1'))
    const [trail] = tagsOf(svg, 'trail')
    const points = trail.points.split(' ')
    // 481 s to 538 s: one point per second.
    expect(points).toHaveLength(58)
    expect(points[0]).toBe('254.1,441.5')
    expect(points[points.length - 1]).toBe('282,428.4')
    expect(tagsOf(svg, 'trail-first')[0]).toMatchObject({ cx: '254.1', cy: '441.5' })
    expect(svg).toContain('>T0 · 7.2 km</text>')
    expect(tagsOf(svg, 'entry')[0]).toMatchObject({ cx: '314.4', cy: '413.4' })
    expect(svg).toContain('>2:04 ring entry</text>')
    // The continuation runs from the freeze to the entry, 538 s to 604 s.
    expect(tagsOf(svg, 'trail-ahead')[0].points.split(' ')).toHaveLength(67)
    // On 02b the threat is in the picture at Begin itself.
    const b = frameSvg(fixture('S04-02b-raw-1'))
    expect(tagsOf(b, 'trail')[0].points.split(' ')).toHaveLength(59)
    expect(b).toContain('>2:03 ring entry</text>')
  })

  it('marks the analyst’s overlay on both frames — the above-calm injects the run never opened — with the one footnote', () => {
    for (const name of ['S03-02a-raw-1', 'S03-02a-vigil-1', 'S04-02b-raw-1', 'S04-02b-vigil-1']) {
      const svg = frameSvg(fixture(name))
      expect(tagsOf(svg, 'never-opened').map((mark) => mark['data-id'])).toEqual([
        'inject-12',
        'inject-13',
        'inject-17',
        'inject-37',
      ])
      // The one sentence on two lines, since SVG text does not wrap (#151 round 1); the two 02
      // Vigil runs reopen the threat after the freeze, so they carry the key's two lines as well
      // (S5f, #173) and the unaided runs, which stop at the freeze, carry neither.
      const late = name.endsWith('vigil-1')
      expect(textsOf(svg, 'footnote')).toEqual(
        late ? [...FOOTNOTE_LINES, ...LATE_FOOTNOTE_LINES] : [...FOOTNOTE_LINES],
      )
      expect(textsOf(svg, 'footnote').slice(0, 2).join(' ')).toBe(FOOTNOTE)
      expect((svg.match(/>never opened</g) ?? []).length).toBe(4)
    }
    // "Never" is about the whole run: a candidate opened after the freeze is not marked (#151 round 1).
    const later = frameSvg(
      synthetic([
        { t: 14, type: 'select', track: THREAT_ID },
        { t: 58, type: 'escalate', track: THREAT_ID },
        { t: 80, type: 'select', track: 'inject-12' },
      ]),
    )
    expect(tagsOf(later, 'never-opened').map((mark) => mark['data-id'])).toEqual([
      'inject-13',
      'inject-17',
      'inject-37',
    ])
    expect(tagsOf(later, 'hop')).toHaveLength(1)
    expect(FOOTNOTE).toBe(
      "\"never opened\" marks the engine's above-calm tracks at the freeze that the run never opened: the analyst's overlay, drawn on both conditions; raw's screen never showed that set.",
    )
  })
})

describe('the frame — the header and the caption box (ruled B3, B4)', () => {
  it('heads a raw run UNAIDED and a Vigil run WITH VIGIL, frozen at the escalation, or MISSED at +6:00', () => {
    const raw = fixture('S03-02a-raw-1')
    expect(headerLine(raw)).toBe('UNAIDED · frozen at the moment of escalation — 0:58')
    const vigil = fixture('S04-02b-vigil-1')
    expect(headerLine(vigil)).toBe('WITH VIGIL · frozen at the moment of escalation — 0:58')
    const missed = synthetic([{ t: 30, type: 'select', track: 'inject-12' }], { mode: 'vigil' })
    expect(headerLine(missed)).toBe('WITH VIGIL · MISSED — frozen at +6:00')
    const svg = frameSvg(raw)
    expect(textsOf(svg, 'title')).toEqual(['UNAIDED · frozen at the moment of escalation — 0:58'])
    expect(textsOf(svg, 'subtitle')).toEqual([
      "The subject's selection sequence from the run JSON, replayed as a path. 1 look.",
    ])
    expect(mmss(58)).toBe('0:58')
    expect(mmss(124)).toBe('2:04')
    // Before Begin — an entry the metrics read as negative — prints signed, never `-2:-40` (#151 round 1).
    expect(mmss(-100)).toBe('-1:40')
    expect(mmss(0)).toBe('0:00')
  })

  it('counts a look at a track beyond the panel in the subtitle, its hop kept off the panel (#151 round 1)', () => {
    const input = fixture('S03-02a-raw-1')
    const picture = pictureAtSecond(study.index, input.plan, STUDY.beginS + 14, 'raw')
    const far = picture.find((track) => {
      const [x, y] = project(track.position)
      return x < 0 || x > 900 || y < 0 || y > 700
    })!
    const svg = frameSvg(
      synthetic([
        { t: 14, type: 'select', track: far.id },
        { t: 30, type: 'select', track: THREAT_ID },
        { t: 58, type: 'escalate', track: THREAT_ID },
      ]),
    )
    expect(textsOf(svg, 'subtitle')).toEqual([
      "The subject's selection sequence from the run JSON, replayed as a path. 2 looks, 1 beyond the panel.",
    ])
    const hops = tagsOf(svg, 'hop')
    expect(hops).toHaveLength(2)
    expect(hops[0]['data-id']).toBe(far.id)
    expect([Number(hops[0].cx), Number(hops[0].cy)]).toEqual(expectedPx(far.position))
    expect(tagsOf(svg, 'path')[0].points.startsWith(`${hops[0].cx},${hops[0].cy} `)).toBe(true)
  })

  it('writes the 02a log exactly — one line per decision, in clock order, each fact once', () => {
    expect(captionTexts(fixture('S03-02a-raw-1'))).toEqual([
      'Look #1 · 0:14 — opened UAS-8F21 (the threat) · Remote ID.',
      'Look #1 · 0:49 — assessed UAS-8F21 (the threat).',
      'Look #1 · 0:58 — escalated UAS-8F21 (the threat) 1.2 km outside the ring · 1:06 before entry, ring entry 2:04.',
    ])
    // Each fact once: the open line no longer carries the escalation's clock, and 0:58 is
    // written on exactly one line of the log (S5g, #175 item 2).
    const once = captionTexts(fixture('S03-02a-raw-1')).filter((line) => line.includes('0:58'))
    expect(once).toHaveLength(1)
    // The same log on a Vigil run, with what Vigil read under the line it belongs to, the
    // freeze's rule where the run kept working, and the overlay's count on the foot's own line.
    expect(captionTexts(fixture('S03-02a-vigil-1'))).toEqual([
      'Look #1 · 0:14 — opened TRK-11 (the threat) · sensor.',
      'Vigil read it rank 1 · warning 71 · closing at 18 m/s · ring entry in 1:49.',
      'Remote ID UAS-8F21 broadcasts 1.1 km from the observed track.',
      'Look #1 · 0:49 — assessed TRK-11 (the threat).',
      'Look #1 · 0:58 — escalated TRK-11 (the threat) 1.2 km outside the ring · 1:06 before entry, ring entry 2:04.',
      'frozen at 0:58',
      // The look after the freeze carries no Vigil reading: the frame's key says every reading
      // is the frozen second's (#176 round 1).
      'Look #2 · 1:20 — opened TRK-11 (the threat) · sensor.',
      '4 candidates never opened.',
    ])
    const svg = frameSvg(fixture('S03-02a-raw-1'))
    expect(textsOf(svg, 'caption')).toHaveLength(3)
  })

  it('says what a look read where that is not the name the log gives the track (ruled R1)', () => {
    // 02b Vigil is the case: the screen showed UAS-8F21 at the +14 look and TRK-11 at the +80
    // one, so the log names it once — at the freeze, where the map labels it — and the earlier
    // line says what it read then.
    expect(captionTexts(fixture('S04-02b-vigil-1'))[0]).toBe(
      'Look #1 · 0:14 — opened TRK-11 (the threat) · Remote ID, reading UAS-8F21 then.',
    )
    expect(captionTexts(fixture('S04-02b-vigil-1'))).toContain(
      'Look #2 · 1:20 — opened TRK-11 (the threat) · sensor.',
    )
    // Only where they differ: 02a Vigil read TRK-11 at both looks, and no 03 line carries it.
    for (const name of ['S03-02a-vigil-1', 'S05-03a-raw-1', 'S05-03a-vigil-1', 'S06-03b-vigil-1']) {
      expect(captionTexts(fixture(name)).some((line) => line.includes(' then'))).toBe(false)
    }
  })

  it('reads a dismissal, a second look, an escalation inside the ring, and a miss', () => {
    const late = captionLines(
      synthetic([
        { t: 20, type: 'select', track: THREAT_ID },
        { t: 25, type: 'assess', track: THREAT_ID },
        { t: 31, type: 'dismiss', track: THREAT_ID },
        { t: 100, type: 'select', track: 'inject-12' },
        { t: 200, type: 'select', track: THREAT_ID },
        { t: 230, type: 'escalate', track: THREAT_ID },
      ]),
    )
    expect(late.map((line) => line.text)).toEqual([
      'Look #1 · 0:20 — opened UAS-8F21 (the threat) · Remote ID.',
      'Look #1 · 0:25 — assessed UAS-8F21 (the threat).',
      'Look #1 · 0:31 — dismissed UAS-8F21 (the threat).',
      'Look #2 · 1:40 — opened TRK-12 · sensor.',
      'Look #3 · 3:20 — opened UAS-8F21 (the threat) · Remote ID.',
      // Inside the ring the threat orbits, so at 3:50 it is 1.7 km in — not the closing line's 1.9.
      'Look #3 · 3:50 — escalated UAS-8F21 (the threat) 1.7 km inside the ring · 1:46 after entry, ring entry 2:04.',
    ])
    // Every line about the threat takes the box's weight; the non-threat's open is muted (item 1).
    expect(late.map((line) => line.bold)).toEqual([true, true, true, false, true, true])
    const missed = captionLines(
      synthetic([
        { t: 30, type: 'select', track: 'inject-12' },
        { t: 90, type: 'select', track: THREAT_ID },
      ]),
    )
    // The miss is stated once, beneath the log, with the ring entry it crossed (item 4).
    expect(missed.map((line) => line.text)).toEqual([
      'Look #1 · 0:30 — opened TRK-12 · sensor.',
      'Look #2 · 1:30 — opened UAS-8F21 (the threat) · Remote ID.',
      'MISSED UAS-8F21 (the threat) — never escalated; ring entry 2:04.',
    ])
  })

  it('reads two looks on one second by position: the actions belong to the look before them in the record (#151 round 1)', () => {
    const lines = captionLines(
      synthetic([
        { t: 20, type: 'select', track: THREAT_ID },
        { t: 20, type: 'select', track: THREAT_ID },
        { t: 25, type: 'assess', track: THREAT_ID },
        { t: 58, type: 'escalate', track: THREAT_ID },
      ]),
    )
    expect(lines.map((line) => line.text)).toEqual([
      'Look #1 · 0:20 — opened UAS-8F21 (the threat) · Remote ID.',
      'Look #2 · 0:20 — opened UAS-8F21 (the threat) · Remote ID.',
      'Look #2 · 0:25 — assessed UAS-8F21 (the threat).',
      'Look #2 · 0:58 — escalated UAS-8F21 (the threat) 1.2 km outside the ring · 1:06 before entry, ring entry 2:04.',
    ])
    // An action on the same second as a later look, written before it, belongs to the earlier look.
    const tied = captionTexts(
      synthetic([
        { t: 20, type: 'select', track: THREAT_ID },
        { t: 30, type: 'assess', track: THREAT_ID },
        { t: 30, type: 'select', track: THREAT_ID },
        { t: 58, type: 'escalate', track: THREAT_ID },
      ]),
    )
    expect(tied[0]).toBe('Look #1 · 0:20 — opened UAS-8F21 (the threat) · Remote ID.')
    expect(tied[1]).toBe('Look #1 · 0:30 — assessed UAS-8F21 (the threat).')
    expect(tied[2]).toBe('Look #2 · 0:30 — opened UAS-8F21 (the threat) · Remote ID.')
  })
})

describe('the frame — identical in both modes, deterministic (ruled B3, B7)', () => {
  it('gives the same bytes twice, and names the file by subject, scenario, mode, and run', () => {
    const input = fixture('S04-02b-raw-1')
    expect(frameSvg(input)).toBe(frameSvg(input))
    expect(frameName(input.record)).toBe('S04-02b-raw-1.svg')
    expect(frameSvg(input)).not.toContain('score')
  })

  it('throws for a look at a track not in the picture at that second', () => {
    expect(() => frameSvg(synthetic([{ t: 0, type: 'select', track: THREAT_ID }]))).toThrow(
      'S09 run 1: look #1 at t 0 names inject-11, not in the picture then',
    )
  })
})

describe('the frame per threat on the prioritization pair (S5c-i, #138 re-gate, ruled N6, E3, E6, E7)', () => {
  const on03 = (scenario: '03a' | '03b', events: RunEvent[], mode: 'raw' | 'vigil' = 'raw') =>
    synthetic(events, { scenario, mode, subject: 'S05' })
  const shape: RunEvent[] = [
    { t: 12, type: 'select', track: 'inject-35' },
    { t: 27, type: 'select', track: 'inject-36' },
    { t: 41, type: 'select', track: 'inject-57' },
    { t: 58, type: 'escalate', track: 'inject-57' },
    { t: 66, type: 'select', track: 'inject-74' },
    { t: 84, type: 'select', track: 'inject-31' },
    { t: 97, type: 'escalate', track: 'inject-31' },
    { t: 130, type: 'select', track: 'inject-65' },
    { t: 150, type: 'escalate', track: 'inject-65' },
  ]
  const labelTag = (svg: string, content: string) => {
    const match = svg.match(
      new RegExp(`<text[^>]*>${content.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}</text>`),
    )
    return match ? attrs(match[0]) : null
  }

  it('draws each threat’s trail with its marks unlabelled and one map label per threat around its dot at the freeze (ruled F2; placed by #170)', () => {
    const input = on03('03a', shape)
    const svg = frameSvg(input)
    const trails = tagsOf(svg, 'trail')
    expect(trails.map((trail) => trail['data-id'])).toEqual(['inject-31', 'inject-57'])
    expect(tagsOf(svg, 'trail-first').map((mark) => mark['data-id'])).toEqual([
      'inject-31',
      'inject-57',
    ])
    expect(tagsOf(svg, 'entry').map((mark) => mark['data-id'])).toEqual(['inject-31', 'inject-57'])
    for (const id of ['inject-31', 'inject-57']) {
      const first = tagsOf(svg, 'trail-first').find((mark) => mark['data-id'] === id)!
      const track = injectTracksAt(input.plan, STUDY.beginS).find(
        (candidate) => candidate.id === id,
      )!
      expect([Number(first.cx), Number(first.cy)]).toEqual(expectedPx(track.position))
    }
    // No T0 or ring-entry label on the pair's marks: those words are the caption's.
    expect(svg).not.toContain('T0 · ')
    expect(svg).not.toContain(' ring entry</text>')
    // The raw label per threat, below-right of the trail's last point — the dot at the freeze.
    const labels = tagsOf(svg, 'threat-label')
    expect(labels.map((label) => label['data-id'])).toEqual(['inject-31', 'inject-57'])
    expect(textsOf(svg, 'threat-label')).toEqual([
      'TRK-31 · ring entry 1:42',
      'TRK-57 · ring entry 3:08',
    ])
    // Each label is at one of the eight spots around its own dot — the trail's last point —
    // and no longer always the first of them (#170): the search moves it off what it would sit
    // on, and off the look path and the ring (ruled R1).
    trails.forEach((trail, i) => {
      const [x, y] = trail.points.split(' ').at(-1)!.split(',').map(Number)
      expect(SPOTS).toContainEqual([
        Math.round((Number(labels[i].x) - x) * 10) / 10,
        Math.round((Number(labels[i].y) - y) * 10) / 10,
        labels[i]['text-anchor'] === 'end',
      ])
    })
    // The trails run from Begin to the freeze at +97 — 98 points each.
    expect(trails[0].points.split(' ')).toHaveLength(98)
    expect(trails[1].points.split(' ')).toHaveLength(98)
  })

  it('colours a hop on either threat in the warning colour, the rest in the accent', () => {
    const svg = frameSvg(on03('03a', shape))
    const hops = tagsOf(svg, 'hop')
    expect(hops.map((hop) => hop['data-id'])).toEqual([
      'inject-35',
      'inject-36',
      'inject-57',
      'inject-74',
      'inject-31',
    ])
    expect(hops.map((hop) => hop.fill)).toEqual([
      '#4c9aff',
      '#4c9aff',
      '#ff6b57',
      '#4c9aff',
      '#ff6b57',
    ])
  })

  it('heads the pair’s frame at the last escalation, or MISSED naming the threats, at the scenario’s own window (E3)', () => {
    const last = on03('03a', shape)
    expect(headerLine(last)).toBe('UNAIDED · frozen at the moment of the last escalation — 1:37')
    const oneMissed = on03(
      '03b',
      [
        { t: 95, type: 'select', track: 'inject-29' },
        { t: 118, type: 'escalate', track: 'inject-29' },
      ],
      'vigil',
    )
    expect(headerLine(oneMissed)).toBe('WITH VIGIL · MISSED TRK-23 — frozen at +3:38')
    const bothMissed = on03('03a', [{ t: 12, type: 'select', track: 'inject-35' }])
    expect(headerLine(bothMissed)).toBe('UNAIDED · MISSED TRK-31, TRK-57 — frozen at +3:38')
  })

  it('names each threat by its role and logs every decision in the clock’s order (E7, S5g)', () => {
    // The T0 range on the open line and the standoff on the escalation's own (ruled F2, item 2),
    // and the clock running one way: 0:12 to 2:30 where the grouped caption ran 1:37 then 0:58.
    expect(captionTexts(on03('03a', shape))).toEqual([
      'Look #1 · 0:12 — opened TRK-35 · sensor.',
      'Look #2 · 0:27 — opened TRK-36 · sensor.',
      'Look #3 · 0:41 — opened TRK-57 (threat 2) · sensor, 6.2 km at T0.',
      'Look #3 · 0:58 — escalated TRK-57 (threat 2) 0.8 km outside the ring · 2:10 before entry, ring entry 3:08.',
      'Look #4 · 1:06 — opened TRK-74 · sensor.',
      'Look #5 · 1:24 — opened TRK-31 (threat 1) · sensor, 6.3 km at T0.',
      'Look #5 · 1:37 — escalated TRK-31 (threat 1) 0.1 km outside the ring · 0:05 before entry, ring entry 1:42.',
      // The freeze's rule, before the first line the run wrote after it (ruled R2).
      'frozen at 1:37',
      'Look #6 · 2:10 — opened TRK-65 · sensor.',
      'Look #6 · 2:30 — escalated TRK-65 · enters the ring at 6:59, after the window closed.',
    ])
    expect(
      captionTexts(
        on03('03b', [
          { t: 15, type: 'select', track: 'inject-33' },
          { t: 95, type: 'select', track: 'inject-29' },
          { t: 108, type: 'assess', track: 'inject-29' },
          { t: 118, type: 'escalate', track: 'inject-29' },
          { t: 140, type: 'select', track: 'inject-80' },
        ]),
      ),
    ).toEqual([
      'Look #1 · 0:15 — opened TRK-33 · sensor.',
      'Look #2 · 1:35 — opened TRK-29 (threat 1) · sensor, 6.3 km at T0.',
      'Look #2 · 1:48 — assessed TRK-29 (threat 1).',
      'Look #2 · 1:58 — escalated TRK-29 (threat 1) 0.2 km inside the ring · 0:16 after entry, ring entry 1:42.',
      'Look #3 · 2:20 — opened TRK-80 · sensor.',
      // The miss beneath the log, once, with the ring entry it crossed (item 4). The freeze is
      // the window's end on a miss, so nothing follows it and the rule is absent (R2).
      'MISSED TRK-23 (threat 2) — never escalated; ring entry 3:08.',
    ])
  })

  it('leaves the corroboration pair’s frames byte for byte as S5b wrote them — no id on a trail, the T0 label at x + 8', () => {
    for (const name of ['S03-02a-raw-1', 'S03-02a-vigil-1', 'S04-02b-raw-1', 'S04-02b-vigil-1']) {
      const svg = frameSvg(fixture(name))
      expect(svg).toBe(readFileSync(`tools/replay/__fixtures__/frames/${name}.svg`, 'utf8'))
      expect(tagsOf(svg, 'trail')[0]['data-id']).toBeUndefined()
      expect(tagsOf(svg, 'trail-first')[0]['data-id']).toBeUndefined()
      const [first] = tagsOf(svg, 'trail-first')
      const t0 = labelTag(svg, 'T0 · 7.2 km')!
      expect(t0['text-anchor']).toBeUndefined()
      expect(Number(t0.x)).toBe(Math.round((Number(first.cx) + 8) * 10) / 10)
    }
  })
})

describe('the frame on the 03 fixtures (S5c-i, ruled E9)', () => {
  it('writes the caption for the S05 03a raw fixture and the S06 03b raw fixture exactly', () => {
    const raw = fixture('S05-03a-raw-1')
    expect(headerLine(raw)).toBe('UNAIDED · frozen at the moment of the last escalation — 1:37')
    expect(captionTexts(raw)).toEqual([
      'Look #1 · 0:12 — opened TRK-35 · sensor.',
      'Look #2 · 0:27 — opened TRK-36 · sensor.',
      'Look #3 · 0:41 — opened TRK-57 (threat 2) · sensor, 6.2 km at T0.',
      'Look #3 · 0:50 — assessed TRK-57 (threat 2).',
      'Look #3 · 0:58 — escalated TRK-57 (threat 2) 0.8 km outside the ring · 2:10 before entry, ring entry 3:08.',
      'Look #4 · 1:06 — opened TRK-74 · sensor.',
      'Look #5 · 1:24 — opened TRK-31 (threat 1) · sensor, 6.3 km at T0.',
      'Look #5 · 1:30 — assessed TRK-31 (threat 1).',
      'Look #5 · 1:37 — escalated TRK-31 (threat 1) 0.1 km outside the ring · 0:05 before entry, ring entry 1:42.',
      'frozen at 1:37',
      'Look #6 · 2:10 — opened TRK-65 · sensor.',
      'Look #6 · 2:20 — assessed TRK-65.',
      'Look #6 · 2:30 — escalated TRK-65 · enters the ring at 6:59, after the window closed.',
    ])
    const missed = fixture('S06-03b-raw-1')
    expect(headerLine(missed)).toBe('UNAIDED · MISSED TRK-23 — frozen at +3:38')
    // The two escalations the run made besides the threats now sit in the clock where it made
    // them, each naming the look it came off (S5f, #173), and the miss is stated beneath (item 4).
    expect(captionTexts(missed)).toEqual([
      'Look #1 · 0:15 — opened TRK-33 · sensor.',
      'Look #1 · 0:24 — assessed TRK-33.',
      'Look #1 · 0:33 — escalated TRK-33 · enters the ring at 6:32, after the window closed.',
      'Look #2 · 0:48 — opened TRK-21 · sensor.',
      'Look #2 · 1:00 — assessed TRK-21.',
      'Look #2 · 1:10 — escalated TRK-21 · never enters the ring.',
      'Look #3 · 1:35 — opened TRK-29 (threat 1) · sensor, 6.3 km at T0.',
      'Look #3 · 1:48 — assessed TRK-29 (threat 1).',
      'Look #3 · 1:58 — escalated TRK-29 (threat 1) 0.2 km inside the ring · 0:16 after entry, ring entry 1:42.',
      'Look #4 · 2:20 — opened TRK-80 · sensor.',
      'MISSED TRK-23 (threat 2) — never escalated; ring entry 3:08.',
    ])
    // R3: every escalation takes the box's weight, whatever the track — the two above are of
    // tracks that are not threats — while their opens and assesses stay muted.
    expect(captionLines(missed).map((line) => line.bold)).toEqual([
      false,
      false,
      true,
      false,
      false,
      true,
      true,
      true,
      true,
      false,
      true,
    ])
    // Its freeze is the window's end, so nothing follows it and the log carries no rule (R2).
    expect(captionLines(missed).some((line) => line.rule === true)).toBe(false)
    // The Vigil frames read the same idents: the 03 threats are silent, so no mode changes them.
    const vigil = fixture('S06-03b-vigil-1')
    expect(headerLine(vigil)).toBe(
      'WITH VIGIL · frozen at the moment of the last escalation — 1:28',
    )
    expect(captionTexts(vigil)[0]).toBe(
      'Look #1 · 0:09 — opened TRK-29 (threat 1) · sensor, 6.3 km at T0.',
    )
    // Six hops on the raw frame: five up to the freeze at +97, and the sixth look at +130 after
    // it, which the frame draws too since S5f (#173). The subtitle gives both counts.
    const svg = frameSvg(raw)
    expect(tagsOf(svg, 'hop')).toHaveLength(5)
    expect(tagsOf(svg, 'hop-late').map((hop) => hop['data-t'])).toEqual(['130'])
    expect(textsOf(svg, 'subtitle')).toEqual([
      "The subject's selection sequence from the run JSON, replayed as a path. 6 looks over the whole run, 5 to the freeze.",
    ])
    expect(frameSvg(raw)).toBe(frameSvg(raw))
    // It builds the 03 frames several times over; the runner is slower than this machine.
  }, 30_000)
})

describe('the frame — round 1 (#159)', () => {
  it('emphasises a MISSED decision line wherever it sits: threat 1 missed and threat 2 escalated reads both lines bold', () => {
    const svg = frameSvg(
      synthetic(
        [
          { t: 41, type: 'select', track: 'inject-57' },
          { t: 58, type: 'escalate', track: 'inject-57' },
        ],
        { scenario: '03a', subject: 'S05' },
      ),
    )
    const captions = [...svg.matchAll(/<text[^>]*class="caption"[^>]*>([^<]*)<\/text>/g)].map(
      (match) => ({ attrs: attrs(match[0]), text: match[1] }),
    )
    expect(captions.map((line) => line.text)).toEqual([
      'Look #1 · 0:41 — opened TRK-57 (threat 2) · sensor, 6.2 km at T0.',
      'Look #1 · 0:58 — escalated TRK-57 (threat 2) 0.8 km outside the ring · 2:10 before entry, ring entry 3:08.',
      'MISSED TRK-31 (threat 1) — never escalated; ring entry 1:42.',
    ])
    // Every line here is a threat's, so every one takes the box's weight — the miss beneath the
    // log among them, wherever it sits.
    expect(captions.map((line) => line.attrs['font-weight'])).toEqual(['600', '600', '600'])
  })
})

describe('the Vigil annotations, on a Vigil frame only (S5c-ii, #138, ruled C1–C10, F1–F5)', () => {
  const vigilOf = (name: string) => fixture(name)
  const queueLines = (svg: string) =>
    [...svg.matchAll(/<text[^>]*class="vigil-queue-line"[^>]*>(.*?)<\/text>/g)].map((match) =>
      match[1].replace(/<[^>]+>/g, ''),
    )
  const vigilCaption = (svg: string) =>
    [...svg.matchAll(/class="caption"[^>]*>([^<]*)</g)].map((match) => match[1])

  it('draws the Priority list box under the map on 02a and 02b — the S5c gate’s five lines exactly — and the twenty-six on 03a (S7c, #163)', () => {
    const a = frameSvg(vigilOf('S03-02a-vigil-1'))
    expect(textsOf(a, 'vigil-queue-title')).toEqual(['Priority list at 0:58 · 5 above calm'])
    expect(queueLines(a)).toEqual([
      '1 TRK-11 72 · Remote ID mismatch, closing, near PHL Airfield',
      '2 TRK-12 64 · Revisiting, non-cooperative, near PHL Airfield',
      '3 TRK-13 58 · Non-cooperative, near PHL Airfield, low and slow',
      '4 UAS-0088 49 · Closing, near PHL Airfield, low and slow',
      '5 UAS-8E97 45 · Closing, near PHL Airfield, low and slow',
    ])
    const b = frameSvg(vigilOf('S04-02b-vigil-1'))
    expect(queueLines(b).slice(3)).toEqual([
      '4 UAS-BEEC 49 · Closing, near PHL Airfield, low and slow',
      '5 UAS-CF19 45 · Closing, near PHL Airfield, low and slow',
    ])
    // Under the map: the box's rect sits below the panel and above the caption, full width —
    // below the key's two lines as well on a frame with a look after the freeze, as 02a has
    // (S5f, #173).
    const [box] = tagsOf(a, 'vigil-queue')
    expect(Number(box.y)).toBe(80 + 700 + 48 + 28)
    expect(box.width).toBe('840')
    expect(Number(box.height)).toBe(30 + 5 * 18 + 6)
    const c = frameSvg(vigilOf('S05-03a-vigil-1'))
    expect(textsOf(c, 'vigil-queue-title')).toEqual(['Priority list at 1:11 · 26 above calm'])
    expect(queueLines(c)).toHaveLength(26)
    expect(queueLines(c)[0]).toBe('1 TRK-31 73 · Non-cooperative, closing, near PHL Airfield')
    expect(queueLines(c)[13]).toBe('14 TRK-25 61 · Orbiting, non-cooperative, low and slow')
    expect(queueLines(c)[24]).toBe('25 UAS-FA85 45 · Closing, near PHL Airfield, low and slow')
    expect(queueLines(c)[25]).toBe(
      '26 TRK-47 45 · Non-cooperative, low and slow, near PHL Airfield',
    )
    // The rank in the band's colour: warning for rank 1, caution for rank 4 on 02a.
    const spans = [
      ...a.matchAll(/class="vigil-queue-line"[^>]*><tspan[^>]*fill="([^"]+)">(\d+)<\/tspan>/g),
    ].map((match) => [match[2], match[1]])
    expect(spans).toEqual([
      ['1', '#ff6b57'],
      ['2', '#f5b942'],
      ['3', '#f5b942'],
      ['4', '#f5b942'],
      ['5', '#f5b942'],
    ])
  })

  it('labels every above-calm inject beside its dot in the band’s colour, above-right; on the pair a threat’s label is its combined one', () => {
    const input = vigilOf('S03-02a-vigil-1')
    const svg = frameSvg(input)
    const labels = tagsOf(svg, 'vigil-label')
    const candidates = candidatesAt(rankedAtSecond(study, input.plan, STUDY.beginS + 58))
    expect(labels.map((label) => label['data-id'])).toEqual(
      candidates.map((entry) => entry.track.id),
    )
    expect(textsOf(svg, 'vigil-label')).toEqual([
      'TRK-11 · 72',
      'TRK-12 · 64',
      'TRK-13 · 58',
      'UAS-0088 · 49',
      'UAS-8E97 · 45',
    ])
    candidates.forEach((entry, i) => {
      const [x, y] = expectedPx(entry.track.position)
      expect(Number(labels[i].x)).toBe(Math.round((x + 9) * 10) / 10)
      expect(Number(labels[i].y)).toBe(Math.round((y - 7) * 10) / 10)
      expect(labels[i].fill).toBe(entry.band === 'warning' ? '#ff6b57' : '#f5b942')
    })
    expect(labels[0]).toMatchObject({ x: '291', y: '421.4' })
    // 02: the warm label above-right as the S5c gate mocked it, and the entry at the spot the
    // placement gives it — below-right was on the T0 label and the mismatch label (#170).
    expect(tagsOf(svg, 'vigil-entry')[0]).toMatchObject({
      x: '273',
      y: '418.4',
      'text-anchor': 'end',
      'data-id': 'inject-11',
    })
    const dot = expectedPx(candidates[0].track.position)
    expect(SPOTS).toContainEqual([
      Math.round((273 - dot[0]) * 10) / 10,
      Math.round((418.4 - dot[1]) * 10) / 10,
      true,
    ])
    expect(textsOf(svg, 'vigil-entry')).toEqual(['entry in 1:05'])
    expect(textsOf(frameSvg(vigilOf('S04-02b-vigil-1')), 'vigil-entry')).toEqual(['entry in 1:04'])
    expect(tagsOf(svg, 'vigil-threat-label')).toHaveLength(0)
    // The pair: twenty-four warm labels and one combined label per threat, in the band's colour.
    const c = frameSvg(vigilOf('S05-03a-vigil-1'))
    expect(tagsOf(c, 'vigil-label')).toHaveLength(24)
    expect(tagsOf(c, 'vigil-entry')).toHaveLength(0)
    expect(textsOf(c, 'vigil-threat-label')).toEqual([
      'TRK-31 · 73 · entry in 0:31',
      'TRK-57 · 73 · entry in 1:56',
    ])
    // Below-right was on the threat's own entry mark, so the label takes the left-hand spot at
    // the same height and reads away from the dot (#170).
    expect(tagsOf(c, 'vigil-threat-label')[0]).toMatchObject({
      x: '283.9',
      y: '326.7',
      'text-anchor': 'end',
      fill: '#ff6b57',
      'font-weight': '600',
    })
    expect(tagsOf(c, 'threat-label')).toHaveLength(0)
    expect(textsOf(frameSvg(vigilOf('S06-03b-vigil-1')), 'vigil-threat-label')).toEqual([
      'TRK-29 · 73 · entry in 0:14',
      'TRK-23 · 73 · entry in 1:39',
    ])
  })

  it('draws the mismatch line from the observed dot to the broadcast’s position on 02, and none on the silent 03 threats', () => {
    const a = frameSvg(vigilOf('S03-02a-vigil-1'))
    expect(a).toContain(
      '<line class="vigil-mismatch" data-id="inject-11" x1="282" y1="428.4" x2="315.1" y2="428.4"',
    )
    expect(tagsOf(a, 'vigil-broadcast')[0]).toMatchObject({ cx: '315.1', cy: '428.4' })
    expect(textsOf(a, 'vigil-mismatch-label')).toEqual(['Remote ID says here · 1.1 km'])
    const b = frameSvg(vigilOf('S04-02b-vigil-1'))
    expect(b).toContain(
      '<line class="vigil-mismatch" data-id="inject-11" x1="623.4" y1="413.8" x2="656.5" y2="413.8"',
    )
    for (const name of ['S05-03a-vigil-1', 'S06-03b-vigil-1']) {
      const svg = frameSvg(vigilOf(name))
      expect(tagsOf(svg, 'vigil-mismatch')).toHaveLength(0)
      expect(svg).not.toContain('Remote ID says here')
    }
  })

  it('writes the Vigil line under the look it belongs to and the overlay’s count at the foot', () => {
    expect(vigilCaption(frameSvg(vigilOf('S03-02a-vigil-1')))).toEqual([
      'Look #1 · 0:14 — opened TRK-11 (the threat) · sensor.',
      'Vigil read it rank 1 · warning 71 · closing at 18 m/s · ring entry in 1:49.',
      'Remote ID UAS-8F21 broadcasts 1.1 km from the observed track.',
      'Look #1 · 0:49 — assessed TRK-11 (the threat).',
      'Look #1 · 0:58 — escalated TRK-11 (the threat) 1.2 km outside the ring · 1:06 before entry, ring entry 2:04.',
      // The freeze's rule carries its own class, so it is not among the box's sentences here;
      // the look after it carries no reading (#176 round 1).
      'Look #2 · 1:20 — opened TRK-11 (the threat) · sensor.',
      // The count is the foot's own line, not a suffix on a decision about a track (item 5).
      '4 candidates never opened.',
    ])
    // 02b: the look at +14 read the Remote ID and no mismatch — the lie begins at +30 — so R1's
    // clause says what it read then, under the one name the log gives the track.
    expect(vigilCaption(frameSvg(vigilOf('S04-02b-vigil-1'))).slice(0, 2)).toEqual([
      'Look #1 · 0:14 — opened TRK-11 (the threat) · Remote ID, reading UAS-8F21 then.',
      'Vigil read it rank 3 · caution 47 · closing at 18 m/s · ring entry in 1:48.',
    ])
    expect(vigilCaption(frameSvg(vigilOf('S05-03a-vigil-1')))).toEqual([
      'Look #1 · 0:11 — opened TRK-31 (threat 1) · sensor, 6.3 km at T0.',
      'Vigil read it rank 1 · warning 72 · closing at 13 m/s · ring entry in 1:31.',
      'Look #1 · 0:24 — assessed TRK-31 (threat 1).',
      'Look #1 · 0:38 — escalated TRK-31 (threat 1) 0.8 km outside the ring · 1:04 before entry, ring entry 1:42.',
      'Look #2 · 0:52 — opened TRK-57 (threat 2) · sensor, 6.2 km at T0.',
      'Vigil read it rank 2 · warning 72 · closing at 6 m/s · ring entry in 2:15.',
      'Look #2 · 1:02 — assessed TRK-57 (threat 2).',
      'Look #2 · 1:11 — escalated TRK-57 (threat 2) 0.7 km outside the ring · 1:57 before entry, ring entry 3:08.',
      'Look #3 · 2:00 — opened TRK-35 · sensor.',
      '23 candidates never opened.',
    ])
    expect(vigilCaption(frameSvg(vigilOf('S06-03b-vigil-1'))).at(-1)).toBe(
      '23 candidates never opened.',
    )
    // The Vigil line is muted, as every line that is not a threat's or an escalation is (R3).
    const a = frameSvg(vigilOf('S03-02a-vigil-1'))
    const vigilLine = a.match(/<text[^>]*class="caption"[^>]*>Vigil read it/)![0]
    expect(vigilLine).toContain('fill="#8b98a9"')
  })

  it('draws no annotation on a raw frame — the four raw fixture frames carry no vigil- class — and holds the 02 Vigil frames byte for byte (F4)', () => {
    for (const name of ['S03-02a-raw-1', 'S04-02b-raw-1', 'S05-03a-raw-1', 'S06-03b-raw-1']) {
      const svg = frameSvg(fixture(name))
      expect(svg).not.toMatch(/class="vigil-/)
      expect(svg).not.toContain('Vigil read it')
      expect(svg).not.toContain('never opened.')
    }
    for (const name of ['S03-02a-vigil-1', 'S04-02b-vigil-1']) {
      expect(frameSvg(fixture(name))).toBe(
        readFileSync(`tools/replay/__fixtures__/frames/${name}.svg`, 'utf8'),
      )
    }
  })

  it('renders one record as raw and as Vigil with the map group equal once the vigil- elements are stripped, and the caption equal minus the Vigil lines (F3)', () => {
    const mapGroup = (svg: string) => {
      const start = svg.indexOf('<g class="map"')
      return svg
        .slice(start, svg.indexOf('</g>', start))
        .split('\n')
        .filter((line) => !/class="(vigil-|threat-label)/.test(line))
    }
    const captionsOf = (svg: string) =>
      [...svg.matchAll(/class="caption"[^>]*>([^<]*)</g)]
        .map((match) => match[1])
        // The Vigil reading, its mismatch line and the overlay's count are the Vigil frame's own
        // (C6, C7); since S5g the count is a line rather than a suffix.
        .filter((line) => !/^(Vigil read it|Remote ID |\d+ candidates? never opened)/.test(line))
    for (const name of ['S03-02a-raw-1', 'S05-03a-raw-1']) {
      const raw = fixture(name)
      const asVigil = { ...raw, record: { ...raw.record, mode: 'vigil' as const } }
      const r = frameSvg(raw)
      const v = frameSvg(asVigil)
      expect(mapGroup(v)).toEqual(mapGroup(r))
      const rc = captionsOf(r)
      const vc = captionsOf(v)
      expect(vc).toHaveLength(rc.length)
      const differing = rc.filter((line, i) => line !== vc[i])
      // 02a: the lines that name the threat, since raw's screen read UAS-8F21 where Vigil's read
      // TRK-11; 03a: none — the threats are silent, so both modes read TRK-nn (S5g, #175).
      expect(differing).toEqual(
        name === 'S03-02a-raw-1'
          ? [
              'Look #1 · 0:14 — opened UAS-8F21 (the threat) · Remote ID.',
              'Look #1 · 0:49 — assessed UAS-8F21 (the threat).',
              'Look #1 · 0:58 — escalated UAS-8F21 (the threat) 1.2 km outside the ring · 1:06 before entry, ring entry 2:04.',
            ]
          : [],
      )
      expect(v).toContain('WITH VIGIL')
    }
    // On the pair each mode has its one label per threat, F2's words each side.
    const raw = fixture('S05-03a-raw-1')
    const v = frameSvg({ ...raw, record: { ...raw.record, mode: 'vigil' as const } })
    expect(textsOf(frameSvg(raw), 'threat-label')).toEqual([
      'TRK-31 · ring entry 1:42',
      'TRK-57 · ring entry 3:08',
    ])
    expect(textsOf(v, 'threat-label')).toHaveLength(0)
    expect(textsOf(v, 'vigil-threat-label')).toEqual([
      'TRK-31 · 74 · entry in 0:05',
      'TRK-57 · 73 · entry in 1:30',
    ])
  })
})

describe('the frame — round 1 (#160)', () => {
  const vigilFixtures = ['S03-02a-vigil-1', 'S04-02b-vigil-1', 'S05-03a-vigil-1', 'S06-03b-vigil-1']
  const captionsOf = (svg: string) =>
    [...svg.matchAll(/class="caption"[^>]*>([^<]*)</g)].map((match) => match[1])

  it('keeps every caption line inside the box: the mismatch clause is its own line, and no line on the four Vigil fixtures passes 128 characters', () => {
    // The box is 824 px wide inside its padding at 13 px; the theme's face runs about 6.3 px a
    // character in this text, so 128 characters is the budget with room — the pre-fix Vigil
    // line with the mismatch clause ran 138.
    for (const name of vigilFixtures) {
      const lines = captionsOf(frameSvg(fixture(name)))
      for (const line of lines) expect(line.length, `${name}: ${line}`).toBeLessThanOrEqual(128)
    }
    const a = captionsOf(frameSvg(fixture('S03-02a-vigil-1')))
    expect(a[1]).toBe('Vigil read it rank 1 · warning 71 · closing at 18 m/s · ring entry in 1:49.')
    expect(a[2]).toBe('Remote ID UAS-8F21 broadcasts 1.1 km from the observed track.')
    expect(a).toHaveLength(7)
    // 02b's look at +14 read no mismatch, so no such line.
    expect(captionsOf(frameSvg(fixture('S04-02b-vigil-1')))).toHaveLength(6)
    // The log is narrower than the caption it replaces: the widest line of the eight frames runs
    // 111 characters where the grouped caption's ran 128, the overlay's count having moved off
    // the last decision line (item 5).
    const widest = ['S03-02a-raw-1', ...vigilFixtures, 'S05-03a-raw-1', 'S06-03b-raw-1']
      .flatMap((name) => captionsOf(frameSvg(fixture(name))))
      .reduce((longest, line) => (line.length > longest.length ? line : longest), '')
    expect(widest.length).toBeLessThanOrEqual(112)
  })

  it('reads the entry through the Entry row’s own function: the horizon, inside, and the ground guard', () => {
    const center = AO.protectedSites[0].center
    const kmPerDegLon = 111.32 * Math.cos((center[1] * Math.PI) / 180)
    const west = (km: number): [number, number] => [center[0] - km / kmPerDegLon, center[1]]
    const track = (position: [number, number], groundSpeedKt: number | null, onGround = false) => ({
      position,
      headingDeg: 90,
      groundSpeedKt,
      onGround,
      lastSeenSec: 0,
    })
    // 12 km out at 4 kt: the ring is 7 km ahead, 57 minutes away — past the row's 20 min horizon.
    expect(entryWords(track(west(12), 4))).toBe('no ring entry within 20 min')
    // 12 km out at 40 kt: 5:40 to the ring.
    expect(entryWords(track(west(12), 40))).toMatch(/^ring entry in 5:[34]\d$/)
    expect(entryWords(track(center, 40))).toBe('inside the ring')
    expect(entryWords(track(west(12), 40, true))).toBeNull()
    // No speed: the row reads none within the horizon, and so does the frame — never "not closing".
    expect(entryWords(track(west(12), null))).toBe('no ring entry within 20 min')
    for (const name of vigilFixtures) {
      expect(frameSvg(fixture(name))).not.toContain('not closing')
    }
  })

  it('counts the overlay’s marks in the suffix and names any candidate beyond the panel apart', () => {
    const record = fixture('S03-02a-raw-1').record
    const at = (id: string, position: [number, number]) =>
      ({ track: { id, position } }) as unknown as Parameters<typeof neverOpenedWords>[1][number]
    const center = AO.protectedSites[0].center
    const inPanel = at('inject-12', center)
    const far = at('inject-13', [center[0] + 1, center[1]])
    expect(neverOpenedWords(record, [inPanel])).toBe('1 candidate never opened.')
    expect(neverOpenedWords(record, [inPanel, far])).toBe(
      '1 candidate never opened, 1 beyond the panel.',
    )
    expect(neverOpenedWords(record, [at('inject-11', center)])).toBe('0 candidates never opened.')
    // The fixtures' sets lie inside the panel, so the counts are the marks': 4 and 23. Since S5g
    // the count is the foot's own line rather than a suffix (item 5).
    expect(captionsOf(frameSvg(fixture('S03-02a-vigil-1'))).at(-1)).toBe(
      '4 candidates never opened.',
    )
    expect(tagsOf(frameSvg(fixture('S03-02a-vigil-1')), 'never-opened')).toHaveLength(4)
    expect(captionsOf(frameSvg(fixture('S05-03a-vigil-1'))).at(-1)).toBe(
      '23 candidates never opened.',
    )
    expect(tagsOf(frameSvg(fixture('S05-03a-vigil-1')), 'never-opened')).toHaveLength(23)
  })

  it('paints a calm band in the neutral text colour, never a borrowed caution', () => {
    expect(bandFill('warning')).toBe('#ff6b57')
    expect(bandFill('caution')).toBe('#f5b942')
    expect(bandFill('calm')).toBe('#e6edf3')
  })

  it('prints every pixel to a tenth: no pixel attribute on any of the eight fixture frames carries two or more decimals', () => {
    // The pixel attributes alone: fill-opacity="0.08" is a two-decimal value by design.
    for (const name of [
      'S03-02a-raw-1',
      'S03-02a-vigil-1',
      'S04-02b-raw-1',
      'S04-02b-vigil-1',
      'S05-03a-raw-1',
      'S05-03a-vigil-1',
      'S06-03b-raw-1',
      'S06-03b-vigil-1',
    ]) {
      expect(frameSvg(fixture(name))).not.toMatch(
        /\b(x|y|cx|cy|x1|y1|x2|y2|r|width|height)="-?\d+\.\d{2,}"/,
      )
    }
  })
})

describe('the frame’s document for the pair (S5d-i, ruled G2)', () => {
  it('gives its body apart from the wrapper, a clip id of the caller’s, and the Queue box capped on request', () => {
    const input = fixture('S05-03a-vigil-1')
    const whole = frameDocument(input)
    expect(whole).toMatchObject({ width: 900, height: 1642 })
    expect(frameSvg(input)).toBe(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1642" viewBox="0 0 900 1642" data-subject="S05" data-scenario="03a" data-mode="vigil" data-run="1">',
        ...whole.lines,
        '</svg>',
        '',
      ].join('\n'),
    )
    expect(whole.lines.join('\n')).toContain('<clipPath id="panel">')
    const capped = frameDocument(input, { clipId: 'panel-right', queueCap: 5 })
    const body = capped.lines.join('\n')
    expect(body).toContain('<clipPath id="panel-right">')
    expect(body).toContain('clip-path="url(#panel-right)"')
    expect(tagsOf(body, 'vigil-queue-line')).toHaveLength(5)
    expect(textsOf(body, 'vigil-queue-more')).toEqual([
      "… 21 more above calm, on the run's own frame",
    ])
    // Twenty-one rows fewer, one count line more: twenty lines of 18 px.
    expect(capped.height).toBe(whole.height - 20 * 18)
    // A cap the box fits under changes nothing.
    expect(frameDocument(fixture('S03-02a-vigil-1'), { queueCap: 5 }).lines).toEqual(
      frameDocument(fixture('S03-02a-vigil-1')).lines,
    )
  })

  it('draws the frame from its two parts — the picture, then the log from the picture’s height — the same bytes as the file (S5g, #194)', () => {
    // The sheet takes the picture and the log lines apart to put the logs below its comparison;
    // the frame's own file is the two parts put back together under one ground, so the eight
    // expected files below hold. Every log line goes through `captionText`, the box and the
    // sheet's blocks alike.
    for (const name of ['S05-03a-raw-1', 'S06-03b-vigil-1']) {
      const input = fixture(name)
      const parts = frameParts(input)
      const whole = frameDocument(input)
      const log = parts.log(parts.top.height)
      expect(whole.height).toBe(parts.top.height + log.height)
      expect(whole.lines).toEqual([
        `<rect width="900" height="${whole.height}" fill="#0b0f14"/>`,
        ...parts.top.lines,
        ...log.lines,
      ])
      // The picture is the header, the map and its footnotes: 80, 700 and the foot.
      expect(parts.top.height).toBe(input.record.mode === 'raw' ? 856 : 828)
      // The Queue box stands wherever it is asked to, the same lines from another y.
      const box = parts.queue(0)
      expect(box.height).toBe(input.record.mode === 'vigil' ? 30 + 26 * 18 + 6 : 0)
      if (input.record.mode === 'vigil') {
        expect(box.lines[0]).toContain('y="0"')
        expect(parts.queue(500).lines[0]).toContain('y="500"')
        expect(parts.queue(500).lines.length).toBe(box.lines.length)
      }
      // The log's lines are the caption's, and the box draws each through captionText.
      expect(parts.lines).toEqual(captionLines(input))
      const captionY = parts.top.height + (input.record.mode === 'vigil' ? box.height + 12 : 0)
      parts.lines.forEach((line, i) => {
        for (const drawn of captionText(line, captionY + CAPTION.top + (i + 1) * CAPTION.line - 6))
          expect(log.lines).toContain(drawn)
      })
    }
  })

  it('holds the eight fixture frames byte for byte as expected files', () => {
    for (const name of [
      'S03-02a-raw-1',
      'S03-02a-vigil-1',
      'S04-02b-raw-1',
      'S04-02b-vigil-1',
      'S05-03a-raw-1',
      'S05-03a-vigil-1',
      'S06-03b-raw-1',
      'S06-03b-vigil-1',
    ]) {
      expect(frameSvg(fixture(name))).toBe(
        readFileSync(`tools/replay/__fixtures__/frames/${name}.svg`, 'utf8'),
      )
    }
  })
})

describe('a threat’s label goes where the map is clear (#170, ruled R1, R2)', () => {
  /** The eight spots again, as offsets from a dot at the origin. */
  const spotsAt = (x: number, y: number) =>
    SPOTS.map(([dx, dy, end]) => ({ x: x + dx, y: y + dy, end }))

  it('takes its own spot when nothing is there and no line crosses it', () => {
    const place = placeLabel(400, 300, 11, 'TRK-11 · 72', [], [], null)
    expect(place).toEqual({ x: 409, y: 316, end: false, pass: 1 })
  })

  it('steps past a spot a mark or a label holds, and reports the pass it took', () => {
    // A box over the first spot only: the label takes the second, still in the first pass.
    const first = textBox(409, 316, 11, 'TRK-11 · 72')
    expect(placeLabel(400, 300, 11, 'TRK-11 · 72', [first], [], null)).toEqual({
      x: 409,
      y: 290,
      end: false,
      pass: 1,
    })
  })

  it('prefers a spot no line crosses, and takes a crossed one only when none is free (R1)', () => {
    // The look path runs through the first spot, which is otherwise clear: the first pass steps
    // past it rather than stopping there, and takes the second spot.
    const path: Segment[] = [
      [
        [380, 312],
        [520, 312],
      ],
    ]
    expect(placeLabel(400, 300, 11, 'TRK-11 · 72', [], path, null)).toEqual({
      x: 409,
      y: 290,
      end: false,
      pass: 1,
    })
    // The ring counts the same way: an outline through the first spot moves the label off it.
    const ring = { cx: 409, cy: 316, r: 40 }
    expect(placeLabel(400, 300, 11, 'TRK-11 · 72', [], [], ring).pass).toBe(1)
    expect(placeLabel(400, 300, 11, 'TRK-11 · 72', [], [], ring)).not.toMatchObject({
      x: 409,
      y: 316,
    })
    // With every spot crossed by the path, no spot is line-free: the second pass takes the first
    // that clears the marks and labels, which is the label's own.
    const everywhere: Segment[] = spotsAt(400, 300).map((spot) => [
      [spot.x - 200, spot.y - 4],
      [spot.x + 200, spot.y - 4],
    ])
    const crossed = placeLabel(400, 300, 11, 'TRK-11 · 72', [], everywhere, null)
    expect(crossed).toEqual({ x: 409, y: 316, end: false, pass: 2 })
  })

  it('falls back to its own spot, on top of what crowds it, when no spot is clear (R1)', () => {
    const everySpot = spotsAt(400, 300).map((spot) =>
      textBox(spot.x, spot.y, 11, 'TRK-11 · 72', spot.end),
    )
    const place = placeLabel(400, 300, 11, 'TRK-11 · 72', everySpot, [], null)
    expect(place).toEqual({ x: 409, y: 316, end: false, pass: 0 })
  })

  it('keeps every spot wholly inside the panel, in both passes (R2)', () => {
    // A dot in the panel's bottom-right corner: every right-hand spot would run off the edge,
    // and the low ones off the bottom, so the label takes a left-hand spot that fits.
    const place = placeLabel(PANEL.width - 20, PANEL.height - 8, 11, 'TRK-11 · 72', [], [], null)
    const box = textBox(place.x, place.y, 11, 'TRK-11 · 72', place.end)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.w).toBeLessThanOrEqual(PANEL.width)
    expect(box.y + box.h).toBeLessThanOrEqual(PANEL.height)
    expect(place.end).toBe(true)
    // The bound holds in the second pass too: with every spot crossed by a line, the one it
    // takes is still inside the panel.
    const everywhere: Segment[] = spotsAt(PANEL.width - 20, PANEL.height - 8).map((spot) => [
      [spot.x - 300, spot.y - 4],
      [spot.x + 300, spot.y - 4],
    ])
    const second = placeLabel(
      PANEL.width - 20,
      PANEL.height - 8,
      11,
      'TRK-11 · 72',
      [],
      everywhere,
      null,
    )
    const box2 = textBox(second.x, second.y, 11, 'TRK-11 · 72', second.end)
    expect(second.pass).toBe(2)
    expect(box2.x + box2.w).toBeLessThanOrEqual(PANEL.width)
    expect(box2.y + box2.h).toBeLessThanOrEqual(PANEL.height)
  })

  it('reads a line across a box, and a ring the box straddles', () => {
    const box = textBox(100, 100, 11, 'TRK-11 · 72')
    expect(
      crossesBox(box, [
        [0, 95],
        [400, 95],
      ]),
    ).toBe(true)
    expect(
      crossesBox(box, [
        [0, 40],
        [400, 40],
      ]),
    ).toBe(false)
    // A segment that stops short of the box does not cross it.
    expect(
      crossesBox(box, [
        [0, 95],
        [50, 95],
      ]),
    ).toBe(false)
    // The ring is a line, not a disc: a box wholly inside it is not crossed, one on it is.
    expect(crossesRing(box, 110, 95, 300)).toBe(false)
    expect(crossesRing(box, 110, 95, 20)).toBe(true)
  })

  it('never under-reads a label: the estimate against fourteen measured in a browser', () => {
    // Widths at font-size 11 in system-ui, measured with getComputedTextLength (#170's gate).
    const measured: [string, number][] = [
      ['TRK-23 · 73 · entry in 1:39', 126.69],
      ['TRK-23 · 73 · inside the ring', 137.33],
      ['inject-23 · ring entry 3:08', 121.03],
      ['never opened', 66.97],
      ['UAS-A49E · 46', 72.05],
      ['TRK-11 · 72', 53.63],
      ['entry in 1:05', 59.95],
      ['inside the ring', 69.38],
      ['Remote ID says here · 1.1 km', 139.52],
      ['T0 · 7.2 km', 52.31],
      ['2:04 ring entry', 70.25],
      ['PHL Airfield · 5 km ring', 111.25],
      ['xx', 11.03],
      ['x x', 14.05],
    ]
    for (const [content, width] of measured) {
      const box = textBox(0, 100, 11, content)
      expect(box.w).toBeGreaterThanOrEqual(width)
      // And never wildly over: a box more than half again the real one would cost a label every
      // spot on a crowded frame.
      expect(box.w).toBeLessThan(width * 1.5 + 4)
    }
  })

  it('leaves no threat label on the look path or the ring on the four 03 frames (R1)', () => {
    for (const name of ['S05-03a-raw-1', 'S05-03a-vigil-1', 'S06-03b-raw-1', 'S06-03b-vigil-1']) {
      const svg = readFileSync(`tools/replay/__fixtures__/frames/${name}.svg`, 'utf8')
      const points = svg
        .match(/<polyline points="([^"]*)" fill="none" class="path"/)![1]
        .split(' ')
        .map((point) => point.split(',').map(Number) as [number, number])
      const path: Segment[] = points.slice(1).map((point, i): Segment => [points[i], point])
      const ring = svg.match(/<circle class="ring" cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/)!
      const labels = [
        ...svg.matchAll(
          /<text x="([\d.]+)" y="([\d.]+)"[^>]*class="(?:threat-label|vigil-threat-label)"([^>]*)>([^<]*)</g,
        ),
      ]
      expect(labels).toHaveLength(2)
      for (const [, x, y, attrs, content] of labels) {
        const box = textBox(Number(x), Number(y), 11, content, attrs.includes('text-anchor="end"'))
        expect([name, content, path.some((seg) => crossesBox(box, seg))]).toEqual([
          name,
          content,
          false,
        ])
        expect([
          name,
          content,
          crossesRing(box, Number(ring[1]), Number(ring[2]), Number(ring[3])),
        ]).toEqual([name, content, false])
      }
    }
  })
})

describe('a threat’s label clears every drawn mark — round 1 (#172)', () => {
  /** Every circle the map draws, as a box; the ring is a line, tested apart. */
  const marksOf = (svg: string) =>
    [...svg.matchAll(/<circle class="([a-z-]+)"[^>]*cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)]
      .filter((mark) => mark[1] !== 'ring')
      .map((mark) => ({
        cls: mark[1],
        x: Number(mark[2]) - Number(mark[4]),
        y: Number(mark[3]) - Number(mark[4]),
        w: 2 * Number(mark[4]),
        h: 2 * Number(mark[4]),
      }))
  const labelsOf = (svg: string) =>
    [
      ...svg.matchAll(
        /<text x="([\d.]+)" y="([\d.]+)"[^>]*class="(threat-label|vigil-threat-label|vigil-entry)"([^>]*)>([^<]*)</g,
      ),
    ].map((label) => ({
      cls: label[3],
      content: label[5],
      box: textBox(
        Number(label[1]),
        Number(label[2]),
        11,
        label[5],
        label[4].includes('text-anchor="end"'),
      ),
    }))
  const over = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

  it('covers no mark the map draws — the base picture’s own track dots included', () => {
    for (const name of [
      'S03-02a-vigil-1',
      'S04-02b-vigil-1',
      'S05-03a-raw-1',
      'S05-03a-vigil-1',
      'S06-03b-raw-1',
      'S06-03b-vigil-1',
    ]) {
      const svg = readFileSync(`tools/replay/__fixtures__/frames/${name}.svg`, 'utf8')
      const marks = marksOf(svg)
      // Every frame draws a track dot per in-panel track, so the set is not vacuous.
      expect(marks.filter((mark) => mark.cls === 'track').length).toBeGreaterThan(20)
      for (const label of labelsOf(svg)) {
        const on = marks.filter((mark) => over(label.box, mark))
        expect([name, label.content, on.map((mark) => mark.cls)]).toEqual([name, label.content, []])
      }
    }
  })

  it('steps off a track dot: the 02a Vigil run frozen at +4:30, where below-right holds two', () => {
    // The reviewer's own case (#172 round 1): before the dots entered `occupied` this label sat
    // at 382.4 — its first spot — across the two ADS-B dots at 453.3.
    const base = fixture('S03-02a-vigil-1')
    const record: RunRecord = {
      ...base.record,
      events: [
        { t: 250, type: 'select', track: THREAT_ID },
        { t: 270, type: 'escalate', track: THREAT_ID },
      ],
    }
    const input = { ...base, record, metrics: runMetrics(record, study.index, base.plan) }
    expect(input.metrics.freezeT).toBe(270)
    const svg = frameSvg(input)
    const [label] = labelsOf(svg)
    expect([label.cls, label.content]).toEqual(['vigil-entry', 'inside the ring'])
    expect(label.box.x).toBeLessThan(382.4)
    for (const mark of marksOf(svg)) expect(over(label.box, mark)).toBe(false)
  })
})

describe('the whole run on the frame (S5f, #173, ruled R1, R2)', () => {
  const on03 = (events: RunEvent[], mode: 'raw' | 'vigil' = 'raw') =>
    synthetic(events, { scenario: '03a', mode, subject: 'S05' })
  /** A real aircraft the recording holds at +0:50 and no longer holds at +3:20. */
  const gone = 'adsb-a0cb44'
  const threats: RunEvent[] = [
    { t: 41, type: 'select', track: 'inject-57' },
    { t: 58, type: 'escalate', track: 'inject-57' },
    { t: 84, type: 'select', track: 'inject-31' },
    { t: 97, type: 'escalate', track: 'inject-31' },
  ]

  it('draws the path in two pieces and a look after the freeze as a dashed outline the panel fills (R1)', () => {
    const input = fixture('S05-03a-raw-1')
    const svg = frameSvg(input)
    // Five looks up to the freeze at 1:37 keep their solid markers; the sixth, at 2:10, is the
    // one the frame drew nowhere before S5f.
    expect(tagsOf(svg, 'hop').map((hop) => hop['data-t'])).toEqual(['12', '27', '41', '66', '84'])
    const [late] = tagsOf(svg, 'hop-late')
    expect(late).toMatchObject({
      'data-k': '6',
      'data-t': '130',
      'data-id': 'inject-65',
      r: '9',
      fill: '#121821',
      stroke: '#4c9aff',
      'stroke-dasharray': '3 2',
    })
    // R1: the outline takes the panel's own fill, so its numeral reads over the panel and never
    // over the ring, a trail or a dot — and the marker is drawn after the ring, so it covers it.
    expect(svg.indexOf('class="ring"')).toBeLessThan(svg.indexOf('class="hop-late"'))
    expect(svg).toContain(
      `<text x="${late.cx}" y="${Number(late.cy) + 4}" font-family="system-ui, sans-serif" font-size="11" font-weight="700" text-anchor="middle" fill="#4c9aff">6</text>`,
    )
    // The path up to the freeze, then the later piece — which starts at the last on-time hop, so
    // the segment that leaves the frozen second is the dashed one.
    const solid = tagsOf(svg, 'path')[0].points.split(' ')
    const dashed = tagsOf(svg, 'path-late')[0]
    expect(solid).toHaveLength(5)
    expect(dashed.points).toBe(`${solid[4]} ${late.cx},${late.cy}`)
    expect(dashed['stroke-dasharray']).toBe('4 4')
  })

  it('gives both counts in the subtitle, and keeps the old wording when nothing follows the freeze', () => {
    expect(textsOf(frameSvg(fixture('S05-03a-raw-1')), 'subtitle')).toEqual([
      "The subject's selection sequence from the run JSON, replayed as a path. 6 looks over the whole run, 5 to the freeze.",
    ])
    // S06's 03b run misses a threat, so its freeze is the window end and every look is on it.
    expect(textsOf(frameSvg(fixture('S06-03b-raw-1')), 'subtitle')).toEqual([
      "The subject's selection sequence from the run JSON, replayed as a path. 4 looks.",
    ])
  })

  it('carries the key’s two lines only on a frame that has a look after the freeze', () => {
    expect(textsOf(frameSvg(fixture('S05-03a-raw-1')), 'footnote')).toEqual([
      ...FOOTNOTE_LINES,
      ...LATE_FOOTNOTE_LINES,
    ])
    expect(textsOf(frameSvg(fixture('S06-03b-raw-1')), 'footnote')).toEqual([...FOOTNOTE_LINES])
    // The key's own words, and the Queue box standing below them on a Vigil frame.
    expect(LATE_FOOTNOTE_LINES[0]).toContain(
      'and one the regenerated picture no longer holds is not drawn at all',
    )
  })

  it('skips a look after the freeze the picture cannot place, and still throws for one up to it (R2)', () => {
    // The same look, on the same track, at the same second: only the freeze differs. The picture
    // the frame is of no longer holds this arrival at +3:20.
    const look: RunEvent = { t: 200, type: 'select', track: gone }
    const after = on03([...threats, look])
    expect(after.metrics.freezeT).toBe(97)
    const svg = frameSvg(after)
    expect(tagsOf(svg, 'hop-late')).toHaveLength(0)
    expect(tagsOf(svg, 'hop').map((hop) => hop['data-id'])).toEqual(['inject-57', 'inject-31'])
    // The count is the run's own, not the drawn marks': three looks, two of them on the frame.
    expect(textsOf(svg, 'subtitle')[0]).toContain('3 looks over the whole run, 2 to the freeze')
    // The same look before a later freeze stops the tool, as it always has.
    const before = on03([
      { t: 150, type: 'select', track: 'inject-57' },
      look,
      { t: 205, type: 'escalate', track: 'inject-31' },
      { t: 210, type: 'escalate', track: 'inject-57' },
    ])
    expect(before.metrics.freezeT).toBe(210)
    expect(() => frameSvg(before)).toThrow(/at t 200 names adsb-a0cb44, not in the picture then/)
  })

  it('writes a line for every escalation besides the threats, with what the track turned out to be', () => {
    // A real aircraft, the one shape no committed run holds: escalating a cooperative aircraft is
    // an error whatever its path (#36 [40] B), and the line says what it was, not what it counted.
    // In t order, as the loader requires: the threat's look is #1 and the aircraft's #2.
    const real = on03(
      (
        [
          ...threats,
          { t: 50, type: 'select', track: gone },
          { t: 60, type: 'escalate', track: gone },
        ] as RunEvent[]
      ).sort((a, b) => a.t - b.t),
    )
    expect(captionTexts(real)).toContain(
      'Look #2 · 1:00 — escalated POD2 · a real aircraft — cooperative traffic, never a threat.',
    )
    // M6: the log names it POD2 · ADS-B when the run opened it, and R3 gives the escalation the
    // box's weight though the track is no threat.
    expect(captionTexts(real)).toContain('Look #2 · 0:50 — opened POD2 · ADS-B.')
    expect(captionLines(real).find((line) => line.text.includes('escalated POD2'))?.bold).toBe(true)
    expect(captionLines(real).find((line) => line.text.includes('opened POD2'))?.bold).toBe(false)
    expect(real.metrics.falseEscalations).toBe(1)
    // An escalation worked off the Queue with no look of its own names no look.
    const unopened = synthetic(
      [
        { t: 33, type: 'escalate', track: 'inject-33' },
        { t: 95, type: 'select', track: 'inject-29' },
        { t: 118, type: 'escalate', track: 'inject-29' },
        { t: 140, type: 'escalate', track: 'inject-21' },
      ],
      { scenario: '03b', subject: 'S06' },
    )
    expect(captionTexts(unopened)).toEqual([
      'Unopened · 0:33 — escalated TRK-33 · enters the ring at 6:32, after the window closed.',
      'Look #1 · 1:35 — opened TRK-29 (threat 1) · sensor, 6.3 km at T0.',
      'Look #1 · 1:58 — escalated TRK-29 (threat 1) 0.2 km inside the ring · 0:16 after entry, ring entry 1:42.',
      'Unopened · 2:20 — escalated TRK-21 · never enters the ring.',
      'MISSED TRK-23 (threat 2) — never escalated; ring entry 3:08.',
    ])
  })
})

describe('text to a fixed width — round 1 on #174', () => {
  it('fills a line with whole chunks and never estimates one past the width', () => {
    // The caller decides what may not be broken; the sheet's chunks are one named escalation
    // each, so a line ends between two of them rather than inside a parenthesis.
    const chunks = [
      'Besides the threats, S06 escalated',
      'TRK-33 at 0:33 (enters the ring at 6:32, after the window closed),',
      'TRK-21 at 1:10 (never enters the ring).',
    ]
    const lines = wrapText(chunks, 13, 500)
    expect(lines.join(' ')).toBe(chunks.join(' '))
    expect(lines).toEqual(chunks)
    for (const line of lines) expect(estimateWidth(line, 13)).toBeLessThanOrEqual(500)
    // A width that fits them all leaves one line; a chunk too wide for any line stands alone
    // rather than being broken, since breaking inside one is the thing the chunks prevent.
    expect(wrapText(chunks, 13, 4000)).toEqual([chunks.join(' ')])
    expect(wrapText([chunks[1]], 13, 1)).toEqual([chunks[1]])
    expect(estimateWidth(chunks[1], 13)).toBeGreaterThan(400)
    expect(estimateWidth('abcd', 10)).toBeCloseTo(21.2, 10)
  })
})

describe('the caption as a decision log (S5g, #175, ruled R1–R3)', () => {
  const on03 = (events: RunEvent[], mode: 'raw' | 'vigil' = 'raw') =>
    synthetic(events, { scenario: '03a', mode, subject: 'S05' })
  /** A real aircraft the recording holds at +0:50 and no longer holds at +3:20. */
  const gone = 'adsb-a0cb44'

  it('rules the log at the freeze, labelled, only where the run wrote after it (R2)', () => {
    // 03a unaided: five looks to its 1:37 freeze and a sixth at 2:10, so the rule falls between.
    const raw = fixture('S05-03a-raw-1')
    const lines = captionLines(raw)
    const at = lines.findIndex((line) => line.rule === true)
    expect(lines[at].text).toBe('frozen at 1:37')
    expect(lines[at - 1].text).toContain('1:37 — escalated')
    expect(lines[at + 1].text).toContain('2:10 — opened')
    expect(lines.filter((line) => line.rule === true)).toHaveLength(1)
    // It draws as a hairline with its label, not as a sentence, and takes a line of the box.
    const svg = frameSvg(raw)
    expect(textsOf(svg, 'caption-rule-label')).toEqual(['frozen at 1:37'])
    const rule = /<line class="caption-rule" x1="([0-9.]+)" y1="([0-9.]+)" x2="([0-9.]+)"/.exec(
      svg,
    )!
    expect(Number(rule[3])).toBe(PANEL.width - 46)
    // It starts clear of its label and runs to the box's inner edge.
    expect(Number(rule[1])).toBeGreaterThan(46 + estimateWidth('frozen at 1:37', 11))
    expect(Number(rule[1])).toBeLessThan(Number(rule[3]))
    expect(textsOf(svg, 'caption')).toHaveLength(lines.length - 1)
    // 03b unaided misses a threat, so its freeze is the window's end: nothing follows, no rule.
    const missed = fixture('S06-03b-raw-1')
    expect(missed.metrics.freezeT).toBe(missed.metrics.runS)
    expect(captionLines(missed).some((line) => line.rule === true)).toBe(false)
    expect(frameSvg(missed)).not.toContain('caption-rule')
  })

  it('gives every escalation the box’s weight and every other non-threat line the mute (R3)', () => {
    // 03b unaided: two escalations of tracks that are no threat, each off its own look.
    const lines = captionLines(fixture('S06-03b-raw-1'))
    const weight = (needle: string) => lines.find((line) => line.text.includes(needle))!.bold
    expect(weight('escalated TRK-33')).toBe(true)
    expect(weight('escalated TRK-21')).toBe(true)
    expect(weight('opened TRK-33')).toBe(false)
    expect(weight('assessed TRK-21')).toBe(false)
    expect(weight('opened TRK-80')).toBe(false)
    // A threat's own lines keep the weight they had, the miss included (item 1).
    expect(weight('opened TRK-29')).toBe(true)
    expect(weight('MISSED TRK-23')).toBe(true)
    // The box draws the weight the line carries, and nothing else does.
    const captions = [
      ...frameSvg(fixture('S06-03b-raw-1')).matchAll(
        /<text[^>]*class="caption"[^>]*>([^<]*)<\/text>/g,
      ),
    ].map((match) => ({ attrs: attrs(match[0]), text: match[1] }))
    for (const caption of captions) {
      const line = lines.find((candidate) => candidate.text === caption.text)!
      expect(caption.attrs['font-weight']).toBe(line.bold ? '600' : undefined)
      expect(caption.attrs.fill).toBe(line.bold ? '#e6edf3' : '#8b98a9')
    }
  })

  it('names a track the log names it on the map, and falls back where the freeze cannot (M1, item 3)', () => {
    // The raw pair's map label reads the name the log gives, so a pair's two maps agree.
    const svg = frameSvg(fixture('S05-03a-raw-1'))
    expect(textsOf(svg, 'threat-label')).toEqual([
      'TRK-31 · ring entry 1:42',
      'TRK-57 · ring entry 3:08',
    ])
    // The ids stay where the tooling reads them — data-id — and leave the words a reader sees.
    expect(textsOf(svg, 'threat-label').join(' ')).not.toContain('inject-')
    expect(captionTexts(fixture('S05-03a-raw-1')).join(' ')).not.toContain('inject-')
    expect(svg).toContain('data-id="inject-31"')
    // A track the picture no longer holds at the freeze takes the ident of its last event: this
    // arrival is in the picture at +0:50 and gone by the +3:30 freeze.
    const late = on03([
      { t: 50, type: 'select', track: gone },
      { t: 150, type: 'select', track: 'inject-57' },
      { t: 205, type: 'escalate', track: 'inject-31' },
      { t: 210, type: 'escalate', track: 'inject-57' },
    ])
    expect(late.metrics.freezeT).toBe(210)
    expect(trackAtSecond(study.index, late.plan, gone, STUDY.beginS + 210, 'raw')).toBeNull()
    expect(captionTexts(late)[0]).toBe('Look #1 · 0:50 — opened POD2 · ADS-B.')
  })

  it('logs a dismissal, which no committed fixture holds (M6)', () => {
    const lines = captionTexts(
      on03([
        { t: 12, type: 'select', track: 'inject-35' },
        { t: 20, type: 'dismiss', track: 'inject-35' },
        { t: 41, type: 'select', track: 'inject-57' },
        { t: 58, type: 'escalate', track: 'inject-57' },
        { t: 84, type: 'select', track: 'inject-31' },
        { t: 97, type: 'escalate', track: 'inject-31' },
      ]),
    )
    expect(lines.slice(0, 2)).toEqual([
      'Look #1 · 0:12 — opened TRK-35 · sensor.',
      'Look #1 · 0:20 — dismissed TRK-35.',
    ])
  })
})

describe('the decision log — round 1 (#176)', () => {
  const on03 = (events: RunEvent[], mode: 'raw' | 'vigil' = 'raw') =>
    synthetic(events, { scenario: '03a', mode, subject: 'S05' })

  it('lays the rule down with the line that follows it, so an acknowledgement alone leaves none', () => {
    const decisions: RunEvent[] = [
      { t: 41, type: 'select', track: 'inject-57' },
      { t: 58, type: 'escalate', track: 'inject-57' },
      { t: 84, type: 'select', track: 'inject-31' },
      { t: 97, type: 'escalate', track: 'inject-31' },
    ]
    // An acknowledgement is a run event the loader accepts and the log writes no line for, so a
    // run whose only work after the freeze is one gets no rule — and no hairline over its foot.
    const acked = on03([...decisions, { t: 150, type: 'alert_ack', track: 'inject-65' }])
    expect(acked.metrics.freezeT).toBe(97)
    expect(captionLines(acked).some((line) => line.rule === true)).toBe(false)
    expect(captionTexts(acked).at(-1)).toContain('1:37 — escalated TRK-31 (threat 1)')
    expect(frameSvg(acked)).not.toContain('caption-rule')
    const ackedVigil = on03(
      [...decisions, { t: 150, type: 'alert_ack', track: 'inject-65' }],
      'vigil',
    )
    expect(captionTexts(ackedVigil).at(-1)).toMatch(/candidates never opened\.$/)
    expect(captionLines(ackedVigil).some((line) => line.rule === true)).toBe(false)
    // A decision after the freeze still lays it down, immediately above that line.
    const worked = on03([...decisions, { t: 150, type: 'select', track: 'inject-65' }])
    const lines = captionLines(worked)
    expect(lines.at(-2)?.rule).toBe(true)
    expect(lines.at(-1)?.text).toContain('2:30 — opened TRK-65')
  })

  it('reads Vigil at the frozen second only, as the frame’s own key says it does', () => {
    // The key under the map says the picture, the Queue box and every reading are the frozen
    // second's, so a look after the freeze carries no reading: one frame, one reading per track.
    const lines = captionTexts(fixture('S03-02a-vigil-1'))
    expect(lines.filter((line) => line.startsWith('Vigil read it'))).toHaveLength(1)
    expect(lines.indexOf('frozen at 0:58')).toBeGreaterThan(
      lines.findIndex((line) => line.startsWith('Vigil read it')),
    )
    expect(lines.at(-2)).toBe('Look #2 · 1:20 — opened TRK-11 (the threat) · sensor.')
    expect(lines.at(-1)).toBe('4 candidates never opened.')
  })

  it('names a missed threat in the header as the log names it', () => {
    const missed = fixture('S06-03b-raw-1')
    expect(headerLine(missed)).toBe('UNAIDED · MISSED TRK-23 — frozen at +3:38')
    // The one word a reader saw that still read an inject id; no frame carries one now.
    for (const name of [
      'S03-02a-raw-1',
      'S03-02a-vigil-1',
      'S04-02b-raw-1',
      'S04-02b-vigil-1',
      'S05-03a-raw-1',
      'S05-03a-vigil-1',
      'S06-03b-raw-1',
      'S06-03b-vigil-1',
    ]) {
      const words = [...frameSvg(fixture(name)).matchAll(/>([^<>]*)</g)].map((match) => match[1])
      expect(
        words.some((word) => word.includes('inject-')),
        name,
      ).toBe(false)
    }
  })
})
