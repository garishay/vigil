import { describe, expect, it } from 'vitest'
import { AO } from './ao'
import { SCENARIO, type CastEntry, type Placement, type ScenarioConfig } from './scenario'
import { SCENARIOS, scenarioNamed } from './scenarios'
import { SCENARIO_02A } from './scenarios/02a'
import { ROTATION_02B_DEG, SCENARIO_02B } from './scenarios/02b'
import { HOVER_LEG_M, LEG_M, along, at, rotated } from './scenarios/cast'
import { SCORING } from './scoring'
import type { AdsbCapture } from '../lib/adsb'
import { scenarioFeed } from '../lib/feeds'
import { destinationPoint, distanceMeters } from '../lib/geo'
import { gridTimeline, injectTracksAt, planScenario, timelineOf } from '../lib/injects'
import { entryAt } from '../lib/projection'
import { historiesAt, indexCapture, memoryAt, originsOf } from '../lib/replay'
import { bandOf, scoreTrack } from '../lib/scoring'
import type { InjectTrack } from '../lib/tracks'

const SITE = AO.protectedSites[0]
const C = AO.center
/** The study window on 002 (#131 D3; the S3 gate's check 4): Begin at 480 s, a 360 s run. */
const T0 = 480
const RUN = 360
const place = (p: Placement) => destinationPoint(C, p.bearingDeg, p.rangeKm * 1000)
const rangeOf = (p: Placement) => distanceMeters(C, place(p))
const cast = (config: ScenarioConfig) => config.cast ?? []
const STUDY = [SCENARIO_02A, SCENARIO_02B]

const kind = (entry: CastEntry) =>
  entry.behavior === 'transit-orbit'
    ? 'threat'
    : entry.behavior === 'return-to-launch'
      ? 'returning'
      : entry.speedKt === 1
        ? 'hover'
        : entry.remoteId === 'silent'
          ? distanceMeters(place(entry.from), place(entry.to)) < LEG_M / 2
            ? 'shuttle'
            : 'silent mover'
          : 'mover'

describe('the scenario registry (S3b, #135, ruled A5; #36 [26] A)', () => {
  it('lists default — the default deal — first, then the two study files; an unknown name is refused', () => {
    expect(SCENARIOS.map((scenario) => scenario.name)).toEqual(['default', '02a', '02b'])
    expect(SCENARIOS[0].config).toBe(SCENARIO)
    expect(scenarioNamed('02a').config).toBe(SCENARIO_02A)
    expect(scenarioNamed('02b').config).toBe(SCENARIO_02B)
    expect(() => scenarioNamed('03')).toThrow('No scenario named "03"')
    // The seeds are the study's, never a recording id (ruled on #135).
    expect(SCENARIO_02A.seed).toBe('study-02a')
    expect(SCENARIO_02B.seed).toBe('study-02b')
  })
})

describe('the study casts 02a and 02b (S3b, #135, ruled)', () => {
  it('are cast-only, thirty rows numbered from inject-11, in the composition ruled at the gate', () => {
    for (const config of STUDY) {
      expect(config.minInjects).toBe(0)
      expect(config.maxInjects).toBe(0)
      expect(cast(config)).toHaveLength(30)
      const kinds = cast(config).map(kind)
      expect(kinds.filter((k) => k === 'threat')).toHaveLength(1)
      expect(kinds.filter((k) => k === 'shuttle')).toHaveLength(1)
      expect(kinds.filter((k) => k === 'silent mover')).toHaveLength(4)
      expect(kinds.filter((k) => k === 'returning')).toHaveLength(3)
      expect(kinds.filter((k) => k === 'hover')).toHaveLength(15)
      expect(kinds.filter((k) => k === 'mover')).toHaveLength(6)
      // 24 heard, 5 silent, 1 threat.
      expect(cast(config).filter((e) => e.remoteId === 'silent')).toHaveLength(5)
      expect(cast(config).filter((e) => e.remoteId === 'broadcasting')).toHaveLength(25)
      const plan = scenarioFeed(timelineOf(CAPTURE), config).plan
      expect(plan.specs.map((spec) => spec.id)).toEqual(
        Array.from({ length: 30 }, (_, i) => `inject-${11 + i}`),
      )
    }
  })

  it('hold the three rules: startS 481 on 02a’s threat, hovers at 9.0 km or beyond, far silents at 13 km or beyond', () => {
    expect(cast(SCENARIO_02A)[0]).toMatchObject({ behavior: 'transit-orbit', startS: 481 })
    for (const config of STUDY) {
      for (const entry of cast(config)) {
        if (entry.behavior !== 'shuttle') continue
        if (kind(entry) === 'hover') {
          expect(entry.from.rangeKm).toBeGreaterThanOrEqual(9)
          // The leg is outward: the far end no nearer than the placement, 30 m long.
          expect(rangeOf(entry.to)).toBeGreaterThanOrEqual(rangeOf(entry.from) - 1)
          expect(distanceMeters(place(entry.from), place(entry.to))).toBeCloseTo(HOVER_LEG_M, -1)
        }
        if (kind(entry) === 'silent mover' && entry.speedKt !== 8) {
          expect(entry.from.rangeKm).toBeGreaterThanOrEqual(13)
        }
      }
      const hovers = cast(config).filter((e) => kind(e) === 'hover')
      expect(Math.min(...hovers.map((e) => e.from.rangeKm))).toBe(9.0)
      expect(Math.max(...hovers.map((e) => e.from.rangeKm))).toBe(12.0)
    }
  })

  it('place every entry outside the ring and inside the AO — its far end and pad too', () => {
    const [w, s, e, n] = AO.bbox
    const inside = (p: Placement) => {
      const [lon, lat] = place(p)
      return lon >= w && lon <= e && lat >= s && lat <= n
    }
    for (const config of STUDY) {
      for (const entry of cast(config)) {
        expect(rangeOf(entry.from)).toBeGreaterThan(SITE.radiusM)
        expect(inside(entry.from)).toBe(true)
        if (entry.behavior === 'shuttle') expect(inside(entry.to)).toBe(true)
        if (entry.behavior === 'return-to-launch') {
          expect(rangeOf(entry.pad)).toBeGreaterThan(SITE.radiusM)
          expect(inside(entry.pad)).toBe(true)
        }
      }
    }
  })

  it('02b is 02a turned 225° about the centre, the threat aside — and its threat is the ruled one', () => {
    expect(ROTATION_02B_DEG).toBe(225)
    expect(cast(SCENARIO_02B).slice(1)).toEqual(
      cast(SCENARIO_02A)
        .slice(1)
        .map((entry) => rotated(entry, 225)),
    )
    // 02a's: a new track on the first tick after Begin, lying from its first frame.
    expect(cast(SCENARIO_02A)[0]).toEqual({
      behavior: 'transit-orbit',
      remoteId: 'broadcasting',
      label: 'UAS-8F21',
      speedKt: 35,
      altitudeFt: 200,
      startS: 481,
      from: at(245, 7.2),
      courseDeg: 65,
      orbit: { center: at(240, 3.0), radiusM: 800 },
      broadcastOffset: { bearingDeg: 90, distanceM: 1100 },
    })
    // 02b's: in the picture from t = 0, heard and consistent, the lie from T0 + 30 s.
    expect(cast(SCENARIO_02B)[0]).toEqual({
      behavior: 'transit-orbit',
      remoteId: 'broadcasting',
      label: 'UAS-8F21',
      speedKt: 35,
      altitudeFt: 200,
      from: at(110, 15.84),
      courseDeg: 290,
      orbit: { center: at(105, 3.0), radiusM: 800 },
      broadcastOffset: { bearingDeg: 90, distanceM: 1100, fromS: 510 },
    })
    // The offset is clear of both association thresholds and of the feed's guard: 100 m over
    // the scorer's 1 000 m, 400 m under raw's 1 500 m.
    expect(SCORING.cooperativity.mismatchM).toBe(1000)
    expect(1100 - SCORING.cooperativity.mismatchM).toBeGreaterThanOrEqual(100)
    expect(1500 - 1100).toBeGreaterThanOrEqual(100)
  })

  it('a leg’s far end is where the plane says, to a tenth of a degree and a metre', () => {
    // 12 km due east of a point 5 km north of the centre: 13 km out on 067.4°.
    expect(along(at(0, 5), 90, 12_000)).toEqual({ bearingDeg: 67.4, rangeKm: 13 })
    expect(along(at(180, 10), 180, 30)).toEqual({ bearingDeg: 180, rangeKm: 10.03 })
  })
})

/** An empty recording on 002's grid: 80 frames at 15 s, so the histories and the memory fold run. */
const CAPTURE: AdsbCapture = {
  ao: 'phl',
  source: 'adsb.lol v2',
  capturedAt: '2026-09-04T22:02:11.000Z',
  intervalMs: 15000,
  bbox: AO.bbox,
  frames: Array.from({ length: 80 }, (_, i) => ({ tMs: i * 15000, records: [] })),
}

interface Tick {
  tSec: number
  scored: { track: InjectTrack; composite: number; band: string; rank: number }[]
}

/** The scenario through the feed, scored on the 1 Hz grid as the app and the bench do, ranked among the injects. */
function fold(config: ScenarioConfig, from: number, to: number): Tick[] {
  const index = indexCapture(CAPTURE)
  const feed = scenarioFeed(timelineOf(CAPTURE), config)
  const plan = feed.plan
  const origins = originsOf(index, plan)
  const ticks: Tick[] = []
  for (let tSec = from; tSec <= to; tSec++) {
    const layer = feed.pictureAt(tSec)
    const context = {
      tSec,
      // 002 opens at 18:02 local; the run sits inside operating hours, so the clock reads 0.
      minuteOfDay: 18 * 60 + 2 + Math.floor(tSec / 60),
      memory: memoryAt((t) => injectTracksAt(plan, t), plan.intervalS, tSec),
      history: historiesAt(index, plan, layer, tSec, SCORING.pattern.windowS),
      origins,
    }
    const scored = layer
      .map((track) => {
        const score = scoreTrack(track, AO.protectedSites, context)
        return {
          track,
          composite: score.composite,
          band: bandOf(Math.round(score.composite), SCORING.bands),
        }
      })
      .sort((a, b) => b.composite - a.composite)
      .map((entry, i) => ({ ...entry, rank: i + 1 }))
    ticks.push({ tSec, scored })
  }
  return ticks
}

const of = (tick: Tick, id: string) => tick.scored.find((s) => s.track.id === id)
/** The range from the centre, or Infinity on a tick the track is absent from. */
const rangeAt = (tick: Tick, id: string) => {
  const s = of(tick, id)
  return s ? distanceMeters(C, s.track.position) : Infinity
}

describe('the study casts on the 1 Hz grid, through the feed (S3b, #135, ruled)', () => {
  it('02a: the threat appears on the first tick after Begin, opens warning at rank 1, and enters the ring at 604 s', () => {
    const ticks = fold(SCENARIO_02A, T0, T0 + RUN)
    expect(of(ticks[0], 'inject-11')).toBeUndefined()
    const first = of(ticks[1], 'inject-11')!
    expect(ticks[1].tSec).toBe(481)
    expect(first).toMatchObject({ band: 'warning', rank: 1 })
    expect(first.track).toMatchObject({ identity: 'non-cooperative', callsign: null })
    expect(first.track.broadcast?.label).toBe('UAS-8F21')
    expect(rangeAt(ticks[1], 'inject-11')).toBeCloseTo(7200, -2)
    const entered = ticks.find((t) => rangeAt(t, 'inject-11') <= SITE.radiusM)!
    expect(entered.tSec).toBe(604)
    // Warning on every tick of the run, never a flap; rank 1 throughout.
    for (const tick of ticks.slice(1))
      expect(of(tick, 'inject-11')).toMatchObject({ band: 'warning', rank: 1 })
  }, 60_000)

  it('02b: the threat is heard and consistent from t = 0, 7.2 km at T0 with 122 s to entry; its lie starts at 510 s, and it crosses warning on that tick with 92 s to entry, the ident withheld from it', () => {
    const before = fold(SCENARIO_02B, T0, 509)
    const at480 = of(before[0], 'inject-11')!
    expect(at480.track).toMatchObject({ identity: 'cooperative', callsign: 'UAS-8F21' })
    expect(rangeAt(before[0], 'inject-11')).toBeCloseTo(7200, -2)
    const entry = entryAt(at480.track, SITE)
    expect(entry.kind).toBe('entry')
    if (entry.kind === 'entry') expect(Math.round(entry.tSec)).toBe(122)
    for (const tick of before) expect(of(tick, 'inject-11')!.band).toBe('caution')
    const ticks = fold(SCENARIO_02B, 510, T0 + RUN)
    const crossing = of(ticks[0], 'inject-11')!
    expect(ticks[0].tSec).toBe(510)
    expect(crossing).toMatchObject({ band: 'warning', rank: 1 })
    expect(crossing.track).toMatchObject({ identity: 'non-cooperative', callsign: null })
    const atCrossing = entryAt(crossing.track, SITE)
    if (atCrossing.kind === 'entry') expect(Math.round(atCrossing.tSec)).toBe(92)
    expect(atCrossing.kind).toBe('entry')
    // Rank 1 from the crossing by 5 or more over every other inject, on every tick of the run.
    for (const tick of ticks) {
      const [top, next] = tick.scored
      expect(top.track.id).toBe('inject-11')
      expect(Math.round(top.composite) - Math.round(next.composite)).toBeGreaterThanOrEqual(5)
    }
    const entered = ticks.find((t) => rangeAt(t, 'inject-11') <= SITE.radiusM)!
    expect(entered.tSec).toBe(603)
  }, 60_000)

  it('no decoy enters the ring inside the run; the closing drone reads caution throughout it and meets the ring after 900 s', () => {
    for (const config of STUDY) {
      const ticks = fold(config, T0, T0 + RUN)
      const decoys = cast(config)
        .map((_, i) => `inject-${11 + i}`)
        .filter((id) => id !== 'inject-11')
      for (const tick of ticks) {
        for (const id of decoys) {
          const s = of(tick, id)
          if (!s) continue
          expect(distanceMeters(C, s.track.position)).toBeGreaterThan(SITE.radiusM)
          expect(s.band).not.toBe('warning')
        }
        // The closing drone, #37: caution on every tick, its closing at 50 or more — the audit's word.
        const drone = of(tick, 'inject-37')!
        expect(drone.band).toBe('caution')
      }
      const late = fold(config, 900, 960)
      const entered = late.find((t) => rangeAt(t, 'inject-37') <= SITE.radiusM)
      expect(entered).toBeDefined()
      expect(entered!.tSec).toBeGreaterThanOrEqual(900)
      expect(rangeAt(ticks[0], 'inject-37')).toBeCloseTo(6800, -2)
      const closing = scoreTrack(of(ticks[0], 'inject-37')!.track, AO.protectedSites, {
        tSec: T0,
        minuteOfDay: 18 * 60 + 10,
        memory: {},
      }).factors[1].value
      expect(closing).toBeGreaterThanOrEqual(50)
    }
  }, 120_000)

  it('the above-calm set is four at Begin + 1 — the threat, the shuttle, the low-and-slow, the closing drone — and at most five in the run, a return joining for its 40 s; the hovers and far silents read calm', () => {
    for (const config of STUDY) {
      const ticks = fold(config, T0, T0 + RUN)
      const above = (tick: Tick) =>
        tick.scored.filter((s) => s.band !== 'calm').map((s) => s.track.id)
      // At 480 s 02a's threat is not yet in the picture; 02b's is, heard and caution.
      expect(above(ticks[0]).sort()).toEqual(
        config === SCENARIO_02A
          ? ['inject-12', 'inject-13', 'inject-37']
          : ['inject-11', 'inject-12', 'inject-13', 'inject-37'],
      )
      expect(above(ticks[1]).sort()).toEqual(['inject-11', 'inject-12', 'inject-13', 'inject-37'])
      expect(Math.max(...ticks.map((t) => above(t).length))).toBe(5)
      const returns = ['inject-17', 'inject-18', 'inject-19']
      for (const tick of ticks) {
        for (const id of above(tick)) {
          expect(['inject-11', 'inject-12', 'inject-13', 'inject-37', ...returns]).toContain(id)
        }
        // Hovers (20–34) and far silents (14–16): calm on every tick.
        for (let i = 14; i <= 34; i++) {
          if (i >= 17 && i <= 19) continue
          expect(of(tick, `inject-${i}`)!.band).toBe('calm')
        }
      }
    }
  }, 120_000)
})

describe('the movers never turn inside the recording (#145 round 1)', () => {
  it('lays a leg past what 20 kt flies in 1 185 s, and every mover holds its heading from the first frame to the last', () => {
    // 002 is 80 frames at 15 s — 1 185 s; at 20 kt that is 12.2 km. A 12 km leg ran out 19 s
    // early and two movers turned around; the leg is 13 km, and the heading at the last tick is
    // the heading at the first, for every straight mover of both casts (the 1 km shuttle turns
    // by design; a hover's leg is 30 m).
    const lastS = 79 * 15
    expect(LEG_M).toBeGreaterThan(20 * 0.514444 * lastS)
    for (const config of STUDY) {
      const plan = planScenario(gridTimeline(80, 15000), config)
      const movers = cast(config)
        .map((entry, i) => ({ entry, id: `inject-${11 + i}` }))
        .filter(({ entry }) => kind(entry) === 'mover' || kind(entry) === 'silent mover')
      expect(movers).toHaveLength(10)
      for (const { id } of movers) {
        const first = injectTracksAt(plan, 0).find((track) => track.id === id)!
        const last = injectTracksAt(plan, lastS).find((track) => track.id === id)!
        expect(last.headingDeg).toBeCloseTo(first.headingDeg!, 0)
      }
    }
  })
})

describe('the rotation turns a broadcast offset with the track (#145 round 2)', () => {
  it('keeps the lie on the same side of its track: 02a’s threat turned 225° claims its broadcast on 315°, not 90°', () => {
    const turned = rotated(cast(SCENARIO_02A)[0], 225)
    expect(turned).toMatchObject({
      from: at(110, 7.2),
      courseDeg: 290,
      orbit: { center: at(105, 3.0), radiusM: 800 },
      broadcastOffset: { bearingDeg: 315, distanceM: 1100 },
    })
    // An entry without an offset is turned as before, and nothing else on the entry moves.
    expect(rotated(cast(SCENARIO_02A)[1], 225).broadcastOffset).toBeUndefined()
    expect(rotated(cast(SCENARIO_02A)[0], 360)).toEqual(cast(SCENARIO_02A)[0])
  })
})
