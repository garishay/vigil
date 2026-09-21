import { describe, expect, it } from 'vitest'
import { AO } from './ao'
import { SCENARIO, type CastEntry, type Placement, type ScenarioConfig } from './scenario'
import { SCENARIOS, scenarioNamed } from './scenarios'
import { SCENARIO_02A } from './scenarios/02a'
import { ROTATION_02B_DEG, SCENARIO_02B } from './scenarios/02b'
import { SCENARIO_03A } from './scenarios/03a'
import { ROTATION_03B_DEG, SCENARIO_03B } from './scenarios/03b'
import { ROTATION_03D_DEG, SCENARIO_03D } from './scenarios/03d'
import {
  HOVER_LEG_M,
  LEG_M,
  along,
  at,
  rotated,
  silentAt,
  silentHover,
  silentOrbit,
} from './scenarios/cast'
import { SCORING } from './scoring'
import { STUDY as STUDY_CONFIG } from './study'
import type { AdsbCapture } from '../lib/adsb'
import { trackIdent, trackShape } from '../lib/display'
import { associate, scenarioFeed } from '../lib/feeds'
import { KT_TO_MS, bearingDegrees, destinationPoint, distanceMeters } from '../lib/geo'
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
  it('lists 03d — the demo’s, what the bare link and `on` open — first, then 001, the default deal, then the study files; an unknown name is refused', () => {
    expect(SCENARIOS.map((scenario) => scenario.name)).toEqual([
      '03d',
      '001',
      '02a',
      '02b',
      '03a',
      '03b',
    ])
    expect(SCENARIOS[0].config).toBe(SCENARIO_03D)
    expect(scenarioNamed('001').config).toBe(SCENARIO)
    expect(scenarioNamed('02a').config).toBe(SCENARIO_02A)
    expect(scenarioNamed('02b').config).toBe(SCENARIO_02B)
    expect(scenarioNamed('03a').config).toBe(SCENARIO_03A)
    expect(scenarioNamed('03b').config).toBe(SCENARIO_03B)
    expect(() => scenarioNamed('03')).toThrow('No scenario named "03"')
    // A study scenario's own run length (S7, #152, ruled D3): the prioritization pair's from the
    // rule — the last threat's entry + 30 s — and none on 02 or the default, the study's 360.
    // 03b is 03a rotated since S7d (#167), so the pair runs the same length.
    expect(scenarioNamed('03a').runS).toBe(218)
    expect(scenarioNamed('03b').runS).toBe(218)
    expect(scenarioNamed('02a').runS).toBeUndefined()
    expect(scenarioNamed('02b').runS).toBeUndefined()
    expect(scenarioNamed('001').runS).toBeUndefined()
    // The demo's scenario is not a study scenario: no run length of its own (S11, #213).
    expect(scenarioNamed('03d').runS).toBeUndefined()
    expect(scenarioNamed('03d').pairedWith).toBeUndefined()
    expect(SCENARIO_03D.seed).toBe('demo-03d')
    expect(SCENARIO_03A.seed).toBe('study-03a')
    expect(SCENARIO_03B.seed).toBe('study-03b')
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
    // The prioritization casts too (S7, #154 round 1): a mover written at Begin flies its whole
    // leg from t = 0 at up to 35 kt, so its leg is sized from its own speed — 25 kt over 1 185 s
    // is 15.2 km, 35 kt is 21.3 km, both past the 13 km a 20 kt leg needs.
    for (const config of [...STUDY, SCENARIO_03A, SCENARIO_03B]) {
      const plan = planScenario(gridTimeline(80, 15000), config)
      // The id a row takes is the plan's, not its position: the prioritization pair names its
      // own (S7d, #167).
      const movers = cast(config)
        .map((entry, i) => ({ entry, id: plan.specs[i].id }))
        .filter(({ entry }) => kind(entry) === 'mover' || kind(entry) === 'silent mover')
      expect(movers).toHaveLength(config === SCENARIO_03A || config === SCENARIO_03B ? 25 : 10)
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

describe('the prioritization casts 03a and 03b (S7, #152, ruled; the load of R1)', () => {
  const PAIR = [SCENARIO_03A, SCENARIO_03B]
  /** A mover's placement at Begin: its origin flown 480 s along its own course (`silentAt`). */
  const atBegin = (entry: CastEntry) => {
    if (entry.behavior !== 'shuttle') throw new Error('a mover')
    const course = bearingDegrees(place(entry.from), place(entry.to))
    return along(entry.from, course, entry.speedKt * KT_TO_MS * T0)
  }

  it('are cast-only, forty-nine rows under each scenario’s own ids: two silent threats, four silent baits, 02a’s furniture rows, nineteen silent load rows; nothing broadcasts an offset, and both threats are present from t = 0', () => {
    for (const config of PAIR) {
      expect(config.minInjects).toBe(0)
      expect(config.maxInjects).toBe(0)
      expect(cast(config)).toHaveLength(49)
      expect(cast(config).filter((e) => e.remoteId === 'silent')).toHaveLength(25)
      expect(cast(config).filter((e) => e.remoteId === 'broadcasting')).toHaveLength(24)
      expect(cast(config).every((e) => e.broadcastOffset === undefined)).toBe(true)
      expect(cast(config)[0].startS).toBeUndefined()
      expect(cast(config)[1].startS).toBeUndefined()
      // The ids are the scenario's own list, in row order (S7d, #167): its length, its order
      // and its disjointness from the other cast's are the id test's; here, that the plan takes
      // them and takes nothing positional.
      const plan = scenarioFeed(timelineOf(CAPTURE), config).plan
      expect(plan.specs.map((spec) => spec.id)).toEqual(
        (config.castIds ?? []).map((n) => `inject-${n}`),
      )
    }
    // Rows 7–30 are 02a's furniture — the same rows, under 03's own ids.
    expect(cast(SCENARIO_03A).slice(6, 30)).toEqual(cast(SCENARIO_02A).slice(6))
    // 03b is the whole of 03a turned 135° about the centre, threats included (S7d, #167).
    expect(ROTATION_03B_DEG).toBe(135)
    expect(cast(SCENARIO_03B)).toEqual(cast(SCENARIO_03A).map((entry) => rotated(entry, 135)))
  })

  it('writes every mover where it is at Begin: 03a’s threats at 285° / 6.30 km on 111° at 25 kt and 050° / 6.15 km on 225° at 12 kt, 03b’s the same two turned 135°; the load’s four band rows at 6.3–6.5 km at 11–12 kt, its three inbound rows at 9–12 km and two far, fast ones at 10–11.5 km, its four hovers at 6.6–9.6 km, and its six misses', () => {
    const [t1, t2] = cast(SCENARIO_03A)
    expect(t1).toMatchObject({ behavior: 'shuttle', remoteId: 'silent', speedKt: 25 })
    expect(t2).toMatchObject({ behavior: 'shuttle', remoteId: 'silent', speedKt: 12 })
    expect(atBegin(t1).bearingDeg).toBeCloseTo(285, 0)
    expect(atBegin(t1).rangeKm).toBeCloseTo(6.3, 2)
    expect(atBegin(t2).bearingDeg).toBeCloseTo(50, 0)
    expect(atBegin(t2).rangeKm).toBeCloseTo(6.15, 2)
    // 03b's threats are 03a's turned, so a row's two tracks match in range, speed and entry
    // time and differ only in bearing and label (S7d, #167): 285° + 135° = 60°, 50° + 135° = 185°.
    const [u1, u2] = cast(SCENARIO_03B)
    expect(u1.speedKt).toBe(25)
    expect(u2.speedKt).toBe(12)
    expect(atBegin(u1).bearingDeg).toBeCloseTo(60, 0)
    expect(atBegin(u1).rangeKm).toBeCloseTo(6.3, 2)
    expect(atBegin(u2).bearingDeg).toBeCloseTo(185, 0)
    expect(atBegin(u2).rangeKm).toBeCloseTo(6.15, 2)
    // The builder itself: the origin is the Begin placement flown back, so flying it forward lands there.
    const back = silentAt(at(95, 8.0), 279, 10, T0)
    expect(back).toMatchObject({ behavior: 'shuttle', remoteId: 'silent', speedKt: 10 })
    expect(atBegin(back).bearingDeg).toBeCloseTo(95, 0)
    expect(atBegin(back).rangeKm).toBeCloseTo(8.0, 2)
    // The load (ruled R1; placed at #154 round 2): rows 41–42 silent inbound in the threats' band,
    // 5.5–6.5 km at Begin at 11 kt on courses off the centre line; 43–45 silent, steady inbound,
    // 9–12 km; 46–47 silent on courses that miss. To the metre: the round trip through the plane
    // and back lands within a metre of the row. S7c (#163) adds 48–49 in the band at 11–12 kt,
    // 50–51 far and fast at 10–11.5 km and 24–30 kt, 52–55 silent hovers at 6.6–9.6 km, and
    // 56–59 on courses that miss at 6.2–9.9 km — the silent set twenty-five, nothing under 8 kt
    // but the hovers.
    const load = cast(SCENARIO_03A).slice(30)
    expect(load).toHaveLength(19)
    expect(load.every((e) => e.remoteId === 'silent' && e.behavior === 'shuttle')).toBe(true)
    const rangeAtBegin = (entry: CastEntry) => Math.round(atBegin(entry).rangeKm * 100) / 100
    for (const entry of load.slice(0, 2)) {
      expect(rangeAtBegin(entry)).toBeGreaterThanOrEqual(5.5)
      expect(rangeAtBegin(entry)).toBeLessThanOrEqual(6.5)
      expect(entry.speedKt).toBe(11)
    }
    for (const entry of load.slice(2, 5)) {
      expect(rangeAtBegin(entry)).toBeGreaterThanOrEqual(9)
      expect(rangeAtBegin(entry)).toBeLessThanOrEqual(12)
    }
    expect(atBegin(load[5]).rangeKm).toBeCloseTo(6.557, 2)
    expect(atBegin(load[6]).rangeKm).toBeCloseTo(8.12, 2)
    for (const entry of load.slice(7, 9)) {
      expect(rangeAtBegin(entry)).toBeGreaterThanOrEqual(5.5)
      expect(rangeAtBegin(entry)).toBeLessThanOrEqual(6.5)
    }
    expect(load.slice(7, 9).map((e) => e.speedKt)).toEqual([11, 12])
    expect(load.slice(9, 11).map((e) => [rangeAtBegin(e), e.speedKt])).toEqual([
      [11.5, 30],
      [10, 24],
    ])
    expect(load.slice(11, 15).map(kind)).toEqual(['hover', 'hover', 'hover', 'hover'])
    expect(load.slice(11, 15).map((e) => e.from.rangeKm)).toEqual([6.6, 7.4, 8.6, 9.6])
    expect(load.slice(15).map((e) => [rangeAtBegin(e), e.speedKt])).toEqual([
      [6.25, 16],
      [7.17, 20],
      [8.83, 12],
      [9.87, 25],
    ])
    expect(load.filter((e) => kind(e) !== 'hover').every((e) => e.speedKt >= 8)).toBe(true)
  })

  it('the silent hover’s leg lies across its bearing, and the silent orbit joins its circle on the side its offset says — the same side once turned 135°', () => {
    const hover = silentHover(at(160, 5.4))
    expect(hover).toMatchObject({
      behavior: 'shuttle',
      remoteId: 'silent',
      speedKt: 1,
      from: at(160, 5.4),
    })
    if (hover.behavior !== 'shuttle') throw new Error('a shuttle')
    expect(distanceMeters(place(hover.from), place(hover.to))).toBeCloseTo(HOVER_LEG_M, -1)
    // Across, not outward: the far end's range is the placement's within a metre.
    expect(Math.abs(rangeOf(hover.to) - rangeOf(hover.from))).toBeLessThan(1)
    expect(cast(SCENARIO_03A)[2]).toEqual(hover)
    const orbit = silentOrbit(at(340, 9.0), 500, 8, { joinDeg: 125, joinM: 800, offsetDeg: 8 })
    expect(orbit).toMatchObject({
      behavior: 'transit-orbit',
      remoteId: 'silent',
      speedKt: 8,
      courseDeg: 313,
      orbit: { center: at(340, 9.0), radiusM: 500 },
    })
    expect(orbit.from).toEqual(along(at(340, 9.0), 125, 800))
    expect(cast(SCENARIO_03A)[4]).toEqual(orbit)
    const turnOf = (config: ScenarioConfig) => {
      const script = planScenario(gridTimeline(80, 15000), config).specs[4].script
      if (script?.kind !== 'transit-orbit') throw new Error('an orbit')
      return script.turn
    }
    // A positive offset aims the course to the right of the centre, so the centre lies to the
    // left and the track turns left onto its circle — `turn` −1, counter-clockwise (#154 round 1).
    expect(turnOf(SCENARIO_03A)).toBe(-1)
    expect(turnOf(SCENARIO_03B)).toBe(-1)
    const mirrored = { ...SCENARIO_03A, cast: [...cast(SCENARIO_03A)] }
    mirrored.cast[4] = silentOrbit(at(340, 9.0), 500, 8, {
      joinDeg: 125,
      joinM: 800,
      offsetDeg: -8,
    })
    expect(turnOf(mirrored)).toBe(1)
  })
})

describe('the prioritization casts on the 1 Hz grid, through the feed (S7, #152; the gate’s numbers, pinned in full by S7b)', () => {
  // 03b is 03a rotated since S7d (#167), so the pair runs the same window.
  const RUN_03A = 218
  const RUN_03B = 218
  const holds = (ticks: Tick[], firstEntryS: number, threats: [string, string]) => {
    for (const tick of ticks) {
      if (tick.tSec > firstEntryS) break
      expect(tick.scored[0].track.id).toBe(threats[0])
      expect(tick.scored[1].track.id).toBe(threats[1])
      expect(of(tick, threats[0])!.band).toBe('warning')
      expect(of(tick, threats[1])!.band).toBe('warning')
    }
    // Nothing but the two threats enters the ring inside the run, and nothing else reads warning
    // before the first entry — the two band rows cross it after (Begin + 128 and + 157), under
    // the threats, and S7b's baselines pin those ticks.
    for (const tick of ticks) {
      for (const s of tick.scored) {
        if (s.track.id === threats[0] || s.track.id === threats[1]) continue
        expect(distanceMeters(C, s.track.position)).toBeGreaterThan(SITE.radiusM)
        if (tick.tSec <= firstEntryS) expect(s.band).not.toBe('warning')
      }
    }
  }

  it('03a: both threats warning at Begin and ranks 1 and 2 in entry order on every tick to the first entry at 582 s; the second enters at 668 s; no bait, load, or furniture enters inside the run, and none reads warning before the first entry', () => {
    const ticks = fold(SCENARIO_03A, T0, T0 + RUN_03A)
    holds(ticks, 582, ['inject-31', 'inject-57'])
    expect(ticks.find((t) => rangeAt(t, 'inject-31') <= SITE.radiusM)!.tSec).toBe(582)
    expect(ticks.find((t) => rangeAt(t, 'inject-57') <= SITE.radiusM)!.tSec).toBe(668)
    expect(rangeAt(ticks[0], 'inject-31')).toBeCloseTo(6300, -2)
    expect(rangeAt(ticks[0], 'inject-57')).toBeCloseTo(6150, -2)
  }, 180_000)

  it('03b: 03a’s two threats turned — inject-29 at 582 s and inject-23 at 668 s, the same ranges and the same entries (S7d, #167)', () => {
    const ticks = fold(SCENARIO_03B, T0, T0 + RUN_03B)
    holds(ticks, 582, ['inject-29', 'inject-23'])
    expect(ticks.find((t) => rangeAt(t, 'inject-29') <= SITE.radiusM)!.tSec).toBe(582)
    expect(ticks.find((t) => rangeAt(t, 'inject-23') <= SITE.radiusM)!.tSec).toBe(668)
    expect(rangeAt(ticks[0], 'inject-29')).toBeCloseTo(6300, -2)
    expect(rangeAt(ticks[0], 'inject-23')).toBeCloseTo(6150, -2)
  }, 180_000)
})

describe('the prioritization pair’s ids and idents (S7d, #167, ruled M1, M2; R1, R2)', () => {
  /**
   * The two scenarios as the app plans them — the ids `planScenario` assigns and the idents
   * drawn from them, never the two lists in `ids.ts` (ruled R1): a test on the lists passes
   * while 03b inherits 03a’s `castIds` through the spread, which is the hazard.
   */
  function plannedIdents(name: string) {
    const entry = scenarioNamed(name)
    const plan = planScenario(timelineOf(CAPTURE), entry.config)
    const runS = entry.runS ?? STUDY_CONFIG.runS
    const silent = new Set(
      plan.specs.filter((spec) => spec.remoteId === 'silent').map((spec) => spec.id),
    )
    // Every tick of the scenario’s own window, in both conditions: raw associates at the study’s
    // own distance and Vigil at the scorer’s, and an ident is what that screen showed (R2).
    const byIdent = new Map<string, Set<string>>()
    const drawn = new Set<string>()
    for (const associationM of [STUDY_CONFIG.rawAssociationM, SCORING.cooperativity.mismatchM]) {
      for (let tSec = T0; tSec <= T0 + runS; tSec++) {
        for (const track of injectTracksAt(plan, tSec)) {
          const ident = trackIdent(associate(track, associationM))
          drawn.add(track.id)
          if (!byIdent.has(ident)) byIdent.set(ident, new Set())
          byIdent.get(ident)!.add(track.id)
        }
      }
    }
    return { ids: plan.specs.map((spec) => spec.id), silent, byIdent, drawn, runS }
  }

  it('assigns the two casts disjoint ids, and disjoint idents over every tick of both windows in both modes (R1, R2)', () => {
    const a = plannedIdents('03a')
    const b = plannedIdents('03b')
    expect(a.ids).toHaveLength(49)
    expect(b.ids).toHaveLength(49)
    expect(a.ids.filter((id) => b.ids.includes(id))).toEqual([])
    const identsA = [...a.byIdent.keys()]
    const identsB = [...b.byIdent.keys()]
    expect(identsA.filter((ident) => identsB.includes(ident))).toEqual([])
    // One ident per row, so an ident names a track and not two.
    for (const [ident, ids] of [...a.byIdent, ...b.byIdent])
      expect([ident, ids.size]).toEqual([ident, 1])
  })

  it('draws every cast ident as TRK-nn with two digits or UAS-XXXX, and never a three-digit number (R2)', () => {
    for (const name of ['03a', '03b']) {
      const { byIdent, silent, drawn, ids } = plannedIdents(name)
      expect(
        [...byIdent.keys()].every((ident) => /^(TRK-\d{2}|UAS-[0-9A-F]{4})$/.test(ident)),
      ).toBe(true)
      // A TRK number is a silent row’s; a heard row that ever drew one has gone silent in the
      // window, which no study cast does. The furniture’s three-digit ids never reach a screen.
      for (const [ident, forIds] of byIdent) {
        const id = [...forIds][0]
        if (ident.startsWith('TRK-')) {
          expect([ident, silent.has(id)]).toEqual([ident, true])
          expect(ident).toBe(`TRK-${id.slice(id.lastIndexOf('-') + 1)}`)
        }
      }
      expect([...byIdent.keys()].filter((ident) => ident.startsWith('TRK-'))).toHaveLength(25)
      // One furniture row is never in the window: 02a’s third return starts at 750 s, past the
      // window’s end at 698 s. Every other row draws.
      expect(ids.filter((id) => !drawn.has(id))).toHaveLength(1)
    }
  })

  it('numbers a cast from 11 when the scenario names no castIds, and refuses a list that does not fit the cast', () => {
    const base = { ...SCENARIO_03A, castIds: undefined, cast: cast(SCENARIO_03A).slice(0, 3) }
    expect(planScenario(gridTimeline(80, 15000), base).specs.map((s) => s.id)).toEqual([
      'inject-11',
      'inject-12',
      'inject-13',
    ])
    expect(
      planScenario(gridTimeline(80, 15000), { ...base, castIds: [40, 12, 77] }).specs.map(
        (s) => s.id,
      ),
    ).toEqual(['inject-40', 'inject-12', 'inject-77'])
    expect(() => planScenario(gridTimeline(80, 15000), { ...base, castIds: [40, 12] })).toThrow(
      'castIds names 2 ids for a cast of 3',
    )
    expect(() => planScenario(gridTimeline(80, 15000), { ...base, castIds: [40, 12, 40] })).toThrow(
      'castIds repeats an id',
    )
    expect(() => planScenario(gridTimeline(80, 15000), { ...base, castIds: [40, 10, 77] })).toThrow(
      'castIds holds 10; a cast id is an integer from 11',
    )
    // A silent row's number is what the screen draws as TRK-<n>, so it stays two digits; a heard
    // row shows its UAS label and may take any number above them (#168 round 1).
    expect(cast(SCENARIO_03A)[0].remoteId).toBe('silent')
    expect(() =>
      planScenario(gridTimeline(80, 15000), { ...base, castIds: [40, 12, 100] }),
    ).toThrow(
      'castIds gives the silent row 3 the id 100; a silent row draws TRK-<n> on the screen, so its id runs to 99',
    )
    // The furniture's own three-digit ids are fine: they never reach a screen.
    const heard = { ...base, cast: cast(SCENARIO_03A).slice(6, 9) }
    expect(heard.cast.every((entry) => entry.remoteId === 'broadcasting')).toBe(true)
    expect(
      planScenario(gridTimeline(80, 15000), { ...heard, castIds: [100, 101, 148] }).specs.map(
        (spec) => spec.id,
      ),
    ).toEqual(['inject-100', 'inject-101', 'inject-148'])
  })
})

describe('the demo member 03d (S11, #213)', () => {
  const FAR = 'inject-44'
  const CLOSE = 'inject-39'

  it('is 03a’s crowd turned 270° under a third id set — fifty-one rows: two threats of its own, then 03a’s rows 3–49 turned, then 03a’s two threat rows re-cut as near misses; no id in either twin, and so no 03d threat ident a 03a or 03b threat ident', () => {
    const rows = cast(SCENARIO_03D)
    expect(rows).toHaveLength(51)
    expect(SCENARIO_03D.maxInjects).toBe(0)
    expect(rows.slice(2, 49)).toEqual(
      cast(SCENARIO_03A)
        .slice(2)
        .map((entry) => rotated(entry, ROTATION_03D_DEG)),
    )
    // Through the plan, as the app numbers them (R1 on #167), against both twins’ plans.
    const planned = (config: ScenarioConfig) =>
      planScenario(timelineOf(CAPTURE), config).specs.map((spec) => spec.id)
    const ids = planned(SCENARIO_03D)
    const twins = new Set([...planned(SCENARIO_03A), ...planned(SCENARIO_03B)])
    expect(ids).toHaveLength(51)
    expect(ids.filter((id) => twins.has(id))).toEqual([])
    expect(ids.slice(0, 2)).toEqual([FAR, CLOSE])
    for (const id of ['inject-31', 'inject-57', 'inject-29', 'inject-23']) {
      expect(ids.slice(0, 2)).not.toContain(id)
    }
    // A silent row shows two digits, a heard row never shows its three (R2).
    rows.forEach((row, i) => {
      const n = Number(ids[i].slice('inject-'.length))
      expect([ids[i], row.remoteId === 'silent' ? n < 100 : n >= 148]).toEqual([ids[i], true])
    })
    expect(rows.filter((row) => row.remoteId === 'silent')).toHaveLength(27)
  })

  it('reads the cold open from t = 0: both threats warning at ranks 1 and 2, the close one on top until their ranges cross — 93 s in the app’s order — and the far one from then to its entry at 123 s; the close one enters at 158 s; nothing else is inside the ring or warning before 608 s', () => {
    const ticks = fold(SCENARIO_03D, 0, 607)
    for (const tick of ticks) {
      expect(of(tick, FAR)!.band).toBe('warning')
      expect(of(tick, CLOSE)!.band).toBe('warning')
      const top = tick.scored.slice(0, 2).map((s) => s.track.id)
      // The crossing is a tie of a few ticks — the app's comparator reads it at 93 s, and this
      // fold's composite-only sort a few ticks earlier — so the pin holds either side of it.
      if (tick.tSec <= 80) expect([tick.tSec, top]).toEqual([tick.tSec, [CLOSE, FAR]])
      else if (tick.tSec >= 100 && tick.tSec <= 123) {
        expect([tick.tSec, top]).toEqual([tick.tSec, [FAR, CLOSE]])
      } else expect([tick.tSec, [...top].sort()]).toEqual([tick.tSec, [CLOSE, FAR].sort()])
      for (const s of tick.scored) {
        if (s.track.id === FAR || s.track.id === CLOSE) continue
        expect(distanceMeters(C, s.track.position)).toBeGreaterThan(SITE.radiusM)
        expect([tick.tSec, s.track.id, s.band]).not.toEqual([tick.tSec, s.track.id, 'warning'])
      }
    }
    expect(ticks.find((t) => rangeAt(t, FAR) <= SITE.radiusM)!.tSec).toBe(123)
    expect(ticks.find((t) => rangeAt(t, CLOSE) <= SITE.radiusM)!.tSec).toBe(158)
  }, 30_000)
})

describe('the map’s shapes on the study casts (S9, #181)', () => {
  /** Every track’s shape on every tick of the window, in both conditions, by id and tick. */
  function shapesByMode(name: string) {
    const entry = scenarioNamed(name)
    const plan = planScenario(timelineOf(CAPTURE), entry.config)
    const runS = entry.runS ?? STUDY_CONFIG.runS
    const differing = new Map<string, number[]>()
    let ticks = 0
    for (let tSec = T0; tSec <= T0 + runS; tSec++) {
      for (const track of injectTracksAt(plan, tSec)) {
        ticks++
        const raw = trackShape(associate(track, STUDY_CONFIG.rawAssociationM))
        const vigil = trackShape(associate(track, SCORING.cooperativity.mismatchM))
        if (raw !== vigil) differing.set(track.id, [...(differing.get(track.id) ?? []), tSec])
      }
    }
    return { differing, ticks }
  }

  it('draws the prioritization pair shape-identical in both modes on every tick: nothing on 03 is mismatched', () => {
    for (const name of ['03a', '03b']) {
      const { differing, ticks } = shapesByMode(name)
      expect(ticks).toBeGreaterThan(9000)
      expect([...differing.keys()]).toEqual([])
    }
  })

  it('gives no threat a shape of its own on 03: every silent row is the one dot on every tick, every heard row a drone', () => {
    // The gate's first question (#181): a threat must not be findable by shape unaided. The
    // shape reads the callsign the rule left and nothing else, so the two threats — silent, like
    // the twenty-three other silent rows — are the dot the baits and the load are.
    for (const name of ['03a', '03b']) {
      const entry = scenarioNamed(name)
      const plan = planScenario(timelineOf(CAPTURE), entry.config)
      const silent = new Set(
        plan.specs.filter((spec) => spec.remoteId === 'silent').map((spec) => spec.id),
      )
      expect(silent.size).toBe(25)
      const threats = plan.specs.slice(0, 2).map((spec) => spec.id)
      expect(threats.every((id) => silent.has(id))).toBe(true)
      for (let tSec = T0; tSec <= T0 + (entry.runS ?? STUDY_CONFIG.runS); tSec++) {
        for (const track of injectTracksAt(plan, tSec)) {
          const shape = trackShape(associate(track, STUDY_CONFIG.rawAssociationM))
          expect([track.id, shape]).toEqual([track.id, silent.has(track.id) ? 'dot' : 'drone'])
        }
      }
    }
  })

  it('draws the corroboration pair’s threat as a drone unaided and a dot in Vigil, and nothing else differently', () => {
    // 02a lies from its first frame (481 s); 02b from 510 s. Every other row reads one shape.
    const a = shapesByMode('02a')
    expect([...a.differing.keys()]).toEqual(['inject-11'])
    expect(a.differing.get('inject-11')?.[0]).toBe(481)
    expect(a.differing.get('inject-11')).toHaveLength(T0 + RUN - 481 + 1)
    const b = shapesByMode('02b')
    expect([...b.differing.keys()]).toEqual(['inject-11'])
    expect(b.differing.get('inject-11')?.[0]).toBe(510)
  })
})
