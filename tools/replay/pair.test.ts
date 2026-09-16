import { describe, expect, it } from 'vitest'
import { frameSvg, type FrameInput } from './frame.ts'
import { loadStudy, planFor, readRun } from './load.ts'
import { runMetrics } from './metrics.ts'
import { conditionWord, countsLine, orderWords, pairName, pairSvg } from './pair.ts'

const study = loadStudy()
const fixture = (name: string): FrameInput => {
  const record = readRun(`tools/replay/__fixtures__/${name}.json`)
  const plan = planFor(record.scenario, study.timeline)
  return { record, plan, study, metrics: runMetrics(record, study.index, plan) }
}
/** The pair as the CLI draws it: the boxes capped at five rows (ruled G2). */
const pairOf = (left: string, right: string) =>
  pairSvg({ left: fixture(left), right: fixture(right) }, { queueCap: 5 })

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
/** The text an element with the class carries, by its data-id. */
const textFor = (svg: string, cls: string, id: string) =>
  svg.match(new RegExp(`<text[^>]*class="${cls}" data-id="${id}"[^>]*>([^<]*)</text>`))?.[1] ?? null
/** The block's axes, written out again here so a pixel is checked against the formula, not the code. */
const timeX = (s: number, runS: number) => Math.round((220 + (s / runS) * 900) * 10) / 10
const bandX = (m: number) => Math.round((1180 + ((m + 3000) / 6000) * 600) * 10) / 10

describe('the pair (S5d-i, #138, ruled A6, N8, G1–G6) — the two frames and the block', () => {
  it('nests the two frames side by side with their own clip ids and stands the block under the taller', () => {
    const svg = pairOf('S05-03a-raw-1', 'S05-03a-vigil-1')
    expect(
      svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="1820" height="1618"'),
    ).toBe(true)
    expect(svg).toContain('data-left="S05-03a-raw-1" data-right="S05-03a-vigil-1"')
    expect(tagsOf(svg, 'frame-left')[0]).toMatchObject({
      x: '0',
      y: '0',
      width: '900',
      height: '988',
    })
    expect(tagsOf(svg, 'frame-right')[0]).toMatchObject({
      x: '920',
      y: '0',
      width: '900',
      height: '1188',
    })
    expect(svg).toContain('<clipPath id="panel-left">')
    expect(svg).toContain('<clipPath id="panel-right">')
    expect(svg).not.toContain('<clipPath id="panel">')
    // The block: 70 + 2 rows × 150 + 60 under the taller frame's 1 188 (the box capped: nine
    // rows out, the count line in).
    expect(tagsOf(svg, 'block')[0]).toMatchObject({ y: '1188', height: '430', width: '1820' })
    expect(pairOf('S05-03a-raw-1', 'S05-03a-vigil-1')).toBe(svg)
  })

  it('caps each frame’s Queue box at five rows with the count line, while the run’s own frame keeps every row (G2)', () => {
    const svg = pairOf('S05-03a-raw-1', 'S05-03a-vigil-1')
    expect(tagsOf(svg, 'vigil-queue-line')).toHaveLength(5)
    expect(textsOf(svg, 'vigil-queue-title')).toEqual(['Queue at 1:11 · 14 above calm'])
    expect(textsOf(svg, 'vigil-queue-more')).toEqual([
      "… 9 more above calm, on the run's own frame",
    ])
    const own = frameSvg(fixture('S05-03a-vigil-1'))
    expect(tagsOf(own, 'vigil-queue-line')).toHaveLength(14)
    expect(tagsOf(own, 'vigil-queue-more')).toHaveLength(0)
    // On the corroboration pair the five rows are the whole box: no count line.
    const a = pairOf('S03-02a-raw-1', 'S03-02a-vigil-1')
    expect(tagsOf(a, 'vigil-queue-line')).toHaveLength(5)
    expect(tagsOf(a, 'vigil-queue-more')).toHaveLength(0)
  })

  it('writes the counts line for both conditions, "unaided" for a raw run, the order on the prioritization pair only (G3)', () => {
    expect(conditionWord(fixture('S03-02a-raw-1').record)).toBe('unaided')
    expect(conditionWord(fixture('S03-02a-vigil-1').record)).toBe('Vigil')
    expect(textsOf(pairOf('S03-02a-raw-1', 'S03-02a-vigil-1'), 'counts')).toEqual([
      'opened before the first threat unaided 0 · Vigil 0     |     false escalations unaided 0 · Vigil 0     |     escalations of later entrants unaided 0 · Vigil 0',
    ])
    expect(textsOf(pairOf('S05-03a-raw-1', 'S05-03a-vigil-1'), 'counts')).toEqual([
      'opened before the first threat unaided 2 · Vigil 0     |     false escalations unaided 0 · Vigil 0     |     escalations of later entrants unaided 1 · Vigil 0     |     order unaided ✗ (inject-12 before inject-11) · Vigil ✓',
    ])
    expect(textsOf(pairOf('S06-03b-raw-1', 'S06-03b-vigil-1'), 'counts')).toEqual([
      'opened before the first threat unaided 2 · Vigil 0     |     false escalations unaided 1 · Vigil 0     |     escalations of later entrants unaided 1 · Vigil 0     |     order unaided — (inject-12 missed) · Vigil ✓',
    ])
    const raw = pairOf('S05-03a-raw-1', 'S05-03a-vigil-1')
    expect(textsOf(raw, 'legend')).toEqual(['unaided', 'Vigil'])
    expect(raw).not.toMatch(/>raw</)
    expect(orderWords(fixture('S05-03a-vigil-1').metrics)).toBe('✓')
    expect(orderWords(fixture('S03-02a-raw-1').metrics)).toBe('— (one threat)')
    expect(
      countsLine(fixture('S03-02a-raw-1').metrics, fixture('S03-02a-vigil-1').metrics, 'a', 'b'),
    ).toContain('opened before the first threat a 0 · b 0')
  })

  it('draws one row per threat: the entry tick, each condition’s open and escalation on the shared time axis, at the pixels the axis gives', () => {
    const svg = pairOf('S05-03a-raw-1', 'S05-03a-vigil-1')
    expect(textsOf(svg, 'row-title')).toEqual(['threat 1 · inject-11', 'threat 2 · inject-12'])
    expect(textsOf(svg, 'row-entry')).toEqual(['ring entry 1:42', 'ring entry 3:08'])
    const ticks = tagsOf(svg, 'entry-tick').map((tick) => Number(tick.x1))
    expect(ticks).toEqual([timeX(102, 218), timeX(188, 218)])
    expect(ticks).toEqual([641.1, 996.1])
    // The raw lane on the left, the Vigil lane on the right, each from the run's own metrics.
    const left = fixture('S05-03a-raw-1').metrics
    const right = fixture('S05-03a-vigil-1').metrics
    left.threats.forEach((threat, i) => {
      const open = tagsOf(svg, 'lane-left-open').find((mark) => mark['data-id'] === threat.id)!
      const esc = tagsOf(svg, 'lane-left-escalate').find((mark) => mark['data-id'] === threat.id)!
      expect(Number(open.cx)).toBe(timeX(threat.firstOpenS!, 218))
      expect(Number(esc.cx)).toBe(timeX(threat.timeToEscalateS!, 218))
      const other = right.threats[i]
      const rOpen = tagsOf(svg, 'lane-right-open').find((mark) => mark['data-id'] === threat.id)!
      const rEsc = tagsOf(svg, 'lane-right-escalate').find((mark) => mark['data-id'] === threat.id)!
      expect(Number(rOpen.cx)).toBe(timeX(other.firstOpenS!, 218))
      expect(Number(rEsc.cx)).toBe(timeX(other.timeToEscalateS!, 218))
    })
    expect(tagsOf(svg, 'lane-right-open')[0]).toMatchObject({ cx: '265.4', 'data-id': 'inject-11' })
    expect(tagsOf(svg, 'lane-right-escalate')[0]).toMatchObject({ cx: '376.9' })
    expect(svg).toContain('>opened 1:24</text>')
    expect(svg).toContain('>escalated 1:37</text>')
    // The time axis runs the scenario's own window: 3:38 on 03a, 6:00 on 02a.
    expect(svg).toContain('>3:38</text>')
    expect(pairOf('S03-02a-raw-1', 'S03-02a-vigil-1')).toContain('>6:00</text>')
  })

  it('draws the standoff band per threat with one dot per condition at the pixels the axis gives, its number and its distance from the entry beside it', () => {
    const svg = pairOf('S05-03a-raw-1', 'S05-03a-vigil-1')
    const dots = (cls: string) => tagsOf(svg, cls).map((dot) => [dot['data-id'], Number(dot.cx)])
    expect(dots('band-left')).toEqual([
      ['inject-11', bandX(60)],
      ['inject-12', bandX(793)],
    ])
    expect(dots('band-right')).toEqual([
      ['inject-11', bandX(814)],
      ['inject-12', bandX(714)],
    ])
    expect(dots('band-left')).toEqual([
      ['inject-11', 1486],
      ['inject-12', 1559.3],
    ])
    expect(dots('band-right')[0][1]).toBe(1561.4)
    expect(svg).toContain('>+0.1 km · 0:05 before entry</text>')
    expect(svg).toContain('>+0.8 km · 1:04 before entry</text>')
    expect(svg).toContain('>+0.7 km · 1:57 before entry</text>')
    // 02a: the one row, both conditions the same decision.
    const a = pairOf('S03-02a-raw-1', 'S03-02a-vigil-1')
    expect(textsOf(a, 'row-title')).toEqual(['the threat · inject-11'])
    expect(textsOf(a, 'row-entry')).toEqual(['ring entry 2:04'])
    expect(tagsOf(a, 'band-left')[0].cx).toBe(String(bandX(1174)))
    expect(tagsOf(a, 'band-right')[0].cx).toBe(String(bandX(1174)))
    expect((a.match(/>\+1\.2 km · 1:06 before entry</g) ?? []).length).toBe(2)
  })

  it('reads a miss on the lane and on the band: 03b’s raw run never opened threat 2', () => {
    const svg = pairOf('S06-03b-raw-1', 'S06-03b-vigil-1')
    expect(textFor(svg, 'lane-left', 'inject-12')).toBe('MISSED')
    expect(tagsOf(svg, 'lane-left-open').map((mark) => mark['data-id'])).toEqual(['inject-11'])
    expect(tagsOf(svg, 'band-left-miss')[0]).toMatchObject({
      'data-id': 'inject-12',
      cx: '1186',
      fill: 'none',
    })
    expect(tagsOf(svg, 'band-left').map((dot) => dot['data-id'])).toEqual(['inject-11'])
    // Threat 1 was escalated 12 s after its entry: inside the ring, the dot left of the ring mark.
    expect(Number(tagsOf(svg, 'band-left')[0].cx)).toBe(bandX(-75))
    expect(svg).toContain('>−0.1 km · 0:12 after entry</text>')
    expect(tagsOf(svg, 'lane-right-escalate').map((mark) => mark['data-id'])).toEqual([
      'inject-11',
      'inject-12',
    ])
  })

  it('pairs any two runs, labelled by their modes — two unaided runs read two lanes under one word (G5) — and names the file by both when they differ', () => {
    const left = fixture('S03-02a-raw-1')
    const right = fixture('S04-02b-raw-1')
    expect(pairName(left.record, right.record)).toBe('pair-S03-02a-S04-02b.svg')
    expect(pairName(left.record, fixture('S03-02a-vigil-1').record)).toBe('pair-S03-02a.svg')
    const svg = pairSvg({ left, right }, { queueCap: 5 })
    expect(textsOf(svg, 'legend')).toEqual(['unaided', 'unaided'])
    expect(textsOf(svg, 'counts')[0]).toMatch(
      /^opened before the first threat unaided 0 · unaided 0/,
    )
  })

  it('sits a standoff past ±3 km at the band’s edge with its number (G6)', () => {
    const left = fixture('S03-02a-raw-1')
    const far = {
      ...left,
      metrics: {
        ...left.metrics,
        threats: [{ ...left.metrics.threats[0], standoffM: 4500 }],
      },
    }
    const svg = pairSvg({ left: far, right: fixture('S03-02a-vigil-1') }, { queueCap: 5 })
    expect(Number(tagsOf(svg, 'band-left')[0].cx)).toBe(bandX(3000))
    expect(svg).toContain('>+4.5 km · 1:06 before entry</text>')
  })
})
