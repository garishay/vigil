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
import { loadStudy, RunRefusal } from './replay/load.ts'

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
    expect(main(['--study', FIXTURES, '--out', out])).toBe(`${join(out, 'study.csv')}: 8 runs\n`)
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
        'S05,03a,raw,1,2.60.0+80c9a10,2026-09-16T17:42:37.615Z,97,60,97,false,0,3,6,102,5,6,4,218,2,1,false,84,41,58,793,false,188',
        'S05,03a,vigil,1,2.60.0+80c9a10,2026-09-16T17:42:35.598Z,71,814,38,false,0,1,3,102,5,6,4,218,0,0,true,11,52,71,714,false,188',
        'S06,03b,raw,1,2.60.0+80c9a10,2026-09-16T17:42:39.634Z,179,-75,118,false,1,3,4,106,5,6,4,179,2,1,,95,,,,true,149',
        'S06,03b,vigil,1,2.60.0+80c9a10,2026-09-16T17:42:33.576Z,88,465,30,false,0,1,3,106,5,6,4,179,0,0,true,9,61,88,775,false,149',
        '',
      ].join('\n'),
    )
    expect(written).toBe(main([FIXTURES, '--out', frames]))
    expect(existsSync(join(frames, 'S04-02b-vigil-1.svg'))).toBe(true)
    expect(existsSync(join(frames, 'S06-03b-raw-1.svg'))).toBe(true)
    // Eight runs: no pair, and no study figure yet (S5d-ii).
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
    expect(pair).toContain('… 9 more above calm')
    // Two runs of unlike subject or scenario pair under both names.
    const unlike = mkdtempSync(join(tmpdir(), 'vigil-replay-'))
    temps.push(unlike)
    const unlikeLog: string[] = []
    main(
      [join(FIXTURES, 'S03-02a-raw-1.json'), join(FIXTURES, 'S05-03a-raw-1.json'), '--out', unlike],
      (line) => unlikeLog.push(line),
    )
    expect(unlikeLog.at(-1)).toBe(`${join(unlike, 'pair-S03-02a-S05-03a.svg')}: written\n`)
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
