import { describe, expect, it } from 'vitest'
import { THREAT_ID } from '../../scripts/study.ts'
import { AO } from '../../src/config/ao.ts'
import { STUDY } from '../../src/config/study.ts'
import { distanceMeters } from '../../src/lib/geo.ts'
import { injectTracksAt } from '../../src/lib/injects.ts'
import type { RunEvent, RunRecord } from '../../src/lib/run.ts'
import {
  captionLines,
  FOOTNOTE,
  frameName,
  frameSvg,
  headerLine,
  looksOnFrame,
  mmss,
  PANEL,
  project,
} from './frame.ts'
import { loadStudy, planFor, readRun } from './load.ts'
import { runMetrics } from './metrics.ts'
import { pictureAtSecond } from './regenerate.ts'

const study = loadStudy()
const plans = { '02a': planFor('02a', study.timeline), '02b': planFor('02b', study.timeline) }
const fixture = (name: string) => {
  const record = readRun(`tools/replay/__fixtures__/${name}.json`)
  const plan = plans[record.scenario as '02a' | '02b']
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
  const plan = plans[record.scenario as '02a' | '02b']
  return { record, plan, study, metrics: runMetrics(record, study.index, plan) }
}

/** The projection, written out again here so a hop's pixel is checked against the formula, not the code. */
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
    // The Vigil fixture looked twice; the second look, at +80, is after the freeze at +58.
    expect(looksOnFrame(input.record, 58)).toHaveLength(1)
    expect(hops).toHaveLength(1)
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
      expect(textsOf(svg, 'footnote')).toEqual([FOOTNOTE])
      expect((svg.match(/>never opened</g) ?? []).length).toBe(4)
    }
    expect(FOOTNOTE).toBe(
      "\"never opened\" marks the engine's above-calm tracks at the freeze that the run never opened: the analyst's overlay, drawn on both conditions; raw's screen never showed that set.",
    )
  })
})

describe('the frame — the header and the caption box (ruled B3, B4)', () => {
  it('heads a raw run UNAIDED and a Vigil run WITH VIGIL, frozen at the escalation, or MISSED at +6:00', () => {
    const raw = fixture('S03-02a-raw-1')
    expect(headerLine(raw.record, raw.metrics)).toBe(
      'UNAIDED · frozen at the moment of escalation — 0:58',
    )
    const vigil = fixture('S04-02b-vigil-1')
    expect(headerLine(vigil.record, vigil.metrics)).toBe(
      'WITH VIGIL · frozen at the moment of escalation — 0:58',
    )
    const missed = synthetic([{ t: 30, type: 'select', track: 'inject-12' }], { mode: 'vigil' })
    expect(headerLine(missed.record, missed.metrics)).toBe('WITH VIGIL · MISSED — frozen at +6:00')
    const svg = frameSvg(raw)
    expect(textsOf(svg, 'title')).toEqual(['UNAIDED · frozen at the moment of escalation — 0:58'])
    expect(textsOf(svg, 'subtitle')).toEqual([
      "The subject's selection sequence from the run JSON, replayed as a path. 1 look.",
    ])
    expect(mmss(58)).toBe('0:58')
    expect(mmss(124)).toBe('2:04')
  })

  it('writes the caption for the 02a raw fixture exactly, and the same template for a Vigil run', () => {
    expect(captionLines(fixture('S03-02a-raw-1'))).toEqual([
      'Look #1 · 0:14 — opened the threat; assessed at 0:49, escalated at 0:58.',
      'It read as UAS-8F21 · Remote ID.',
      'Look #1 · 0:58 — escalated it 1.2 km outside the ring · 1:06 before entry.',
    ])
    expect(captionLines(fixture('S03-02a-vigil-1'))).toEqual([
      'Look #1 · 0:14 — opened the threat; assessed at 0:49, escalated at 0:58.',
      'It read as TRK-11 · sensor.',
      'Look #1 · 0:58 — escalated it 1.2 km outside the ring · 1:06 before entry.',
    ])
    // 02b: the lie begins at +30, so the look at +14 read the Remote ID in Vigil too.
    expect(captionLines(fixture('S04-02b-vigil-1'))[1]).toBe('It read as UAS-8F21 · Remote ID.')
    expect(captionLines(fixture('S04-02b-vigil-1'))[2]).toBe(
      'Look #1 · 0:58 — escalated it 1.2 km outside the ring · 1:05 before entry.',
    )
    const svg = frameSvg(fixture('S03-02a-raw-1'))
    expect(textsOf(svg, 'caption')).toHaveLength(3)
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
    expect(late).toEqual([
      'Look #1 · 0:20 — opened the threat; assessed at 0:25, dismissed at 0:31.',
      'It read as UAS-8F21 · Remote ID.',
      'Look #3 · 3:20 — opened the threat; escalated at 3:50.',
      'It read as UAS-8F21 · Remote ID.',
      // Inside the ring the threat orbits, so at 3:50 it is 1.7 km in — not the closing line's 1.9.
      'Look #3 · 3:50 — escalated it 1.7 km inside the ring · 1:46 after entry.',
    ])
    const missed = captionLines(
      synthetic([
        { t: 30, type: 'select', track: 'inject-12' },
        { t: 90, type: 'select', track: THREAT_ID },
      ]),
    )
    expect(missed).toEqual([
      'Look #2 · 1:30 — opened the threat.',
      'It read as UAS-8F21 · Remote ID.',
      'MISSED — never escalated; 2 looks.',
    ])
  })
})

describe('the frame — identical in both modes, deterministic (ruled B3, B7)', () => {
  it('renders one record as raw and as Vigil with only the header word and the ident words differing', () => {
    const raw = fixture('S03-02a-raw-1')
    const asVigil = { ...raw, record: { ...raw.record, mode: 'vigil' as const } }
    const a = frameSvg(raw).split('\n')
    const b = frameSvg(asVigil).split('\n')
    expect(a).toHaveLength(b.length)
    const differing = a.map((line, i) => [line, b[i]]).filter(([x, y]) => x !== y)
    // 80 header + 700 panel + 36 footnote + 94 caption (three lines) = 910.
    expect(differing.map(([x]) => x)).toEqual([
      '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="910" viewBox="0 0 900 910" data-subject="S03" data-scenario="02a" data-mode="raw" data-run="1">',
      '<text x="30" y="40" font-family="system-ui, sans-serif" class="title" font-size="20" font-weight="700" fill="#e6edf3">UNAIDED · frozen at the moment of escalation — 0:58</text>',
      '<text x="46" y="870" font-family="system-ui, sans-serif" class="caption" font-size="13" fill="#8b98a9">It read as UAS-8F21 · Remote ID.</text>',
    ])
    expect(differing.map(([, y]) => y)).toEqual([
      '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="910" viewBox="0 0 900 910" data-subject="S03" data-scenario="02a" data-mode="vigil" data-run="1">',
      '<text x="30" y="40" font-family="system-ui, sans-serif" class="title" font-size="20" font-weight="700" fill="#e6edf3">WITH VIGIL · frozen at the moment of escalation — 0:58</text>',
      '<text x="46" y="870" font-family="system-ui, sans-serif" class="caption" font-size="13" fill="#8b98a9">It read as TRK-11 · sensor.</text>',
    ])
  })

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
