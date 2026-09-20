import { describe, expect, it } from 'vitest'
import { bearingDegrees } from '../../src/lib/geo.ts'
import { STUDY } from '../../src/config/study.ts'
import type { RunEvent, RunRecord } from '../../src/lib/run.ts'
import { injectTracksAt } from '../../src/lib/injects.ts'
import {
  CAPTION,
  captionText,
  estimateWidth,
  frameParts,
  mmss,
  outcomeWords,
  trackNamer,
  type FrameInput,
} from './frame.ts'
import { planFor } from './load.ts'
import { loadStudy, readRuns } from './files.ts'
import { otherEscalations, runMetrics } from './metrics.ts'
import { pictureAtSecond, rangeM, SITE, trackAtSecond } from './regenerate.ts'
import {
  headlineSentence,
  tallyLine,
  openingSentence,
  ordinalWord,
  sheetBlocks,
  sheetName,
  sheetSvg,
} from './sheet.ts'
import { orderWords, pairSvg } from './pair.ts'
import { studySvg } from './figure.ts'

const study = loadStudy()
/** The headline's width: the sheet less the prose's x and the right pad. */
const HEADLINE_WIDTH = 1820 - 48 - 30
/**
 * A 15 px system-ui sentence's width per character, measured in Chrome on this sheet (#208
 * round 1): 1 706.2 px over 264 characters and 1 590.0 over 246, both 6.46; the estimate the
 * frame uses over-reads it by a fifth.
 */
const PX_PER_CHAR_15 = 6.47
const fixture = (name: string): FrameInput => {
  const record = readRuns(`tools/replay/__fixtures__/${name}.json`)[0]
  const plan = planFor(record.scenario, study.timeline)
  return { record, plan, study, metrics: runMetrics(record, study.index, plan) }
}
/**
 * The sheet as the CLI draws it: the Queue boxes capped at five rows, as the pair's are (ruled
 * K2) — rendered once per pair and shared across the file's tests. The render is the expensive
 * half — both frames and the engine at the freeze, about a second a sheet here and twice that
 * on the runner — and a test that reads four of them sat at the default timeout on `main`
 * (#209). The output is a string of two committed fixtures, so sharing it changes nothing a
 * test can see.
 */
const sheets = new Map<string, string>()
const sheetOf = (unaided: string, vigil: string): string => {
  const key = `${unaided} ${vigil}`
  const drawn = sheets.get(key)
  if (drawn !== undefined) return drawn
  const svg = sheetSvg({ unaided: fixture(unaided), vigil: fixture(vigil) }, { queueCap: 5 })
  sheets.set(key, svg)
  return svg
}

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
  it('writes a tally line and one sentence per condition on the prioritization sheet, every threat named (R1)', () => {
    const svg = sheetOf('S05-03a-raw-1', 'S06-03b-vigil-1')
    // The sentence keeps the threats and the looks and says the escalations besides the threats
    // as counts in the footnote's two classes (S5h, #207, item 2), where a second sentence named
    // each one (S5f, #173): the row below keeps every ident. A class with none is left unsaid,
    // and the order clause stays last (K3).
    expect(textsOf(svg, 'headline')).toEqual([
      'Unaided on 03a, S05 opened two non-threats first, escalated threat 1 with 0.1 km to spare and threat 2 with 0.8 km, in 5 looks (6 over the whole run), with one early escalation; threat 2 was escalated before threat 1.',
      'With Vigil on 03b, S06 opened a threat first, escalated threat 1 with 0.9 km to spare and threat 2 with 0.6 km, in 3 looks over the whole run; the threats were escalated in entry order.',
    ])
    // Each condition opens with its tally line (S5h, #207, item 1): the same five fields in the
    // same order — the CSV's own numbers, the standoffs in the sentence's own words (R4).
    expect(textsOf(svg, 'headline-tally')).toEqual([
      'threats escalated before the ring 2 of 2 · first threat escalated at 0:58 · 0.1 km to spare, 0.8 km to spare · early escalations 1 · false alarms 0',
      'threats escalated before the ring 2 of 2 · first threat escalated at 0:30 · 0.9 km to spare, 0.6 km to spare · early escalations 0 · false alarms 0',
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
    // The two escalations as one of each class, and no order clause: the order is null while a
    // threat is missed (#153, ruled K3).
    expect(textsOf(svg, 'headline')).toEqual([
      'Unaided on 03b, S06 opened two non-threats first, escalated threat 1 inside the ring and missed threat 2, in 3 looks (4 over the whole run), with one early escalation and one false alarm.',
      'With Vigil on 03a, S05 opened a threat first, escalated threat 1 with 0.8 km to spare and threat 2 with 0.7 km, in 2 looks (3 over the whole run); the threats were escalated in entry order.',
    ])
    // The tally reads the miss as MISSED and the inside escalation in the sentence's words and
    // counts neither as escalated before the ring (round 1); the clock is the first threat
    // escalation, labelled so — the run's first Escalate of any track was 0:33 (R2).
    expect(textsOf(svg, 'headline-tally')[0]).toBe(
      'threats escalated before the ring 0 of 2 · first threat escalated at 1:58 · 0.2 km inside the ring, MISSED · early escalations 1 · false alarms 1',
    )
    expect(textsOf(svg, 'sheet-title')).toEqual([
      'SUBJECT SHEET · S06 · S05 · 03b unaided, 03a with Vigil',
    ])
  })

  it('reads the one-threat sheet in the singular, and a zero as words (K4)', () => {
    const svg = sheetOf('S03-02a-raw-1', 'S04-02b-vigil-1')
    expect(textsOf(svg, 'headline')).toEqual([
      'Unaided on 02a, S03 opened a threat first, escalated the threat with 1.2 km to spare, in 1 look over the whole run.',
      'With Vigil on 02b, S04 opened a threat first, escalated the threat with 1.2 km to spare, in 1 look (2 over the whole run).',
    ])
    // One threat, so no order clause at all (K3), and neither run escalated anything else, so
    // each sentence ends on its looks.
    // The tally on one threat: one of one, one standoff, the zeros in digits.
    expect(textsOf(svg, 'headline-tally')).toEqual([
      'threats escalated before the ring 1 of 1 · first threat escalated at 0:58 · 1.2 km to spare · early escalations 0 · false alarms 0',
      'threats escalated before the ring 1 of 1 · first threat escalated at 0:58 · 1.2 km to spare · early escalations 0 · false alarms 0',
    ])
  })

  it('tallies a run that escalated no threat in the same fields (S5h, #207, item 1)', () => {
    const base = fixture('S05-03a-raw-1')
    const record = {
      ...base.record,
      events: base.record.events.filter((e) => e.type !== 'escalate'),
    }
    const none = { ...base, record, metrics: runMetrics(record, study.index, base.plan) }
    expect(tallyLine(none)).toBe(
      'threats escalated before the ring 0 of 2 · no threat escalated · MISSED, MISSED · early escalations 0 · false alarms 0',
    )
    expect(headlineSentence(none)).toBe(
      'Unaided on 03a, S05 opened two non-threats first, missed threat 1 and threat 2, in 6 looks over the whole run.',
    )
  })

  it('leads with the looks to the last threat escalation and carries the whole run’s count after it (S5g, #194, item 3)', () => {
    const unaided = fixture('S05-03a-raw-1')
    expect(unaided.metrics.looks).toBe(6)
    // The last threat escalation is at 1:37, with five looks up to it; the sixth is at 2:10. The
    // looks to the escalation lead, and the CSV's column follows in parentheses — the frame's
    // subtitle counts the same five to its freeze.
    expect(openingSentence(unaided)).toContain('in 5 looks (6 over the whole run).')
    // A miss holds the frame at the window's end, but the sentence still counts to the last
    // escalation there was: S06's 03b escalated threat 1 at 1:58 after three looks, and looked
    // once more.
    expect(openingSentence(fixture('S06-03b-raw-1'))).toContain(
      'in 3 looks (4 over the whole run).',
    )
    // Nothing looked at after the last escalation: the two counts are one, said once.
    expect(openingSentence(fixture('S06-03b-vigil-1'))).toContain('in 3 looks over the whole run.')
    // No threat escalated at all: the whole-run count stands alone, as it did.
    const base = fixture('S05-03a-raw-1')
    const record = {
      ...base.record,
      events: base.record.events.filter((e) => e.type !== 'escalate'),
    }
    const none = { ...base, record, metrics: runMetrics(record, study.index, base.plan) }
    expect(openingSentence(none)).toBe(
      'Unaided on 03a, S05 opened two non-threats first, missed threat 1 and threat 2, in 6 looks over the whole run.',
    )
  })

  it('writes the order clause both ways, and leaves it out when a threat is missed (K3, #153)', () => {
    const inOrder = fixture('S06-03b-vigil-1')
    const inverted = fixture('S05-03a-raw-1')
    const missed = fixture('S06-03b-raw-1')
    expect(headlineSentence(inOrder)).toContain('; the threats were escalated in entry order.')
    expect(headlineSentence(inverted)).toContain('; threat 2 was escalated before threat 1.')
    expect(headlineSentence(missed)).not.toContain(';')
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
    // The two threat rows, the row S5f adds for what else was escalated (#173), and the logs'
    // row under them (S5g, #194).
    expect(textsOf(svg, 'row-title')).toEqual([
      "threat 1 · each scenario's first entrant",
      "threat 2 · each scenario's second entrant",
      'other escalations',
      'the look logs',
    ])
    expect(textsOf(svg, 'row-subtitle')).toEqual([
      // Each side names its track as its own run's frame does (#177): the screen's name at that
      // run's freeze, never the study's id, which no screen printed.
      'unaided 03a TRK-31 · with Vigil 03b TRK-29',
      'unaided 03a TRK-57 · with Vigil 03b TRK-23',
      'every escalation the run made besides the threats above, and what each track turned out to be',
      // The words are the ruling's (R1 on #194).
      "Every look and action in each run, in time order — unaided left, Vigil right. Under Vigil's log, the list as Vigil showed it at the freeze.",
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
    // A row is a block of its own (S5g, #194), so the ring's centre is 146 into either block;
    // where the blocks stand is the order test's.
    const cy = [146, 146]
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
      const [x, y] = ringPoint(146, bearing, SITE.radiusM)
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
    expect(textsOf(svg02, 'row-title')).toEqual(['the threat', 'the look logs'])
    expect(textsOf(svg02, 'row-subtitle')[0]).toBe(
      // One cast row, two conditions, and the two screens named it differently — which is what
      // F2 protects and what the id hid (#177).
      'unaided 02a UAS-8F21 · with Vigil 02b TRK-11',
    )
  })
})

describe('the subject sheet — the document', () => {
  it('composes the two frames’ pictures unchanged, the unaided one left, with the Queue box capped (K2)', () => {
    const svg = sheetOf('S05-03a-raw-1', 'S06-03b-vigil-1')
    // Each frame's picture — its header, its map, its footnotes — under the headline's 150 (S5h,
    // #207: two lines per condition), the unaided one 856 tall for its key line and the Vigil
    // one 828; the logs stand in their own blocks below the comparison (S5g, #194).
    expect(svg).toContain('<svg class="frame-unaided" x="0" y="150" width="900" height="856"')
    expect(svg).toContain('<svg class="frame-vigil" x="920" y="150" width="900" height="828"')
    // The sheet stands its blocks' sum: 150 and the taller picture, a row per threat, the third
    // row's own 238 for its one escalation, the logs' head, thirteen lines — the longer log's —
    // the Queue box under its 12 px gap, and a foot of 98 for the fourth footnote's line (#173).
    expect(svg).toContain('width="1820" height="2506"')
    expect(150 + 856 + 2 * 320 + 238 + 82 + 13 * 22 + (12 + 144) + 98).toBe(2506)
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
    // One side rendered afresh, past the shared sheet (#209): the pin is that two renders agree,
    // which a cached string compared with itself would not prove (#210 round 1).
    const fresh = sheetSvg(
      { unaided: fixture('S05-03a-raw-1'), vigil: fixture('S06-03b-vigil-1') },
      { queueCap: 5 },
    )
    expect(fresh).toBe(sheetOf('S05-03a-raw-1', 'S06-03b-vigil-1'))
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
    expect(openingSentence(input)).toBe(
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
    expect(textsOf(none, 'row-title')).toEqual(['the threat', 'the look logs'])
    expect(none).not.toContain('other-mark-')
    expect(none).not.toContain('nothing else escalated')
  })

  it('takes its own height — 200 above its words, 18 a line, 20 under them', () => {
    // The row is a block of its own (S5g, #194): its height is the block's, and the sheet's is
    // the blocks' sum — the headline and the taller picture, a row per threat, this row, the
    // logs' head and their lines, the Queue box, and a foot of 98 for the fourth footnote line.
    const height = (svg: string) =>
      [...svg.matchAll(/data-block="other" width="1820" height="(\d+)"/g)].map((m) => Number(m[1]))
    expect(height(two)).toEqual([200 + 2 * 18 + 20])
    expect(height(one)).toEqual([200 + 1 * 18 + 20])
    expect(two).toContain(
      `width="1820" height="${150 + 856 + 2 * 320 + 256 + 82 + 11 * 22 + (12 + 144) + 98}"`,
    )
    expect(one).toContain(
      `width="1820" height="${150 + 856 + 2 * 320 + 238 + 82 + 13 * 22 + (12 + 144) + 98}"`,
    )
    // Every row's rule opens its own block — the two threats', this one's, the logs' and the
    // footnotes' — and the third row's axis runs the same scale as the threats' rows.
    expect(tagsOf(two, 'time-axis')).toHaveLength(3)
    expect([...two.matchAll(/<line x1="30" y1="0" x2="1790"/g)]).toHaveLength(5)
  })
})

describe('the headline on a run that escalated many — S5h (#207), where #174 wrapped the names', () => {
  /**
   * The gate's worst case: S06's 03b Vigil run with both threats escalated by 0:30 as the long
   * session had them, then the subject works down the list — nine later entrants and one
   * never-entrant, a look and an Escalate each. On the committed fixtures' fields; nothing
   * committed. Before S5h the sentence naming them ran to four lines.
   */
  const tenRun = (): FrameInput => {
    const base = fixture('S06-03b-vigil-1')
    const others = [
      'inject-33',
      'inject-95',
      'inject-80',
      'inject-96',
      'inject-89',
      'inject-144',
      'inject-13',
      'inject-73',
      'inject-83',
      'inject-21',
    ]
    const events: RunEvent[] = [
      { t: 3, type: 'select', track: 'inject-21' },
      { t: 7, type: 'select', track: 'inject-79' },
      { t: 11, type: 'select', track: 'inject-29' },
      { t: 16, type: 'escalate', track: 'inject-29' },
      { t: 19, type: 'select', track: 'inject-19' },
      { t: 22, type: 'select', track: 'inject-23' },
      { t: 28, type: 'select', track: 'inject-73' },
      { t: 30, type: 'escalate', track: 'inject-23' },
      ...others.flatMap((track, i): RunEvent[] => [
        { t: 40 + i * 16, type: 'select', track },
        { t: 46 + i * 16, type: 'escalate', track },
      ]),
    ]
    const record: RunRecord = { ...base.record, events }
    return { ...base, record, metrics: runMetrics(record, study.index, base.plan) }
  }
  const ten = tenRun()

  it('says ten escalations besides the threats as two counts on one line, and the headline keeps its height', () => {
    expect([ten.metrics.escalationsOfLaterEntrants, ten.metrics.falseEscalations]).toEqual([9, 1])
    expect(tallyLine(ten)).toBe(
      'threats escalated before the ring 2 of 2 · first threat escalated at 0:16 · 1.1 km to spare, 1.0 km to spare · early escalations 9 · false alarms 1',
    )
    expect(headlineSentence(ten)).toBe(
      'With Vigil on 03b, S06 opened two non-threats first, escalated threat 1 with 1.1 km to spare and threat 2 with 1.0 km, in 6 looks (16 over the whole run), with nine early escalations and one false alarm; the threats were escalated in entry order.',
    )
    const svg = sheetSvg({ unaided: fixture('S05-03a-raw-1'), vigil: ten }, { queueCap: 5 })
    // One line per condition and its tally, no ident in the headline, and the block at 150
    // whatever the run did: the third row below names all ten (S5f).
    expect(textsOf(svg, 'headline')).toHaveLength(2)
    expect(textsOf(svg, 'headline-tally')).toHaveLength(2)
    for (const cls of ['headline-tally', 'headline']) {
      for (const line of textsOf(svg, cls)) expect(line).not.toMatch(/\b(TRK|UAS)-/)
    }
    // The tally fits by the estimate; the sentence by the measured rate below — this one stands
    // 1 590 px of the 1 742 available in Chrome, where the estimate would read it at 1 956 and
    // fail a line that fits.
    for (const line of textsOf(svg, 'headline-tally')) {
      expect(estimateWidth(line, 13)).toBeLessThanOrEqual(HEADLINE_WIDTH)
    }
    for (const line of textsOf(svg, 'headline')) {
      expect(line.length * PX_PER_CHAR_15).toBeLessThanOrEqual(HEADLINE_WIDTH)
    }
    expect(svg).toContain('<svg class="frame-unaided" x="0" y="150"')
    expect(svg).toContain('data-block="headline" width="1820" height="1006"')
    expect(tagsOf(svg, 'other-mark-vigil')).toHaveLength(10)
    // The sheet renders two whole frames; the runner is slower than this machine (#166 round 1).
  }, 30_000)

  /**
   * The longest sentence the code can build (#208 round 1): every branch at its longest on one
   * run — seven distinct non-threats opened and never a threat, both threats escalated inside
   * the ring in entry order, looks after the last escalation so both counts print, seven of
   * each count class (the five-letter count words are the longest; eleven and up print digits).
   * On the S06 03b Vigil fixture's fields, the threats escalated after their entries at 1:42
   * and 3:08; nothing committed.
   */
  const longestRun = (): FrameInput => {
    const base = fixture('S06-03b-vigil-1')
    const opened = [
      'inject-21',
      'inject-79',
      'inject-19',
      'inject-82',
      'inject-98',
      'inject-26',
      'inject-51',
    ]
    const early = [
      'inject-33',
      'inject-95',
      'inject-80',
      'inject-96',
      'inject-89',
      'inject-144',
      'inject-13',
    ]
    const events: RunEvent[] = [
      ...opened.map((track, i): RunEvent => ({ t: 5 + i * 5, type: 'select', track })),
      ...opened.map((track, i): RunEvent => ({ t: 50 + i * 5, type: 'escalate', track })),
      ...early.map((track, i): RunEvent => ({ t: 90 + i * 5, type: 'escalate', track })),
      { t: 195, type: 'escalate', track: 'inject-29' },
      { t: 200, type: 'escalate', track: 'inject-23' },
      ...Array.from({ length: 13 }, (_, i): RunEvent => ({
        t: 204 + i,
        type: 'select',
        track: 'inject-19',
      })),
    ]
    const record: RunRecord = { ...base.record, events }
    return { ...base, record, metrics: runMetrics(record, study.index, base.plan) }
  }

  it('pins the longest sentence the code can build inside the sheet’s width (#208 round 1)', () => {
    const longest = longestRun()
    expect(longest.metrics.threats.map((threat) => threat.standoffM)).toEqual([-1186, -78])
    expect(headlineSentence(longest)).toBe(
      'With Vigil on 03b, S06 opened seven non-threats and never a threat, escalated threat 1 inside the ring and threat 2 inside the ring, in 7 looks (20 over the whole run), with seven early escalations and seven false alarms; the threats were escalated in entry order.',
    )
    // Measured in Chrome: 1 706.2 px over its 264 characters, 36 px inside the budget. A
    // three-digit look count adds two characters, still inside; a subject code longer than the
    // study's three characters by more than five would run past the edge — the codes are S13–S18
    // and S90–S99 (#131), and the loader accepts any, so that limit is stated here, not guarded.
    expect(headlineSentence(longest).length).toBe(264)
    expect((264 + 2) * PX_PER_CHAR_15).toBeLessThanOrEqual(HEADLINE_WIDTH)
    // The tally on this run: neither threat before the ring, both inside by their magnitude.
    expect(tallyLine(longest)).toBe(
      'threats escalated before the ring 0 of 2 · first threat escalated at 3:15 · 1.2 km inside the ring, 0.1 km inside the ring · early escalations 7 · false alarms 7',
    )
    const svg = sheetSvg({ unaided: fixture('S05-03a-raw-1'), vigil: longest }, { queueCap: 5 })
    for (const line of textsOf(svg, 'headline')) {
      expect(line.length * PX_PER_CHAR_15).toBeLessThanOrEqual(HEADLINE_WIDTH)
    }
    for (const line of textsOf(svg, 'headline-tally')) {
      expect(estimateWidth(line, 13)).toBeLessThanOrEqual(HEADLINE_WIDTH)
    }
    expect(svg).toContain('data-block="headline" width="1820" height="1006"')
  }, 30_000)

  it('never lets the tally and the sentence disagree on a threat (#208 round 1)', () => {
    // The miss layout, pinned as the owner asked: threat 1 escalated inside the ring and threat
    // 2 missed count as none before the ring, and the sentence says the same two things.
    const miss = sheetOf('S06-03b-raw-1', 'S05-03a-vigil-1')
    expect(textsOf(miss, 'headline-tally')[0]).toContain('threats escalated before the ring 0 of 2')
    expect(textsOf(miss, 'headline-tally')[0]).toContain('· 0.2 km inside the ring, MISSED ·')
    expect(textsOf(miss, 'headline')[0]).toContain(
      'escalated threat 1 inside the ring and missed threat 2',
    )
    // And on every sheet, threat by threat: a tally value's kind — to spare, inside the ring,
    // MISSED — is the kind the sentence gives that threat, and its figure is in the sentence.
    for (const [unaided, vigil] of [
      ['S05-03a-raw-1', 'S06-03b-vigil-1'],
      ['S06-03b-raw-1', 'S05-03a-vigil-1'],
      ['S03-02a-raw-1', 'S04-02b-vigil-1'],
    ] as const) {
      const svg = sheetOf(unaided, vigil)
      const tallies = textsOf(svg, 'headline-tally')
      const sentences = textsOf(svg, 'headline')
      tallies.forEach((tally, k) => {
        const values = tally.split(' · ')[2].split(', ')
        const before = values.filter((value) => value.endsWith('to spare')).length
        expect(
          tally.startsWith(`threats escalated before the ring ${before} of ${values.length}`),
        ).toBe(true)
        for (const value of values) {
          if (value === 'MISSED') expect(sentences[k]).toContain('missed')
          else if (value.endsWith('inside the ring'))
            expect(sentences[k]).toContain('inside the ring')
          else expect(sentences[k]).toContain(`with ${value.replace(' to spare', '')}`)
        }
      })
    }
  })

  it('stands every sheet’s headline at 150, as S5e drew it: the tally and the sentence, two lines a condition', () => {
    for (const [unaided, vigil] of [
      ['S05-03a-raw-1', 'S06-03b-vigil-1'],
      ['S06-03b-raw-1', 'S05-03a-vigil-1'],
      ['S03-02a-raw-1', 'S04-02b-vigil-1'],
    ] as const) {
      const svg = sheetOf(unaided, vigil)
      expect(textsOf(svg, 'headline')).toHaveLength(2)
      expect(svg).toContain('<svg class="frame-unaided" x="0" y="150"')
      // The two lines at their baselines — the tally where the sentence stood, the sentence
      // where the counts stood — the second condition 52 below the first, so the fixtures'
      // sheet prints on the one page #194 R5 ruled.
      for (const [k, y] of [
        [0, 62],
        [1, 114],
      ] as const) {
        const mode = k === 0 ? 'raw' : 'vigil'
        expect(svg).toContain(
          `<text x="48" y="${y}" font-family="system-ui, sans-serif" class="headline-tally" data-mode="${mode}"`,
        )
        expect(svg).toContain(
          `<text x="48" y="${y + 22}" font-family="system-ui, sans-serif" class="headline" data-mode="${mode}"`,
        )
      }
      expect(svg).not.toContain('headline-counts')
    }
  })
})

describe('one name per track across the document (#177, ruled M1–M4, R1)', () => {
  const inputs = {
    'S05-03a-raw-1': fixture('S05-03a-raw-1'),
    'S06-03b-vigil-1': fixture('S06-03b-vigil-1'),
    'S06-03b-raw-1': fixture('S06-03b-raw-1'),
    'S05-03a-vigil-1': fixture('S05-03a-vigil-1'),
    'S03-02a-raw-1': fixture('S03-02a-raw-1'),
    'S04-02b-vigil-1': fixture('S04-02b-vigil-1'),
  }

  it('gives the sheet the frame’s rule wherever it prints an ident (M2)', () => {
    // The rule, not a difference: on the committed cast the freeze and an escalation's own second
    // give the same ident everywhere, so this pins what the sheet resolves rather than a change
    // it shows. It fails on the row subtitle before this PR, which named the study's ids.
    for (const [u, v] of [
      ['S05-03a-raw-1', 'S06-03b-vigil-1'],
      ['S06-03b-raw-1', 'S05-03a-vigil-1'],
      ['S03-02a-raw-1', 'S04-02b-vigil-1'],
    ] as const) {
      const unaided = inputs[u]
      const vigil = inputs[v]
      const svg = sheetSvg({ unaided, vigil }, { queueCap: 5 })
      const names = { unaided: trackNamer(unaided), vigil: trackNamer(vigil) }
      // The row subtitle: each side its own run's name, in the row's own order. The third row's
      // subtitle is not a threat's, so only the first rows are read.
      textsOf(svg, 'row-subtitle')
        .slice(0, unaided.metrics.threats.length)
        .forEach((line, i) => {
          expect(line).toBe(
            `unaided ${unaided.metrics.scenario} ${names.unaided.ident(unaided.metrics.threats[i].id)} · with Vigil ${vigil.metrics.scenario} ${names.vigil.ident(vigil.metrics.threats[i].id)}`,
          )
        })
      // The third row's words, where it has any: the same rule, that lane's run.
      for (const side of ['unaided', 'vigil'] as const) {
        const input = side === 'unaided' ? unaided : vigil
        for (const other of otherEscalations(input.record, input.study.index, input.plan)) {
          const ident = names[side].ident(other.id)
          expect(textsOf(svg, `other-legend-${side}`)).toContain(
            `${side === 'unaided' ? 'unaided' : 'Vigil'} · ${ident} escalated ${mmss(other.t)} — ${outcomeWords(other)}`,
          )
          // The headline no longer names it (S5h, #207): the row is the one place it is listed.
          expect(headlineSentence(input)).not.toContain(ident)
        }
      }
      // And no word a reader sees carries a study id, on the sheet as on its frames.
      const words = [...svg.matchAll(/>([^<>]*)</g)].map((match) => match[1])
      expect(words.some((word) => /\b(inject|adsb)-/.test(word))).toBe(false)
    }
  })

  it('shows the two conditions’ own names where their screens differed (M1)', () => {
    // The 02 cast is the one that flips: 02a's unaided screen read the Remote ID name at its
    // freeze and 02b's Vigil screen the sensor track, for one cast row.
    const svg = sheetSvg(
      { unaided: inputs['S03-02a-raw-1'], vigil: inputs['S04-02b-vigil-1'] },
      { queueCap: 5 },
    )
    expect(textsOf(svg, 'row-subtitle')[0]).toBe('unaided 02a UAS-8F21 · with Vigil 02b TRK-11')
    // Each side is the name its own frame carries, so the subtitle agrees with the frame above it.
    expect(trackNamer(inputs['S03-02a-raw-1']).ident('inject-11')).toBe('UAS-8F21')
    expect(trackNamer(inputs['S04-02b-vigil-1']).ident('inject-11')).toBe('TRK-11')
  })

  it('records which artifacts carry an ident at all (R1’s sweep)', () => {
    const words = (svg: string) => [...svg.matchAll(/>([^<>]*)</g)].map((match) => match[1])
    const ident = /\b(TRK-\d+|UAS-[0-9A-F]+)\b/
    // The pair prints one: its row title, and the order clause when the threats were inverted or
    // one was missed. Both take the namer now.
    const pair = pairSvg(
      { left: inputs['S05-03a-raw-1'], right: inputs['S05-03a-vigil-1'] },
      { queueCap: 5 },
    )
    expect(textsOf(pair, 'row-title')).toEqual(['threat 1 · TRK-31', 'threat 2 · TRK-57'])
    expect(orderWords(inputs['S05-03a-raw-1'])).toBe('✗ (TRK-57 before TRK-31)')
    expect(words(pair).some((word) => /\b(inject|adsb)-/.test(word))).toBe(false)
    // The study figure prints no track's name at all: subject codes, scenarios and counts only.
    const figure = studySvg(Object.values(inputs).map((input) => input.metrics))
    expect(words(figure).some((word) => ident.test(word))).toBe(false)
    expect(words(figure).some((word) => /\b(inject|adsb)-/.test(word))).toBe(false)
    expect(words(figure)).toContain('S05')
  })
})

describe('the sheet in blocks (S5g, #194)', () => {
  const unaided = fixture('S05-03a-raw-1')
  const vigil = fixture('S06-03b-vigil-1')
  const input = { unaided, vigil }
  const blocks = sheetBlocks(input, { queueCap: 5 })
  const svg = sheetSvg(input, { queueCap: 5 })
  const named = (block: string) => /data-block="([^"]+)" width="1820" height="(\d+)"/.exec(block)!
  const names = blocks.map((block) => named(block)[1])
  const heights = blocks.map((block) => Number(named(block)[2]))

  it('lays the sheet out in the order a reader meets it, a block each (item 1)', () => {
    // The headline with the two pictures; a threat a row; the other escalations; the logs' head;
    // one block per line of the longer log — thirteen, the unaided run's; the Queue box; the
    // footnotes. Nothing removed: every class the one-SVG sheet drew is still drawn.
    expect(names).toEqual([
      'headline',
      'threat-1',
      'threat-2',
      'other',
      'logs',
      ...Array.from({ length: 13 }, (_, i) => `log-${i + 1}`),
      'queue',
      'footnotes',
    ])
    expect(heights).toEqual([1006, 320, 320, 238, 82, ...Array(13).fill(22), 156, 98])
    // The 02 sheet has no third row and no ordinal, and its longer log is the Vigil run's eight.
    const none = sheetBlocks(
      { unaided: fixture('S03-02a-raw-1'), vigil: fixture('S04-02b-vigil-1') },
      { queueCap: 5 },
    ).map((block) => named(block)[1])
    expect(none).toEqual([
      'headline',
      'threat-1',
      'logs',
      ...Array.from({ length: 7 }, (_, i) => `log-${i + 1}`),
      'queue',
      'footnotes',
    ])
    for (const cls of [
      'sheet-title',
      'headline',
      'headline-tally',
      'frame-unaided',
      'frame-vigil',
      'row-title',
      'lane-unaided-escalate',
      'ring-mark-vigil',
      'ring-legend-unaided',
      'other-mark-unaided',
      'other-legend-unaided',
      'caption',
      'caption-rule',
      'vigil-queue',
      'vigil-queue-more',
      'sheet-footnote',
    ]) {
      expect(svg).toContain(`class="${cls}"`)
    }
  })

  it('keeps every block one set of bytes between the browser’s blocks and the CLI’s file (item 2)', () => {
    // The file is the blocks stacked: each block's `<svg>` verbatim inside a `<g>` at the running
    // y, and the file's height their sum — the wrapper is the only line the file adds, so what
    // the browser mounts and what the CLI writes are the same bytes block for block.
    let y = 0
    for (const block of blocks) {
      expect(svg).toContain(`<g transform="translate(0 ${y})">\n${block}\n</g>`)
      y += Number(named(block)[2])
    }
    expect(svg).toContain(`width="1820" height="${y}" viewBox="0 0 1820 ${y}"`)
    expect(y).toBe(2506)
    expect(svg.split('<g transform="translate(0 ')).toHaveLength(blocks.length + 1)
    // Each block is a document of its own: a viewBox, its ground, its name; the blocks are the
    // file's only content besides its wrapper.
    for (const block of blocks) {
      expect(block.startsWith('<svg class="block" data-block=')).toBe(true)
      expect(block.endsWith('</svg>')).toBe(true)
    }
    // The same bytes twice (K10).
    expect(sheetBlocks(input, { queueCap: 5 })).toEqual(blocks)
  })

  it('draws each frame’s picture unchanged and its log line for line through the frame’s own lines', () => {
    // The picture: the frame's own top — header, map, footnotes — nested as it was, and the
    // eight expected frames hold byte for byte (the K2 pin above). The log: the frame's caption
    // lines, each drawn by the line function the frame's own caption box uses, at the pitch and
    // baseline the box gives it, the Vigil column moved by the frame's width and the gap.
    const l = frameParts(unaided, { queueCap: 5, clipId: 'sheet-unaided' })
    const r = frameParts(vigil, { queueCap: 5, clipId: 'sheet-vigil' })
    expect(svg).toContain(
      `<svg class="frame-unaided" x="0" y="150" width="900" height="${l.top.height}" viewBox="0 0 900 ${l.top.height}">\n${l.top.lines.join('\n')}\n</svg>`,
    )
    expect(svg).toContain(
      `<svg class="frame-vigil" x="920" y="150" width="900" height="${r.top.height}" viewBox="0 0 900 ${r.top.height}">\n${r.top.lines.join('\n')}\n</svg>`,
    )
    expect([l.lines.length, r.lines.length]).toEqual([13, 11])
    l.lines.forEach((line, i) => {
      const block = blocks[names.indexOf(`log-${i + 1}`)]
      expect(block).toContain(captionText(line, CAPTION.line - 6).join('\n'))
    })
    r.lines.forEach((line, i) => {
      const block = blocks[names.indexOf(`log-${i + 1}`)]
      expect(block).toContain(
        `<g transform="translate(920 0)">\n<rect x="30" y="0" width="840" height="${22 + 8}" fill="#121821"/>\n${captionText(line, CAPTION.line - 6).join('\n')}\n</g>`,
      )
    })
    // The Queue box is the frame's, capped, from 12 into its block, under the Vigil column.
    expect(blocks[names.indexOf('queue')]).toContain(
      `<g transform="translate(920 0)">\n${r.queue(12).lines.join('\n')}\n</g>`,
    )
    expect(r.queue(12).height).toBe(144)
  })

  it('closes each log’s panel a column at a time: its top in the logs’ block, a slice under every line, its bottom under the last', () => {
    const slice = (h: number, y = 0) =>
      `<rect x="30" y="${y}" width="840" height="${h + 8}" fill="#121821"/>`
    const head = blocks[names.indexOf('logs')]
    // Both panels open in the head block, 16 above the first line, at y 66 — under the row's
    // title and subtitle.
    expect(head.split(slice(CAPTION.top, 66))).toHaveLength(3)
    // The Vigil log is eleven lines: its twelfth block carries its bottom, and the thirteenth
    // nothing of it; the unaided log runs to the last line, so its bottom is the queue block's
    // first 12, under the box's gap.
    expect(blocks[names.indexOf('log-11')]).toContain(
      `<g transform="translate(920 0)">\n${slice(22)}`,
    )
    expect(blocks[names.indexOf('log-12')]).toContain(
      `<g transform="translate(920 0)">\n${slice(CAPTION.bottom)}\n</g>`,
    )
    expect(blocks[names.indexOf('log-13')]).not.toContain('translate(920 0)')
    const queue = blocks[names.indexOf('queue')]
    expect(queue.startsWith(`<svg class="block" data-block="queue"`)).toBe(true)
    expect(queue.split('\n')[2]).toBe(slice(CAPTION.bottom))
    expect(queue).not.toContain(`<g transform="translate(920 0)">\n${slice(CAPTION.bottom)}`)
    // Nothing of a panel where a column has no line: the unaided panel is whole on the 03 sheet,
    // the count of slices its lines, its top and its bottom.
    expect(svg.split('<rect x="30" y="0" width="840"')).toHaveLength(13 + 11 + 2 + 1)
  })

  it('runs each block’s ground eight units under the block below, so a print at a fractional scale shows no hairline', () => {
    // A page lays the blocks out at a fractional scale, and two rects that merely meet leave a
    // hairline of the paper between their antialiased edges — measured at the gate on a 1.5×
    // raster of the PDF: a light line at every join with no overrun, none at eight units. The
    // block below paints over the overrun.
    blocks.forEach((block, i) => {
      expect(block.split('\n')[0]).toBe(
        `<svg class="block" data-block="${names[i]}" width="1820" height="${heights[i]}" viewBox="0 0 1820 ${heights[i]}" overflow="visible">`,
      )
      expect(block.split('\n')[1]).toBe(
        `<rect width="1820" height="${heights[i] + 8}" fill="#0b0f14"/>`,
      )
    })
  })

  it('carries a long session — 43 looks — as one block a line, the headline reading the looks to the last escalation first', () => {
    // The session the rehearsal printed (#194): both threats escalated by 0:30 in six looks and
    // thirty-seven more after, on the committed fixtures' fields. Every look names a track the
    // picture holds at its second.
    const base = fixture('S06-03b-vigil-1')
    const present = (t: number) =>
      [...pictureAtSecond(study.index, base.plan, STUDY.beginS + t, 'vigil')]
        .map((track) => track.id)
        .filter((id) => id.startsWith('inject-') && id !== 'inject-29' && id !== 'inject-23')
        .sort()
    const events: RunEvent[] = [
      { t: 3, type: 'select', track: 'inject-21' },
      { t: 7, type: 'select', track: 'inject-79' },
      { t: 11, type: 'select', track: 'inject-29' },
      { t: 16, type: 'escalate', track: 'inject-29' },
      { t: 19, type: 'select', track: 'inject-19' },
      { t: 22, type: 'select', track: 'inject-23' },
      { t: 28, type: 'select', track: 'inject-73' },
      { t: 30, type: 'escalate', track: 'inject-23' },
      ...Array.from({ length: 37 }, (_, i): RunEvent => ({
        t: 34 + i * 5,
        type: 'select',
        track: present(34 + i * 5)[(i * 7) % present(34 + i * 5).length],
      })),
    ]
    const record: RunRecord = { ...base.record, events }
    const long = { ...base, record, metrics: runMetrics(record, study.index, base.plan) }
    expect(long.metrics.looks).toBe(43)
    expect(openingSentence(long)).toContain('in 6 looks (43 over the whole run).')
    const longBlocks = sheetBlocks({ unaided, vigil: long }, { queueCap: 5 })
    const lines = frameParts(long).lines.length
    expect(lines).toBeGreaterThan(43)
    expect(longBlocks.filter((block) => named(block)[1].startsWith('log-'))).toHaveLength(lines)
    // No block holds two lines of one log: a page can break between any two.
    for (const block of longBlocks.filter((block) => named(block)[1].startsWith('log-'))) {
      expect(block.split('class="caption"').length - 1).toBeLessThanOrEqual(2)
      expect(Number(named(block)[2])).toBe(22)
    }
  })
})
