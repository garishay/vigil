/**
 * The bench (#104, ruled): a deterministic scoreboard for the scoring engine, two-sided. Every
 * committed recording × N seeds, one-second ticks over each recording's clock through the seams
 * the app itself calls — the picture, the injects, the identity memory, the histories, the
 * origins, the scorer, the queue's own comparator — so a number here is a number the app would
 * show. Nothing is reimplemented.
 *
 * Per inject behavior: time from first seen to the first upward crossing into caution and into
 * warning, the inject's own queue rank at each, and the flap count — upward re-crossings into a
 * band already entered, the number #109 waits on. Per recording: every real aircraft whose
 * *uncapped* composite ever reaches caution or warning. Under the ceiling every ADS-B track sits
 * at 30, so the capped count is 0 by construction; the uncapped band is what the ceiling is
 * holding back, and the number that tunes.
 *
 * The generator's labels — `behavior`, `remoteId` — are the oracle here, the one place outside
 * tests they are read (R3). They never reach `src/`.
 *
 * Real scores are seed-independent — no factor reads another track — so the real layer is
 * scored once per tick per recording and each seed scores only its injects; the union is ranked
 * by `queueOrder`. The seed-1 pin in `bench.test.ts` holds that equal to `rankTracks` over the
 * full picture on every tick, permanently: a future factor that reads another track fails it.
 *
 * Run: `npm run bench` prints the table; `npm run bench:baseline` writes `docs/bench/baseline.md`,
 * which a test holds the default run to byte for byte, so CI fails on any diff. `--seeds N` sets
 * the count; `--config file.json` merges a partial scoring config over the committed one for a
 * sweep, printed and never written.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { AO } from '../src/config/ao.ts'
import { RECORDINGS, type RecordingEntry } from '../src/config/recordings.ts'
import { SCENARIO } from '../src/config/scenario.ts'
import { SCORING, type Band, type ScoringConfig } from '../src/config/scoring.ts'
import type { AdsbCapture } from '../src/lib/adsb.ts'
import {
  BEHAVIORS,
  REMOTE_ID_STATES,
  injectTracksAt,
  planScenario,
  timelineOf,
} from '../src/lib/injects.ts'
import { queueOrder, type RankedTrack } from '../src/lib/ranking.ts'
import { historiesAt, indexCapture, memoryAt, originsOf, pictureAt } from '../src/lib/replay.ts'
import { bandOf, clockStartOf, minuteOfDay, scoreTrack } from '../src/lib/scoring.ts'
import type { Behavior, RemoteIdStatus } from '../src/lib/tracks.ts'

export const OUT = 'docs/bench/baseline.md'
export const DEFAULT_SEEDS = 25

export interface Recording {
  entry: RecordingEntry
  capture: AdsbCapture
}

export interface Crossing {
  /** Seconds after the inject was first seen. */
  afterS: number
  /** The inject's own queue position at that tick, both layers ranked. */
  rank: number
}

/** One inject's run under one seed on one recording, folded tick by tick. */
export interface InjectRun {
  behavior: Behavior
  remoteId: RemoteIdStatus
  firstSeenS: number
  caution: Crossing | null
  warning: Crossing | null
  flaps: number
  /** The band the bench last saw — the record's rule: the tick against what was last seen. */
  last: Band
}

/** One real aircraft's run on a recording: the highest uncapped band it reached, and where. */
export interface RealRun {
  id: string
  callsign: string | null
  band: Band
  maxUncapped: number
}

export interface RecordingResult {
  id: string
  aircraft: number
  injects: InjectRun[]
  real: RealRun[]
}

export interface BenchResult {
  seeds: string[]
  overridePath: string | null
  recordings: RecordingResult[]
}

export interface BenchOptions {
  seeds?: number
  config?: ScoringConfig
  overridePath?: string | null
  /** Every tick's queue, for the pin — the bench's own ranking, as it folded it. */
  onTick?: (tick: { recording: string; seed: string; tSec: number; ranked: RankedTrack[] }) => void
}

const BAND_RANK: Record<Band, number> = { calm: 0, caution: 1, warning: 2 }

/** Seed 1 is the scenario's own, so the first run is the golden's picture; the rest derive from it. */
export function benchSeeds(count: number, scenarioSeed = SCENARIO.seed): string[] {
  return Array.from({ length: count }, (_, i) =>
    i === 0 ? scenarioSeed : `${scenarioSeed}/bench-${i + 1}`,
  )
}

/**
 * The crossing fold for one inject at one tick. The first upward entry into a band stamps its
 * time and rank; a calm → warning jump stamps both; a track first seen in a band stamps 0 s.
 * An upward crossing into a band already entered is a flap. Downward crossings only move `last`.
 */
export function foldInject(
  run: InjectRun | undefined,
  track: { behavior: Behavior; remoteId: RemoteIdStatus },
  band: Band,
  tSec: number,
  rank: number,
): InjectRun {
  if (!run) {
    const opened: InjectRun = {
      behavior: track.behavior,
      remoteId: track.remoteId,
      firstSeenS: tSec,
      caution: null,
      warning: null,
      flaps: 0,
      last: band,
    }
    if (band !== 'calm') opened.caution = { afterS: 0, rank }
    if (band === 'warning') opened.warning = { afterS: 0, rank }
    return opened
  }
  if (band === run.last) return run
  const next = { ...run, last: band }
  if (BAND_RANK[band] < BAND_RANK[run.last]) return next
  const crossing = { afterS: tSec - run.firstSeenS, rank }
  if (band === 'warning') {
    if (next.caution === null) next.caution = crossing
    if (next.warning === null) next.warning = crossing
    else next.flaps++
  } else if (next.caution === null) next.caution = crossing
  else next.flaps++
  return next
}

/** The real fold: the band the uncapped composite lands in, on the chip's whole-number rule. */
export function foldReal(
  run: RealRun | undefined,
  track: { id: string; callsign: string | null },
  uncapped: number,
  bands: ScoringConfig['bands'],
): RealRun {
  const band = bandOf(Math.round(uncapped), bands)
  if (!run) return { id: track.id, callsign: track.callsign, band, maxUncapped: uncapped }
  return {
    id: run.id,
    callsign: run.callsign ?? track.callsign,
    band: BAND_RANK[band] > BAND_RANK[run.band] ? band : run.band,
    maxUncapped: Math.max(run.maxUncapped, uncapped),
  }
}

/**
 * A partial config over the committed one, key by key: an object merges, anything else replaces.
 * A key the config does not have is refused by name — a sweep file with a typo must not pass as
 * the default.
 */
export function mergeConfig<T extends object>(base: T, override: unknown, path = 'config'): T {
  if (typeof override !== 'object' || override === null || Array.isArray(override)) {
    throw new Error(`${path} must be an object`)
  }
  const out = { ...base } as Record<string, unknown>
  for (const [key, value] of Object.entries(override)) {
    if (!(key in out)) throw new Error(`unknown config key: ${path}.${key}`)
    const current = out[key]
    out[key] =
      typeof current === 'object' && current !== null && typeof value === 'object'
        ? mergeConfig(current, value, `${path}.${key}`)
        : value
  }
  return out as T
}

/** The bench over the given recordings — the CLI passes every committed one (R1). */
export function runBench(
  recordings: readonly Recording[],
  options: BenchOptions = {},
): BenchResult {
  const config = options.config ?? SCORING
  const seeds = benchSeeds(options.seeds ?? DEFAULT_SEEDS)
  const sites = AO.protectedSites
  const areas = AO.friendlyAreas
  const results = recordings.map(({ entry, capture }): RecordingResult => {
    const index = indexCapture(capture)
    const startLocal = clockStartOf(entry, capture, AO)
    const realOrigins = originsOf(index, null)
    // The real layer once per tick: its scores depend on nothing a seed changes.
    const realByTick: Omit<RankedTrack, 'rank'>[][] = []
    const reals = new Map<string, RealRun>()
    for (let tSec = 0; tSec <= index.durationS; tSec++) {
      const adsb = pictureAt(index, tSec)
      const context = {
        tSec,
        minuteOfDay: minuteOfDay(startLocal, tSec),
        memory: {},
        history: historiesAt(index, null, adsb, tSec, config.pattern.windowS),
        friendly: areas,
        origins: realOrigins,
        config,
      }
      realByTick.push(
        adsb.map((track) => {
          const score = scoreTrack(track, sites, context)
          reals.set(track.id, foldReal(reals.get(track.id), track, score.uncapped, config.bands))
          return { track, score, rangeM: score.rangeM, siteId: score.siteId }
        }),
      )
    }
    const injects: InjectRun[] = []
    for (const seed of seeds) {
      const plan = planScenario(timelineOf(capture), { ...SCENARIO, seed })
      const origins = originsOf(index, plan)
      const runs = new Map<string, InjectRun>()
      for (let tSec = 0; tSec <= index.durationS; tSec++) {
        const layer = injectTracksAt(plan, tSec)
        const context = {
          tSec,
          minuteOfDay: minuteOfDay(startLocal, tSec),
          memory: memoryAt((t) => injectTracksAt(plan, t), plan.intervalS, tSec),
          history: historiesAt(index, plan, layer, tSec, config.pattern.windowS),
          friendly: areas,
          origins,
          config,
        }
        const scored: Omit<RankedTrack, 'rank'>[] = layer.map((track) => {
          const score = scoreTrack(track, sites, context)
          return { track, score, rangeM: score.rangeM, siteId: score.siteId }
        })
        const ranked = [...realByTick[tSec], ...scored]
          .sort(queueOrder)
          .map((e, i) => ({ ...e, rank: i + 1 }))
        options.onTick?.({ recording: entry.id, seed, tSec, ranked })
        for (const e of ranked) {
          if (e.track.source !== 'inject') continue
          const band = bandOf(Math.round(e.score.composite), config.bands)
          runs.set(e.track.id, foldInject(runs.get(e.track.id), e.track, band, tSec, e.rank))
        }
      }
      injects.push(...runs.values())
    }
    const real = [...reals.values()]
      .filter((run) => run.band !== 'calm')
      .sort((a, b) => b.maxUncapped - a.maxUncapped || (a.id < b.id ? -1 : 1))
    return { id: entry.id, aircraft: reals.size, injects, real }
  })
  return { seeds, overridePath: options.overridePath ?? null, recordings: results }
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const mean = (xs: number[]) => Math.round(xs.reduce((sum, x) => sum + x, 0) / xs.length)
const spread = (xs: number[], show: (x: number) => string) =>
  xs.length === 0 ? '—' : [Math.min(...xs), mean(xs), Math.max(...xs)].map(show).join(' / ')

function crossingCells(runs: InjectRun[], band: 'caution' | 'warning'): string {
  const crossings = runs.flatMap((run) => (run[band] ? [run[band]] : []))
  const times = spread(
    crossings.map((c) => c.afterS),
    mmss,
  )
  const ranks = spread(
    crossings.map((c) => c.rank),
    String,
  )
  return `${times} | ${crossings.length}/${runs.length} | ${ranks}`
}

/** The table as Markdown — the baseline's bytes, and what `npm run bench` prints. */
export function renderBench(result: BenchResult): string {
  const lines = [
    '# Bench baseline',
    '',
    'Generated by `npm run bench:baseline` — never hand-edit; a weight or a detector that moves carries its regenerated table, and the review reads the diff (#104).',
    `Config: \`src/config/scoring.ts\`${result.overridePath ? ` with \`${result.overridePath}\` merged over it` : ' as committed'}. ${result.seeds.length} seeds × ${result.recordings.length} recordings · one-second ticks over each recording's clock · config sites, no friendly areas.`,
    "A crossing is the first upward crossing; a flap is an upward re-crossing into a band already entered. Times are m:ss from the inject's first tick; rank is the crossing inject's own queue position, both layers ranked. Real aircraft read the uncapped composite — under the ceiling every one sits at 30.",
  ]
  for (const recording of result.recordings) {
    lines.push(
      '',
      `## ${recording.id} — injects (${recording.injects.length} over ${result.seeds.length} seeds)`,
      '',
      '| behavior | n | to caution min / mean / max | reached | rank at caution min / mean / max | to warning min / mean / max | reached | rank at warning min / mean / max | flaps total / max |',
      '|---|---|---|---|---|---|---|---|---|',
    )
    for (const behavior of BEHAVIORS) {
      const runs = recording.injects.filter((run) => run.behavior === behavior)
      const flaps = runs.map((run) => run.flaps)
      lines.push(
        `| ${behavior} | ${runs.length} | ${crossingCells(runs, 'caution')} | ${crossingCells(runs, 'warning')} | ${flaps.reduce((a, b) => a + b, 0)} / ${Math.max(0, ...flaps)} |`,
      )
    }
    const states = REMOTE_ID_STATES.map((state) => {
      const runs = recording.injects.filter((run) => run.remoteId === state)
      const reached = (band: 'caution' | 'warning') => runs.filter((run) => run[band]).length
      return `${state}: n ${runs.length} · caution ${reached('caution')} · warning ${reached('warning')} · flaps ${runs.reduce((sum, run) => sum + run.flaps, 0)}`
    })
    lines.push('', `By Remote ID state — ${states.join(' · ')}`)
    const count = (band: Band) => recording.real.filter((run) => run.band === band).length
    lines.push(
      '',
      `## ${recording.id} — real aircraft (uncapped composite)`,
      '',
      `${recording.aircraft} aircraft · caution ${count('caution')} · warning ${count('warning')}`,
      '',
      '| track | callsign | band | max uncapped |',
      '|---|---|---|---|',
      ...recording.real.map(
        (run) =>
          `| ${run.id} | ${run.callsign ?? '—'} | ${run.band} | ${run.maxUncapped.toFixed(1)} |`,
      ),
    )
  }
  return `${lines.join('\n')}\n`
}

export interface Args {
  seeds: number
  configPath: string | null
  write: boolean
}

/** `--seeds N`, `--config file.json`, `--write` — the baseline is only ever the committed config's. */
export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { seeds: DEFAULT_SEEDS, configPath: null, write: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--write') args.write = true
    else if (arg === '--seeds' || arg === '--config') {
      const value = argv[++i]
      if (value === undefined) throw new Error(`${arg} needs a value`)
      if (arg === '--config') args.configPath = value
      else {
        args.seeds = Number(value)
        if (!Number.isInteger(args.seeds) || args.seeds < 1)
          throw new Error(`--seeds must be a whole number, got "${value}"`)
      }
    } else throw new Error(`unknown argument: ${arg}`)
  }
  if (args.write && args.configPath !== null) {
    throw new Error("--write takes no --config: the baseline is the committed config's")
  }
  return args
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const config = args.configPath
    ? mergeConfig(SCORING, JSON.parse(readFileSync(args.configPath, 'utf8')))
    : SCORING
  // Every committed recording, always — the seed count is the only knob (R1).
  const recordings = RECORDINGS.map((entry) => ({
    entry,
    capture: JSON.parse(readFileSync(`public/${entry.file}`, 'utf8')) as AdsbCapture,
  }))
  const started = performance.now()
  const table = renderBench(
    runBench(recordings, { seeds: args.seeds, config, overridePath: args.configPath }),
  )
  const elapsed = ((performance.now() - started) / 1000).toFixed(1)
  if (args.write) {
    writeFileSync(OUT, table, 'utf8')
    console.log(`Wrote ${OUT} in ${elapsed} s`)
  } else {
    process.stdout.write(table)
    console.error(`bench: ${elapsed} s`)
  }
}

if (process.argv[1] && basename(process.argv[1]) === 'bench.ts') {
  try {
    main()
  } catch (error) {
    console.error((error as Error).message)
    process.exitCode = 1
  }
}
