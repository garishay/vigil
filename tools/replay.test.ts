import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectRunFiles,
  DEFAULT_OUT,
  main,
  metricsOf,
  PAIR_QUEUE_CAP,
  parseArgs,
} from './replay.ts'
import { CSV_COLUMNS } from './replay/csv.ts'
import { RunRefusal } from './replay/load.ts'
import { loadStudy, readRuns } from './replay/files.ts'

// Vitest runs from the repo root, as the tool does; the fixtures are named from there.
const FIXTURES = 'tools/replay/__fixtures__'
const study = loadStudy()
const temps: string[] = []
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('the replay tool’s command line (S5a, #138, ruled A8)', () => {
  it('reads run files, --study, and --out, and refuses what it does not know', () => {
    expect(parseArgs(['a.json', 'b.json'])).toEqual({
      study: false,
      out: DEFAULT_OUT,
      paths: ['a.json', 'b.json'],
    })
    expect(parseArgs(['--study', 'runs', '--out', 'here'])).toEqual({
      study: true,
      out: 'here',
      paths: ['runs'],
    })
    expect(DEFAULT_OUT).toBe('study')
    expect(() => parseArgs(['--out'])).toThrow('--out names a directory')
    expect(() => parseArgs(['--out', '--study', 'a.json'])).toThrow('--out names a directory')
    expect(() => parseArgs(['--svg', 'a.json'])).toThrow(
      'unknown flag --svg — --study, --out <dir>',
    )
    expect(() => parseArgs(['--study'])).toThrow(
      'no run file named — give a run JSON, or --study <dir>',
    )
  })

  it('takes a directory as its .json files in name order, and a file as itself', () => {
    const files = collectRunFiles([FIXTURES])
    expect(files.map((file) => basename(file))).toEqual([
      'S03-02a-raw-1.json',
      'S03-02a-vigil-1.json',
      'S04-02b-raw-1.json',
      'S04-02b-vigil-1.json',
      'S05-03a-raw-1.json',
      'S05-03a-vigil-1.json',
      'S06-03b-raw-1.json',
      'S06-03b-vigil-1.json',
    ])
    expect(collectRunFiles([join(FIXTURES, 'S03-02a-raw-1.json')])).toEqual([
      join(FIXTURES, 'S03-02a-raw-1.json'),
    ])
  })

  it('prints the CSV for named runs and writes their frames under --out; writes study.csv under --out for --study', () => {
    const frames = mkdtempSync(join(tmpdir(), 'vigil-replay-'))
    temps.push(frames)
    const logged: string[] = []
    const printed = main(
      [
        join(FIXTURES, 'S03-02a-vigil-1.json'),
        join(FIXTURES, 'S03-02a-raw-1.json'),
        '--out',
        frames,
      ],
      (line) => logged.push(line),
    )
    const lines = printed.split('\n')
    expect(lines[0]).toBe(CSV_COLUMNS.join(','))
    expect(lines[1]).toMatch(/^S03,02a,raw,1,/)
    expect(lines[2]).toMatch(/^S03,02a,vigil,1,/)
    // Each run's frame, named by subject, scenario, mode, and run, and the line that names it
    // (S5b); exactly two runs write the pair too (S5d-i).
    expect(logged).toEqual([
      `${join(frames, 'S03-02a-vigil-1.svg')}: written\n`,
      `${join(frames, 'S03-02a-raw-1.svg')}: written\n`,
      `${join(frames, 'pair-S03-02a.svg')}: written\n`,
    ])
    expect(readFileSync(join(frames, 'pair-S03-02a.svg'), 'utf8')).toContain(
      'data-left="S03-02a-vigil-1" data-right="S03-02a-raw-1"',
    )
    const svg = readFileSync(join(frames, 'S03-02a-raw-1.svg'), 'utf8')
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain('UNAIDED · frozen at the moment of escalation — 0:58')
    expect(existsSync(join(frames, 'study.csv'))).toBe(false)
    const out = mkdtempSync(join(tmpdir(), 'vigil-replay-'))
    temps.push(out)
    // --study writes the figure beside the CSV and names it (S5d-ii).
    const studyLog: string[] = []
    expect(main(['--study', FIXTURES, '--out', out], (line) => studyLog.push(line))).toBe(
      `${join(out, 'study.csv')}: 8 runs\n`,
    )
    expect(studyLog).toEqual([`${join(out, 'study.svg')}: written\n`])
    const figure = readFileSync(join(out, 'study.svg'), 'utf8')
    expect(figure.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="1000"')).toBe(true)
    expect(figure).toContain('Study — 8 runs · 4 subjects')
    const written = readFileSync(join(out, 'study.csv'), 'utf8')
    // The eight fixture rows, byte for byte — the hand calculation on the PR (S5a's acceptance;
    // the 03 rows and the appended columns S5c-i's). The S5a cells of the 02 rows are unchanged.
    expect(written).toBe(
      [
        CSV_COLUMNS.join(','),
        'S03,02a,raw,1,2.60.0+efac241-dirty,2026-09-15T23:38:09.494Z,58,1174,58,false,0,1,1,124,6,7,5,360,0,0,,14,,,,,',
        'S03,02a,vigil,1,2.60.0+efac241-dirty,2026-09-15T23:38:11.935Z,58,1174,58,false,0,1,2,124,6,7,5,360,0,0,,14,,,,,',
        'S04,02b,raw,1,2.60.0+c9c80e3,2026-09-16T00:31:10.057Z,58,1153,58,false,0,1,1,123,6,7,5,360,0,0,,14,,,,,',
        'S04,02b,vigil,1,2.60.0+c9c80e3,2026-09-16T00:31:12.777Z,58,1153,58,false,0,1,2,123,6,7,5,360,0,0,,14,,,,,',
        'S05,03a,raw,1,2.60.0+a2b58ca,2026-09-17T15:15:54.751Z,97,60,97,false,0,3,6,102,5,6,4,218,2,1,false,84,41,58,793,false,188',
        'S05,03a,vigil,1,2.60.0+a2b58ca,2026-09-17T15:15:54.753Z,71,814,38,false,0,1,3,102,5,6,4,218,0,0,true,11,52,71,714,false,188',
        'S06,03b,raw,1,2.60.0+a2b58ca,2026-09-17T15:19:40.703Z,218,-207,118,false,1,3,4,102,5,6,4,218,2,1,,95,,,,true,188',
        'S06,03b,vigil,1,2.60.0+a2b58ca,2026-09-17T15:19:40.702Z,88,916,30,false,0,1,3,102,5,6,4,218,0,0,true,9,61,88,609,false,188',
        '',
      ].join('\n'),
    )
    expect(written).toBe(main([FIXTURES, '--out', frames]))
    expect(existsSync(join(frames, 'S04-02b-vigil-1.svg'))).toBe(true)
    expect(existsSync(join(frames, 'S06-03b-raw-1.svg'))).toBe(true)
    // Eight runs in the bare form: no pair, and the figure is --study's alone.
    expect(existsSync(join(frames, 'study.svg'))).toBe(false)
    expect(readdirSync(frames).filter((name) => name.startsWith('pair-'))).toEqual([
      'pair-S03-02a.svg',
    ])
  })

  it('writes the pair for exactly two run files and for no other count (S5d-i, ruled A8, G5)', () => {
    expect(PAIR_QUEUE_CAP).toBe(5)
    const one = mkdtempSync(join(tmpdir(), 'vigil-replay-'))
    temps.push(one)
    const oneLog: string[] = []
    main([join(FIXTURES, 'S05-03a-raw-1.json'), '--out', one], (line) => oneLog.push(line))
    expect(oneLog).toEqual([`${join(one, 'S05-03a-raw-1.svg')}: written\n`])
    const two = mkdtempSync(join(tmpdir(), 'vigil-replay-'))
    temps.push(two)
    const twoLog: string[] = []
    main(
      [join(FIXTURES, 'S05-03a-raw-1.json'), join(FIXTURES, 'S05-03a-vigil-1.json'), '--out', two],
      (line) => twoLog.push(line),
    )
    expect(twoLog).toEqual([
      `${join(two, 'S05-03a-raw-1.svg')}: written\n`,
      `${join(two, 'S05-03a-vigil-1.svg')}: written\n`,
      `${join(two, 'pair-S05-03a.svg')}: written\n`,
    ])
    const pair = readFileSync(join(two, 'pair-S05-03a.svg'), 'utf8')
    expect(pair).toContain('… 21 more above calm')
    // Two runs of unlike scenarios of one family are the subject sheet's (S5e, #164); two of
    // unlike families are refused in words, and nothing is written (#161 round 1).
    const sheetOut = mkdtempSync(join(tmpdir(), 'vigil-replay-'))
    temps.push(sheetOut)
    const sheetLog: string[] = []
    main(
      [
        join(FIXTURES, 'S06-03b-vigil-1.json'),
        join(FIXTURES, 'S05-03a-raw-1.json'),
        '--out',
        sheetOut,
      ],
      (line) => sheetLog.push(line),
    )
    // The unaided run names the file whichever order the two were given in.
    expect(sheetLog.at(-1)).toBe(`${join(sheetOut, 'sheet-S05-S06-03a-03b.svg')}: written
`)
    expect(readFileSync(join(sheetOut, 'sheet-S05-S06-03a-03b.svg'), 'utf8')).toContain(
      'SUBJECT SHEET · S05 · S06 · 03a unaided, 03b with Vigil',
    )
    const unlike = mkdtempSync(join(tmpdir(), 'vigil-replay-'))
    temps.push(unlike)
    const unlikeOut = join(unlike, 'out')
    expect(() =>
      main([
        join(FIXTURES, 'S03-02a-raw-1.json'),
        join(FIXTURES, 'S05-03a-raw-1.json'),
        '--out',
        unlikeOut,
      ]),
    ).toThrow(
      "a sheet reads one family — S03's 02a is corroboration and S05's 03a is prioritization",
    )
    expect(existsSync(join(unlikeOut, 'S03-02a-raw-1.svg'))).toBe(false)
    const three = mkdtempSync(join(tmpdir(), 'vigil-replay-'))
    temps.push(three)
    const threeLog: string[] = []
    main(
      [
        join(FIXTURES, 'S05-03a-raw-1.json'),
        join(FIXTURES, 'S05-03a-vigil-1.json'),
        join(FIXTURES, 'S06-03b-raw-1.json'),
        '--out',
        three,
      ],
      (line) => threeLog.push(line),
    )
    expect(threeLog).toHaveLength(3)
    expect(threeLog.some((line) => line.includes('pair-'))).toBe(false)
    expect(readdirSync(three).filter((name) => name.startsWith('pair-'))).toEqual([])
    // It writes six documents through the CLI; the runner is slower than this machine (#166 round 1).
  }, 30_000)

  it('never pools a demonstration run (S11b, #214): --study over a folder holding a 03d run beside 03a and 03b runs skips it in words, by scenario, and counts the rest; without --study the same run draws its frame, and two 03d runs their pair', () => {
    const mixed = mkdtempSync(join(tmpdir(), 'vigil-replay-'))
    temps.push(mixed)
    for (const name of ['S05-03a-vigil-1.json', 'S06-03b-raw-1.json']) {
      writeFileSync(join(mixed, name), readFileSync(join(FIXTURES, name)))
    }
    const demo = join(FIXTURES, 'demo', 'S90-03d-vigil-1.json')
    writeFileSync(join(mixed, 'S90-03d-vigil-1.json'), readFileSync(demo))
    const out = mkdtempSync(join(tmpdir(), 'vigil-replay-'))
    temps.push(out)
    const logged: string[] = []
    expect(main(['--study', mixed, '--out', out], (line) => logged.push(line))).toBe(
      `${join(out, 'study.csv')}: 2 runs\n`,
    )
    expect(logged).toEqual([
      `${join(mixed, 'S90-03d-vigil-1.json')}: skipped — 03d is a demonstration scenario, never pooled\n`,
      `${join(out, 'study.svg')}: written\n`,
    ])
    const csv = readFileSync(join(out, 'study.csv'), 'utf8')
    expect(csv.split('\n').filter((line) => line.startsWith('S90'))).toEqual([])
    expect(csv).toContain('\nS05,03a,vigil,1,')
    expect(readFileSync(join(out, 'study.svg'), 'utf8')).toContain('Study — 2 runs · 2 subjects')
    // A folder of demonstration runs alone pools nothing and says so per file.
    const only = mkdtempSync(join(tmpdir(), 'vigil-replay-'))
    temps.push(only)
    writeFileSync(join(only, 'S90-03d-vigil-1.json'), readFileSync(demo))
    expect(main(['--study', only, '--out', out], () => {})).toBe(
      `${join(out, 'study.csv')}: 0 runs\n`,
    )
    // The bare form: the frame and, for the demo's two runs, the pair — on 03d's own window.
    const frames = mkdtempSync(join(tmpdir(), 'vigil-replay-'))
    temps.push(frames)
    const printed = main([demo, join(FIXTURES, 'demo', 'S90-03d-raw-2.json'), '--out', frames])
    expect(printed.split('\n')[1]).toMatch(/^S90,03d,vigil,1,/)
    expect(readdirSync(frames).sort()).toEqual([
      'S90-03d-raw-2.svg',
      'S90-03d-vigil-1.svg',
      'pair-S90-03d.svg',
    ])
    expect(readFileSync(join(frames, 'S90-03d-vigil-1.svg'), 'utf8')).toContain(
      'frozen at the moment of the last escalation — 0:50',
    )
  })

  it('builds one plan per scenario across the runs, and stops on a refused file with nothing written', () => {
    const metrics = metricsOf(collectRunFiles([FIXTURES]), study)
    expect(metrics.map((m) => `${m.subject} ${m.scenario} ${m.mode}`)).toEqual([
      'S03 02a raw',
      'S03 02a vigil',
      'S04 02b raw',
      'S04 02b vigil',
      'S05 03a raw',
      'S05 03a vigil',
      'S06 03b raw',
      'S06 03b vigil',
    ])
    const out = mkdtempSync(join(tmpdir(), 'vigil-replay-'))
    temps.push(out)
    const bad = join(out, 'bad.json')
    writeFileSync(bad, '{"subject":"S09"}')
    expect(() => main(['--study', bad, '--out', join(out, 'never')])).toThrow(RunRefusal)
    expect(() => main(['--study', bad, '--out', join(out, 'never')])).toThrow(
      `${bad}: "scenario" is missing`,
    )
    expect(existsSync(join(out, 'never'))).toBe(false)
    expect(() => metricsOf([join(FIXTURES, '..', 'load.ts')], study)).toThrow(RunRefusal)
  })

  it('draws every frame before writing any: a run the frame refuses, or two runs sharing a name, leaves nothing behind (#151 round 1)', () => {
    const batch = mkdtempSync(join(tmpdir(), 'vigil-replay-'))
    temps.push(batch)
    const good = readFileSync(join(FIXTURES, 'S03-02a-raw-1.json'), 'utf8')
    writeFileSync(join(batch, 'a-good.json'), good)
    // A look at the threat at t 0 on a second run: the loader accepts it, the frame refuses it —
    // after the good run, which must not have been written.
    writeFileSync(
      join(batch, 'b-bad.json'),
      good
        .replace('"run": 1', '"run": 2')
        .replace(
          '{"t":14,"type":"select","track":"inject-11"}',
          '{"t":0,"type":"select","track":"inject-11"}',
        ),
    )
    const out = join(batch, 'out')
    expect(() => main([batch, '--out', out])).toThrow(
      'look #1 at t 0 names inject-11, not in the picture then',
    )
    expect(existsSync(join(out, 'S03-02a-raw-1.svg'))).toBe(false)
    // Two files, one identity: refused in words, nothing written.
    writeFileSync(join(batch, 'b-bad.json'), good)
    expect(() => main([batch, '--out', out])).toThrow(
      `S03-02a-raw-1.svg: two runs in this batch share subject S03, scenario 02a, mode raw, run 1 — ${join(batch, 'a-good.json')} and ${join(batch, 'b-bad.json')}`,
    )
    expect(existsSync(join(out, 'S03-02a-raw-1.svg'))).toBe(false)
  })
})

describe('a results file reads wherever a run file does (S6a-i, #165, ruled A5, A7; D3)', () => {
  const RESULTS = join(FIXTURES, 'results', 'vigil-S05-results.json')

  it('is the two committed run fixtures, and the second run’s index is the only edit', () => {
    // D3, ruled: the one edited field is stated here, not only at the gate. A results file holds
    // a subject's run 1 and run 2; every committed run fixture is run 1 and no subject spans two
    // scenarios, so the fixture is S05's two 03a runs with the second re-indexed and nothing else
    // touched. That claim is proven rather than asserted, so it cannot drift from the runs.
    const results = JSON.parse(readFileSync(RESULTS, 'utf8')) as {
      subject: string
      build: string
      runs: unknown[]
    }
    const raw = JSON.parse(readFileSync(join(FIXTURES, 'S05-03a-raw-1.json'), 'utf8')) as {
      run: number
      build: string
    }
    const vigil = JSON.parse(readFileSync(join(FIXTURES, 'S05-03a-vigil-1.json'), 'utf8')) as {
      run: number
    }
    expect(vigil.run).toBe(1)
    expect(results.runs[0]).toEqual(raw)
    expect(results.runs[1]).toEqual({ ...vigil, run: 2 })
    expect(results).toEqual({ subject: 'S05', build: raw.build, runs: results.runs })
  })

  it('reads as two runs through readRuns, and as one file the folder walk does not see twice', () => {
    expect(readRuns(RESULTS).map((run) => `${run.mode} ${run.run}`)).toEqual(['raw 1', 'vigil 2'])
    // The fixture sits in its own directory, so the eight run fixtures the other tests walk are
    // still eight — the walk lists a directory's `.json` files, never its subdirectories.
    expect(collectRunFiles([FIXTURES])).toHaveLength(8)
    expect(collectRunFiles([join(FIXTURES, 'results')])).toEqual([RESULTS])
  })

  it('writes both frames and the pair from one file, and --study counts runs rather than files', () => {
    const out = mkdtempSync(join(tmpdir(), 'vigil-replay-'))
    temps.push(out)
    const logged: string[] = []
    const printed = main([RESULTS, '--out', out], (line) => logged.push(line))
    expect(logged).toEqual([
      `${join(out, 'S05-03a-raw-1.svg')}: written\n`,
      `${join(out, 'S05-03a-vigil-2.svg')}: written\n`,
      `${join(out, 'pair-S05-03a.svg')}: written\n`,
    ])
    // The rows the two run files print, but for the run index the envelope re-indexed.
    const separate = main(
      [join(FIXTURES, 'S05-03a-raw-1.json'), join(FIXTURES, 'S05-03a-vigil-1.json'), '--out', out],
      () => {},
    )
    expect(printed).toBe(separate.replace('S05,03a,vigil,1,', 'S05,03a,vigil,2,'))
    // --study over a folder holding that one file: one file in, two runs measured (item 7).
    const study = mkdtempSync(join(tmpdir(), 'vigil-replay-'))
    temps.push(study)
    expect(main(['--study', join(FIXTURES, 'results'), '--out', study], () => {})).toBe(
      `${join(study, 'study.csv')}: 2 runs\n`,
    )
    expect(readFileSync(join(study, 'study.csv'), 'utf8')).toBe(printed)
  }, 30_000)
})
