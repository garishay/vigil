import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BEHAVIORS,
  REMOTE_ID_STATES,
  generateScenario,
  injectTracksAt,
  planScenario,
} from './injects'
import type { InjectScenario } from './injects'
import { AO } from '../config/ao'
import { SCENARIO } from '../config/scenario'
import { distanceMeters } from './geo'
import type { AdsbCapture } from './adsb'
import captureRaw from '../../public/adsb-phl.json?raw'
import goldenRaw from './__fixtures__/injects-vigil-phl-001.json?raw'

// Both fixtures are loaded as raw text rather than as JSON module imports: parsing at runtime
// keeps TypeScript from inferring a literal type for a 600 KB recording, which it does not enjoy.
const capture = JSON.parse(captureRaw) as AdsbCapture
const golden = JSON.parse(goldenRaw) as InjectScenario

/** The timeline the committed recording actually has — read, not assumed. */
const TIMELINE = { frameCount: capture.frames.length, intervalMs: capture.intervalMs }

const allTracks = (scenario: InjectScenario) => scenario.frames.flatMap((frame) => frame.tracks)

describe('determinism', () => {
  it('reproduces the committed golden fixture for the default seed', () => {
    // The acceptance criterion (§11): same seed → identical picture. The golden pins the whole
    // scenario, so drift in the RNG, the geometry, the envelope, or the rounding all fail here.
    expect(generateScenario(TIMELINE)).toEqual(golden)
  })

  it('produces identical output from two separate calls', () => {
    // Would catch module-level RNG state leaking between invocations, which the golden alone
    // could not: a generator that mutates shared state still matches the golden on its first run.
    expect(generateScenario(TIMELINE)).toEqual(generateScenario(TIMELINE))
  })

  it('produces a different picture for a different seed', () => {
    const other = generateScenario(TIMELINE, { ...SCENARIO, seed: 'vigil-phl-002' })
    expect(other).not.toEqual(golden)

    // Asserted on the decisions, not just on the bytes: a generator that ignored the seed and
    // only jittered its output would still fail a bare inequality check for the wrong reason.
    const fingerprint = (scenario: InjectScenario) =>
      scenario.frames[0].tracks.map((t) => `${t.behavior}/${t.remoteId}`).join(',')
    expect(fingerprint(other)).not.toEqual(fingerprint(golden))
  })

  it('reads no clock and no ambient randomness', () => {
    // Proves the property rather than its symptom. Anything reaching for an unseeded source
    // throws here, so the failure names the cause instead of showing a golden diff.
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random is not available to the inject generator')
    })
    const now = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now is not available to the inject generator')
    })
    expect(() => generateScenario(TIMELINE)).not.toThrow()
    expect(random).not.toHaveBeenCalled()
    expect(now).not.toHaveBeenCalled()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })
})

describe('timeline alignment', () => {
  it('samples the frame grid the recording actually has', () => {
    // Binds the two layers together: a recapture at a different interval or length fails CI
    // rather than silently desynchronising the picture PR 06 replays.
    const scenario = generateScenario(TIMELINE)
    expect(scenario.frames.map((frame) => frame.tMs)).toEqual(
      capture.frames.map((frame) => frame.tMs),
    )
    expect(scenario.frameCount).toBe(capture.frames.length)
    expect(scenario.intervalMs).toBe(capture.intervalMs)
  })

  it('carries the same track ids in every frame', () => {
    const scenario = generateScenario(TIMELINE)
    const ids = scenario.frames[0].tracks.map((track) => track.id)
    for (const frame of scenario.frames) {
      expect(frame.tracks.map((track) => track.id)).toEqual(ids)
    }
  })

  it('can be evaluated between frames, for PR 06 to interpolate against', () => {
    const plan = planScenario(TIMELINE)
    const [before, between, after] = [0, 7.5, 15].map((t) => injectTracksAt(plan, t))
    const transit = plan.specs.findIndex((spec) => spec.behavior === 'transit')
    expect(transit).toBeGreaterThanOrEqual(0)

    // A closed-form position, so the midpoint is a real evaluation rather than a snap to a frame.
    const at = (tracks: typeof before) => tracks[transit].position
    expect(at(between)).not.toEqual(at(before))
    expect(at(between)).not.toEqual(at(after))
    expect(distanceMeters(at(before), at(between))).toBeGreaterThan(50)
  })
})

describe('scenario coverage', () => {
  const scenario = generateScenario(TIMELINE)
  const first = scenario.frames[0].tracks

  it('fields 3–8 injects, per scope §5.2', () => {
    expect(first.length).toBeGreaterThanOrEqual(3)
    expect(first.length).toBeLessThanOrEqual(8)
  })

  it('demonstrates every behavior and every Remote ID state', () => {
    // By construction, not by a lucky seed — the default scenario is both the demo and the
    // golden, so the picture a reviewer opens has to contain the whole model.
    expect(new Set(first.map((track) => track.behavior))).toEqual(new Set(BEHAVIORS))
    expect(new Set(first.map((track) => track.remoteId))).toEqual(new Set(REMOTE_ID_STATES))
  })

  it('guarantees that coverage across seeds, not just this one', () => {
    for (const seed of ['a', 'b', 'c', 'vigil-phl-002', 'phl-night']) {
      const tracks = generateScenario(TIMELINE, { ...SCENARIO, seed }).frames[0].tracks
      expect(new Set(tracks.map((t) => t.behavior))).toEqual(new Set(BEHAVIORS))
      expect(new Set(tracks.map((t) => t.remoteId))).toEqual(new Set(REMOTE_ID_STATES))
    }
  })

  it('gives every inject a distinct launch point', () => {
    const plan = planScenario(TIMELINE)
    const launches = plan.specs.map((spec) => spec.launchId)
    expect(new Set(launches).size).toBe(launches.length)
    expect(SCENARIO.launchPoints.length).toBeGreaterThanOrEqual(SCENARIO.maxInjects)
  })
})

describe('launch points', () => {
  it('sit outside every protected site, so an inject has to fly to get inside', () => {
    // Proximity and closing geometry (§6) can only mean something if the ring is entered rather
    // than started in.
    for (const launch of SCENARIO.launchPoints) {
      for (const site of AO.protectedSites) {
        expect(launch.rangeKm * 1000).toBeGreaterThan(site.radiusM)
      }
    }
  })

  it('sit inside the AO bounding box', () => {
    const [west, south, east, north] = AO.bbox
    for (const spec of planScenario(TIMELINE).specs) {
      const [lon, lat] = spec.origin
      expect(lon).toBeGreaterThan(west)
      expect(lon).toBeLessThan(east)
      expect(lat).toBeGreaterThan(south)
      expect(lat).toBeLessThan(north)
    }
  })

  it('are relative to the AO, so relocating Vigil relocates them', () => {
    const elsewhere = { ...AO, center: [-97.0379, 32.8998] as [number, number], protectedSites: [] }
    const moved = planScenario(TIMELINE, SCENARIO, elsewhere)
    for (const spec of moved.specs) {
      expect(distanceMeters(elsewhere.center, spec.origin)).toBeLessThan(11_000)
    }
  })
})

describe('the low-and-slow envelope', () => {
  const tracks = allTracks(generateScenario(TIMELINE))
  const { minAltitudeFt, maxAltitudeFt, maxGroundSpeedKt, maxVerticalRateFpm } = SCENARIO.envelope

  it('holds every inject inside it, on every frame', () => {
    for (const track of tracks) {
      expect(track.altitudeFt).not.toBeNull()
      expect(track.altitudeFt as number).toBeGreaterThanOrEqual(minAltitudeFt)
      expect(track.altitudeFt as number).toBeLessThanOrEqual(maxAltitudeFt)
      expect(track.groundSpeedKt).toBeGreaterThanOrEqual(0)
      expect(track.groundSpeedKt).toBeLessThanOrEqual(maxGroundSpeedKt)
      expect(Math.abs(track.verticalRateFpm ?? 0)).toBeLessThanOrEqual(maxVerticalRateFpm)
    }
  })

  it('never puts an inject on the ground', () => {
    expect(tracks.every((track) => track.onGround === false)).toBe(true)
  })

  it('derives ground speed from the distance actually covered', () => {
    // Not declared alongside the motion: a track cannot claim a speed its positions contradict.
    const plan = planScenario(TIMELINE)
    const [before, after] = [60, 75].map((t) => injectTracksAt(plan, t))
    for (let i = 0; i < plan.specs.length; i++) {
      const travelled = distanceMeters(before[i].position, after[i].position)
      expect(after[i].groundSpeedKt).toBeCloseTo(travelled / 15 / 0.514444, 0)
    }
  })
})

describe('behaviors', () => {
  const plan = planScenario(TIMELINE)
  const specFor = (behavior: string) => {
    const index = plan.specs.findIndex((spec) => spec.behavior === behavior)
    expect(index).toBeGreaterThanOrEqual(0)
    return index
  }
  const trackFor = (behavior: string, tSec: number) => injectTracksAt(plan, tSec)[specFor(behavior)]
  const rangeToSite = (behavior: string, tSec: number) =>
    distanceMeters(AO.protectedSites[0].center, trackFor(behavior, tSec).position)

  it('transit holds a course and keeps going', () => {
    const headings = [120, 300, 600, 900].map((t) => trackFor('transit', t).headingDeg ?? 0)
    for (const heading of headings) expect(heading).toBeCloseTo(headings[0], 0)
    expect(rangeToSite('transit', 0)).toBeGreaterThan(rangeToSite('transit', 600))
  })

  it('loiter arrives, then stays put', () => {
    const spec = plan.specs[specFor('loiter')]
    const dwell = spec.inboundS
    const positions = [dwell + 60, dwell + 300, dwell + 600].map(
      (t) => trackFor('loiter', t).position,
    )
    for (const position of positions) {
      expect(distanceMeters(positions[0], position)).toBeLessThan(2 * spec.radiusM + 1)
    }
    // Dwelling, not parked: it moves, just nowhere.
    expect(distanceMeters(positions[0], positions[2])).toBeGreaterThan(0)
  })

  it('orbit keeps a constant radius about a fixed center and comes back around', () => {
    const spec = plan.specs[specFor('orbit')]
    const samples = [60, 180, 300, 420].map((t) => trackFor('orbit', spec.inboundS + t).position)
    const center = samples.map((p) => distanceMeters(p, samples[0]))
    // Every sample sits within a diameter of every other — a closed pattern, not a departure.
    for (const d of center) expect(d).toBeLessThanOrEqual(2 * spec.radiusM + 1)

    const period = (2 * Math.PI * spec.radiusM) / spec.speedMs
    const start = trackFor('orbit', spec.inboundS + 1).position
    const lap = trackFor('orbit', spec.inboundS + 1 + period).position
    expect(distanceMeters(start, lap)).toBeLessThan(spec.radiusM / 4)
  })

  it('lawnmower reverses course lane by lane', () => {
    const spec = plan.specs[specFor('lawnmower')]
    const legS = spec.legM / spec.speedMs
    const outbound = trackFor('lawnmower', spec.inboundS + legS * 0.5).headingDeg ?? 0
    const back = trackFor(
      'lawnmower',
      spec.inboundS + (spec.legM + spec.laneM) / spec.speedMs + legS * 0.5,
    )
    const reversed = Math.abs((((back.headingDeg ?? 0) - outbound + 540) % 360) - 180)
    expect(reversed).toBeGreaterThan(150)
  })

  it('approach-retreat closes on the site and then opens again', () => {
    const spec = plan.specs[specFor('approach-retreat')]
    const start = rangeToSite('approach-retreat', 0)
    const closest = rangeToSite('approach-retreat', spec.periodS / 2)
    const back = rangeToSite('approach-retreat', spec.periodS * 0.9)
    expect(closest).toBeLessThan(start)
    expect(closest).toBeCloseTo(spec.nearM, -1)
    expect(back).toBeGreaterThan(closest)
  })
})

describe('Remote ID', () => {
  const plan = planScenario(TIMELINE)
  const scenario = generateScenario(TIMELINE)
  const framesFor = (id: string) =>
    scenario.frames.map((frame) => frame.tracks.find((track) => track.id === id)!)

  it('maps a broadcasting inject to a cooperative identity on every frame', () => {
    for (const spec of plan.specs.filter((s) => s.remoteId === 'broadcasting')) {
      const frames = framesFor(spec.id)
      expect(frames.every((track) => track.identity === 'cooperative')).toBe(true)
      expect(frames.every((track) => track.callsign === spec.label)).toBe(true)
    }
  })

  it('maps a silent inject to non-cooperative, with no ident at all', () => {
    for (const spec of plan.specs.filter((s) => s.remoteId === 'silent')) {
      const frames = framesFor(spec.id)
      expect(frames.every((track) => track.identity === 'non-cooperative')).toBe(true)
      expect(frames.every((track) => track.callsign === null)).toBe(true)
    }
  })

  it('actually drops an intermittent broadcast in and out across frames', () => {
    // The label is not a costume: `intermittent` means the broadcast is genuinely missing on
    // some frames, which is what makes `unknown` a state the Queue can display.
    const intermittent = plan.specs.filter((spec) => spec.remoteId === 'intermittent')
    expect(intermittent.length).toBeGreaterThan(0)
    for (const spec of intermittent) {
      const identities = framesFor(spec.id).map((track) => track.identity)
      expect(identities).toContain('cooperative')
      expect(identities).toContain('unknown')
      expect(identities).not.toContain('non-cooperative')
    }
  })

  it('drops out in runs rather than one frame at a time', () => {
    for (const spec of plan.specs.filter((s) => s.remoteId === 'intermittent')) {
      let longest = 0
      let current = 0
      for (const heard of spec.heard) {
        current = heard ? 0 : current + 1
        longest = Math.max(longest, current)
      }
      expect(longest).toBeGreaterThanOrEqual(2)
    }
  })

  it('loses the ident on exactly the frames the broadcast is missing', () => {
    for (const spec of plan.specs.filter((s) => s.remoteId === 'intermittent')) {
      framesFor(spec.id).forEach((track, index) => {
        expect(track.callsign).toBe(spec.heard[index] ? spec.label : null)
      })
    }
  })

  it('holds the heard state between frames instead of interpolating it', () => {
    const plan = planScenario(TIMELINE)
    const spec = plan.specs.find((s) => s.remoteId === 'intermittent')!
    const index = plan.specs.indexOf(spec)
    for (let frame = 0; frame < 8; frame++) {
      const t = frame * plan.intervalS
      const mid = injectTracksAt(plan, t + plan.intervalS / 2)[index]
      const on = injectTracksAt(plan, t)[index]
      expect(mid.identity).toBe(on.identity)
    }
  })
})

describe('guardrails (§2)', () => {
  it('only ever produces inject-sourced tracks', () => {
    // Nothing in this module can mint an AdsbTrack, and nothing in the scenario claims to be one.
    for (const track of allTracks(generateScenario(TIMELINE))) {
      expect(track.source).toBe('inject')
      expect(track.id.startsWith('inject-')).toBe(true)
    }
  })

  it('gives injects synthetic idents that cannot collide with a real callsign', () => {
    for (const spec of planScenario(TIMELINE).specs) {
      expect(spec.label).toMatch(/^UAS-[0-9A-F]{4}$/)
    }
  })
})
