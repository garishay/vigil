/**
 * The replay tool (S5, #138; #131): run JSON in, the study's numbers out — offline, the scenario
 * regenerated from its seed on the study recording's own frame grid, through the app's pure
 * modules and nothing reimplemented. S5a is the core and the CSV; S5b the frame per run; S5c
 * the Vigil annotations; S5d-i the pair; S5d-ii the study figure.
 *
 *   node tools/replay.ts <run.json> [more.json ...] [--out <dir>]
 *                                                          the CSV for those runs, printed;
 *                                                          each run's frame written under
 *                                                          --out as <subject>-<scenario>-<mode>-<run>.svg;
 *                                                          exactly two runs also write the pair,
 *                                                          pair-<subject>-<scenario>.svg — or,
 *                                                          for two scenarios of one family, the
 *                                                          subject sheet,
 *                                                          sheet-<subject>-<scenarioA>-<scenarioB>.svg
 *   node tools/replay.ts --study <dir | run.json ...> [--out <dir>]
 *                                                          study.csv and study.svg written under --out
 *
 * --out is study/ at the repo root by default, gitignored (ruled A8). A directory given as a
 * path is every `.json` file in it, in name order. A run file the loader refuses stops the tool
 * with the file and the field named; nothing is written.
 */

import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { csvText } from './replay/csv.ts'
import { studySvg } from './replay/figure.ts'
import { frameName, frameSvg } from './replay/frame.ts'
import { pairName, pairSvg } from './replay/pair.ts'
import { sheetName, sheetSvg } from './replay/sheet.ts'
import { loadStudy, planFor, readRun, type Study } from './replay/load.ts'
import { runMetrics, type RunMetrics } from './replay/metrics.ts'
import type { InjectPlan } from '../src/lib/injects.ts'
import type { RunRecord } from '../src/lib/run.ts'

export const DEFAULT_OUT = 'study'
/** The pair's Queue boxes show this many rows and count the rest; the run's own frame shows every row (S5d-i, ruled G2). */
export const PAIR_QUEUE_CAP = 5

export interface Args {
  study: boolean
  out: string
  paths: string[]
}

/** The command line, or a throw in so many words for a flag the tool does not know. */
export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { study: false, out: DEFAULT_OUT, paths: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--study') args.study = true
    else if (arg === '--out') {
      const out = argv[++i]
      if (out === undefined || out.startsWith('--')) throw new Error('--out names a directory')
      args.out = out
    } else if (arg.startsWith('--')) throw new Error(`unknown flag ${arg} — --study, --out <dir>`)
    else args.paths.push(arg)
  }
  if (args.paths.length === 0)
    throw new Error('no run file named — give a run JSON, or --study <dir>')
  return args
}

/** Each path as run files: a directory is its `.json` files in name order, a file is itself. */
export function collectRunFiles(paths: readonly string[]): string[] {
  return paths.flatMap((path) =>
    statSync(path).isDirectory()
      ? readdirSync(path)
          .filter((name) => name.endsWith('.json'))
          .sort()
          .map((name) => join(path, name))
      : [path],
  )
}

/** A run file read and measured, with its scenario's plan — built once per scenario. */
export interface Run {
  file: string
  record: RunRecord
  plan: InjectPlan
  metrics: RunMetrics
}

export function runsOf(files: readonly string[], study: Study = loadStudy()): Run[] {
  const plans = new Map<string, InjectPlan>()
  return files.map((file) => {
    const record = readRun(file)
    let plan = plans.get(record.scenario)
    if (plan === undefined) {
      plan = planFor(record.scenario, study.timeline)
      plans.set(record.scenario, plan)
    }
    return { file, record, plan, metrics: runMetrics(record, study.index, plan) }
  })
}

/** The metrics of every run file. */
export const metricsOf = (files: readonly string[], study: Study = loadStudy()): RunMetrics[] =>
  runsOf(files, study).map((run) => run.metrics)

/**
 * Two runs composed into one document: one scenario is the pair (S5d-i), two scenarios of one
 * family the subject sheet (S5e) — the unaided run left, the Vigil run right, whichever order
 * they were named in. Two of unlike families are refused in words by the sheet itself.
 */
function composite(runs: readonly Run[], study: Study, out: string): { out: string; svg: string } {
  const [first, second] = runs.map((run) => ({ ...run, study }))
  if (first.record.scenario === second.record.scenario) {
    return {
      out: join(out, pairName(first.record, second.record)),
      svg: pairSvg({ left: first, right: second }, { queueCap: PAIR_QUEUE_CAP }),
    }
  }
  const unaided = first.record.mode === 'raw' ? first : second
  const vigil = unaided === first ? second : first
  return {
    out: join(out, sheetName(unaided.record, vigil.record)),
    svg: sheetSvg({ unaided, vigil }, { queueCap: PAIR_QUEUE_CAP }),
  }
}

/**
 * The tool: the CSV on stdout for the runs named; without `--study`, each run's frame written
 * under `--out` too (S5b, ruled B5), the written files named through `log`; with `--study`,
 * `study.csv` written under `--out` instead.
 */
export function main(argv: readonly string[], log: (line: string) => void = () => {}): string {
  const args = parseArgs(argv)
  const files = collectRunFiles(args.paths)
  const study = loadStudy()
  const runs = runsOf(files, study)
  const csv = csvText(runs.map((run) => run.metrics))
  mkdirSync(args.out, { recursive: true })
  if (args.study) {
    const out = join(args.out, 'study.csv')
    const figure = join(args.out, 'study.svg')
    // The figure drawn before either file is written (S5d-ii).
    const svg = studySvg(runs.map((run) => run.metrics))
    writeFileSync(out, csv)
    writeFileSync(figure, svg)
    log(`${figure}: written\n`)
    return `${out}: ${files.length} run${files.length === 1 ? '' : 's'}\n`
  }
  // Every frame drawn, and every name checked, before anything is written: a run the frame
  // refuses, or two runs that would share a file, leaves no partial set behind (#151 round 1).
  const named = new Map<string, string>()
  const frames = runs.map((run) => {
    const name = frameName(run.record)
    const first = named.get(name)
    if (first !== undefined) {
      const { subject, scenario, mode, run: index } = run.record
      throw new Error(
        `${name}: two runs in this batch share subject ${subject}, scenario ${scenario}, mode ${mode}, run ${index} — ${first} and ${run.file}`,
      )
    }
    named.set(name, run.file)
    return { out: join(args.out, name), svg: frameSvg({ ...run, study }) }
  })
  // Exactly two runs: the pair too, or the subject sheet when the two are unlike scenarios of
  // one family (S5e) — drawn before anything is written, like the frames.
  const composed = runs.length === 2 ? composite(runs, study, args.out) : null
  for (const { out, svg } of [...frames, ...(composed ? [composed] : [])]) {
    writeFileSync(out, svg)
    log(`${out}: written\n`)
  }
  return csv
}

if (process.argv[1] && basename(process.argv[1]) === 'replay.ts') {
  try {
    process.stdout.write(main(process.argv.slice(2), (line) => process.stderr.write(line)))
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`)
    process.exitCode = 1
  }
}
