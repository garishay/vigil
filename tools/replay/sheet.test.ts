import { describe, expect, it } from 'vitest'
import { bearingDegrees } from '../../src/lib/geo.ts'
import { STUDY } from '../../src/config/study.ts'
import type { RunEvent, RunRecord } from '../../src/lib/run.ts'
import { injectTracksAt } from '../../src/lib/injects.ts'
import { estimateWidth, type FrameInput } from './frame.ts'
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
    // The second sentence names every escalation the run made besides the threats, with what
    // each turned out to be, where it counted classes before (S5f, #173, ruled N4 A).
    expect(textsOf(svg, 'headline-counts')).toEqual([
      'Besides the threats, S05 escalated TRK-65 at 2:30 (enters the ring at 6:59, after the window closed); threat 2 was escalated before threat 1.',
      'Nothing else was escalated; the threats were escalated in entry order.',
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
    // The two escalations named in the record's order, and no order clause: the order is null
    // while a threat is missed (#153, ruled K3).
    expect(textsOf(svg, 'headline-counts')[0]).toBe(
      'Besides the threats, S06 escalated TRK-33 at 0:33 (enters the ring at 6:32, after the window closed) and TRK-21 at 1:10 (never enters the ring).',
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
    // One threat, so no order clause at all (K3); neither run escalated anything else.
    expect(textsOf(svg, 'headline-counts')).toEqual([
      'Nothing else was escalated.',
      'Nothing else was escalated.',
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
    expect(countsSentence(inOrder)).toContain('; the threats were escalated in entry order.')
    expect(countsSentence(inverted)).toContain('; threat 2 was escalated before threat 1.')
    expect(countsSentence(missed)).not.toContain(';')
  })
})

describe('the subject sheet — the rows', () => {
  const svg = sheetOf('S05-03a-raw-1', 'S06-03b-vigil-1')
  const unaided = fixture('S05-03a-raw-1')
  const vigil = fixture('S06-03b-vigil-1')
  /** The axis runs the longer window; since S7d both 03 windows are 218 s. */
  const runS = 218

  it('titles each row by its role and names the two tracks it compares', () => {
    // The two threat rows, and beneath them the row S5f adds for what else was escalated (#173).
    expect(textsOf(svg, 'row-title')).toEqual([
      "threat 1 · each scenario's first entrant",
      "threat 2 · each scenario's second entrant",
      'other escalations',
    ])
    expect(textsOf(svg, 'row-subtitle')).toEqual([
      'unaided 03a inject-31 · with Vigil 03b inject-29',
      'unaided 03a inject-57 · with Vigil 03b inject-23',
      'every escalation the run made besides the threats above, and what each track turned out to be',
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
      // so the bars land together at the axis's end — one per threat row and one on the third
      // row's lane (S5f, #173).
      expect(
        tagsOf(svg, 'lane-end')
          .filter((bar) => bar['data-lane'] === side)
          .map((bar) => Number(bar.x1)),
      ).toEqual([
        timeX(input.metrics.runS, runS),
        timeX(input.metrics.runS, runS),
        timeX(input.metrics.runS, runS),
      ])
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
    // The rows stand under the taller frame — the Vigil frame's 1 254 px since the log (#175) —
    // and the headline's 150.
    const cy = [150 + 1254 + 146, 150 + 1254 + 320 + 146]
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
      const [x, y] = ringPoint(150 + 1254 + 146, bearing, SITE.radiusM)
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
    expect(notes).toHaveLength(4)
    expect(notes[0]).toContain("threat 1 is each scenario's first entrant")
    expect(notes[0]).toContain('The time axis runs the longer window (3:38)')
    expect(notes[1]).toBe(
      '03a and 03b are one cast turned around the site under different labels, so a row’s two tracks match in range, speed and entry time; only their bearing and label differ.',
    )
    expect(notes[2]).toContain('hollow inside the ring')
    // The classes the CSV counts, under the row that shows the events they count — the pair's and
    // the figure's own sentence (K8 B), which the headline said inline before S5f (#173).
    expect(notes[3]).toBe(
      'A false alarm is a track that never enters the ring, and every real aircraft; an early escalation is a track that would have entered after the run — a dispatch that could have waited rather than a false alarm.',
    )
    // The corroboration pair is not one cast turned, so the sentence is not written there; and
    // neither of its runs escalated anything else, so there is no row and no counts sentence.
    const corroboration = textsOf(sheetOf('S03-02a-raw-1', 'S04-02b-vigil-1'), 'sheet-footnote')
    expect(corroboration).toHaveLength(2)
    expect(corroboration.some((note) => note.includes('turned around the site'))).toBe(false)
    expect(corroboration.some((note) => note.includes('A false alarm is'))).toBe(false)
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
    // The sheet stands 150 for the headline, the taller frame (1 254 since the log, #175), a row
    // row's own 238 for its one escalation, and a foot of 98 — the fourth footnote's line (#173).
    expect(svg).toContain('width="1820" height="2380"')
    expect(150 + 1254 + 2 * 320 + 238 + 98).toBe(2380)
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
      // No fixture reopens a track inside its freeze; the two 02 Vigil runs reopen the threat
      // after it, and since S5f the frame draws the whole run, so those two carry a badge (#173).
      expect(frameSvg(input).includes('class="hop-visits"')).toBe(
        name === 'S03-02a-vigil-1' || name === 'S04-02b-vigil-1',
      )
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
    // The header still counts every look, and the one off the panel among them; since S5f it
    // gives the whole run's count and the freeze's, the eighth look being at +130 (#173).
    expect(textsOf(svg, 'subtitle')[0]).toContain(
      '8 looks over the whole run, 7 to the freeze, 1 beyond the panel.',
    )
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

describe('the sheet’s other escalations (S5f, #173)', () => {
  /** The layout half the pilot's subjects produce, and the one whose unaided run made two. */
  const two = sheetOf('S06-03b-raw-1', 'S05-03a-vigil-1')
  const one = sheetOf('S05-03a-raw-1', 'S06-03b-vigil-1')
  const runS = 218

  it('marks every escalation that is no row above, on the same axis, the track above each mark', () => {
    expect(tagsOf(two, 'other-mark-unaided')).toEqual([
      expect.objectContaining({
        'data-id': 'inject-33',
        'data-t': '33',
        cx: String(timeX(33, runS)),
      }),
      expect.objectContaining({
        'data-id': 'inject-21',
        'data-t': '70',
        cx: String(timeX(70, runS)),
      }),
    ])
    expect(timeX(33, runS)).toBe(356.2)
    expect(timeX(70, runS)).toBe(509)
    // The track as the run read it, above its mark and centred on it.
    expect(two).toContain(`<text x="${timeX(33, runS)}" y="`)
    expect(tagsOf(one, 'other-mark-unaided')).toEqual([
      expect.objectContaining({
        'data-id': 'inject-65',
        'data-t': '150',
        cx: String(timeX(150, runS)),
      }),
    ])
    expect(timeX(150, runS)).toBe(839.3)
  })

  it('says what each turned out to be, and never calls a due-later inbound a non-threat', () => {
    expect(textsOf(two, 'other-legend-unaided')).toEqual([
      'unaided · TRK-33 escalated 0:33 — enters the ring at 6:32, after the window closed',
      'unaided · TRK-21 escalated 1:10 — never enters the ring',
    ])
    expect(textsOf(one, 'other-legend-unaided')).toEqual([
      'unaided · TRK-65 escalated 2:30 — enters the ring at 6:59, after the window closed',
    ])
    // The row names outcomes, never verdicts: a track that enters after the window is not a
    // non-threat, which is what the run could not have known (#173).
    for (const svg of [one, two]) {
      const row = [
        ...textsOf(svg, 'other-legend-unaided'),
        ...textsOf(svg, 'other-legend-vigil'),
        ...textsOf(svg, 'row-title'),
        ...textsOf(svg, 'row-subtitle'),
      ]
      expect(row.some((line) => line.includes('non-threat'))).toBe(false)
      expect(row.some((line) => line.includes('false alarm'))).toBe(false)
    }
  })

  it('says so on a lane that escalated nothing else, and leaves the row out when neither did', () => {
    // The row belongs to the pair, so the quiet condition says it was quiet rather than going blank.
    expect(textsOf(two, 'other-none-vigil')).toEqual(['nothing else escalated'])
    expect(tagsOf(two, 'other-mark-vigil')).toHaveLength(0)
    // Neither 02 run escalated anything besides its threat, so there is no row at all.
    const none = sheetOf('S03-02a-raw-1', 'S04-02b-vigil-1')
    expect(textsOf(none, 'row-title')).toEqual(['the threat'])
    expect(none).not.toContain('other-mark-')
    expect(none).not.toContain('nothing else escalated')
  })

  it('takes its own height — 200 above its words, 18 a line, 20 under them', () => {
    // The sheet stands 150 for the headline, the taller frame, a row per threat, the row's own
    // height, and a foot of 98 for the fourth footnote line.
    expect(two).toContain(
      `width="1820" height="${150 + 1282 + 2 * 320 + (200 + 2 * 18 + 20) + 98}"`,
    )
    expect(one).toContain(
      `width="1820" height="${150 + 1254 + 2 * 320 + (200 + 1 * 18 + 20) + 98}"`,
    )
    // The row's rule sits under the threats' rows, and its axis runs the same scale as theirs.
    const rules = [...two.matchAll(/<line x1="30" y1="([0-9.]+)" x2="1790"/g)].map((m) =>
      Number(m[1]),
    )
    expect(rules).toEqual([150 + 1282, 150 + 1282 + 320, 150 + 1282 + 640, 150 + 1282 + 640 + 256])
  })
})

describe('the headline’s width — round 1 (#174)', () => {
  /** A run that escalated five tracks besides its threats: two baits, three rows due later. */
  const busyRun = (): FrameInput => {
    const base = fixture('S05-03a-raw-1')
    const events: RunEvent[] = [
      { t: 10, type: 'select', track: 'inject-35' },
      { t: 20, type: 'escalate', track: 'inject-35' },
      { t: 30, type: 'select', track: 'inject-36' },
      { t: 40, type: 'escalate', track: 'inject-36' },
      { t: 41, type: 'select', track: 'inject-57' },
      { t: 58, type: 'escalate', track: 'inject-57' },
      { t: 66, type: 'select', track: 'inject-74' },
      { t: 70, type: 'escalate', track: 'inject-74' },
      { t: 72, type: 'select', track: 'inject-25' },
      { t: 74, type: 'escalate', track: 'inject-25' },
      { t: 84, type: 'select', track: 'inject-31' },
      { t: 97, type: 'escalate', track: 'inject-31' },
      { t: 130, type: 'select', track: 'inject-65' },
      { t: 150, type: 'escalate', track: 'inject-65' },
    ]
    const record: RunRecord = { ...base.record, subject: 'SXX', events }
    return { ...base, record, metrics: runMetrics(record, study.index, base.plan) }
  }
  const busy = busyRun()

  it('breaks the counts sentence to the sheet’s width and grows the headline by the lines it takes', () => {
    // Five escalations besides the threats: one line of this sentence measures 1 839 px in a
    // browser on an 1 820 px sheet, so it is broken rather than run off the edge.
    const svg = sheetSvg({ unaided: busy, vigil: fixture('S06-03b-vigil-1') }, { queueCap: 5 })
    const lines = textsOf(svg, 'headline-counts')
    expect(lines).toHaveLength(3)
    expect(lines[0] + ' ' + lines[1]).toBe(countsSentence(busy))
    // The break falls between two named escalations and never inside one: the parentheses are
    // what make the list scannable, so the first line ends on a closed one and the second opens
    // with the last item's *and* (#174 round 1).
    expect(lines[0].endsWith('(never enters the ring)')).toBe(true)
    expect(lines[1].startsWith('and TRK-65 at 2:30 (')).toBe(true)
    for (const line of lines) {
      expect(line.startsWith(' ')).toBe(false)
      expect(estimateWidth(line, 13)).toBeLessThanOrEqual(1820 - 48 - 30)
    }
    // The block grows by that one line, and the frames and everything under them move with it.
    expect(svg).toContain('<svg class="frame-unaided" x="0" y="168"')
    // The sheet renders two whole frames; the runner is slower than this machine (#166 round 1).
  }, 30_000)

  it('leaves a sheet whose sentences fit on one line exactly where S5e put it', () => {
    for (const [unaided, vigil] of [
      ['S05-03a-raw-1', 'S06-03b-vigil-1'],
      ['S06-03b-raw-1', 'S05-03a-vigil-1'],
      ['S03-02a-raw-1', 'S04-02b-vigil-1'],
    ] as const) {
      const svg = sheetOf(unaided, vigil)
      expect(textsOf(svg, 'headline-counts')).toHaveLength(2)
      expect(svg).toContain('<svg class="frame-unaided" x="0" y="150"')
    }
  })
})
