import { describe, expect, it } from 'vitest'
import { AO } from '../config/ao'
import { PROJECTION } from '../config/projection'
import { destinationPoint, distanceMeters } from './geo'
import { gridTimeline, injectTracksAt, planScenario } from './injects'
import { projectPosition, timeToEntry, type EntrySite, type Projectable } from './projection'

const PHL = AO.protectedSites[0]
const KT_TO_MS = 0.514444

/** A point `m` metres north of the ring's centre. */
const north = (m: number): [number, number] => destinationPoint(PHL.center, 0, m)

/** Airborne, 9 km north of PHL, heading south at 60 kt: 4 km to the ring at 30.9 m/s. */
const inbound: Projectable = {
  position: north(9000),
  headingDeg: 180,
  groundSpeedKt: 60,
  onGround: false,
  lastSeenSec: 0,
}
const INBOUND_S = 4000 / (60 * KT_TO_MS)

/** The scenario as App plans it; the hero is inject-05, silent, on its approach from the south. */
const plan = planScenario(gridTimeline(80, 15000))
const hero = (tSec: number) => injectTracksAt(plan, tSec).find((track) => track.id === 'inject-05')!

describe('timeToEntry', () => {
  it('reads the gate’s numbers off the scenario: 5 min 48 s at 02:33:00, 108 s at 02:37:00, inside from 02:39:00', () => {
    const early = timeToEntry(hero(180), AO.protectedSites)!
    expect(early.kind).toBe('entry')
    if (early.kind === 'entry') expect(Math.round(early.tSec)).toBe(348)
    const near = timeToEntry(hero(420), AO.protectedSites)!
    expect(near).toMatchObject({
      kind: 'entry',
      siteId: 'phl-airfield',
      siteName: 'PHL Airfield',
      tier: 1,
    })
    if (near.kind === 'entry') expect(Math.round(near.tSec)).toBe(108)
    expect(timeToEntry(hero(540), AO.protectedSites)).toEqual({
      kind: 'inside',
      siteId: 'phl-airfield',
      siteName: 'PHL Airfield',
      tier: 1,
      coastedS: null,
    })
  })

  it('ends the path on the ring — the entry point lies within 20 m of the radius, near and far', () => {
    for (const track of [hero(180), hero(300), hero(420), inbound]) {
      const estimate = timeToEntry(track, AO.protectedSites)!
      expect(estimate.kind).toBe('entry')
      if (estimate.kind === 'entry')
        expect(Math.abs(distanceMeters(estimate.point, PHL.center) - PHL.radiusM)).toBeLessThan(1)
    }
    // A fast aircraft 25 km out, straight in: the two frames disagree by metres, not pixels.
    const far = timeToEntry(
      { ...inbound, position: north(25_000), groundSpeedKt: 200 },
      AO.protectedSites,
    )!
    expect(far.kind).toBe('entry')
    if (far.kind === 'entry') {
      expect(Math.abs(distanceMeters(far.point, PHL.center) - PHL.radiusM)).toBeLessThan(20)
      expect(Math.round(far.tSec)).toBe(Math.round(20_000 / (200 * KT_TO_MS)))
    }
  })

  it('solves the closed form: TCPA less the half-chord over the speed', () => {
    const estimate = timeToEntry(inbound, AO.protectedSites)!
    expect(estimate.kind).toBe('entry')
    if (estimate.kind === 'entry') expect(estimate.tSec).toBeCloseTo(INBOUND_S, 0)
  })

  it('reads none past the horizon, opening, on a path that misses the ring, or with speed or heading unobserved', () => {
    const none = { kind: 'none', coastedS: null }
    // 4 km at 10 kt is 778 s: past the 600 s horizon, inside a 900 s one — the horizon is config.
    const slow = { ...inbound, groundSpeedKt: 10 }
    expect(timeToEntry(slow, AO.protectedSites)).toEqual(none)
    expect(PROJECTION.horizonS).toBe(600)
    expect(timeToEntry(slow, AO.protectedSites, { horizonS: 900 })?.kind).toBe('entry')
    expect(timeToEntry({ ...inbound, headingDeg: 0 }, AO.protectedSites)).toEqual(none)
    expect(timeToEntry({ ...inbound, headingDeg: 90 }, AO.protectedSites)).toEqual(none)
    expect(timeToEntry({ ...inbound, groundSpeedKt: null }, AO.protectedSites)).toEqual(none)
    expect(timeToEntry({ ...inbound, headingDeg: null }, AO.protectedSites)).toEqual(none)
    expect(timeToEntry({ ...inbound, groundSpeedKt: 0 }, AO.protectedSites)).toEqual(none)
  })

  it('shows nothing for a track on the ground', () => {
    expect(timeToEntry({ ...inbound, onGround: true }, AO.protectedSites)).toBeNull()
  })

  it('takes the soonest across sites, names the tier unweighted, and inside beats any entry — the nearer enclosing site named', () => {
    // A tier-2 ring on the way in: 1.5 km ahead of the track's edge-to-edge path, so it is met first.
    const decoy: EntrySite = {
      id: 'decoy',
      name: 'Decoy Stadium',
      center: north(7000),
      radiusM: 500,
      tier: 2,
    }
    const soonest = timeToEntry(inbound, [PHL, decoy])!
    expect(soonest).toMatchObject({ kind: 'entry', siteId: 'decoy', tier: 2 })
    if (soonest.kind === 'entry') expect(soonest.tSec).toBeCloseTo(1500 / (60 * KT_TO_MS), 0)
    // The same list the other way round names the same site.
    expect(timeToEntry(inbound, [decoy, PHL])).toEqual(soonest)
    // Enclosed by two rings: inside, the nearer centre named, whatever the tier.
    const near: EntrySite = { id: 'near', name: 'Near', center: north(9100), radiusM: 300, tier: 2 }
    const wide: EntrySite = {
      id: 'wide',
      name: 'Wide',
      center: north(8000),
      radiusM: 2000,
      tier: 1,
    }
    expect(timeToEntry(inbound, [PHL, wide, near])).toMatchObject({
      kind: 'inside',
      siteId: 'near',
      tier: 2,
    })
    expect(timeToEntry(inbound, [near, PHL, wide])).toMatchObject({
      kind: 'inside',
      siteId: 'near',
    })
  })

  it('counts the age off a coasting track, clamps at zero, and carries the age; an interpolated age counts nothing', () => {
    const held = timeToEntry({ ...inbound, lastSeenSec: 30, coasting: true }, AO.protectedSites)!
    expect(held.kind).toBe('entry')
    expect(held.coastedS).toBe(30)
    if (held.kind === 'entry') expect(held.tSec).toBeCloseTo(INBOUND_S - 30, 0)
    const long = timeToEntry({ ...inbound, lastSeenSec: 200, coasting: true }, AO.protectedSites)!
    if (long.kind === 'entry') expect(long.tSec).toBe(0)
    // The point is where the path meets the ring, whatever the age.
    if (held.kind === 'entry' && long.kind === 'entry') expect(long.point).toEqual(held.point)
    const bridged = timeToEntry({ ...inbound, lastSeenSec: 30 }, AO.protectedSites)!
    expect(bridged.coastedS).toBeNull()
    if (bridged.kind === 'entry') expect(bridged.tSec).toBeCloseTo(INBOUND_S, 0)
    // The mark travels on inside and none too, so the caption can say so on every reading.
    expect(
      timeToEntry(
        { ...inbound, headingDeg: 0, lastSeenSec: 12, coasting: true },
        AO.protectedSites,
      ),
    ).toEqual({
      kind: 'none',
      coastedS: 12,
    })
  })

  it('is a function of its inputs alone', () => {
    expect(timeToEntry(hero(420), AO.protectedSites)).toEqual(
      timeToEntry(hero(420), AO.protectedSites),
    )
    expect(timeToEntry(hero(420), AO.protectedSites)).not.toEqual(
      timeToEntry(hero(421), AO.protectedSites),
    )
  })
})

describe('projectPosition', () => {
  it('steps the track out along its heading, and stays put when speed or heading is unobserved or the step is not forward', () => {
    const later = projectPosition(inbound, 100)
    expect(distanceMeters(inbound.position, later)).toBeCloseTo(100 * 60 * KT_TO_MS, 0)
    expect(later[1]).toBeLessThan(inbound.position[1])
    expect(projectPosition({ ...inbound, groundSpeedKt: null }, 100)).toBe(inbound.position)
    expect(projectPosition({ ...inbound, headingDeg: null }, 100)).toBe(inbound.position)
    expect(projectPosition(inbound, 0)).toBe(inbound.position)
    expect(projectPosition(inbound, -5)).toBe(inbound.position)
  })
})
