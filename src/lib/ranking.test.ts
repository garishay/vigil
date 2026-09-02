import { describe, expect, it } from 'vitest'
import { rankTracks } from './ranking'
import { AO } from '../config/ao'
import type { ProtectedSite } from '../config/ao'
import { SCORING } from '../config/scoring'
import { frameTracks } from '../data/capture'
import type { AdsbCapture } from './adsb'
import { destinationPoint, distanceMeters } from './geo'
import { injectTracksAt, planScenario, type InjectScenario } from './injects'
import { historiesAt, memoryAt, type ReplayIndex } from './replay'
import { minuteOfDay, type ScoringContext } from './scoring'
import type { AdsbTrack, Identity, InjectTrack, Track } from './tracks'
import captureRaw from '../../public/adsb-phl.json?raw'
import goldenRaw from './__fixtures__/injects-vigil-phl-001.json?raw'

const capture = JSON.parse(captureRaw) as AdsbCapture
const golden = JSON.parse(goldenRaw) as InjectScenario

const SITE = AO.protectedSites[0]
const SITES = AO.protectedSites

/** A point `rangeM` from the protected site, due north unless told otherwise. */
const at = (rangeM: number, bearingDeg = 0) => destinationPoint(SITE.center, bearingDeg, rangeM)

/** 10:00 local, nothing heard — daylight, so the off-hours factor is out of the way. */
const DAY: ScoringContext = { tSec: 0, minuteOfDay: 600, memory: {} }

function adsb(hex: string, rangeM: number, extra: Partial<AdsbTrack> = {}): AdsbTrack {
  return {
    id: `adsb-${hex}`,
    source: 'adsb',
    icaoHex: hex,
    identity: 'cooperative',
    callsign: null,
    position: at(rangeM),
    altitudeFt: 3000,
    onGround: false,
    groundSpeedKt: 200,
    // Due north of the site, heading east: abeam, neither closing nor opening.
    headingDeg: 90,
    verticalRateFpm: 0,
    lastSeenSec: 0,
    category: null,
    registry: null,
    ...extra,
  }
}

function inject(n: number, identity: Identity, rangeM: number): InjectTrack {
  return {
    id: `inject-${String(n).padStart(2, '0')}`,
    source: 'inject',
    behavior: 'transit',
    remoteId: identity === 'non-cooperative' ? 'silent' : 'intermittent',
    uaType: null,
    identity,
    callsign: identity === 'cooperative' ? `UAS-${n}` : null,
    position: at(rangeM),
    altitudeFt: 200,
    onGround: false,
    groundSpeedKt: 20,
    // Straight in.
    headingDeg: 180,
    verticalRateFpm: 0,
    lastSeenSec: 0,
  }
}

const order = (tracks: Track[], sites: ProtectedSite[] = SITES) =>
  rankTracks(tracks, sites).map((entry) => entry.track.id)

describe('rankTracks', () => {
  it('orders by composite score, descending, and carries the breakdown on the entry', () => {
    // The nearest track is the cooperative one and it still ranks last: the engine, not range,
    // decides — a silent drone thirty kilometres out carries its cooperativity everywhere.
    const tracks = [
      inject(1, 'cooperative', 500),
      inject(2, 'unknown', 5000),
      inject(3, 'non-cooperative', 9000),
    ]
    const ranked = rankTracks(tracks, SITES)
    const composites = ranked.map((entry) => entry.score.composite)
    expect(composites).toEqual([...composites].sort((a, b) => b - a))
    expect(ranked.every((entry) => entry.score.factors.length === 6)).toBe(true)
  })

  it('never ranks an ADS-B track above any silent or unknown inject under the default weights (§2)', () => {
    // The ceiling is 30; a never-heard inject's cooperativity alone is 25 ÷ 80 = 31.25. So the
    // placeholder ranking's guarantee survives the engine — by arithmetic, not by a sort key —
    // and this test is what tells a slider change it has broken it.
    expect(SCORING.cooperativity.silent * (SCORING.weights.cooperativity / 80)).toBeGreaterThan(
      SCORING.adsbCeiling,
    )
    const tracks = [
      adsb('a00001', 0, { altitudeFt: 200, groundSpeedKt: 20, headingDeg: 180 }),
      adsb('a00002', 100),
      inject(1, 'non-cooperative', 30_000),
      inject(2, 'unknown', 30_000),
    ]
    const ranked = rankTracks(tracks, SITES, DAY)
    const injects = ranked.filter((r) => r.track.source === 'inject').map((r) => r.rank)
    const adsbRanks = ranked.filter((r) => r.track.source === 'adsb').map((r) => r.rank)
    expect(Math.min(...adsbRanks)).toBeGreaterThan(Math.max(...injects))
  })

  it('lets a broadcasting inject compete with ADS-B on the geometry', () => {
    // §5.2 working as written: a drone identifying itself is cooperative and nothing more, so a
    // capped arrival outranks one that is far out and in daylight; the same drone inside the
    // ring at night outranks the arrival.
    const arrival = adsb('a00001', 2000, { altitudeFt: 1000, groundSpeedKt: 174, headingDeg: 180 })
    expect(rankTracks([inject(1, 'cooperative', 30_000), arrival], SITES, DAY)[0].track.id).toBe(
      'adsb-a00001',
    )
    expect(rankTracks([inject(1, 'cooperative', 2000), arrival], SITES)[0].track.id).toBe(
      'inject-01',
    )
  })

  it('orders the capped ADS-B block by its uncapped composite', () => {
    // Both cap at 30: the arrival, low and slowing (uncapped 55), and an aircraft over the site
    // at 3,000 ft with no heading broadcast (uncapped 49 — inside the ring, closing is complete
    // whichever way it points, 05a). The list still says which is the more pressing of the two.
    const arrival = adsb('a00001', 2000, { altitudeFt: 1000, groundSpeedKt: 120, headingDeg: 180 })
    const overhead = adsb('a00002', 100, { headingDeg: null })
    const ranked = rankTracks([overhead, arrival], SITES)
    expect(ranked.map((r) => r.score.composite)).toEqual([30, 30])
    expect(ranked[0].track.id).toBe('adsb-a00001')
    expect(ranked[0].score.uncapped).toBeGreaterThan(ranked[1].score.uncapped)
  })

  it('breaks an equal score by identity, then airborne before on-ground, then range, then id', () => {
    // Four distant ADS-B tracks with nothing to score but the floor and the hour: all 14.0625.
    const tracks = [
      adsb('b', 60_000, { onGround: true, altitudeFt: 0, groundSpeedKt: 0, headingDeg: null }),
      adsb('a', 60_000, { onGround: true, altitudeFt: 0, groundSpeedKt: 0, headingDeg: null }),
      adsb('c', 60_000, { onGround: true, altitudeFt: 0, groundSpeedKt: 0, headingDeg: null }),
      adsb('d', 70_000, { headingDeg: null }),
      adsb('e', 61_000, { onGround: true, altitudeFt: 0, groundSpeedKt: 0, headingDeg: null }),
    ]
    const ranked = rankTracks(tracks, SITES)
    expect(new Set(ranked.map((r) => r.score.composite)).size).toBe(1)
    expect(ranked.map((r) => r.track.id)).toEqual([
      'adsb-d',
      'adsb-a',
      'adsb-b',
      'adsb-c',
      'adsb-e',
    ])
  })

  it('reports range to the site center in meters, and which site it measured', () => {
    const [entry] = rankTracks([adsb('a00001', 2500)], SITES)
    expect(entry.rangeM).toBeCloseTo(distanceMeters(SITE.center, entry.track.position), 6)
    expect(entry.rangeM).toBeCloseTo(2500, -1)
    expect(entry.siteId).toBe(SITE.id)
    expect(entry.score.rangeM).toBe(entry.rangeM)
  })

  it('measures to the nearest protected site when there is more than one', () => {
    // The constraint parked on #4: with one site, "nearest" and "[0]" coincide. Here they do not.
    const other: ProtectedSite = {
      id: 'other',
      name: 'Other',
      center: at(20_000, 90),
      radiusM: 1000,
    }
    const nearOther = adsb('a00001', 0, { position: at(19_000, 90) })
    const [entry] = rankTracks([nearOther], [SITE, other])
    expect(entry.siteId).toBe('other')
    expect(entry.rangeM).toBeCloseTo(1000, -1)
  })

  it('numbers ranks from one, in order', () => {
    const ranked = rankTracks([adsb('a', 1), adsb('b', 2), adsb('c', 3)], SITES)
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3])
  })

  it('refuses to rank without a protected site to measure against', () => {
    expect(() => rankTracks([adsb('a', 1)], [])).toThrow(/protected site/)
  })

  it('does not mutate its input', () => {
    const tracks = [adsb('b', 2), adsb('a', 1)]
    const before = tracks.map((t) => t.id)
    rankTracks(tracks, SITES)
    expect(tracks.map((t) => t.id)).toEqual(before)
  })
})

describe('determinism', () => {
  // The Queue is a pure function of the track list and the scoring context: the golden's frame 0
  // plus the recording's frame 0 is the picture the app opens on, and this is the order it opens
  // in — at the scenario's clock start, with nothing yet heard, which is what the default
  // context supplies.
  const frame0: Track[] = [...frameTracks(capture.frames[0]), ...golden.frames[0].tracks]

  it('ranks the default picture identically every time, and pins its top rows', () => {
    const ids = order(frame0)
    expect(ids).toEqual(order(frame0))
    expect(ids).toHaveLength(capture.frames[0].records.length + golden.frames[0].tracks.length)
    // The "visibly changes" statement (#4): the placeholder read 05 · 03 · 06 · adsb-c00b80 · 01 ·
    // 04 · adsb-a28904. The engine reads the three silent injects, then the three broadcasting
    // ones by geometry, then the capped ADS-B block — led by the arrival inside the ring that
    // the placeholder put fourth, since inside the ring its approach is complete (05a). The
    // composites are over 95 with the pattern row at 0 — no history at frame 0 — and the hero
    // opens at 10 km, one point clear of the nearer grid sweep (ruled on #5, note 3).
    expect(ids.slice(0, 7)).toEqual([
      'inject-05',
      'inject-03',
      'inject-06',
      'inject-01',
      'inject-04',
      'inject-02',
      'adsb-c00b80',
    ])
    const ranked = rankTracks(frame0, SITES)
    expect(ranked.slice(0, 6).map((r) => Math.round(r.score.composite))).toEqual([
      59, 58, 56, 54, 50, 40,
    ])
    expect(ranked[6].score).toMatchObject({ composite: 30, capped: true })
    expect(ranked.find((r) => r.track.id === 'adsb-c00b80')?.rank).toBeGreaterThan(6)
  })

  it('ranks identically with the display enrichment stripped — enrichment is never scored', () => {
    // The §5.1 display-only rule made executable: a sort key reading category or registry would
    // reorder the stripped picture and fail here.
    const stripped = frame0.map((track) =>
      track.source === 'adsb'
        ? { ...track, category: null, registry: null }
        : { ...track, uaType: null },
    )
    expect(order(stripped)).toEqual(order(frame0))
  })

  it('ends the default picture with its parked aircraft, dimmed rather than dropped (C3)', () => {
    const ranked = rankTracks(frame0, SITES)
    const tail = ranked.slice(-3)
    expect(tail.every((r) => r.track.onGround)).toBe(true)
    expect(tail.map((r) => r.track.id)).toEqual(['adsb-a8f5ba', 'adsb-abf0ca', 'adsb-a1bc1f'])
    expect(ranked.slice(0, -3).some((r) => r.track.onGround)).toBe(false)
  })
})

describe('pattern of life in the order (05a acceptance)', () => {
  const plan = planScenario({ frameCount: 80, intervalMs: 15000 })
  const noRecording: ReplayIndex = { durationS: 0, samples: new Map() }
  const injectsAt = (t: number) => {
    const tracks = injectTracksAt(plan, t)
    return rankTracks(tracks, SITES, {
      tSec: t,
      minuteOfDay: minuteOfDay('02:30', t),
      memory: memoryAt((s) => injectTracksAt(plan, s), plan.intervalS, t),
      history: historiesAt(noRecording, plan, tracks, t, SCORING.pattern.windowS),
    })
  }
  const rankOf = (ranked: ReturnType<typeof rankTracks>, id: string) =>
    ranked.find((entry) => entry.track.id === id)!.rank

  it('ranks the scripted loiter and orbit above the scripted transit once their histories fill', () => {
    // The acceptance criterion on #5, on the default scenario at 02:46:30 and at the last frame.
    // The oracle is the generator's behavior, read here and nowhere in the scorer.
    for (const t of [990, 1185]) {
      const ranked = injectsAt(t)
      const byBehavior = Object.fromEntries(
        ranked.map((entry) => [(entry.track as InjectTrack).behavior, entry.track.id]),
      )
      expect(rankOf(ranked, byBehavior.loiter)).toBeLessThan(rankOf(ranked, byBehavior.transit))
      expect(rankOf(ranked, byBehavior.orbit)).toBeLessThan(rankOf(ranked, byBehavior.transit))
      expect(ranked.find((e) => e.track.id === byBehavior.loiter)!.score.pattern).toBe('loiter')
      expect(ranked.find((e) => e.track.id === byBehavior.orbit)!.score.pattern).toBe('orbit')
    }
  })

  it('lifts the hero back to the top of the queue as its dwell builds (ruled on #5, note 3)', () => {
    // Inside the ring the two silent grid sweeps tie the hero at 84 and are nearer; the loiter
    // row is what puts it back at rank 1 — at 02:44:45, and it stays there until a sweep's own
    // return lane ties it at 100.
    expect(rankOf(injectsAt(870), 'inject-05')).toBe(3)
    expect(rankOf(injectsAt(885), 'inject-05')).toBe(1)
    expect(
      Math.round(injectsAt(990).find((e) => e.track.id === 'inject-05')!.score.composite),
    ).toBe(95)
  })

  it('ranks a hover above the same drone in transit — behavior, not just position (§6)', () => {
    const here = at(3000)
    const hovering = inject(1, 'non-cooperative', 3000)
    const passing = { ...inject(2, 'non-cooperative', 3000), position: here }
    const still = [...Array(29)].map((_, i) => ({ tSec: i * 15, position: here }))
    const straight = [...Array(29)].map((_, i) => ({
      tSec: i * 15,
      position: destinationPoint(here, 180, (i - 28) * 150),
    }))
    const ranked = rankTracks([passing, hovering], SITES, {
      tSec: 420,
      minuteOfDay: 150,
      memory: {},
      history: { 'inject-01': still, 'inject-02': straight },
    })
    expect(ranked.map((entry) => entry.track.id)).toEqual(['inject-01', 'inject-02'])
    expect(ranked[0].score.pattern).toBe('loiter')
    expect(ranked[1].score.pattern).toBeNull()
  })
})

describe('arrival order', () => {
  // Synthetic on purpose: the capture is data, not a test oracle, so a recapture re-pins the
  // frame-0 tests above and nothing else.
  it('produces the same order whatever order the tracks arrive in', () => {
    // Two tracks share a score on purpose: without a tie the sort key is already a strict total
    // order and any comparator passes. The tie is what makes the shuffles exercise the id
    // tie-break, and `a00004` arrives first so a stable sort alone cannot save it.
    const tracks: Track[] = [
      adsb('a00004', 9000),
      adsb('a00003', 9000),
      inject(2, 'cooperative', 4000),
      adsb('a00001', 100, { onGround: true, altitudeFt: 0 }),
      inject(1, 'non-cooperative', 30_000),
      adsb('a00002', 2000),
      inject(3, 'unknown', 12_000),
    ]
    const expected = [
      'inject-02',
      'inject-03',
      'inject-01',
      'adsb-a00002',
      'adsb-a00003',
      'adsb-a00004',
      'adsb-a00001',
    ]
    expect(order(tracks)).toEqual(expected)
    expect(order([...tracks].reverse())).toEqual(expected)
    expect(
      order([tracks[4], tracks[0], tracks[6], tracks[2], tracks[5], tracks[3], tracks[1]]),
    ).toEqual(expected)
  })
})
