/**
 * The replay tool (S5, #138; #131): run JSON in, the study's numbers out — offline, the scenario
 * regenerated from its seed on the study recording's own frame grid, through the app's pure
 * modules and nothing reimplemented. S5a is the core and the CSV; the frames follow (S5b–S5d).
 *
 *   node tools/replay.ts <run.json> [more.json ...]        the CSV for those runs, printed
 *   node tools/replay.ts --study <dir | run.json ...> [--out <dir>]
 *                                                          study.csv written under --out —
 *                                                          study/ at the repo root by default,
 *                                                          gitignored (ruled A8)
 *
 * A directory given to --study is every `.json` file in it, in name order. A run file the
 * loader refuses stops the tool with the file and the field named; nothing is written.
 */

import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { csvText } from './replay/csv.ts'
import { loadStudy, planFor, readRun, type Study } from './replay/load.ts'
import { runMetrics, type RunMetrics } from './replay/metrics.ts'
import type { InjectPlan } from '../src/lib/injects.ts'

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

/** The metrics of every run file, the scenario's plan built once per scenario. */
export function metricsOf(files: readonly string[], study: Study = loadStudy()): RunMetrics[] {
  const plans = new Map<string, InjectPlan>()
  return files.map((file) => {
    const record = readRun(file)
    let plan = plans.get(record.scenario)
    if (plan === undefined) {
      plan = planFor(record.scenario, study.timeline)
      plans.set(record.scenario, plan)
    }
    return runMetrics(record, study.index, plan)
  })
}

export function main(argv: readonly string[]): string {
  const args = parseArgs(argv)
  const files = collectRunFiles(args.paths)
  const csv = csvText(metricsOf(files))
  if (!args.study) return csv
  mkdirSync(args.out, { recursive: true })
  const out = join(args.out, 'study.csv')
  writeFileSync(out, csv)
  return `${out}: ${files.length} run${files.length === 1 ? '' : 's'}\n`
}

if (process.argv[1] && basename(process.argv[1]) === 'replay.ts') {
  try {
    process.stdout.write(main(process.argv.slice(2)))
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`)
    process.exitCode = 1
  }
}
