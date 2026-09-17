import { describe, expect, it } from 'vitest'
import {
  countMax,
  familyOf,
  modeWord,
  placeCount,
  placeStandoff,
  placeTime,
  stacksOf,
  studySvg,
} from './figure.ts'
import { loadStudy, planFor, readRun } from './load.ts'
import { runMetrics, type RunMetrics } from './metrics.ts'

const study = loadStudy()
const FIXTURES = [
  'S03-02a-raw-1',
  'S03-02a-vigil-1',
  'S04-02b-raw-1',
  'S04-02b-vigil-1',
  'S05-03a-raw-1',
  'S05-03a-vigil-1',
  'S06-03b-raw-1',
  'S06-03b-vigil-1',
]
const metricsOf = (name: string): RunMetrics => {
  const record = readRun(`tools/replay/__fixtures__/${name}.json`)
  return runMetrics(record, study.index, planFor(record.scenario, study.timeline))
}
const all = FIXTURES.map(metricsOf)
const svg = studySvg(all)

const attrs = (tag: string) =>
  Object.fromEntries(
    [...tag.matchAll(/([a-z0-9-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
  )
const tagsOf = (doc: string, cls: string) =>
  [...doc.matchAll(new RegExp(`<[a-z]+ [^>]*class="${cls}"[^>]*>`, 'g'))].map((match) =>
    attrs(match[0]),
  )
const textsOf = (doc: string, cls: string) =>
  [...doc.matchAll(new RegExp(`<text[^>]*class="${cls}"[^>]*>([^<]*)</text>`, 'g'))].map(
    (match) => match[1],
  )
/** The axes in document order: each line's y. */
const axisYs = (doc: string) => tagsOf(doc, 'axis').map((axis) => Number(axis.y1))
/** The axes' formulas, written out again here so a pixel is checked against them, not the code. */
const standoffX = (m: number) => Math.round((200 + ((m + 3000) / 6000) * 700) * 10) / 10
const timeX = (s: number, runS: number) => Math.round((200 + (s / runS) * 700) * 10) / 10
const countX = (n: number, max: number) => Math.round((200 + (n / max) * 700) * 10) / 10
/** The document's slice from the n-th axis line to the next: that axis's own dots. */
const on = (i: number) => svg.split('<line class="axis"')[i + 1]
/** A dot by class and subject within a slice: its centre. */
const dotOf = (doc: string, cls: string, subject: string) => {
  const tag = tagsOf(doc, cls).find((dot) => dot['data-subject'] === subject)
  return tag ? [Number(tag.cx), Number(tag.cy)] : null
}
/** The label beside a dot, by its centre. */
const labelAt = (doc: string, [x, y]: number[]) =>
  doc.match(
    new RegExp(
      `<text x="${Math.round((x + 9) * 10) / 10}" y="${y + 4}"[^>]*class="label"[^>]*>([^<]*)</text>`,
    ),
  )?.[1] ?? null

describe('the study figure (S5d-ii, #138, ruled A7, N9, G4, H1–H4) — by family, the prioritization pair first', () => {
  it('names the families in the ruled order with their scenarios, the title counting runs and subjects', () => {
    expect(textsOf(svg, 'title')).toEqual(['Study — 8 runs · 4 subjects'])
    expect(textsOf(svg, 'family')).toEqual([
      'Prioritization pair (03a, 03b) — attention',
      'Corroboration pair (02a, 02b) — standoff at decision',
    ])
    expect(textsOf(svg, 'axis-title')).toEqual([
      'non-threats opened before the first threat',
      'first open of threat 1 on the run’s window',
      'first open of threat 2 on the run’s window',
      'standoff at decision · threat 1',
      'standoff at decision · threat 2',
      'standoff at the threat’s escalation',
    ])
    expect(familyOf('02a')).toBe('corroboration')
    expect(familyOf('03b')).toBe('prioritization')
    expect(modeWord('raw')).toBe('unaided')
    expect(modeWord('vigil')).toBe('Vigil')
    expect(svg).not.toMatch(/>raw</)
    expect(svg).not.toContain('raw:')
    expect(textsOf(svg, 'lane-word').filter((word) => word === 'unaided')).toHaveLength(6)
    expect(studySvg(all)).toBe(svg)
  })

  it('stacks a lane’s crowded dots outward from the axis by subject code, the x exact, each labelled beside it (H1, H2)', () => {
    expect(
      stacksOf([
        { m: { subject: 'S04', run: 1 } as RunMetrics, x: 110, hollow: false },
        { m: { subject: 'S03', run: 1 } as RunMetrics, x: 100, hollow: false },
        { m: { subject: 'S05', run: 1 } as RunMetrics, x: 150, hollow: false },
      ]).map((stack) => stack.map(({ m, x }) => `${m.subject}@${x}`)),
    ).toEqual([['S03@100', 'S04@110'], ['S05@150']])
    // The corroboration axis: S03 at +1 174 m and S04 at +1 153 m, 2.5 px apart — one stack a lane,
    // S03 nearest the axis, unaided upward and Vigil downward.
    const y = axisYs(svg)[5]
    expect(dotOf(on(5), 'standoff-raw', 'S03')).toEqual([standoffX(1174), y - 12])
    expect(dotOf(on(5), 'standoff-raw', 'S04')).toEqual([standoffX(1153), y - 26])
    expect(dotOf(on(5), 'standoff-vigil', 'S03')).toEqual([standoffX(1174), y + 12])
    expect(dotOf(on(5), 'standoff-vigil', 'S04')).toEqual([standoffX(1153), y + 26])
    expect(standoffX(1174)).toBe(687)
    expect(standoffX(1153)).toBe(684.5)
    for (const cls of ['standoff-raw', 'standoff-vigil']) {
      for (const subject of ['S03', 'S04']) {
        expect(labelAt(svg, dotOf(svg, cls, subject)!)).toBe(subject)
      }
    }
    // The axis took the room its stack needs: the title 30 + 14 above, the tick labels 42 + 14 below.
    expect(svg).toContain(`y="${y - 44}" font-family="system-ui, sans-serif" class="axis-title"`)
    expect(svg).toContain(`<text x="200" y="${y + 56}"`)
  })

  it('joins a subject’s unaided and Vigil dots on each axis with a thin neutral line under the dots (H1)', () => {
    const connectors = tagsOf(svg, 'connector')
    // Two subjects on each of the six axes.
    expect(connectors).toHaveLength(12)
    expect(
      connectors.every((line) => line.stroke === '#63707f' && line['stroke-width'] === '1'),
    ).toBe(true)
    const y = axisYs(svg)[5]
    const s03 = connectors.filter((line) => line['data-subject'] === 'S03')
    expect(s03).toHaveLength(1)
    expect(s03[0]).toMatchObject({ x1: '687', y1: String(y - 12), x2: '687', y2: String(y + 12) })
    // Drawn under the dots: the connector precedes the first dot of its axis in the document.
    const firstConnector = svg.indexOf('<line class="connector"')
    const firstDot = svg.indexOf('<circle class="count-')
    expect(firstConnector).toBeLessThan(firstDot)
    // The count axis joins S05's dots at 2 (unaided) and 0 (Vigil), across the whole axis.
    const count = axisYs(svg)[0]
    const s05 = connectors.find(
      (line) => line['data-subject'] === 'S05' && Number(line.y1) === count - 12,
    )!
    expect(s05).toMatchObject({ x1: '900', x2: '200', y2: String(count + 12) })
  })

  it('draws the count axis 0 … 2 with a tick per integer and each condition’s runs stacked at their value (H3)', () => {
    const opened = (m: RunMetrics) => m.openedBeforeFirstThreat
    expect(countMax(all, opened)).toBe(2)
    expect(countMax([], opened)).toBe(2)
    const y = axisYs(svg)[0]
    expect(dotOf(on(0), 'count-raw', 'S05')).toEqual([countX(2, 2), y - 12])
    expect(dotOf(on(0), 'count-raw', 'S06')).toEqual([countX(2, 2), y - 26])
    expect(dotOf(on(0), 'count-vigil', 'S05')).toEqual([countX(0, 2), y + 12])
    expect(dotOf(on(0), 'count-vigil', 'S06')).toEqual([countX(0, 2), y + 26])
    expect(
      placeCount(all.slice(4), opened, 2).map((p) => `${p.m.subject}-${p.m.mode}@${p.x}`),
    ).toEqual(['S05-raw@900', 'S05-vigil@200', 'S06-raw@900', 'S06-vigil@200'])
    expect(labelAt(svg, [900, y - 26])).toBe('S06')
    // The ticks at 0, 1, 2 and the end labels.
    expect(svg).toContain(`<line x1="550" y1="${y - 3}" x2="550" y2="${y + 3}"`)
    expect(svg).toContain(
      `<text x="900" y="${y + 56}" font-family="system-ui, sans-serif" font-size="11" fill="#63707f" text-anchor="end">2</text>`,
    )
  })

  it('draws each threat’s first open on the family’s longest window, a never-opened threat hollow at its own run’s window end (G4)', () => {
    const [y1, y2] = axisYs(svg).slice(1, 3)
    expect(dotOf(on(1), 'time-raw', 'S05')).toEqual([timeX(84, 218), y1 - 12])
    expect(dotOf(on(1), 'time-raw', 'S06')).toEqual([timeX(95, 218), y1 - 12])
    // Vigil's two, 6.4 px apart, stack: S05 nearest at its own x, S06 above it at its own x.
    expect(dotOf(on(1), 'time-vigil', 'S05')).toEqual([timeX(11, 218), y1 + 12])
    expect(dotOf(on(1), 'time-vigil', 'S06')).toEqual([timeX(9, 218), y1 + 26])
    expect(timeX(9, 218)).toBe(228.9)
    // Threat 2: S06's unaided run never opened it — hollow at 3:38, its own run's window end.
    expect(
      tagsOf(svg, 'time-raw-hollow').map((dot) => [
        dot['data-subject'],
        Number(dot.cx),
        Number(dot.cy),
      ]),
    ).toEqual([['S06', timeX(218, 218), y2 - 12]])
    expect(timeX(218, 218)).toBe(900)
    expect(svg).toContain('>3:38</text>')
    const placed = placeTime(all.slice(4), 218, 1)
    expect(placed.filter((p) => p.hollow).map((p) => `${p.m.subject}@${p.x}`)).toEqual(['S06@900'])
  })

  it('draws the standoff per threat with a miss hollow at the inside end, the crowded pairs stacked', () => {
    const [t1, t2] = axisYs(svg).slice(3, 5)
    // Threat 1: S06 at −207 m and S05 at +60 m are 31 px apart — no stack.
    expect(dotOf(on(3), 'standoff-raw', 'S05')).toEqual([standoffX(60), t1 - 12])
    expect(dotOf(on(3), 'standoff-raw', 'S06')).toEqual([standoffX(-207), t1 - 12])
    // Vigil's two are 11.9 px apart and stack, S05 nearest the axis by its code.
    expect(dotOf(on(3), 'standoff-vigil', 'S05')).toEqual([standoffX(814), t1 + 12])
    expect(dotOf(on(3), 'standoff-vigil', 'S06')).toEqual([standoffX(916), t1 + 26])
    // Threat 2: S06's unaided miss hollow at the inside end; Vigil's two 12.3 px apart stack.
    expect(
      tagsOf(svg, 'standoff-raw-hollow').map((dot) => [
        dot['data-subject'],
        Number(dot.cx),
        Number(dot.cy),
      ]),
    ).toEqual([['S06', 206, t2 - 12]])
    expect(dotOf(on(4), 'standoff-vigil', 'S05')).toEqual([standoffX(714), t2 + 12])
    expect(dotOf(on(4), 'standoff-vigil', 'S06')).toEqual([standoffX(609), t2 + 26])
    expect(
      placeStandoff(all.slice(6), 1).map((p) => `${p.m.mode}@${p.x}${p.hollow ? ' hollow' : ''}`),
    ).toEqual(['raw@206 hollow', 'vigil@621.1'])
  })

  it('writes the counts per condition under each family, exact', () => {
    expect(textsOf(svg, 'counts-raw')).toEqual([
      'unaided: 2 runs · misses threat 1 0 · threat 2 1 · false alarms 1 · early escalations 2 · order correct 0 of 1 with every threat escalated',
      'unaided: 2 runs · misses 0 · false alarms 0 · early escalations 0',
    ])
    expect(textsOf(svg, 'counts-vigil')).toEqual([
      'Vigil: 2 runs · misses threat 1 0 · threat 2 0 · false alarms 0 · early escalations 0 · order correct 2 of 2 with every threat escalated',
      'Vigil: 2 runs · misses 0 · false alarms 0 · early escalations 0',
    ])
  })

  it('draws one family alone, and an empty study as its title', () => {
    const one = studySvg(all.slice(0, 4))
    expect(textsOf(one, 'family')).toEqual(['Corroboration pair (02a, 02b) — standoff at decision'])
    expect(tagsOf(one, 'axis')).toHaveLength(1)
    expect(tagsOf(one, 'connector')).toHaveLength(2)
    const none = studySvg([])
    expect(textsOf(none, 'title')).toEqual(['Study — 0 runs · 0 subjects'])
    expect(textsOf(none, 'family')).toEqual([])
    // No pixel attribute carries two or more decimals.
    expect(svg).not.toMatch(/\b(x|y|cx|cy|x1|y1|x2|y2|r|width|height)="-?\d+\.\d{2,}"/)
  })
})

describe('the study figure — round 1 (#162)', () => {
  it('reads a scenario’s family from the bench’s roles table and refuses a stranger in words', () => {
    expect(familyOf('02b')).toBe('corroboration')
    expect(familyOf('03a')).toBe('prioritization')
    expect(() => familyOf('02c')).toThrow('02c: not a study scenario the bench knows')
    expect(() => studySvg([{ ...all[0], scenario: '04a' }])).toThrow(
      '04a: not a study scenario the bench knows',
    )
  })

  it('names a family’s scenarios in their own order whatever subject drew which', () => {
    // S03 on 02a becomes S09, so 02b's subject sorts first; the heading still reads (02a, 02b).
    const counterbalanced = all.map((m) => (m.scenario === '02a' ? { ...m, subject: 'S09' } : m))
    expect(textsOf(studySvg(counterbalanced), 'family')).toEqual([
      'Prioritization pair (03a, 03b) — attention',
      'Corroboration pair (02a, 02b) — standoff at decision',
    ])
  })

  it('draws no first-open dot for a run whose scenario has no such threat, as the standoff axis already did', () => {
    // A two-threat run and a one-threat run on threat 2's axis: one dot, the two-threat run's.
    const placed = placeTime([all[4], all[0]], 218, 1)
    expect(placed.map((p) => `${p.m.subject}@${p.x}${p.hollow ? ' hollow' : ''}`)).toEqual([
      'S05@331.7',
    ])
    expect(placeStandoff([all[4], all[0]], 1).map((p) => p.m.subject)).toEqual(['S05'])
  })

  it('draws the corroboration family at its own threat count: a second threat there gets its standoff axis and its counts', () => {
    const second = {
      ...all[0].threats[0],
      id: 'inject-57',
      firstOpenS: null,
      timeToEscalateS: null,
      standoffM: null,
      miss: true,
    }
    const twoThreat = all.slice(0, 4).map((m) => ({ ...m, threats: [m.threats[0], second] }))
    const svg2 = studySvg(twoThreat)
    expect(textsOf(svg2, 'axis-title')).toEqual([
      'standoff at decision · threat 1',
      'standoff at decision · threat 2',
    ])
    expect(tagsOf(svg2, 'standoff-raw-hollow')).toHaveLength(2)
    expect(textsOf(svg2, 'counts-raw')).toEqual([
      'unaided: 2 runs · misses threat 1 0 · threat 2 2 · false alarms 0 · early escalations 0 · order correct 0 of 0 with every threat escalated',
    ])
  })
})
