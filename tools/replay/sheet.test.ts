import { describe, expect, it } from 'vitest'
import { bearingDegrees } from '../../src/lib/geo.ts'
import { STUDY } from '../../src/config/study.ts'
import { injectTracksAt } from '../../src/lib/injects.ts'
import type { FrameInput } from './frame.ts'
import { loadStudy, planFor, readRun } from './load.ts'
import { runMetrics } from './metrics.ts'
import { pictureAtSecond, rangeM, SITE, trackAtSecond } from './regenerate.ts'
import { countsSentence, openingSentence, ordinalWord, sheetName, sheetSvg } from './sheet.ts'

const study = loadStudy()
const fixture = (name: string): FrameInput => {
  const record = readRun(`tools/replay/__fixtures__/${name}.json`)
  const plan = planFor(record.scenario, study.timeline)
  return { record, plan, study, metrics: runMetrics(record, study.index, plan) }
}
/** The sheet as the CLI draws it: the Queue boxes capped at five rows, as the pair's are (ruled K2). */
const sheetOf = (unaided: string, vigil: string) =>
  sheetSvg({ unaided: fixture(unaided), vigil: fixture(vigil) }, { queueCap: 5 })

const attrs = (tag: string) =>
  Object.fromEntries(
    [...tag.matchAll(/([a-z0-9-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
  )
const tagsOf = (svg: string, cls: string) =>
  [...svg.matchAll(new RegExp(`<[a-z]+ [^>]*class="${cls}"[^>]*>`, 'g'))].map((match) =>
    attrs(match[0]),
  )
const textsOf = (svg: string, cls: string) =>
  [...svg.matchAll(new RegExp(`<text[^>]*class="${cls}"[^>]*>([^<]*)</text>`, 'g'))].map(
    (match) => match[1],
  )
/** The axes, written out again here so a pixel is checked against the formula, not the code. */
const timeX = (s: number, runS: number) => Math.round((220 + (s / runS) * 900) * 10) / 10
/** The ring panel: 8 km over 120 px from (1480, cy), north up (ruled K6). */
const ringPoint = (cy: number, bearingDeg: number, m: number) => {
  const r = (Math.min(8000, m) * 120) / 8000
  const rad = (bearingDeg * Math.PI) / 180
  const round1 = (v: number) => Math.round(v * 10) / 10
  return [round1(1480 + Math.sin(rad) * r), round1(cy - Math.cos(rad) * r)]
}
/** Where a threat stood when it was escalated — bearing true and range from the ring's centre. */
const atEscalation = (input: FrameInput, i: number) => {
  const threat = input.metrics.threats[i]
  const track = trackAtSecond(
    study.index,
    input.plan,
    threat.id,
    STUDY.beginS + threat.timeToEscalateS!,
    input.record.mode,
  )!
  return { bearing: bearingDegrees(SITE.center, track.position), rangeM: rangeM(track) }
}

describe('the subject sheet (S5e, #164, ruled K1–K10, R1, R4, R5) — the headline', () => {
  it('writes two sentences per condition on the prioritization sheet, every threat named (R1)', () => {
    const svg = sheetOf('S05-03a-raw-1', 'S06-03b-vigil-1')
    expect(textsOf(svg, 'headline')).toEqual([
      'Unaided on 03a, S05 opened two non-threats first, escalated threat 1 with 0.1 km to spare and threat 2 with 0.8 km, in 6 looks over the whole run.',
      'With Vigil on 03b, S06 opened a threat first, escalated threat 1 with 0.9 km to spare and threat 2 with 0.6 km, in 3 looks over the whole run.',
    ])
    expect(textsOf(svg, 'headline-counts')).toEqual([
      'No false alarms, and one early escalation — a track that would have entered after the run, a dispatch that could have waited rather than a false alarm; threat 2 was escalated before threat 1.',
      'No false alarms, and nothing escalated early; the threats were escalated in entry order.',
    ])
    expect(textsOf(svg, 'sheet-title')).toEqual([
      'SUBJECT SHEET · S05 · S06 · 03a unaided, 03b with Vigil',
    ])
  })

  it('reads a miss as a miss and an escalation inside the ring as one, from the run itself (R5)', () => {
    // The layout half the pilot's subjects produce, and the only one of the three whose unaided
    // run escalated a threat late and missed the other: both clauses are pinned on real events,
    // never on a constructed record.
    const svg = sheetOf('S06-03b-raw-1', 'S05-03a-vigil-1')
    expect(textsOf(svg, 'headline')).toEqual([
      'Unaided on 03b, S06 opened two non-threats first, escalated threat 1 inside the ring and missed threat 2, in 4 looks over the whole run.',
      'With Vigil on 03a, S05 opened a threat first, escalated threat 1 with 0.8 km to spare and threat 2 with 0.7 km, in 3 looks over the whole run.',
    ])
    // A false alarm and an early escalation on one run, and no order clause: the order is null
    // while a threat is missed (#153, ruled K3).
    expect(textsOf(svg, 'headline-counts')[0]).toBe(
      'One false alarm, and one early escalation — a track that would have entered after the run, a dispatch that could have waited rather than a false alarm.',
    )
    expect(textsOf(svg, 'sheet-title')).toEqual([
      'SUBJECT SHEET · S06 · S05 · 03b unaided, 03a with Vigil',
    ])
  })

  it('reads the one-threat sheet in the singular, and a zero as words (K4)', () => {
    const svg = sheetOf('S03-02a-raw-1', 'S04-02b-vigil-1')
    expect(textsOf(svg, 'headline')).toEqual([
      'Unaided on 02a, S03 opened a threat first, escalated the threat with 1.2 km to spare, in 1 look over the whole run.',
      'With Vigil on 02b, S04 opened a threat first, escalated the threat with 1.2 km to spare, in 2 looks over the whole run.',
    ])
    // One threat, so no order clause at all (K3); both zeros read as words.
    expect(textsOf(svg, 'headline-counts')).toEqual([
      'No false alarms, and nothing escalated early.',
      'No false alarms, and nothing escalated early.',
    ])
  })

  it('names the span the look count means — the frame beside it counts to its own freeze (K4)', () => {
    const unaided = fixture('S05-03a-raw-1')
    expect(unaided.metrics.looks).toBe(6)
    // The frame freezes at the last escalation, 1:37, and shows the five looks up to it; the
    // sixth is at 2:10. The sentence says which of the two numbers it is.
    expect(openingSentence(unaided.metrics)).toContain('in 6 looks over the whole run.')
  })

  it('writes the order clause both ways, and leaves it out when a threat is missed (K3, #153)', () => {
    const inOrder = fixture('S06-03b-vigil-1')
    const inverted = fixture('S05-03a-raw-1')
    const missed = fixture('S06-03b-raw-1')
    expect(countsSentence(inOrder.metrics, inOrder.record)).toContain(
      '; the threats were escalated in entry order.',
    )
    expect(countsSentence(inverted.metrics, inverted.record)).toContain(
      '; threat 2 was escalated before threat 1.',
    )
    expect(countsSentence(missed.metrics, missed.record)).not.toContain(';')
  })
})

describe('the subject sheet — the rows', () => {
  const svg = sheetOf('S05-03a-raw-1', 'S06-03b-vigil-1')
  const unaided = fixture('S05-03a-raw-1')
  const vigil = fixture('S06-03b-vigil-1')
  /** The axis runs the longer window; since S7d both 03 windows are 218 s. */
  const runS = 218

  it('titles each row by its role and names the two tracks it compares', () => {
    expect(textsOf(svg, 'row-title')).toEqual([
      "threat 1 · each scenario's first entrant",
      "threat 2 · each scenario's second entrant",
    ])
    expect(textsOf(svg, 'row-subtitle')).toEqual([
      'unaided 03a inject-31 · with Vigil 03b inject-29',
      'unaided 03a inject-57 · with Vigil 03b inject-23',
    ])
  })

  it('places each lane’s marks, its own entry tick and its own window end at the pixels the axis gives', () => {
    expect(unaided.metrics.runS).toBe(runS)
    expect(vigil.metrics.runS).toBe(runS)
    for (const [side, input] of [
      ['unaided', unaided],
      ['vigil', vigil],
    ] as const) {
      const opens = tagsOf(svg, `lane-${side}-open`).map((mark) => Number(mark.cx))
      const escalates = tagsOf(svg, `lane-${side}-escalate`).map((mark) => Number(mark.cx))
      expect(opens).toEqual(input.metrics.threats.map((threat) => timeX(threat.firstOpenS!, runS)))
      expect(escalates).toEqual(
        input.metrics.threats.map((threat) => timeX(threat.timeToEscalateS!, runS)),
      )
      // Each lane carries its own end, and since S7d the pair's two windows are the same length,
      // so the two bars land together at the axis's end.
      expect(
        tagsOf(svg, 'lane-end')
          .filter((bar) => bar['data-lane'] === side)
          .map((bar) => Number(bar.x1)),
      ).toEqual([timeX(input.metrics.runS, runS), timeX(input.metrics.runS, runS)])
      expect(
        [
          ...svg.matchAll(new RegExp(`<line class="entry-tick" data-lane="${side}"[^>]*>`, 'g')),
        ].map((match) => Number(attrs(match[0]).x1)),
      ).toEqual(input.metrics.threats.map((threat) => timeX(threat.entryT!, runS)))
    }
    expect(timeX(102, runS)).toBe(641.1)
    expect(timeX(218, runS)).toBe(1120)
  })

  it('plots each escalation on the ring at its true bearing and range, hollow inside it (K6)', () => {
    // The rows stand under the taller frame — the Vigil frame's 1 188 px — and the headline's 150.
    const cy = [150 + 1188 + 146, 150 + 1188 + 320 + 146]
    for (const [side, input] of [
      ['unaided', unaided],
      ['vigil', vigil],
    ] as const) {
      const marks = tagsOf(svg, `ring-mark-${side}`)
      expect(marks).toHaveLength(2)
      marks.forEach((mark, i) => {
        const { bearing, rangeM: r } = atEscalation(input, i)
        expect([Number(mark.cx), Number(mark.cy)]).toEqual(ringPoint(cy[i], bearing, r))
        // Outside the ring is filled, inside is hollow; every escalation here is outside.
        expect(mark.fill).toBe(input.metrics.threats[i].standoffM! >= 0 ? mark.stroke : 'none')
      })
    }
    // The 5 km ring is 75 px of the 120 px panel, and the site sits at its centre. The two
    // nested frames draw their own map ring, so the sheet's are the ones at the panel's x.
    expect(
      tagsOf(svg, 'ring')
        .filter((ring) => ring.cx === '1480')
        .map((ring) => Number(ring.r)),
    ).toEqual([75, 75])
    expect(tagsOf(svg, 'ring-edge').map((edge) => Number(edge.r))).toEqual([120, 120])
  })

  it('marks each scenario’s own entry point on the ring in that condition’s colour', () => {
    for (const [side, input] of [
      ['unaided', unaided],
      ['vigil', vigil],
    ] as const) {
      const ticks = tagsOf(svg, `ring-entry-${side}`)
      expect(ticks.map((tick) => tick['data-id'])).toEqual(
        input.metrics.threats.map((threat) => threat.id),
      )
      // A 1.4 km radial across the ring: 4.3 km to 5.7 km at 15 px per km.
      for (const tick of ticks) {
        const length = Math.hypot(
          Number(tick.x2) - Number(tick.x1),
          Number(tick.y2) - Number(tick.y1),
        )
        expect(length).toBeCloseTo(21, 0)
      }
      // The tick is the plan's, so it reads the same bearing the threat crossed at.
      const threat = input.metrics.threats[0]
      const atEntry = injectTracksAt(input.plan, STUDY.beginS + threat.entryT!).find(
        (track) => track.id === threat.id,
      )!
      const bearing = bearingDegrees(SITE.center, atEntry.position)
      const [x, y] = ringPoint(150 + 1188 + 146, bearing, SITE.radiusM)
      expect(Math.hypot(Number(ticks[0].x1) - x, Number(ticks[0].y1) - y)).toBeLessThan(11)
    }
  })

  it('writes the legend under each ring, the standoff and its distance from the entry', () => {
    expect(textsOf(svg, 'ring-legend-unaided')).toEqual([
      'unaided · +0.1 km · 0:05 before entry',
      'unaided · +0.8 km · 2:10 before entry',
    ])
    expect(textsOf(svg, 'ring-legend-vigil')).toEqual([
      'Vigil · +0.9 km · 1:12 before entry',
      'Vigil · +0.6 km · 1:40 before entry',
    ])
  })

  it('reads a miss as a word on the lane and in the legend, and an escalation after entry as hollow (R5)', () => {
    const late = sheetOf('S06-03b-raw-1', 'S05-03a-vigil-1')
    expect(textsOf(late, 'lane-unaided')).toEqual(['MISSED'])
    expect(textsOf(late, 'ring-legend-unaided')).toEqual([
      'unaided · −0.2 km · 0:16 after entry',
      'unaided · MISSED — never escalated',
    ])
    // Threat 1 was escalated inside the ring, so its mark is hollow; threat 2 has none at all.
    const marks = tagsOf(late, 'ring-mark-unaided')
    expect(marks).toHaveLength(1)
    expect([marks[0]['data-id'], marks[0].fill]).toEqual(['inject-29', 'none'])
  })

  it('carries the role rule and the ring’s reading in its footnotes, the pair’s sentence on 03 only (R4)', () => {
    const notes = textsOf(svg, 'sheet-footnote')
    expect(notes).toHaveLength(3)
    expect(notes[0]).toContain("threat 1 is each scenario's first entrant")
    expect(notes[0]).toContain('The time axis runs the longer window (3:38)')
    expect(notes[1]).toBe(
      '03a and 03b are one cast turned around the site under different labels, so a row’s two tracks match in range, speed and entry time; only their bearing and label differ.',
    )
    expect(notes[2]).toContain('hollow inside the ring')
    // The corroboration pair is not one cast turned, so the sentence is not written there.
    const corroboration = textsOf(sheetOf('S03-02a-raw-1', 'S04-02b-vigil-1'), 'sheet-footnote')
    expect(corroboration).toHaveLength(2)
    expect(corroboration.some((note) => note.includes('turned around the site'))).toBe(false)
  })

  it('reads one row on the corroboration family, titled as the frame names its threat', () => {
    const svg02 = sheetOf('S03-02a-raw-1', 'S04-02b-vigil-1')
    expect(textsOf(svg02, 'row-title')).toEqual(['the threat'])
    expect(textsOf(svg02, 'row-subtitle')).toEqual([
      'unaided 02a inject-11 · with Vigil 02b inject-11',
    ])
  })
})

describe('the subject sheet — the document', () => {
  it('composes the two frames unchanged, the unaided one left, with the Queue box capped (K2)', () => {
    const svg = sheetOf('S05-03a-raw-1', 'S06-03b-vigil-1')
    expect(svg).toContain('<svg class="frame-unaided" x="0" y="150"')
    expect(svg).toContain('<svg class="frame-vigil" x="920" y="150"')
    // The sheet stands 150 for the headline, the taller frame, a row each, and 80 of footnotes.
    expect(svg).toContain('width="1820" height="2058"')
    expect(textsOf(svg, 'vigil-queue-more')).toEqual([
      "… 21 more above calm, on the run's own frame",
    ])
    // The Vigil frame carries the annotations and the unaided one carries none.
    expect(svg).toContain('data-unaided="S05-03a-raw-1"')
    expect(svg).toContain('data-vigil="S06-03b-vigil-1"')
  })

  it('names the file by both scenarios, and by both subjects when they differ', () => {
    const s05 = fixture('S05-03a-raw-1').record
    const s06 = fixture('S06-03b-vigil-1').record
    expect(sheetName(s05, s06)).toBe('sheet-S05-S06-03a-03b.svg')
    expect(sheetName(s05, { ...s06, subject: 'S05' })).toBe('sheet-S05-03a-03b.svg')
    expect(sheetName(fixture('S03-02a-raw-1').record, fixture('S04-02b-vigil-1').record)).toBe(
      'sheet-S03-S04-02a-02b.svg',
    )
  })

  it('refuses in words what it cannot read: unlike families, one scenario, and two of one condition (K9)', () => {
    const raw03a = fixture('S05-03a-raw-1')
    const raw03b = fixture('S06-03b-raw-1')
    const vigil03a = fixture('S05-03a-vigil-1')
    const vigil03b = fixture('S06-03b-vigil-1')
    const raw02a = fixture('S03-02a-raw-1')
    // The family first: two scenarios of unlike families share neither a claim nor a role.
    expect(() => sheetSvg({ unaided: raw02a, vigil: vigil03b })).toThrow(
      "a sheet reads one family — S03's 02a is corroboration and S06's 03b is prioritization",
    )
    expect(() => sheetSvg({ unaided: raw03a, vigil: vigil03a })).toThrow(
      "a sheet reads two scenarios — S05 and S05 both ran 03a; two runs of one scenario are the pair's",
    )
    expect(() => sheetSvg({ unaided: raw03a, vigil: raw03b })).toThrow(
      "a sheet reads one unaided run and one Vigil run — S05's 03a is unaided and S06's 03b is unaided",
    )
    expect(() => sheetSvg({ unaided: vigil03b, vigil: vigil03a })).toThrow(
      "a sheet reads one unaided run and one Vigil run — S06's 03b is Vigil and S05's 03a is Vigil",
    )
  })

  it('draws the same bytes twice (K10 — the pins are the content’s, not a file’s)', () => {
    expect(sheetOf('S05-03a-raw-1', 'S06-03b-vigil-1')).toBe(
      sheetOf('S05-03a-raw-1', 'S06-03b-vigil-1'),
    )
  })
})

describe('the frame’s repeat-open markers (S5e, #164, ruled K5)', () => {
  /** A run of S05's 03a shape with revisits spliced in before the freeze. */
  const revisited = () => {
    const base = fixture('S05-03a-raw-1')
    const events = [
      ...base.record.events,
      { t: 33, type: 'select' as const, track: 'inject-35' },
      { t: 55, type: 'select' as const, track: 'inject-36' },
      { t: 74, type: 'select' as const, track: 'inject-35' },
    ].sort((a, b) => a.t - b.t)
    const record = { ...base.record, events }
    return { ...base, record, metrics: runMetrics(record, study.index, base.plan) }
  }

  it('draws one marker per distinct track, at its first look, with a count badge when the run came back', async () => {
    const { frameSvg } = await import('./frame.ts')
    const input = revisited()
    // Nine selects in the record; eight of them fall inside the freeze at 1:37, over five
    // distinct tracks — the hover three times, the tangential twice, three others once each.
    expect(input.record.events.filter((event) => event.type === 'select')).toHaveLength(9)
    const svg = frameSvg(input)
    const hops = tagsOf(svg, 'hop')
    expect(hops.map((hop) => [hop['data-id'], hop['data-k'], hop['data-visits'] ?? '1'])).toEqual([
      ['inject-35', '1', '3'],
      ['inject-36', '2', '2'],
      ['inject-57', '4', '1'],
      ['inject-74', '6', '1'],
      ['inject-31', '8', '1'],
    ])
    // The badge reads beside the marker's own number, in the marker's colour.
    expect(textsOf(svg, 'hop-visits')).toEqual(['×3', '×2'])
    // The marker sits at the first look's position, and the path still runs through every visit:
    // eight points for the eight looks on the frame, five markers for five distinct tracks.
    const path = svg.match(/<polyline points="([^"]*)" fill="none" class="path"/)
    expect(path![1].split(' ')).toHaveLength(8)
    expect(hops).toHaveLength(5)
  })

  it('leaves a frame with no revisit exactly as it was — the eight expected frames byte for byte', async () => {
    const { frameSvg, frameName } = await import('./frame.ts')
    const { readFileSync } = await import('node:fs')
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
      const input = fixture(name)
      expect(frameSvg(input)).toBe(
        readFileSync(`tools/replay/__fixtures__/frames/${frameName(input.record)}`, 'utf8'),
      )
      // No fixture reopens a track inside its freeze, so no frame carries a badge.
      expect(frameSvg(input)).not.toContain('class="hop-visits"')
    }
  })
})

describe('the repeat-open markers — round 1 (#171)', () => {
  it('marks a track at its first look on the panel, so one looked at off it first keeps a marker', async () => {
    const { frameSvg, project } = await import('./frame.ts')
    const base = fixture('S05-03a-raw-1')
    // An arrival that is outside the 900 × 700 panel at Begin + 10 and inside it at Begin + 90.
    const far = 'adsb-a3a178'
    const events = [
      { t: 10, type: 'select' as const, track: far },
      { t: 90, type: 'select' as const, track: far },
      ...base.record.events,
    ].sort((a, b) => a.t - b.t)
    const record = { ...base.record, events }
    const input = { ...base, record, metrics: runMetrics(record, study.index, base.plan) }
    const svg = frameSvg(input)
    const mark = tagsOf(svg, 'hop').find((hop) => hop['data-id'] === far)!
    // Two visits, so the badge counts two; the marker is the second — the one on the panel.
    expect(mark['data-visits']).toBe('2')
    expect(mark['data-t']).toBe('90')
    const [x, y] = [Number(mark.cx), Number(mark.cy)]
    expect(x >= 0 && x <= 900 && y >= 0 && y <= 700).toBe(true)
    // The header still counts every look, and the one off the panel among them.
    expect(textsOf(svg, 'subtitle')[0]).toContain('7 looks, 1 beyond the panel.')
    // A track looked at only off the panel keeps its own marker where it stands, clipped.
    const onlyFar = { ...base.record, events: [{ t: 10, type: 'select' as const, track: far }] }
    const offSvg = frameSvg({
      ...base,
      record: onlyFar,
      metrics: runMetrics(onlyFar, study.index, base.plan),
    })
    const offMark = tagsOf(offSvg, 'hop').find((hop) => hop['data-id'] === far)!
    expect(offMark['data-t']).toBe('10')
    expect(
      project(
        pictureAtSecond(study.index, base.plan, STUDY.beginS + 10, 'raw').find((t) => t.id === far)!
          .position,
      ),
    ).toEqual([Number(offMark.cx), Number(offMark.cy)])
  })
})

describe('the headline and the lane on a run that opened nothing — round 1 (#171)', () => {
  const noOpens = () => {
    const base = fixture('S05-03a-raw-1')
    // The Queue worked and threat 1 escalated off it, with no select at all.
    const record = {
      ...base.record,
      events: [{ t: 60, type: 'escalate' as const, track: 'inject-31' }],
    }
    return { ...base, record, metrics: runMetrics(record, study.index, base.plan) }
  }

  it('says the subject opened nothing rather than that they opened a threat first', () => {
    const input = noOpens()
    expect(input.metrics.looks).toBe(0)
    expect(input.metrics.openedBeforeFirstThreat).toBe(0)
    expect(openingSentence(input.metrics)).toBe(
      'Unaided on 03a, S05 opened nothing, escalated threat 1 with 0.5 km to spare and missed threat 2, in 0 looks over the whole run.',
    )
  })

  it('draws the escalation on the lane where it happened, not the word alone at the axis’s end', () => {
    const svg = sheetSvg({ unaided: noOpens(), vigil: fixture('S06-03b-vigil-1') }, { queueCap: 5 })
    // The word says it was never opened; the dot says when — 60 s of a 218 s window.
    expect(textsOf(svg, 'lane-unaided')).toEqual(['escalated unopened', 'MISSED'])
    const escalate = tagsOf(svg, 'lane-unaided-escalate')
    expect(escalate.map((mark) => [mark['data-id'], Number(mark.cx)])).toEqual([
      ['inject-31', timeX(60, 218)],
    ])
    // No open mark and no segment, since there was no look to join it to.
    expect(tagsOf(svg, 'lane-unaided-open')).toEqual([])
  })

  it('leaves the role clause out of the footnote on a sheet that never writes “threat 1”', () => {
    const notes = textsOf(sheetOf('S03-02a-raw-1', 'S04-02b-vigil-1'), 'sheet-footnote')
    expect(notes[0]).toBe(
      'The two runs are different scenarios of one family. The time axis runs the longer window (6:00); each lane carries its own entry and its own end.',
    )
    expect(textsOf(sheetOf('S05-03a-raw-1', 'S06-03b-vigil-1'), 'sheet-footnote')[0]).toContain(
      "a threat is named by its role: threat 1 is each scenario's first entrant",
    )
  })
})

describe('the row’s ordinal — round 1 (#171)', () => {
  it('follows the row rather than assuming two, so a third threat is not the second entrant', () => {
    expect([0, 1, 2, 3, 4, 5].map(ordinalWord)).toEqual([
      'first',
      'second',
      'third',
      'fourth',
      'fifth',
      '6th',
    ])
  })
})
