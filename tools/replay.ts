/**
 * The replay tool (S5, #138; #131): run JSON in, the study's numbers out — offline, the scenario
 * regenerated from its seed on the study recording's own frame grid, through the app's pure
 * modules and nothing reimplemented. S5a is the core and the CSV; S5b the frame per run; the
 * Vigil annotations (S5c) and the pair and the study figure (S5d) follow.
 *
 *   node tools/replay.ts <run.json> [more.json ...] [--out <dir>]
 *                                                          the CSV for those runs, printed;
 *                                                          each run's frame written under
 *                                                          --out as <subject>-<scenario>-<mode>-<run>.svg
 *   node tools/replay.ts --study <dir | run.json ...> [--out <dir>]
 *                                                          study.csv written under --out
 *
 * --out is study/ at the repo root by default, gitignored (ruled A8). A directory given as a
 * path is every `.json` file in it, in name order. A run file the loader refuses stops the tool
 * with the file and the field named; nothing is written.
 */

import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { csvText } from './replay/csv.ts'
import { frameName, frameSvg } from './replay/frame.ts'
import { loadStudy, planFor, readRun, type Study } from './replay/load.ts'
import { runMetrics, type RunMetrics } from './replay/metrics.ts'
import type { InjectPlan } from '../src/lib/injects.ts'
import type { RunRecord } from '../src/lib/run.ts'

export const DEFAULT_OUT = 'study'

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
    writeFileSync(out, csv)
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
  for (const { out, svg } of frames) {
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
