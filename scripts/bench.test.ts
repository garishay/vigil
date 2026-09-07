// @vitest-environment node
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AO } from '../src/config/ao.ts'
import { RECORDINGS } from '../src/config/recordings.ts'
import { SCENARIO } from '../src/config/scenario.ts'
import { SCORING } from '../src/config/scoring.ts'
import type { AdsbCapture } from '../src/lib/adsb.ts'
import { injectTracksAt, planScenario, timelineOf } from '../src/lib/injects.ts'
import { rankTracks } from '../src/lib/ranking.ts'
import { historiesAt, indexCapture, memoryAt, originsOf, pictureAt } from '../src/lib/replay.ts'
import { clockStartOf, minuteOfDay } from '../src/lib/scoring.ts'
import {
  DEFAULT_SEEDS,
  OUT,
  benchSeeds,
  foldInject,
  foldReal,
  mergeConfig,
  parseArgs,
  renderBench,
  runBench,
  type InjectRun,
  type Recording,
} from './bench.ts'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

// Every committed recording, read as the script reads them.
const recordings: Recording[] = RECORDINGS.map((entry) => ({
  entry,
  capture: JSON.parse(readFileSync(join(repo, 'public', entry.file), 'utf8')) as AdsbCapture,
}))
const phl001 = recordings.slice(0, 1)

const inject = { behavior: 'loiter', remoteId: 'silent' } as const

describe('the seeds (A1)', () => {
  it('open with the scenario’s own seed and count N, all distinct', () => {
    const seeds = benchSeeds(DEFAULT_SEEDS)
    expect(seeds).toHaveLength(25)
    expect(seeds[0]).toBe(SCENARIO.seed)
    expect(seeds[1]).toBe(`${SCENARIO.seed}/bench-2`)
    expect(new Set(seeds).size).toBe(25)
  })
})

describe('the crossing fold (A3)', () => {
  it('stamps each band once, on the first upward crossing, and counts a re-entry as a flap', () => {
    const bands = ['calm', 'caution', 'warning', 'caution', 'warning', 'calm', 'caution'] as const
    let run: InjectRun | undefined
    bands.forEach((band, i) => {
      run = foldInject(run, inject, band, 100 + i * 10, 6 - i)
    })
    expect(run).toMatchObject({
      behavior: 'loiter',
      remoteId: 'silent',
      firstSeenS: 100,
      caution: { afterS: 10, rank: 5 },
      warning: { afterS: 20, rank: 4 },
      flaps: 2,
      last: 'caution',
    })
  })

  it('a track first seen in warning stamps both bands at 0 s; a calm → warning jump stamps both', () => {
    expect(foldInject(undefined, inject, 'warning', 300, 1)).toMatchObject({
      caution: { afterS: 0, rank: 1 },
      warning: { afterS: 0, rank: 1 },
      flaps: 0,
    })
    const jumped = foldInject(foldInject(undefined, inject, 'calm', 0, 9), inject, 'warning', 45, 2)
    expect(jumped.caution).toEqual({ afterS: 45, rank: 2 })
    expect(jumped.warning).toEqual({ afterS: 45, rank: 2 })
  })

  it('a re-ascent that skips a band re-enters both — one flap per band, whatever the tick rate (#117 review)', () => {
    const skipped = ['calm', 'caution', 'warning', 'calm', 'warning'] as const
    const stepped = ['calm', 'caution', 'warning', 'calm', 'caution', 'warning'] as const
    const fold = (bands: readonly ('calm' | 'caution' | 'warning')[]) =>
      bands.reduce<InjectRun | undefined>(
        (run, band, i) => foldInject(run, inject, band, i * 10, 1),
        undefined,
      )
    expect(fold(skipped)?.flaps).toBe(2)
    expect(fold(stepped)?.flaps).toBe(2)
  })

  it('a downward crossing moves nothing but the band last seen', () => {
    const down = foldInject(foldInject(undefined, inject, 'caution', 0, 3), inject, 'calm', 20, 8)
    expect(down).toMatchObject({
      caution: { afterS: 0, rank: 3 },
      warning: null,
      flaps: 0,
      last: 'calm',
    })
  })
})

describe('the real fold (A5)', () => {
  it('reads the uncapped composite on the chip’s whole-number rule, and keeps the highest band and max', () => {
    const track = { id: 'adsb-abc123', callsign: null }
    let run = foldReal(undefined, track, 20, SCORING.bands)
    expect(run).toEqual({ id: 'adsb-abc123', callsign: null, band: 'calm', maxUncapped: 20 })
    run = foldReal(run, { ...track, callsign: 'AAL1' }, 39.6, SCORING.bands)
    expect(run.band).toBe('caution')
    expect(run.callsign).toBe('AAL1')
    run = foldReal(run, track, 25, SCORING.bands)
    expect(run).toMatchObject({ band: 'caution', maxUncapped: 39.6, callsign: 'AAL1' })
  })
})

describe('the rank pin (A6)', () => {
  it('ranks every tick of seed 1 on 001 exactly as rankTracks ranks the full picture', () => {
    const { entry, capture } = recordings[0]
    const index = indexCapture(capture)
    const plan = planScenario(timelineOf(capture))
    const origins = originsOf(index, plan)
    const startLocal = clockStartOf(entry, capture, AO)
    let ticks = 0
    runBench(phl001, {
      seeds: 1,
      onTick: ({ tSec, ranked }) => {
        const tracks = [...pictureAt(index, tSec), ...injectTracksAt(plan, tSec)]
        const expected = rankTracks(tracks, AO.protectedSites, {
          tSec,
          minuteOfDay: minuteOfDay(startLocal, tSec),
          memory: memoryAt((t) => injectTracksAt(plan, t), plan.intervalS, tSec),
          history: historiesAt(index, plan, tracks, tSec, SCORING.pattern.windowS),
          friendly: AO.friendlyAreas,
          origins,
        })
        expect(ranked.map((e) => [e.track.id, e.rank, e.score.composite])).toEqual(
          expected.map((e) => [e.track.id, e.rank, e.score.composite]),
        )
        ticks++
      },
    })
    expect(ticks).toBe(index.durationS + 1)
  }, 60_000)
})

describe('the override (A7)', () => {
  it('merges key by key, replaces leaves, and refuses a key the config does not have', () => {
    const merged = mergeConfig(SCORING, { weights: { closing: 0 }, bands: { warning: 65 } })
    expect(merged.weights).toEqual({ ...SCORING.weights, closing: 0 })
    expect(merged.bands).toEqual({ caution: 40, warning: 65 })
    expect(merged.pattern).toBe(SCORING.pattern)
    expect(SCORING.weights.closing).toBe(20)
    expect(() => mergeConfig(SCORING, { weight: { closing: 0 } })).toThrow(
      'unknown config key: config.weight',
    )
    expect(() => mergeConfig(SCORING, { bands: { warn: 1 } })).toThrow('config.bands.warn')
    expect(() => mergeConfig(SCORING, [])).toThrow('config must be an object')
  })

  it('refuses a scalar over an object-valued key — the all-NaN, all-calm sweep (#117 review)', () => {
    expect(() => mergeConfig(SCORING, { weights: 20 })).toThrow('config.weights must be an object')
    expect(() => mergeConfig(SCORING, { pattern: { loiter: 5 } })).toThrow(
      'config.pattern.loiter must be an object',
    )
  })

  it('moves the table and names itself in the header', () => {
    const base = runBench(phl001, { seeds: 2 })
    const swept = runBench(phl001, {
      seeds: 2,
      config: mergeConfig(SCORING, { weights: { closing: 0, proximity: 0 } }),
      overridePath: 'sweep/no-geometry.json',
    })
    const warnings = (result: typeof base) =>
      result.recordings[0].injects.filter((run) => run.warning).length
    expect(warnings(swept)).toBeLessThan(warnings(base))
    expect(renderBench(swept)).toContain('with `sweep/no-geometry.json` merged over it')
    expect(renderBench(base)).toContain('as committed')
  }, 60_000)

  it('parses --seeds and --config, and --write never takes a config', () => {
    expect(parseArgs([])).toEqual({ seeds: DEFAULT_SEEDS, configPath: null, write: false })
    expect(parseArgs(['--seeds', '3', '--config', 'x.json'])).toEqual({
      seeds: 3,
      configPath: 'x.json',
      write: false,
    })
    expect(parseArgs(['--write']).write).toBe(true)
    expect(() => parseArgs(['--write', '--config', 'x.json'])).toThrow('--write takes no --config')
    // The baseline is the default run's — the seed count as much as the config (#117 review).
    expect(() => parseArgs(['--write', '--seeds', '3'])).toThrow('--write takes no --seeds')
    expect(() => parseArgs(['--seeds', 'many'])).toThrow('--seeds must be a whole number')
    expect(() => parseArgs(['--seeds'])).toThrow('--seeds needs a value')
    expect(() => parseArgs(['--fast'])).toThrow('unknown argument: --fast')
  })
})

describe('the baseline (A10, R4)', () => {
  it('renders the same bytes twice', () => {
    expect(renderBench(runBench(phl001, { seeds: 2 }))).toBe(
      renderBench(runBench(phl001, { seeds: 2 })),
    )
  }, 60_000)

  it('is exactly what the default run renders — a weight or a detector that moves regenerates it', () => {
    const committed = readFileSync(join(repo, OUT), 'utf8')
    expect(renderBench(runBench(recordings))).toBe(committed)
  }, 120_000)
})
