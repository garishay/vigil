import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectRunFiles, DEFAULT_OUT, main, metricsOf, parseArgs } from './replay.ts'
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
    ])
    expect(collectRunFiles([join(FIXTURES, 'S03-02a-raw-1.json')])).toEqual([
      join(FIXTURES, 'S03-02a-raw-1.json'),
    ])
  })

  it('prints the CSV for named runs, and writes study.csv under --out for --study', () => {
    const printed = main([
      join(FIXTURES, 'S03-02a-vigil-1.json'),
      join(FIXTURES, 'S03-02a-raw-1.json'),
    ])
    const lines = printed.split('\n')
    expect(lines[0]).toBe(CSV_COLUMNS.join(','))
    expect(lines[1]).toMatch(/^S03,02a,raw,1,/)
    expect(lines[2]).toMatch(/^S03,02a,vigil,1,/)
    const out = mkdtempSync(join(tmpdir(), 'vigil-replay-'))
    temps.push(out)
    expect(main(['--study', FIXTURES, '--out', out])).toBe(`${join(out, 'study.csv')}: 4 runs\n`)
    const written = readFileSync(join(out, 'study.csv'), 'utf8')
    // The four fixture rows, byte for byte — the hand calculation on the PR (S5a's acceptance).
    expect(written).toBe(
      [
        CSV_COLUMNS.join(','),
        'S03,02a,raw,1,2.60.0+efac241-dirty,2026-09-15T23:38:09.494Z,58,1174,58,false,0,1,1,124,6,7,5',
        'S03,02a,vigil,1,2.60.0+efac241-dirty,2026-09-15T23:38:11.935Z,58,1174,58,false,0,1,2,124,6,7,5',
        'S04,02b,raw,1,2.60.0+c9c80e3,2026-09-16T00:31:10.057Z,58,1153,58,false,0,1,1,123,6,7,5',
        'S04,02b,vigil,1,2.60.0+c9c80e3,2026-09-16T00:31:12.777Z,58,1153,58,false,0,1,2,123,6,7,5',
        '',
      ].join('\n'),
    )
    expect(written).toBe(main([FIXTURES]))
  })

  it('builds one plan per scenario across the runs, and stops on a refused file with nothing written', () => {
    const metrics = metricsOf(collectRunFiles([FIXTURES]), study)
    expect(metrics.map((m) => `${m.subject} ${m.scenario} ${m.mode}`)).toEqual([
      'S03 02a raw',
      'S03 02a vigil',
      'S04 02b raw',
      'S04 02b vigil',
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
})
