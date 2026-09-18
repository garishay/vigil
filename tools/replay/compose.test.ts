import { describe, expect, it } from 'vitest'
import { compose, PAIR_QUEUE_CAP } from './compose.ts'
import { RunRefusal, planFor } from './load.ts'
import { loadStudy, readRuns } from './files.ts'
import { runMetrics } from './metrics.ts'
import type { FrameInput } from './frame.ts'

const FIXTURES = 'tools/replay/__fixtures__/'
const study = loadStudy()
const input = (name: string): FrameInput => {
  const record = readRuns(FIXTURES + name)[0]
  const plan = planFor(record.scenario, study.timeline)
  return { record, plan, study, metrics: runMetrics(record, study.index, plan) }
}

describe('compose — the one branch the CLI and the browser take (S6a-i, #165, ruled A4)', () => {
  it('draws the pair for one scenario and the sheet for two of one family, under the CLI’s names', () => {
    expect(PAIR_QUEUE_CAP).toBe(5)
    const pair = compose([input('S05-03a-raw-1.json'), input('S05-03a-vigil-1.json')])
    expect(pair.name).toBe('pair-S05-03a.svg')
    expect(pair.svg).toContain('data-left="S05-03a-raw-1" data-right="S05-03a-vigil-1"')
    // The unaided run names the sheet's file and takes its left frame, whichever order they came in.
    const sheet = compose([input('S04-02b-vigil-1.json'), input('S03-02a-raw-1.json')])
    expect(sheet.name).toBe('sheet-S03-S04-02a-02b.svg')
    expect(sheet.svg).toContain('SUBJECT SHEET · S03 · S04 · 02a unaided, 02b with Vigil')
  }, 30_000)

  it('refuses anything but two runs, before it destructures them (round 1)', () => {
    // The guard travels with the function rather than living at the call site: `parseResults` is
    // permissive about how many runs a file holds, and `compose` is where two is required. A
    // one-run array used to throw a raw TypeError on `second.record`.
    const one = [input('S03-02a-raw-1.json')]
    expect(() => compose(one)).toThrow(RunRefusal)
    expect(() => compose(one)).toThrow(
      'a document reads two runs, not 1 — a results file, or both run files',
    )
    expect(() => compose([])).toThrow('a document reads two runs, not 0 —')
    expect(() => compose([...one, ...one, ...one])).toThrow('a document reads two runs, not 3 —')
  }, 30_000)
})
