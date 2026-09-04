import { describe, expect, it } from 'vitest'
import {
  describeEvent,
  formatElapsed,
  formatScore,
  roundHeading,
  scoreSummary,
  reasonTag,
  scoreTotal,
  simClock,
  siteKindLine,
  siteLine,
  siteOriginLine,
  capLine,
} from './display'
import { scoreTrack, type Score, type ScoringContext } from './scoring'
import { AO } from '../config/ao'
import { destinationPoint } from './geo'
import type { TrackEvent } from './lifecycle'
import type { RankedTrack } from './ranking'
import type { AdsbTrack, InjectTrack, Track } from './tracks'

/** The record's clock, as the drawer and the handoff supply it. */
const clock = (tSec: number) => simClock('02:30', tSec)

const PHL_SITES = AO.protectedSites.map((site) => ({ ...site, kind: 'protected' as const }))
const SCORE: Score = {
  composite: 82,
  weighted: 65.58,
  total: 65.6,
  totalWeight: 80,
  uncapped: 82,
  capped: false,
  band: 'warning',
  pattern: null,
  rangeM: 7200.2,
  siteId: 'phl-airfield',
  sites: PHL_SITES,
  friendly: false,
  factors: [
    {
      id: 'cooperativity',
      label: 'Identity',
      value: 100,
      weight: 25,
      contribution: 25,
      detail: '',
    },
    { id: 'closing', label: 'Closing', value: 44.4, weight: 20, contribution: 8.9, detail: '' },
    { id: 'proximity', label: 'Proximity', value: 78, weight: 15, contribution: 11.7, detail: '' },
    {
      id: 'kinematic',
      label: 'Flight profile',
      value: 100,
      weight: 10,
      contribution: 10,
      detail: '',
    },
    { id: 'time', label: 'Off-hours', value: 100, weight: 10, contribution: 10, detail: '' },
  ],
}

describe('formatScore', () => {
  it('prints the composite as a whole number', () => {
    expect(formatScore(SCORE)).toBe('82')
    expect(formatScore({ ...SCORE, composite: 30 })).toBe('30')
  })
})

/** The arrival from the handoff tests: uncapped 57.8, capped to 30. */
const CAPPED: Score = {
  ...SCORE,
  composite: 30,
  weighted: 46.25,
  total: 46.3,
  uncapped: 57.875,
  capped: true,
  band: 'calm',
  factors: [
    { ...SCORE.factors[0], value: 5, contribution: 1.25 },
    { ...SCORE.factors[1], value: 100, contribution: 20 },
    { ...SCORE.factors[2], value: 100, contribution: 15 },
    { ...SCORE.factors[3], value: 0, contribution: 0 },
    { ...SCORE.factors[4], value: 100, contribution: 10 },
  ],
}

describe('scoreTotal', () => {
  it('prints the one-decimal total the score is made from, over the configured weights (#63, round 2)', () => {
    // 65.6 / 80 = 82.0 %, the printed score; a sum of rounded parts (66) would read 82.5 %.
    expect(scoreTotal(SCORE)).toBe('65.6/80')
  })

  it('carries the uncapped composite the total makes when the ceiling bound', () => {
    expect(scoreTotal(CAPPED)).toBe('46.3/80 → 58')
  })
})

describe('scoreSummary', () => {
  it('names the three largest contributions, largest first, and their total, for the chip’s hover', () => {
    expect(scoreSummary(SCORE)).toBe('Identity 25 · Proximity 12 · Flight profile 10 (65.6/80)')
  })

  it('leads a capped row with the cap line, so the hover never contradicts the chip (#63)', () => {
    expect(scoreSummary(CAPPED)).toBe(
      'Capped at 30 — cooperative aircraft · Closing 20 · Proximity 15 · Off-hours 10 (46.3/80 → 58)',
    )
  })
})

describe('roundHeading', () => {
  it('rounds to the whole degree both the drawer and the handoff print (#49)', () => {
    expect(roundHeading(345.6)).toBe(346)
    expect(roundHeading(0.3)).toBe(0)
  })

  it('wraps a heading that rounds up to north — 0, never an off-the-compass 360 (#51 review)', () => {
    expect(roundHeading(359.7)).toBe(0)
    expect(roundHeading(359.5)).toBe(0)
    expect(roundHeading(359.4)).toBe(359)
  })
})

describe('simClock', () => {
  it('is the scenario’s time of day at the clock, to the second, wrapping at midnight (06a)', () => {
    expect(simClock('02:30', 0)).toBe('02:30:00')
    expect(simClock('02:30', 187)).toBe('02:33:07')
    expect(simClock('23:59', 61)).toBe('00:00:01')
    // A fractional tick never prints a fraction.
    expect(simClock('02:30', 7.9)).toBe('02:30:07')
  })
})

describe('formatElapsed', () => {
  it('prints the replay position as MM:SS with minutes unbounded', () => {
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(187)).toBe('03:07')
    expect(formatElapsed(1185)).toBe('19:45')
    expect(formatElapsed(3725)).toBe('62:05')
  })
})

describe('describeEvent — band crossings (06b)', () => {
  const crossing = (from: 'calm' | 'caution' | 'warning', to: typeof from) =>
    ({
      trackId: 'inject-05',
      seq: 2,
      at: '2026-09-01T12:06:02.000Z',
      tSec: 187,
      action: 'band',
      from: 'new',
      to: 'new',
      band: { from, to },
      observed: {
        identity: 'non-cooperative',
        rangeM: 7200.2,
        siteId: 'phl-airfield',
        sites: PHL_SITES,
        friendly: false,
        altitudeFt: 63,
        groundSpeedKt: 19.1,
        headingDeg: 345.6,
        score: 72,
        uncapped: 72,
        pattern: null,
        factors: {
          cooperativity: 100,
          closing: 44.4,
          proximity: 78,
          pattern: 0,
          kinematic: 100,
          time: 100,
        },
        weights: {
          cooperativity: 25,
          closing: 20,
          proximity: 15,
          pattern: 15,
          kinematic: 10,
          time: 10,
        },
      },
    }) as const

  it('names the band entered and the one left, up or down, in the one table’s words (#66)', () => {
    expect(describeEvent(crossing('calm', 'caution'), [], [], clock)).toBe('Caution — up from calm')
    expect(describeEvent(crossing('caution', 'warning'), [], [], clock)).toBe(
      'Warning — up from caution',
    )
    expect(describeEvent(crossing('warning', 'calm'), [], [], clock)).toBe(
      'Calm — down from warning',
    )
  })
})

describe('describeEvent — pattern entries and the first-seen word (05b)', () => {
  const observed: TrackEvent['observed'] = {
    identity: 'non-cooperative',
    rangeM: 3000,
    siteId: 'phl-airfield',
    sites: PHL_SITES,
    friendly: false,
    altitudeFt: 230,
    groundSpeedKt: 6,
    headingDeg: 270,
    score: 95,
    uncapped: 95,
    pattern: null,
    factors: {
      cooperativity: 100,
      closing: 100,
      proximity: 100,
      pattern: 70,
      kinematic: 100,
      time: 100,
    },
    weights: {
      cooperativity: 25,
      closing: 20,
      proximity: 15,
      pattern: 15,
      kinematic: 10,
      time: 10,
    },
  }
  const base: TrackEvent = {
    trackId: 'inject-05',
    seq: 2,
    at: '2026-09-01T12:06:02.000Z',
    tSec: 990,
    action: 'pattern',
    from: 'new',
    to: 'new',
    observed,
  }
  const change = (from: 'loiter' | 'orbit' | 'revisit' | null, to: typeof from): TrackEvent => ({
    ...base,
    pattern: { from, to },
  })

  it('names what began and what ended, from the one word table', () => {
    expect(describeEvent(change(null, 'loiter'), [], [], clock)).toBe('Loitering — began')
    expect(describeEvent(change('loiter', null), [], [], clock)).toBe('Loitering — ended')
    expect(describeEvent(change('loiter', 'orbit'), [], [], clock)).toBe(
      'Orbiting — began, loitering ended',
    )
    expect(describeEvent(change(null, 'revisit'), [], [], clock)).toBe('Revisiting — began')
  })

  it('carries the word on a first-seen entry when the track opens with a pattern named', () => {
    const opened: TrackEvent = { ...base, seq: 1, action: 'first-seen', from: null }
    expect(describeEvent(opened, [], [], clock)).toBe('New — first seen')
    expect(
      describeEvent({ ...opened, observed: { ...observed, pattern: 'loiter' } }, [], [], clock),
    ).toBe('New — first seen, loitering')
  })

  it('prints a loss with the time last heard from its own payload, and a return bare (#71, #36 [11])', () => {
    expect(
      describeEvent({ ...base, action: 'lost', lost: { lastHeardTSec: 120 } }, [], [], clock),
    ).toBe('Lost — last heard 02:32:00')
    expect(describeEvent({ ...base, action: 'lost' }, [], [], clock)).toBe('Lost')
    expect(describeEvent({ ...base, action: 'regained' }, [], [], clock)).toBe('Regained')
  })
})

describe('reasonTag (05b, ruled on #5)', () => {
  const SITE = AO.protectedSites[0]
  const at = (rangeM: number) => destinationPoint(SITE.center, 0, rangeM)
  const NIGHT: ScoringContext = { tSec: 0, minuteOfDay: 150, memory: {} }
  const hover = (position: [number, number]) =>
    [...Array(29)].map((_, i) => ({ tSec: i * 15, position }))
  const silent = (position: [number, number]): InjectTrack => ({
    ...{
      id: 'inject-05',
      source: 'inject',
      behavior: 'loiter',
      remoteId: 'silent',
      uaType: null,
      identity: 'non-cooperative',
      callsign: null,
      position: [-75.20547, 39.81341],
      altitudeFt: 63,
      onGround: false,
      groundSpeedKt: 19.1,
      headingDeg: 345.6,
      verticalRateFpm: 85,
      lastSeenSec: 0,
    },
    position,
    altitudeFt: 230,
    groundSpeedKt: 6,
    headingDeg: 270,
  })
  const ranked = (track: Track, context = NIGHT): RankedTrack => {
    const score = scoreTrack(track, AO.protectedSites, context)
    return { track, rank: 1, rangeM: score.rangeM, siteId: score.siteId, score }
  }
  const arrival: AdsbTrack = {
    id: 'adsb-a06461',
    source: 'adsb',
    icaoHex: 'a06461',
    identity: 'cooperative',
    callsign: 'AAL423',
    position: at(2000),
    altitudeFt: 1000,
    onGround: false,
    groundSpeedKt: 174,
    headingDeg: 180,
    verticalRateFpm: -640,
    lastSeenSec: 0,
    category: null,
    registry: null,
  }

  it('leads with the named pattern, then the two largest other contributions', () => {
    const drone = silent(at(3000))
    const entry = ranked(drone, { ...NIGHT, history: { 'inject-05': hover(drone.position) } })
    expect(entry.score.pattern).toBe('loiter')
    expect(reasonTag(entry, AO.protectedSites)).toBe('Loitering, non-cooperative, inside the ring')
  })

  it('names the site outside the ring, and gives a factor a word only at half the scale or more', () => {
    // 7.2 km out, straight in at 19 kt: closing reads 44, under the gate; proximity 78 names the site.
    const entry = ranked({ ...silent(at(7200)), groundSpeedKt: 19.1, headingDeg: 180 })
    expect(entry.score.factors.find((f) => f.id === 'closing')!.value).toBeLessThan(50)
    expect(reasonTag(entry, AO.protectedSites)).toBe(
      'Non-cooperative, near PHL Airfield, low and slow',
    )
    // Closing earns its word once it clears the gate.
    const closing = ranked({ ...silent(at(6000)), groundSpeedKt: 120, headingDeg: 180 })
    expect(reasonTag(closing, AO.protectedSites)).toMatch(/closing/)
  })

  it('reads inside the ring off any enclosing site, as closing does, not the nearest centre (#82 review)', () => {
    // A small decoy ring is the nearest centre, 2 km east of a drone that sits inside PHL's ring.
    const decoy = {
      id: 'decoy',
      name: 'Decoy',
      center: destinationPoint(at(3000), 90, 2000),
      radiusM: 1000,
      tier: 1 as const,
    }
    const entry = ranked(silent(at(3000)))
    const twoSites = [AO.protectedSites[0], decoy]
    const rescored = scoreTrack(entry.track, twoSites, NIGHT)
    const twoSiteEntry = {
      ...entry,
      score: rescored,
      rangeM: rescored.rangeM,
      siteId: rescored.siteId,
    }
    expect(twoSiteEntry.siteId).toBe('decoy')
    expect(rescored.factors.find((f) => f.id === 'closing')!.value).toBe(100)
    expect(reasonTag(twoSiteEntry, twoSites)).toBe('Non-cooperative, inside the ring, low and slow')
  })

  it('reads Cooperative aircraft and nothing else on a real aircraft, capped or not, pattern or not (§2)', () => {
    const entry = ranked(arrival)
    expect(entry.score.capped).toBe(true)
    expect(reasonTag(entry, AO.protectedSites)).toBe('Cooperative aircraft')
    const holding = ranked(arrival, {
      ...NIGHT,
      history: { 'adsb-a06461': hover(arrival.position) },
    })
    expect(holding.score.pattern).toBe('loiter')
    expect(reasonTag(holding, AO.protectedSites)).toBe('Cooperative aircraft')
  })

  it('reads a dash when no factor clears the gate, and a lone word when one does', () => {
    // An airliner under the ceiling, uncapped, still reads the one line a real aircraft gets.
    const far: AdsbTrack = {
      ...arrival,
      id: 'adsb-far',
      icaoHex: 'far',
      callsign: null,
      position: at(60_000),
      altitudeFt: 30_000,
      groundSpeedKt: 400,
      headingDeg: 90,
    }
    const airliner = ranked(far, { ...NIGHT, minuteOfDay: 600 })
    expect(airliner.score.capped).toBe(false)
    expect(reasonTag(airliner, AO.protectedSites)).toBe('Cooperative aircraft')
    // A heard drone far out, high and fast, in daylight: nothing clears the gate.
    const quiet = {
      ...silent(at(30_000)),
      identity: 'cooperative' as const,
      callsign: 'UAS-2',
      altitudeFt: 3000,
      groundSpeedKt: 150,
    }
    expect(reasonTag(ranked(quiet, { ...NIGHT, minuteOfDay: 600 }), AO.protectedSites)).toBe('—')
    const heard = { ...silent(at(30_000)), identity: 'cooperative' as const, callsign: 'UAS-1' }
    expect(reasonTag(ranked(heard, { ...NIGHT, minuteOfDay: 600 }), AO.protectedSites)).toBe(
      'Low and slow',
    )
  })
})

describe('the site lines (08a)', () => {
  const record = { ...AO.protectedSites[0], kind: 'protected' as const }

  it('prints the row’s kind and tier line, and its ring and origin line', () => {
    expect(siteKindLine(record)).toBe('Protected · tier 1')
    expect(siteKindLine({ kind: 'protected', tier: 2 })).toBe('Protected · tier 2')
    expect(siteOriginLine({ ...AO.protectedSites[0], addedTSec: null }, clock)).toBe(
      '5.0 km ring · config',
    )
    expect(siteOriginLine({ ...AO.protectedSites[0], radiusM: 1500, addedTSec: 600 }, clock)).toBe(
      '1.5 km ring · 02:40:00',
    )
  })

  it('prints the handoff’s site line, which fits the 26 rem drawer at the name cap (#36 [5])', () => {
    expect(siteLine(record)).toBe('PHL Airfield · protected · tier 1 · 5.0 km')
    const widest = siteLine({ ...record, name: 'x'.repeat(20), tier: 2, radiusM: 12_000 })
    expect(`  ${widest}`).toHaveLength(53)
  })
})

describe('the friendly launch cap on the row and in the record (08b, ruled on #86)', () => {
  const friendly: Score = {
    ...SCORE,
    composite: 30,
    uncapped: 80,
    capped: true,
    band: 'calm',
    friendly: true,
  }

  it('prints the cap line with the number it held back, and the hover leads with it', () => {
    expect(capLine(friendly)).toBe('Friendly launch — capped at 30 (uncapped 80)')
    expect(capLine({ ...SCORE, composite: 30, capped: true })).toBe(
      'Capped at 30 — cooperative aircraft',
    )
    expect(scoreSummary(friendly)).toMatch(/^Friendly launch — capped at 30 \(uncapped 80\) · /)
  })

  it('leads the reason tag with Friendly launch, the pattern after it', () => {
    const SITE = AO.protectedSites[0]
    const drone: InjectTrack = {
      id: 'inject-02',
      source: 'inject',
      behavior: 'orbit',
      remoteId: 'broadcasting',
      uaType: null,
      identity: 'cooperative',
      callsign: 'UAS-A341',
      position: destinationPoint(SITE.center, 0, 3000),
      altitudeFt: 230,
      onGround: false,
      groundSpeedKt: 6,
      headingDeg: 270,
      verticalRateFpm: 0,
      lastSeenSec: 0,
    }
    const score = scoreTrack(drone, AO.protectedSites, { tSec: 0, minuteOfDay: 150, memory: {} })
    const entry: RankedTrack = {
      track: drone,
      rank: 1,
      rangeM: score.rangeM,
      siteId: score.siteId,
      score,
    }
    const tagged = { ...entry, score: { ...entry.score, friendly: true } }
    expect(reasonTag(tagged, AO.protectedSites)).toMatch(/^Friendly launch, /)
    const patterned = { ...tagged, score: { ...tagged.score, pattern: 'orbit' as const } }
    expect(reasonTag(patterned, AO.protectedSites)).toMatch(/^Friendly launch, orbiting/)
    // A real aircraft's row is untouched by the flag: Cooperative aircraft and nothing else.
    expect(
      reasonTag(
        { ...tagged, track: { ...tagged.track, source: 'adsb' } } as RankedTrack,
        AO.protectedSites,
      ),
    ).toBe('Cooperative aircraft')
  })

  it("prints a friendly area's row and record lines", () => {
    expect(siteKindLine({ kind: 'friendly' })).toBe('Friendly launch area')
    expect(
      siteLine({
        id: 'area-2',
        name: 'Drone unit pad',
        kind: 'friendly',
        center: [0, 0],
        radiusM: 500,
      }),
    ).toBe('Drone unit pad · friendly · 0.5 km')
  })
})
