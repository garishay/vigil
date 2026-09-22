import { describe, expect, it } from 'vitest'
import { documentOf, fetchStudy, filesFor, runsIn, splitPasted } from './sheet'
import rawRun from '../../tools/replay/__fixtures__/S03-02a-raw-1.json?raw'
import vigilRun from '../../tools/replay/__fixtures__/S04-02b-vigil-1.json?raw'
import prioritizationRaw from '../../tools/replay/__fixtures__/S05-03a-raw-1.json?raw'
import prioritizationVigil from '../../tools/replay/__fixtures__/S05-03a-vigil-1.json?raw'
import captureRaw from '../../public/adsb-phl-002.json?raw'
import { compose } from '../../tools/replay/compose'
import { planFor } from '../../tools/replay/load'
import { runMetrics } from '../../tools/replay/metrics'
import type { RunRecord } from '../lib/run'

// The fixtures as text, imported the way every other `src` test imports one — nothing here reads
// a disk or a network, which is also what keeps this file inside the app's own project.
const raw = rawRun.trim()
const vigil = vigilRun.trim()
const record = (text: string) => JSON.parse(text) as RunRecord

/** The recording the page fetches, from the committed capture rather than the network. */
const fetcher = (async () =>
  new Response(captureRaw, {
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch

describe('the sheet in the browser (S6a-ii, #165, ruled B5)', () => {
  it('fetches the study recording the way the app fetches every recording', async () => {
    const study = await fetchStudy(fetcher)
    expect(study.recording.entry.id).toBe('vigil-phl-002')
    expect(study.index.samples.size).toBeGreaterThan(0)
    expect(study.index.durationS).toBeGreaterThan(0)
    expect(study.timeline.frameTimesMs.length).toBeGreaterThan(0)
  }, 30_000)

  it('hands the tool exactly what the CLI hands it — one renderer, byte for byte', async () => {
    const study = await fetchStudy(fetcher)
    const records = [record(raw), record(vigil)]
    // `documentOf` is the only code between the page and `compose`, which the CLI calls too, so
    // it is the only place the two could drift — a queue cap set on one side, a run ordered
    // differently, a plan built per call. Held against `compose` over the same runs and study:
    // equal bytes and equal name, so *one renderer* is measured rather than described. The CLI's
    // own output over these fixtures is pinned byte for byte by `tools/replay.test.ts`.
    const sheet = documentOf(records, study)
    const direct = compose(
      records.map((run) => {
        const plan = planFor(run.scenario, study.timeline)
        return { record: run, plan, study, metrics: runMetrics(run, study.index, plan) }
      }),
    )
    expect(sheet.name).toBe(direct.name)
    expect(sheet.svg).toBe(direct.svg)
    expect(sheet.name).toBe('sheet-S03-S04-02a-02b.svg')
    expect(sheet.svg).toContain('SUBJECT SHEET · S03 · S04 · 02a unaided, 02b with Vigil')
    // Two runs of one scenario are the pair, as #165's body rules.
    const pair = documentOf([record(prioritizationRaw), record(prioritizationVigil)], study)
    expect(pair.name).toBe('pair-S05-03a.svg')
    expect(pair.svg).toContain('ATTENTION · STANDOFF AT DECISION')
  }, 60_000)

  it('refuses what the CLI refuses, in the CLI’s own words', async () => {
    const study = await fetchStudy(fetcher)
    // The loader's sentence, with the page's own name for what it read where the CLI has a path.
    expect(() => runsIn(raw.replace('"02a"', '"01"'), 'pasted')).toThrow(
      'pasted: scenario "01" — the replay reads a scenario the bench baselines: 02a, 02b, 03a, 03b, 03d',
    )
    // `compose` owns the count, so the page does not restate it (S6a-i, round 1).
    expect(() => documentOf([record(raw)], study)).toThrow(
      'a document reads two runs, not 1 — a results file, or both run files',
    )
    // The sheet's own refusal, unchanged.
    expect(() => documentOf([record(raw), record(prioritizationRaw)], study)).toThrow(
      "a sheet reads one family — S03's 02a is corroboration and S05's 03a is prioritization",
    )
  }, 30_000)
})

describe('what Save the runs hands back (S6a-ii, #165, ruled D4)', () => {
  it('normalises one subject’s runs to the results file the CLI reads, in run order', () => {
    const runs = [record(prioritizationRaw), { ...record(prioritizationVigil), run: 2 }]
    const files = filesFor(runs)
    expect(files.map((file) => file.name)).toEqual(['vigil-S05-results.json'])
    expect(files.map((file) => file.label)).toEqual(['the runs'])
    // Round-trips through the loader: what the page writes is what the tool reads back.
    expect(runsIn(files[0].text, 'vigil-S05-results.json').map((run) => run.run)).toEqual([1, 2])
    // The files can arrive in any order — the sheet draws either way — but `parseResults` reads
    // the runs ascending, so the envelope is written in run order whatever order it was given
    // (round 1, finding 2). Before the fix this wrote [2, 1] and the loader refused it.
    const reversed = filesFor([...runs].reverse())
    expect(reversed[0].text).toBe(files[0].text)
    expect(runsIn(reversed[0].text, 'vigil-S05-results.json').map((run) => run.run)).toEqual([1, 2])
  })

  it('falls back to a file per run when two runs share a run index', () => {
    // The S5a fixtures are one subject's two conditions, both run 1: there is no order to write
    // them in, so an envelope over them would be refused on read. Each run's own file instead,
    // named for everything that tells one from the other, and labelled by the condition since
    // that is all that differs (round 1, finding 2; #177's rule for the pair's row title).
    const files = filesFor([record(prioritizationRaw), record(prioritizationVigil)])
    expect(files.map((file) => file.name)).toEqual([
      'vigil-S05-03a-raw-run1.json',
      'vigil-S05-03a-vigil-run1.json',
    ])
    expect(files.map((file) => file.label)).toEqual(['unaided', 'Vigil'])
    for (const file of files) expect(runsIn(file.text, file.name)).toHaveLength(1)
  })

  it('writes each run’s own file when the two runs are two subjects', () => {
    // A results envelope is one subject's by contract, so an envelope over two would be refused
    // by the tool that has to read it. The page composes a pair from two subjects — the viewer's
    // artifact — so that case hands back the run files instead, and both read back.
    const files = filesFor([record(raw), record(vigil)])
    expect(files.map((file) => file.name)).toEqual([
      'vigil-S03-02a-raw-run1.json',
      'vigil-S04-02b-vigil-run1.json',
    ])
    // Labelled by the subject, since that is what tells these two apart.
    expect(files.map((file) => file.label)).toEqual(['S03', 'S04'])
    for (const file of files) expect(runsIn(file.text, file.name)).toHaveLength(1)
    // What Copy the runs puts on the clipboard is what the paste box reads back.
    expect(splitPasted(files.map((file) => file.text).join('\n'))).toHaveLength(2)
  })
})

describe('the paste box reads structure, not line shape (S6a-ii, #165, ruled R2)', () => {
  it('splits two pasted runs the same way with and without their line breaks', () => {
    const pretty = `${raw}\n${vigil}`
    // A run's text reaches this box by way of a chat client, which is free to fold or drop every
    // line break. Both forms must split the same way; a line-shape rule splits only the first.
    const flat = pretty.replaceAll('\n', '')
    expect(flat).not.toContain('\n')
    const a = splitPasted(pretty)
    const b = splitPasted(flat)
    expect(a).toHaveLength(2)
    expect(b).toHaveLength(2)
    expect(a.map((part) => part.name)).toEqual(['pasted[0]', 'pasted[1]'])
    expect(b.map((part) => JSON.parse(part.text))).toEqual(a.map((part) => JSON.parse(part.text)))
    expect(b.map((part) => (JSON.parse(part.text) as RunRecord).subject)).toEqual(['S03', 'S04'])
  })

  it('never splits inside a string, whatever braces or escapes it holds', () => {
    // Counted outside strings, escapes honoured: a brace in a value is a character, not an edge.
    const hostile = JSON.stringify({ a: '}{', b: 'a \\" }', c: { d: '{' } })
    expect(splitPasted(hostile)).toEqual([{ name: 'pasted', text: hostile }])
    expect(splitPasted(`${hostile}${hostile}`).map((part) => part.text)).toEqual([hostile, hostile])
  })

  it('names one paste `pasted` and each of several by its place', () => {
    expect(splitPasted(raw).map((part) => part.name)).toEqual(['pasted'])
    expect(splitPasted(`${raw}\n${vigil}`).map((part) => part.name)).toEqual([
      'pasted[0]',
      'pasted[1]',
    ])
  })

  it('ignores text outside a top-level object, before, between and after (ruled, round 1)', () => {
    // The chat client a run arrives through wraps it in a name, a time or a greeting, and the
    // objects are what the loader validates. Before the ruling only the trailing stray text was
    // kept and everything ahead of the first brace was dropped without saying so.
    const wrapped = `Gary 14:03\n${raw}\nthanks!\n${vigil}\nsent from my phone`
    const parts = splitPasted(wrapped)
    expect(parts.map((part) => part.text)).toEqual([raw, vigil])
    expect(parts.map((part) => part.name)).toEqual(['pasted[0]', 'pasted[1]'])
    // No object at all is nothing to read; the page says so rather than refusing a non-run.
    expect(splitPasted('not json')).toEqual([])
    expect(splitPasted('')).toEqual([])
  })

  it('hands on an object that opens and never closes, so the loader refuses it in words', () => {
    // Not stray text: a truncated paste is a run the subject meant to give, and saying so is
    // better than dropping it (ruled, round 1).
    const cut = splitPasted(`${raw}\n{"subject":"S04",`)
    expect(cut).toHaveLength(2)
    expect(cut[1].text).toBe('{"subject":"S04",')
    expect(() => runsIn(cut[1].text, cut[1].name)).toThrow(/^pasted\[1\]: not JSON — /)
    // The chatter around a truncated object still goes; the object itself does not.
    expect(splitPasted('hi\n{"subject":').map((part) => part.text)).toEqual(['{"subject":'])
  })
})
