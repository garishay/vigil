import { describe, expect, it } from 'vitest'
import {
  FACTORS,
  bandOf,
  formatClock,
  minuteOfDay,
  parseClock,
  rememberIdentities,
  scoreTrack,
  type IdentityMemory,
  type ObservedTrack,
  type ScoringContext,
} from './scoring'
import { AO } from '../config/ao'
import type { ProtectedSite } from '../config/ao'
import { SCORING, type FactorId } from '../config/scoring'
import { frameTracks } from '../data/capture'
import type { AdsbCapture } from './adsb'
import { scoreTotal } from './display'
import { destinationPoint } from './geo'
import type { InjectScenario } from './injects'
import type { AdsbTrack, InjectTrack, Track } from './tracks'
import captureRaw from '../../public/adsb-phl.json?raw'
import goldenRaw from './__fixtures__/injects-vigil-phl-001.json?raw'

const capture = JSON.parse(captureRaw) as AdsbCapture
const golden = JSON.parse(goldenRaw) as InjectScenario

const SITE = AO.protectedSites[0]
const SITES = AO.protectedSites

/** A point `rangeM` from the protected site, due north unless told otherwise. */
const at = (rangeM: number, bearingDeg = 0) => destinationPoint(SITE.center, bearingDeg, rangeM)

/** Frame 0 at 02:30 local with nothing yet heard — the picture the app opens on. */
const NIGHT: ScoringContext = { tSec: 0, minuteOfDay: 150, memory: {} }
/** The same picture at 10:00 — within operating hours. */
const DAY: ScoringContext = { ...NIGHT, minuteOfDay: 600 }

function inject(over: Partial<InjectTrack> = {}): InjectTrack {
  return {
    id: 'inject-01',
    source: 'inject',
    behavior: 'transit',
    remoteId: 'silent',
    uaType: null,
    identity: 'non-cooperative',
    callsign: null,
    position: at(1000),
    altitudeFt: 200,
    onGround: false,
    groundSpeedKt: 20,
    // Due north of the site, heading south: straight in.
    headingDeg: 180,
    verticalRateFpm: 0,
    lastSeenSec: 0,
    ...over,
  }
}

function adsb(over: Partial<AdsbTrack> = {}): AdsbTrack {
  return {
    id: 'adsb-a00001',
    source: 'adsb',
    icaoHex: 'a00001',
    identity: 'cooperative',
    callsign: null,
    position: at(20_000),
    altitudeFt: 3000,
    onGround: false,
    groundSpeedKt: 200,
    headingDeg: 90,
    verticalRateFpm: 0,
    lastSeenSec: 0,
    category: null,
    registry: null,
    ...over,
  }
}

const factor = (track: Track, id: FactorId, context: ScoringContext = NIGHT) =>
  scoreTrack(track, SITES, context).factors.find((f) => f.id === id)!

describe('cooperativity', () => {
  it('holds ADS-B at the floor whatever it does', () => {
    const arrival = adsb({ position: at(500), altitudeFt: 300, groundSpeedKt: 60, headingDeg: 180 })
    expect(factor(arrival, 'cooperativity').value).toBe(SCORING.cooperativity.adsb)
    expect(factor(arrival, 'cooperativity').detail).toBe('ADS-B, cooperative by construction')
  })

  it('reads a heard Remote ID low', () => {
    const heard = inject({ identity: 'cooperative', callsign: 'UAS-1' })
    expect(factor(heard, 'cooperativity')).toMatchObject({
      value: SCORING.cooperativity.heard,
      detail: 'Remote ID heard this frame',
    })
  })

  it('reads a track never heard at the top — silent and not-yet-heard alike (the #4 corollary)', () => {
    // An intermittent inject before its first heard frame is observationally a silent one: the
    // memory has nothing, the identity is not cooperative, and the score is the same.
    expect(factor(inject({ identity: 'non-cooperative' }), 'cooperativity').value).toBe(100)
    expect(factor(inject({ identity: 'unknown' }), 'cooperativity')).toMatchObject({
      value: 100,
      detail: 'no ident heard',
    })
  })

  it('dwells at the heard value after the last ident, then degrades to the Unknown plateau (B1)', () => {
    const quiet = inject({ identity: 'unknown' })
    const since = (s: number): ScoringContext => ({
      tSec: 1000,
      minuteOfDay: 150,
      memory: { 'inject-01': { lastHeardTSec: 1000 - s } },
    })
    const { heard, unknown, dwellS, decayS } = SCORING.cooperativity
    expect(factor(quiet, 'cooperativity', since(0)).value).toBe(heard)
    expect(factor(quiet, 'cooperativity', since(dwellS))).toMatchObject({
      value: heard,
      detail: `ident last heard ${dwellS} s ago — holding`,
    })
    expect(factor(quiet, 'cooperativity', since(dwellS + decayS / 2))).toMatchObject({
      value: (heard + unknown) / 2,
      detail: `ident last heard ${dwellS + decayS / 2} s ago — degrading`,
    })
    expect(factor(quiet, 'cooperativity', since(dwellS + decayS))).toMatchObject({
      value: unknown,
      detail: `ident last heard ${dwellS + decayS} s ago — unknown`,
    })
    // A track that once identified itself never becomes a silent one.
    expect(factor(quiet, 'cooperativity', since(100_000)).value).toBe(unknown)
  })

  it('scores two tracks identical in observed history the same whatever their remoteId (ruled on #4)', () => {
    const observedAlike = inject({ identity: 'unknown', remoteId: 'intermittent' })
    const labelledSilent = { ...observedAlike, remoteId: 'silent' as const }
    const labelledBroadcasting = { ...observedAlike, remoteId: 'broadcasting' as const }
    expect(scoreTrack(labelledSilent, SITES, NIGHT)).toEqual(
      scoreTrack(observedAlike, SITES, NIGHT),
    )
    expect(scoreTrack(labelledBroadcasting, SITES, NIGHT)).toEqual(
      scoreTrack(observedAlike, SITES, NIGHT),
    )
    // Nor does the scripted behavior enter.
    const labelledLoiter: InjectTrack = { ...observedAlike, behavior: 'loiter' }
    expect(scoreTrack(labelledLoiter, SITES, NIGHT)).toEqual(
      scoreTrack(observedAlike, SITES, NIGHT),
    )
  })

  it('cannot read the answer key: the input type strips it', () => {
    // The structural half of the #4 ruling, checked by `tsc` on this file: a factor written
    // against `ObservedTrack` has no `remoteId`, `behavior`, `uaType`, `category`, or
    // `registry` to branch on. Nothing is copied or stripped at runtime — the object still
    // carries the field, which is why the guard has to be the type — and any `Track` is
    // assignable to it. Each line below compiles only because it is marked as the error it is.
    const observed: ObservedTrack = inject()
    // @ts-expect-error the answer key is not on the scorer's input
    const remoteId: unknown = observed.remoteId
    // @ts-expect-error nor is the scripted behavior
    const behavior: unknown = observed.behavior
    // @ts-expect-error nor the display enrichment (§5.1)
    const registry: unknown = (adsb() as ObservedTrack).registry
    expect([remoteId, behavior, registry]).toEqual(['silent', 'transit', null])
  })
})

describe('closing geometry', () => {
  it('scores a track heading straight in, minutes out, at 100', () => {
    // 1 km at 20 kt is 97 s to CPA — inside the two-minute full band — and the CPA is the site.
    expect(factor(inject(), 'closing')).toMatchObject({ value: 100, detail: 'CPA 0.0 km in 2 min' })
  })

  it('rolls off with time-to-CPA', () => {
    // 10 km at 20 kt: 972 s = 16.2 min, on the 2 → 20 min ramp: 100 × (1 − 14.2 / 18) ≈ 21.
    expect(factor(inject({ position: at(10_000) }), 'closing').value).toBeCloseTo(21.1, 0)
    // 30 km: 48 min, past the end of the ramp.
    expect(factor(inject({ position: at(30_000) }), 'closing').value).toBe(0)
  })

  it('rolls off with CPA distance outside the ring', () => {
    // 10 km north-west of the site heading east: passes 10 km north, CPA at two ring radii,
    // which is halfway down the 1 → 3 radii ramp; TCPA 10 km at 20 kt as above.
    const abeam = inject({ position: at(Math.hypot(10_000, 10_000), 315), headingDeg: 90 })
    expect(factor(abeam, 'closing').value).toBeCloseTo(0.5 * 21.1, 0)
    expect(factor(abeam, 'closing').detail).toMatch(/^CPA 10\.0 km in 16 min$/)
  })

  it('scores a track that is opening at 0, and says so', () => {
    expect(factor(inject({ headingDeg: 0 }), 'closing')).toMatchObject({
      value: 0,
      detail: 'opening — closest approach already passed',
    })
  })

  it('scores 0 with a reason for readings it cannot use — never a guess (#35)', () => {
    expect(factor(inject({ groundSpeedKt: null }), 'closing').detail).toBe(
      'speed or heading not observed',
    )
    expect(factor(inject({ headingDeg: null }), 'closing').value).toBe(0)
    expect(factor(inject({ groundSpeedKt: 0 }), 'closing')).toMatchObject({
      value: 0,
      detail: 'not moving',
    })
    expect(factor(adsb({ onGround: true, altitudeFt: 0 }), 'closing').detail).toBe(
      'on ground — not in the airspace',
    )
  })

  it('takes the worst case across protected sites', () => {
    const decoy: ProtectedSite = {
      id: 'decoy',
      name: 'Decoy',
      center: at(40_000, 90),
      radiusM: 1000,
    }
    const straightIn = inject()
    expect(factor(straightIn, 'closing').value).toBe(100)
    expect(
      scoreTrack(straightIn, [decoy, SITE], NIGHT).factors.find((f) => f.id === 'closing')?.value,
    ).toBe(100)
  })
})

describe('proximity', () => {
  it('spikes to 100 anywhere inside the ring, including its edge', () => {
    expect(factor(inject({ position: at(0) }), 'proximity').value).toBe(100)
    expect(factor(inject({ position: at(SITE.radiusM) }), 'proximity')).toMatchObject({
      value: 100,
      detail: '5.0 km — inside the 5.0 km ring',
    })
  })

  it('decays to 0 at three ring radii', () => {
    expect(factor(inject({ position: at(10_000) }), 'proximity')).toMatchObject({
      value: expect.closeTo(50, 6),
      detail: '10.0 km — outside the 5.0 km ring',
    })
    expect(factor(inject({ position: at(15_000) }), 'proximity').value).toBeCloseTo(0, 6)
    expect(factor(inject({ position: at(40_000) }), 'proximity').value).toBe(0)
  })

  it('takes the worst case across sites — the highest roll-off, not the nearest centre (#63)', () => {
    // A small stadium ring 500 m nearer than the airfield: by centre the stadium is nearest and
    // its 0.5 km ring rolls off to nothing at 3.5 km, but the drone sits inside the airfield's
    // 5 km ring and must read 100. The Queue's range column still reports the nearest centre.
    const stadium: ProtectedSite = {
      id: 'stadium',
      name: 'Stadium',
      center: at(500),
      radiusM: 500,
    }
    const drone = inject({ position: at(4000) })
    const score = scoreTrack(drone, [stadium, SITE], NIGHT)
    expect(score.factors.find((f) => f.id === 'proximity')).toMatchObject({
      value: 100,
      detail: "4.0 km — inside PHL Airfield's 5.0 km ring",
    })
    expect(score.siteId).toBe('stadium')
    expect(score.rangeM).toBeCloseTo(3500, -1)
  })

  it('does not read a parked aircraft as zero range (C3)', () => {
    expect(
      factor(adsb({ position: at(0), onGround: true, altitudeFt: 0 }), 'proximity'),
    ).toMatchObject({
      value: 0,
      detail: 'on ground — not in the airspace',
    })
  })
})

describe('kinematic profile', () => {
  it('scores the small-UAS box at 100, edge included — the same box the silhouette labels', () => {
    expect(factor(inject(), 'kinematic')).toMatchObject({
      value: 100,
      detail: '200 ft · 20 kt — inside the small-UAS envelope',
    })
    expect(factor(inject({ altitudeFt: 400, groundSpeedKt: 87 }), 'kinematic').value).toBe(100)
  })

  it('rolls off above the box on either reading, taking the lower', () => {
    // 1,200 ft is halfway from 400 to 2,000; 20 kt is inside — the altitude sets the value.
    expect(factor(inject({ altitudeFt: 1200 }), 'kinematic')).toMatchObject({
      value: 50,
      detail: '1200 ft · 20 kt — near the small-UAS envelope',
    })
    // 130.5 kt is halfway from 87 to 174.
    expect(factor(inject({ groundSpeedKt: 130.5 }), 'kinematic').value).toBe(50)
    expect(factor(adsb(), 'kinematic')).toMatchObject({
      value: 0,
      detail: '3000 ft · 200 kt — outside the small-UAS envelope',
    })
  })

  it('never lets an unknown reading qualify — a null is a gap, not a low number (#35)', () => {
    expect(factor(inject({ altitudeFt: null }), 'kinematic')).toMatchObject({
      value: 0,
      detail: 'altitude or speed not observed',
    })
    expect(factor(inject({ groundSpeedKt: null }), 'kinematic').value).toBe(0)
  })

  it('does not read a taxiing airliner as a drone (C3)', () => {
    const taxiing = adsb({ onGround: true, altitudeFt: 0, groundSpeedKt: 12 })
    expect(factor(taxiing, 'kinematic').value).toBe(0)
  })
})

describe('time context', () => {
  it('scores 100 outside operating hours and 0 within, as a step', () => {
    expect(factor(inject(), 'time', NIGHT)).toMatchObject({
      value: 100,
      detail: '02:30 local — outside 06:00–22:00',
    })
    expect(factor(inject(), 'time', DAY)).toMatchObject({
      value: 0,
      detail: '10:00 local — within 06:00–22:00',
    })
  })

  it('wraps operating hours that cross midnight (#63)', () => {
    // A night-watch AO: within from 22:00 through 05:59, outside from 06:00 through 21:59.
    const config = { ...SCORING, operatingHours: { open: '22:00', close: '06:00' } }
    const atMinute = (hhmm: string) =>
      factor(inject(), 'time', { ...NIGHT, minuteOfDay: parseClock(hhmm), config })
    expect(atMinute('23:00')).toMatchObject({
      value: 0,
      detail: '23:00 local — within 22:00–06:00',
    })
    expect(atMinute('02:30').value).toBe(0)
    expect(atMinute('05:59').value).toBe(0)
    expect(atMinute('06:00')).toMatchObject({
      value: 100,
      detail: '06:00 local — outside 22:00–06:00',
    })
    expect(atMinute('12:00').value).toBe(100)
    expect(atMinute('21:59').value).toBe(100)
    expect(atMinute('22:00').value).toBe(0)
  })

  it('treats the open minute as within and the close minute as outside', () => {
    const atMinute = (m: number) => factor(inject(), 'time', { ...NIGHT, minuteOfDay: m }).value
    expect(atMinute(parseClock('05:59'))).toBe(100)
    expect(atMinute(parseClock('06:00'))).toBe(0)
    expect(atMinute(parseClock('21:59'))).toBe(0)
    expect(atMinute(parseClock('22:00'))).toBe(100)
  })
})

describe('the clock helpers', () => {
  it('parses HH:MM and refuses anything else', () => {
    expect(parseClock('02:30')).toBe(150)
    expect(parseClock('23:59')).toBe(1439)
    expect(() => parseClock('2:3')).toThrow(/HH:MM/)
    expect(() => parseClock('24:00')).toThrow(/out of range/)
  })

  it('advances the scenario start by whole minutes and wraps at midnight', () => {
    expect(minuteOfDay('02:30', 0)).toBe(150)
    expect(minuteOfDay('02:30', 599)).toBe(159)
    expect(minuteOfDay('23:30', 3600)).toBe(30)
  })

  it('formats a minute of day as the strip and the detail line print it', () => {
    expect(formatClock(150)).toBe('02:30')
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(1439)).toBe('23:59')
  })
})

describe('rememberIdentities', () => {
  it('stamps a heard inject, opens an unheard one as never heard, and ignores ADS-B', () => {
    const memory = rememberIdentities(
      {},
      [inject({ id: 'inject-01', identity: 'cooperative' }), inject({ id: 'inject-02' }), adsb()],
      45,
    )
    expect(memory).toEqual({
      'inject-01': { lastHeardTSec: 45 },
      'inject-02': { lastHeardTSec: null },
    })
  })

  it('keeps the last heard time through unheard frames, and never mutates its input', () => {
    const first = rememberIdentities({}, [inject({ identity: 'cooperative' })], 15)
    const second = rememberIdentities(first, [inject({ identity: 'unknown' })], 30)
    expect(second).toEqual({ 'inject-01': { lastHeardTSec: 15 } })
    expect(first).toEqual({ 'inject-01': { lastHeardTSec: 15 } })
    expect(second).not.toBe(first)
  })

  it('folds the golden’s intermittent inject frame by frame', () => {
    // inject-01 is heard on frames 0–3 and not on frame 4 (the golden's own dropout chain), so
    // after frame 4 the memory still says 45 s — three frames later the dwell has expired and the
    // score is degrading, which is the smoothing the #4 note asked for.
    let memory: IdentityMemory = {}
    for (let index = 0; index <= 4; index++) {
      memory = rememberIdentities(
        memory,
        golden.frames[index].tracks,
        golden.frames[index].tMs / 1000,
      )
    }
    expect(golden.frames[4].tracks.find((t) => t.id === 'inject-01')?.identity).toBe('unknown')
    expect(memory['inject-01']).toEqual({ lastHeardTSec: 45 })
    const quiet = golden.frames[7].tracks.find((t) => t.id === 'inject-01')!
    const value = factor(quiet, 'cooperativity', { tSec: 105, minuteOfDay: 150, memory }).value
    expect(value).toBeGreaterThan(SCORING.cooperativity.heard)
    expect(value).toBeLessThan(SCORING.cooperativity.unknown)
  })
})

describe('the composite', () => {
  it('lists the five factors in §6 order with their labels, weights, and contributions', () => {
    const { factors } = scoreTrack(inject(), SITES, NIGHT)
    expect(factors.map((f) => f.id)).toEqual(FACTORS.map((f) => f.id))
    expect(factors.map((f) => f.label)).toEqual([
      'Identity',
      'Closing',
      'Proximity',
      'Flight profile',
      'Off-hours',
    ])
    for (const f of factors) {
      expect(f.weight).toBe(SCORING.weights[f.id])
      expect(f.contribution).toBeCloseTo((f.value / 100) * f.weight, 9)
    }
  })

  it('sums the contributions to a weighted total, and scores that total over the configured weights', () => {
    // The invariant the handoff and 04b's breakdown print: the factor lines add up to
    // `weighted`; the score is `weighted / totalWeight × 100`, then the ceiling (ruled on #63).
    const score = scoreTrack(inject({ position: at(10_000) }), SITES, NIGHT)
    expect(score.totalWeight).toBe(80)
    expect(score.weighted).toBeCloseTo(
      score.factors.reduce((sum, f) => sum + f.contribution, 0),
      9,
    )
    // The score is made from the total to one decimal — the number the record prints — so the
    // printed division reproduces it by construction (#63, round 2).
    expect(score.total).toBe(Math.round(score.weighted * 10) / 10)
    expect(score.uncapped).toBe((score.total / score.totalWeight) * 100)
    expect(score.composite).toBe(score.uncapped)
    expect(score.capped).toBe(false)
  })

  it('caps an ADS-B track at the ceiling and reports it, leaving the breakdown honest (A3)', () => {
    // An arrival: inside the ring, straight in, seconds out, at 02:30. Uncapped it reads 57.9 (46.25 weighted, scored as 46.3).
    const arrival = adsb({
      position: at(2000),
      altitudeFt: 1000,
      groundSpeedKt: 174,
      headingDeg: 180,
    })
    const score = scoreTrack(arrival, SITES, NIGHT)
    expect(score.uncapped).toBeCloseTo(57.875, 6)
    expect(score.composite).toBe(SCORING.adsbCeiling)
    expect(score.capped).toBe(true)
    expect(score.band).toBe('calm')
    expect(score.factors.find((f) => f.id === 'closing')?.value).toBe(100)
  })

  it('never caps an inject, and leaves an ADS-B track under the ceiling uncapped', () => {
    const drone = scoreTrack(inject(), SITES, NIGHT)
    expect(drone.composite).toBe(100)
    expect(drone.capped).toBe(false)
    const distant = scoreTrack(adsb(), SITES, NIGHT)
    expect(distant.capped).toBe(false)
    expect(distant.composite).toBe(distant.uncapped)
  })

  it('bands the composite at the configured thresholds', () => {
    const { bands } = SCORING
    expect(bandOf(bands.elevated - 0.01, bands)).toBe('calm')
    expect(bandOf(bands.elevated, bands)).toBe('elevated')
    expect(bandOf(bands.alarm, bands)).toBe('alarm')
    expect(scoreTrack(inject(), SITES, NIGHT).band).toBe('alarm')
    expect(scoreTrack(adsb(), SITES, NIGHT).band).toBe('calm')
  })

  it('bands the whole number it prints, so the word never contradicts the score beside it (#63, round 2)', () => {
    // The hand scenario's silent drone in daylight: 70 / 80 = 87.5, printed as 88. With the
    // alarm threshold at 87.6 the exact composite is elevated and the printed one is alarm; the
    // chip says 88, so alarm is the word that agrees with it.
    const config = { ...SCORING, bands: { elevated: 40, alarm: 87.6 } }
    const score = scoreTrack(inject(), SITES, { ...DAY, config })
    expect(score.composite).toBe(87.5)
    expect(score.band).toBe('alarm')
  })

  it('reports the nearest site and the range to it, and refuses to score without one', () => {
    const score = scoreTrack(inject({ position: at(7200) }), SITES, NIGHT)
    expect(score.siteId).toBe(SITE.id)
    expect(score.rangeM).toBeCloseTo(7200, -1)
    expect(() => scoreTrack(inject(), [], NIGHT)).toThrow(/protected site/)
  })

  it('takes its doctrine from the context when one is supplied', () => {
    const config = { ...SCORING, adsbCeiling: 10, bands: { elevated: 5, alarm: 8 } }
    const arrival = adsb({
      position: at(2000),
      altitudeFt: 1000,
      groundSpeedKt: 174,
      headingDeg: 180,
    })
    const score = scoreTrack(arrival, SITES, { ...NIGHT, config })
    expect(score.composite).toBe(10)
    expect(score.band).toBe('alarm')
  })
})

describe('the §2 check — no input makes a real aircraft rank as a threat', () => {
  const ceiling = SCORING.adsbCeiling
  const elevated = SCORING.bands.elevated

  it('holds the ceiling below the elevated band', () => {
    expect(ceiling).toBeLessThan(elevated)
  })

  it('caps every ADS-B track of every frame of the recording, and the cap is doing work', () => {
    let worstUncapped = 0
    for (const frame of capture.frames) {
      const tSec = frame.tMs / 1000
      for (const track of frameTracks(frame)) {
        const score = scoreTrack(track, SITES, { tSec, minuteOfDay: 150, memory: {} })
        expect(score.composite).toBeLessThanOrEqual(ceiling)
        expect(score.band).toBe('calm')
        worstUncapped = Math.max(worstUncapped, score.uncapped)
      }
    }
    // The airport's own arrivals close on the site and end inside its ring: without the ceiling
    // the worst of them would sit in the elevated band. This is why A3 exists.
    expect(worstUncapped).toBeGreaterThan(elevated)
  })

  it('caps adversarial ADS-B tracks: on the site, closing at full, low and slow, at 02:30', () => {
    const adversarial: AdsbTrack[] = [
      adsb({ position: at(0), altitudeFt: 200, groundSpeedKt: 20, headingDeg: 180 }),
      adsb({ position: at(1000), altitudeFt: 300, groundSpeedKt: 40, headingDeg: 180 }),
      adsb({ position: at(SITE.radiusM), altitudeFt: 400, groundSpeedKt: 87, headingDeg: 180 }),
      adsb({ position: at(2000), altitudeFt: 50, groundSpeedKt: 5, headingDeg: 180 }),
    ]
    for (const track of adversarial) {
      const score = scoreTrack(track, SITES, NIGHT)
      expect(score.uncapped).toBeGreaterThan(elevated)
      expect(score.composite).toBe(ceiling)
      expect(score.capped).toBe(true)
      expect(score.band).toBe('calm')
    }
  })
})

describe('the hand-computed scenario', () => {
  // Four tracks with round inputs, scored by hand in the comments and matched by the engine.
  // Weights 25 / 20 / 15 / 10 / 10 sum to 80; composite = contributions ÷ 80 × 100. 02:30 local.
  const A = inject({ id: 'inject-01', position: at(1000) })
  //   A — silent inject 1 km north, straight in at 20 kt, 200 ft.
  //   cooperativity: never heard → 100 × 25 = 25
  //   closing: CPA 0 → 100; TCPA 1000 m ÷ 10.29 m/s = 97 s < 2 min → 100; product 100 × 20 = 20
  //   proximity: inside the ring → 100 × 15 = 15
  //   kinematic: inside the box → 100 × 10 = 10
  //   time: 02:30 → 100 × 10 = 10        → 80 ÷ 80 = 100
  const B = inject({
    id: 'inject-02',
    identity: 'cooperative',
    callsign: 'UAS-1',
    position: at(10_000),
    headingDeg: null,
  })
  //   B — heard Remote ID drone 10 km north, no heading broadcast, 20 kt, 200 ft.
  //   cooperativity: heard → 25 × 25 % = 6.25
  //   closing: heading not observed → 0
  //   proximity: 10 km on the 5 → 15 km ramp → 50 × 15 % = 7.5
  //   kinematic: inside the box → 10
  //   time: 10                          → 33.75, scored as 33.8 ÷ 80 = 42.25
  const C = adsb({
    id: 'adsb-c',
    icaoHex: 'c',
    position: at(2000),
    altitudeFt: 1000,
    groundSpeedKt: 174,
    headingDeg: 180,
  })
  //   C — an arrival 2 km north, straight in at 174 kt, 1,000 ft.
  //   cooperativity: ADS-B → 5 × 25 % = 1.25
  //   closing: CPA 0, TCPA 22 s → 100 × 20 = 20
  //   proximity: inside → 15
  //   kinematic: 174 kt is the end of the speed ramp → 0
  //   time: 10                          → 46.25, scored as 46.3 ÷ 80 = 57.875, capped to 30
  const D = adsb({
    id: 'adsb-d',
    icaoHex: 'd',
    position: SITE.center,
    altitudeFt: 0,
    onGround: true,
    groundSpeedKt: 0,
    headingDeg: null,
  })
  //   D — parked on the site.
  //   cooperativity 1.25; closing, proximity, kinematic on ground → 0; time 10
  //                                      → 11.25, scored as 11.3 ÷ 80 = 14.125
  //
  //   The score is made from the weighted total to one decimal — the number the record prints —
  //   which is why B, C, and D land a hair above the exact quotient (ruled on #63, round 2).

  it('matches the arithmetic', () => {
    const composite = (track: Track) => scoreTrack(track, SITES, NIGHT)
    expect(composite(A)).toMatchObject({ composite: 100, weighted: 80, total: 80 })
    expect(composite(B).weighted).toBeCloseTo(33.75, 9)
    expect(composite(B).total).toBe(33.8)
    expect(composite(B).composite).toBeCloseTo(42.25, 9)
    expect(composite(C)).toMatchObject({ composite: 30, total: 46.3, capped: true })
    expect(composite(C).uncapped).toBeCloseTo(57.875, 9)
    expect(composite(D).composite).toBeCloseTo(14.125, 9)
  })

  it('reads the same in daylight, ten points lower and in the same order', () => {
    // The off-hours step lifts every track together: nothing reorders when the hour crosses it.
    const night = [A, B, C, D].map((t) => scoreTrack(t, SITES, NIGHT).uncapped)
    const day = [A, B, C, D].map((t) => scoreTrack(t, SITES, DAY).uncapped)
    for (let index = 0; index < night.length; index++) {
      expect(night[index] - day[index]).toBeCloseTo(12.5, 9)
    }
  })
})

describe('determinism', () => {
  const frame0: Track[] = [...frameTracks(capture.frames[0]), ...golden.frames[0].tracks]

  it('scores the default picture identically every time', () => {
    const once = frame0.map((t) => scoreTrack(t, SITES, NIGHT))
    const twice = frame0.map((t) => scoreTrack(t, SITES, NIGHT))
    expect(twice).toEqual(once)
  })

  it('scores identically with the display enrichment stripped — enrichment is never scored (§5.1)', () => {
    const stripped = frame0.map((track) =>
      track.source === 'adsb'
        ? { ...track, category: null, registry: null }
        : { ...track, uaType: null },
    )
    expect(stripped.map((t) => scoreTrack(t, SITES, NIGHT))).toEqual(
      frame0.map((t) => scoreTrack(t, SITES, NIGHT)),
    )
  })

  it('prints a total whose division reproduces the score, for every track of every frame (#63, round 2)', () => {
    // The Score line's arithmetic must land in the same band as the number beside it. The total
    // is printed to one decimal, so the division can differ from the true composite by at most
    // 0.0625 points; this sweep is what says that never flips a rounded score in the picture.
    let checked = 0
    for (const frame of capture.frames) {
      const tSec = frame.tMs / 1000
      const injects = golden.frames[Math.round(tSec / 15)]?.tracks ?? []
      for (const track of [...frameTracks(frame), ...injects]) {
        const score = scoreTrack(track, SITES, { tSec, minuteOfDay: 150, memory: {} })
        const [total] = scoreTotal(score).split('/')
        const reproduced = Math.round((Number(total) / score.totalWeight) * 100)
        expect(reproduced).toBe(Math.round(score.uncapped))
        // The band is taken on the printed whole number, so the word beside the score agrees
        // with the arithmetic under it (a 69.6 prints 70 and reads alarm); a capped track's
        // band is the ceiling's.
        if (!score.capped) expect(bandOf(reproduced, SCORING.bands)).toBe(score.band)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(5000)
  })

  it('carries no ground-truth word in any detail line', () => {
    for (const track of frame0) {
      for (const f of scoreTrack(track, SITES, NIGHT).factors) {
        expect(f.detail).not.toMatch(
          /loiter|orbit|lawnmower|transit|silent|intermittent|broadcasting/,
        )
      }
    }
  })
})
