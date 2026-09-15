import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BEHAVIORS,
  REMOTE_ID_STATES,
  SCRIPTED_BEHAVIORS,
  UA_TYPES,
  generateScenario,
  gridTimeline,
  injectOriginsOf,
  injectTracksAt,
  planScenario,
  timelineOf,
} from './injects'
import type { InjectScenario, ScriptedMotion } from './injects'
import { AO } from '../config/ao'
import { SCENARIO, type CastEntry } from '../config/scenario'
import { SCORING } from '../config/scoring'
import { bearingDegrees, destinationPoint, distanceMeters } from './geo'
import { detectPattern } from './patterns'
import type { AdsbCapture } from './adsb'
import { BEHAVIORS_SCENARIO } from './__fixtures__/behaviors'
import captureRaw from '../../public/adsb-phl.json?raw'
import goldenRaw from './__fixtures__/injects-vigil-phl-001.json?raw'
import behaviorsGoldenRaw from './__fixtures__/injects-vigil-phl-001-behaviors.json?raw'

// Both fixtures are loaded as raw text rather than as JSON module imports: parsing at runtime
// keeps TypeScript from inferring a literal type for a 1.3 MB recording, which it does not enjoy.
const capture = JSON.parse(captureRaw) as AdsbCapture
const golden = JSON.parse(goldenRaw) as InjectScenario
const behaviorsGolden = JSON.parse(behaviorsGoldenRaw) as InjectScenario

/** The timeline the committed recording actually has — read, not assumed. */
const TIMELINE = timelineOf(capture)

const allTracks = (scenario: InjectScenario) => scenario.frames.flatMap((frame) => frame.tracks)

describe('determinism', () => {
  it('reproduces the committed golden fixture for the default seed', () => {
    // The acceptance criterion (§11): same seed → identical picture. The golden pins the whole
    // scenario, so drift in the RNG, the geometry, the envelope, or the rounding all fail here.
    expect(generateScenario(TIMELINE)).toEqual(golden)
  })

  it('keeps the answer key on the golden’s frames and off the picture’s tracks (#115, A3)', () => {
    // The golden is the generator's own record and carries what each inject was flown from; the
    // picture `injectTracksAt` hands the app never builds those two fields at all.
    const plan = planScenario(TIMELINE)
    for (const tSec of [0, 15, 600, 1185]) {
      const picture = injectTracksAt(plan, tSec)
      const frame = golden.frames.find((f) => f.tMs === tSec * 1000)!
      expect(picture).toHaveLength(frame.tracks.length)
      picture.forEach((track, i) => {
        expect(track).not.toHaveProperty('behavior')
        expect(track).not.toHaveProperty('remoteId')
        const { behavior, remoteId, ...observed } = frame.tracks[i]
        expect([behavior, remoteId]).toEqual([plan.specs[i].behavior, plan.specs[i].remoteId])
        expect(track).toEqual(observed)
      })
    }
  })

  it('reads a recording’s timeline ascending whatever order its file holds the frames in (#125 re-review)', () => {
    // `Timeline.frameTimesMs` is documented ascending, and the grid the dropout chain is drawn on
    // reads the last element as the span: a file with its frames out of order must deal the same
    // plan as the same file in order — a scenario is a function of seed and config alone (§5.2).
    const ordered = gridTimeline(3, 15000)
    const shuffled = timelineOf({
      intervalMs: 15000,
      frames: [{ tMs: 0 }, { tMs: 30000 }, { tMs: 15000 }],
    })
    expect(shuffled).toEqual(ordered)
    expect(planScenario(shuffled)).toEqual(planScenario(ordered))
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
    const perf = vi.spyOn(performance, 'now').mockImplementation(() => {
      throw new Error('performance.now is not available to the inject generator')
    })
    expect(() => generateScenario(TIMELINE)).not.toThrow()
    expect(random).not.toHaveBeenCalled()
    expect(now).not.toHaveBeenCalled()
    expect(perf).not.toHaveBeenCalled()
  })

  it('is a function of seed and config alone — the timeline samples it, never reshapes it', () => {
    // A recapture one frame longer must add a frame to every inject, not replace the scenario:
    // every drawn parameter is identical, and the dropout chain is the old one plus one entry.
    const short = planScenario(gridTimeline(80, 15000))
    const long = planScenario(gridTimeline(81, 15000))
    expect(long.specs.map((spec) => ({ ...spec, heard: spec.heard.slice(0, 80) }))).toEqual(
      short.specs,
    )
    expect(long.specs.some((spec) => spec.heard.length === 81)).toBe(true)
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

  it('reads the frame times a recording has — a hole is a hole in both layers, not a stale offset', () => {
    // #39: the timeline used to be rebuilt from an index, so every frame after a hole paired
    // the real picture with inject positions one gap stale. Frames 10–14 are missing here, the
    // hole a tolerated 429 leaves; the plan is the contiguous one — the dropout chain is drawn
    // on the span, not the count — and every kept frame is sampled at its own instant.
    const contiguous = gridTimeline(80, 15000)
    const holed = {
      intervalMs: 15000,
      frameTimesMs: contiguous.frameTimesMs.filter((tMs) => tMs < 150_000 || tMs >= 225_000),
    }
    expect(holed.frameTimesMs).toHaveLength(75)
    expect(planScenario(holed)).toEqual(planScenario(contiguous))
    const whole = generateScenario(contiguous)
    const gappy = generateScenario(holed)
    expect(gappy.frames.map((frame) => frame.tMs)).toEqual(holed.frameTimesMs)
    for (const frame of gappy.frames) {
      expect(frame).toEqual(whole.frames.find((other) => other.tMs === frame.tMs))
    }
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

  it('fields 5–8 injects, per scope §5.2', () => {
    expect(first.length).toBeGreaterThanOrEqual(5)
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

  it('refuses a config whose floor is below the behavior count', () => {
    // "By construction" must not depend on a config edit staying unmade. §5.2 says 5–8 for
    // exactly this reason.
    expect(() => generateScenario(TIMELINE, { ...SCENARIO, minInjects: 3 })).toThrow(/at least 5/)
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
    const elsewhere = { ...AO, center: [-100.0, 40.0] as [number, number], protectedSites: [] }
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
    const period = (2 * Math.PI * spec.radiusM) / spec.speedMs
    // The center the generator orbits: one radius to the right of where the inbound leg ends.
    const entry = trackFor('orbit', spec.inboundS).position
    const center = destinationPoint(entry, (spec.courseDeg + 90) % 360, spec.radiusM)

    // Constant radius: every sample sits one radius from the center. A hovering drone fails this
    // — it would sit at the entry point, a full radius away from where it should be.
    for (const t of [0, period / 8, period / 3, period / 2, period * 0.8]) {
      const at = trackFor('orbit', spec.inboundS + t).position
      expect(distanceMeters(center, at)).toBeCloseTo(spec.radiusM, -1)
    }

    // Actually moving around it: a quarter period apart is a chord of R√2, not zero.
    const a = trackFor('orbit', spec.inboundS + period / 4).position
    const b = trackFor('orbit', spec.inboundS + period / 2).position
    expect(distanceMeters(a, b)).toBeGreaterThan(spec.radiusM)

    // And closed: one lap later it is back where it started.
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

  it('carries the UA type with the ident — heard together, lost together (03c)', () => {
    for (const spec of plan.specs) {
      expect(UA_TYPES).toContain(spec.uaType)
      framesFor(spec.id).forEach((track, index) => {
        const heard =
          spec.remoteId === 'broadcasting' ||
          (spec.remoteId === 'intermittent' && spec.heard[index])
        expect(track.uaType).toBe(heard ? spec.uaType : null)
        expect(track.uaType === null).toBe(track.callsign === null)
      })
    }
    // The golden exercises the fallback: the intermittent inject is unheard on some frames.
    const intermittent = plan.specs.find((spec) => spec.remoteId === 'intermittent')!
    expect(framesFor(intermittent.id).some((track) => track.uaType === null)).toBe(true)
    expect(framesFor(intermittent.id).some((track) => track.uaType !== null)).toBe(true)
  })

  it('draws the UA type from its own stream, so it moved no previously pinned value (03c)', () => {
    // Re-weighting the draw changes UA types and nothing else — every other spec field is
    // dealt by the shared stream, which the UA-type draw never touches (the a2 pattern, #16).
    const reweighted = planScenario(TIMELINE, {
      ...SCENARIO,
      uaTypes: { multirotor: 0, aeroplane: 0, 'hybrid-lift': 1 },
    })
    const levelled = (specs: typeof plan.specs) =>
      specs.map((spec) => ({ ...spec, uaType: 'multirotor' as const }))
    expect(levelled(reweighted.specs)).toEqual(levelled(plan.specs))
    expect(reweighted.specs.every((spec) => spec.uaType === 'hybrid-lift')).toBe(true)
    expect(plan.specs.some((spec) => spec.uaType !== 'hybrid-lift')).toBe(true)
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

describe('the Remote ID broadcast on the picture (S1, #132, ruled A3)', () => {
  const plan = planScenario(TIMELINE)

  it('rides with the ident — heard together, lost together — and claims the observed position', () => {
    for (const tMs of TIMELINE.frameTimesMs) {
      for (const track of injectTracksAt(plan, tMs / 1000)) {
        if (track.callsign === null) expect(track.broadcast).toBeNull()
        else expect(track.broadcast).toEqual({ label: track.callsign, position: track.position })
      }
    }
    // The golden exercises both: a broadcasting inject always carries one, a silent one never.
    const frame0 = injectTracksAt(plan, 0)
    expect(frame0.some((track) => track.broadcast !== null)).toBe(true)
    expect(frame0.some((track) => track.broadcast === null)).toBe(true)
    // The generator's own record carries it too — the golden's diff is this field and nothing else.
    expect(allTracks(golden).every((track) => 'broadcast' in track)).toBe(true)
  })
})

describe('the cast (S2a, #133, ruled A1–A2)', () => {
  const plan = planScenario(TIMELINE, BEHAVIORS_SCENARIO)
  const castSpecs = plan.specs.filter((spec) => spec.script !== null)

  it('leaves the deal exactly as it is without a cast — the 001 golden holds by construction', () => {
    expect(plan.specs.filter((spec) => spec.script === null)).toEqual(planScenario(TIMELINE).specs)
    expect(generateScenario(TIMELINE)).toEqual(golden)
    expect(
      SCRIPTED_BEHAVIORS.every((behavior) => !(BEHAVIORS as readonly string[]).includes(behavior)),
    ).toBe(true)
  })

  it('numbers cast injects from inject-11, the same under every seed and every deal', () => {
    expect(castSpecs.map((spec) => spec.id)).toEqual([
      'inject-11',
      'inject-12',
      'inject-13',
      'inject-14',
    ])
    expect(castSpecs.map((spec) => spec.launchId)).toEqual(['cast', 'cast', 'cast', 'cast'])
    const other = planScenario(TIMELINE, { ...BEHAVIORS_SCENARIO, seed: 'b' })
    expect(other.specs.filter((spec) => spec.script !== null).map((spec) => spec.id)).toEqual([
      'inject-11',
      'inject-12',
      'inject-13',
      'inject-14',
    ])
    expect(castSpecs.map((spec) => spec.behavior)).toEqual([...SCRIPTED_BEHAVIORS, 'transit-orbit'])
  })

  it('draws a cast inject’s label, UA type, and dropout chain from streams keyed by its id — deterministic, and untouched by the timeline', () => {
    for (const spec of castSpecs) {
      expect(spec.label).toMatch(/^UAS-[0-9A-F]{4}$/)
      expect(UA_TYPES).toContain(spec.uaType)
    }
    const scripted = { ...BEHAVIORS_SCENARIO.cast![0], label: 'UAS-8F21' }
    const named = planScenario(TIMELINE, { ...BEHAVIORS_SCENARIO, cast: [scripted] })
    expect(named.specs.at(-1)!.label).toBe('UAS-8F21')
    const longer = planScenario(gridTimeline(81, 15000), BEHAVIORS_SCENARIO)
    const short = planScenario(gridTimeline(80, 15000), BEHAVIORS_SCENARIO)
    expect(longer.specs.map((spec) => ({ ...spec, heard: spec.heard.slice(0, 80) }))).toEqual(
      short.specs,
    )
  })

  it('may carry no deal at all — cast-only — and refuses a scenario with neither (opt-in, ruled)', () => {
    const castOnly = planScenario(TIMELINE, { ...BEHAVIORS_SCENARIO, minInjects: 0, maxInjects: 0 })
    expect(castOnly.specs.map((spec) => spec.id)).toEqual([
      'inject-11',
      'inject-12',
      'inject-13',
      'inject-14',
    ])
    expect(castOnly.specs).toEqual(castSpecs)
    expect(() =>
      planScenario(TIMELINE, { ...SCENARIO, minInjects: 0, maxInjects: 0, cast: [] }),
    ).toThrow(/needs a deal or a cast/)
    // The floor still binds a deal when there is one, cast or no cast.
    expect(() => planScenario(TIMELINE, { ...BEHAVIORS_SCENARIO, minInjects: 3 })).toThrow(
      /at least 5/,
    )
  })

  it('reproduces the committed behaviors golden, and 001’s own is byte-identical', () => {
    expect(generateScenario(TIMELINE, BEHAVIORS_SCENARIO)).toEqual(behaviorsGolden)
    // 9 tracks until the return appears at 120 s, 10 from then on (inject-14 since S2b).
    expect([...new Set(behaviorsGolden.frames.map((frame) => frame.tracks.length))]).toEqual([
      9, 10,
    ])
    expect(behaviorsGolden.frames.find((frame) => frame.tracks.length === 10)!.tMs).toBe(120_000)
  })

  it('holds a cast inject inside the envelope while it flies, and only a landed return on the ground', () => {
    const { minAltitudeFt, maxAltitudeFt, maxGroundSpeedKt, maxVerticalRateFpm } = SCENARIO.envelope
    for (const track of allTracks(behaviorsGolden)) {
      if (track.onGround) {
        expect(track.behavior).toBe('return-to-launch')
        expect(track).toMatchObject({ altitudeFt: 0, groundSpeedKt: 0, headingDeg: null })
        continue
      }
      expect(track.altitudeFt as number).toBeLessThanOrEqual(maxAltitudeFt)
      expect(track.groundSpeedKt).toBeLessThanOrEqual(maxGroundSpeedKt)
      expect(Math.abs(track.verticalRateFpm ?? 0)).toBeLessThanOrEqual(maxVerticalRateFpm)
      // A return descends below the launch floor on its way onto the pad; nothing else does.
      if (track.behavior !== 'return-to-launch') {
        expect(track.altitudeFt as number).toBeGreaterThanOrEqual(minAltitudeFt)
      }
    }
    expect(allTracks(behaviorsGolden).some((track) => track.onGround)).toBe(true)
  })
})

describe('the shuttle (S2a, ruled A3)', () => {
  const plan = planScenario(TIMELINE, BEHAVIORS_SCENARIO)
  const spec = plan.specs.find((s) => s.behavior === 'shuttle')!
  const script = spec.script as Extract<ScriptedMotion, { kind: 'shuttle' }>
  const legS = script.legM / spec.speedMs
  const track = (t: number) => injectTracksAt(plan, t).find((s) => s.id === spec.id)!

  it('flies a triangle wave between its two points at one speed', () => {
    expect(script.legM).toBeCloseTo(1001, 0)
    expect(distanceMeters(track(0).position, spec.origin)).toBeLessThan(2)
    expect(distanceMeters(track(legS).position, script.to)).toBeLessThan(2)
    expect(distanceMeters(track(2 * legS).position, spec.origin)).toBeLessThan(2)
    expect(distanceMeters(track(legS / 2).position, spec.origin)).toBeCloseTo(script.legM / 2, -1)
    for (const t of [30, 60, 200, 300]) expect(track(t).groundSpeedKt).toBeCloseTo(15, 0)
    // Outbound and return legs point opposite ways.
    const out = track(60).headingDeg!
    const back = track(60 + legS).headingDeg!
    expect(Math.abs(((((back - out) % 360) + 360) % 360) - 180)).toBeLessThan(2)
  })

  it('is named a revisit by the detector once it has been out and back', () => {
    const history = (t: number) =>
      [...Array(Math.floor(t / 15) + 1)]
        .map((_, i) => i * 15)
        .filter((s) => s >= t - SCORING.pattern.windowS)
        .map((s) => ({ tSec: s, position: track(s).position }))
    expect(detectPattern(history(120), SCORING.pattern).kind).toBeNull()
    expect(detectPattern(history(240), SCORING.pattern).kind).toBe('revisit')
    expect(detectPattern(history(520), SCORING.pattern).kind).toBe('revisit')
  })
})

describe('transit then orbit (S2a, ruled A4)', () => {
  const plan = planScenario(TIMELINE, BEHAVIORS_SCENARIO)
  const spec = plan.specs.find((s) => s.behavior === 'transit-orbit')!
  const script = spec.script as Extract<ScriptedMotion, { kind: 'transit-orbit' }>
  const track = (t: number) => injectTracksAt(plan, t).find((s) => s.id === spec.id)!
  const site = AO.protectedSites[0].center

  it('runs its course straight until it first meets the configured circle, then holds the radius', () => {
    expect(script.meetS).toBeCloseTo(191.9, 0)
    expect(script.meetM).toBeCloseTo(3456, -1)
    for (const t of [30, 100, 180]) {
      expect(track(t).headingDeg).toBeCloseTo(335, 0)
      expect(distanceMeters(spec.origin, track(t).position)).toBeCloseTo(spec.speedMs * t, -1)
    }
    for (const t of [200, 300, 450, 600, 1000]) {
      expect(distanceMeters(script.center, track(t).position)).toBeCloseTo(800, -1)
      if (t > script.meetS + 15) expect(track(t).groundSpeedKt).toBeCloseTo(35, 0)
    }
    // Inside the ring from 122 s, and the closest approach to the site is on the circle.
    expect(distanceMeters(site, track(122).position)).toBeCloseTo(5000, -3)
    expect(distanceMeters(site, track(300).position)).toBeLessThan(3000)
  })

  it('is continuous across the transition — no jump, one speed', () => {
    const before = track(script.meetS - 1).position
    const after = track(script.meetS + 1).position
    expect(distanceMeters(before, after)).toBeLessThan(2 * spec.speedMs + 5)
    expect(distanceMeters(before, after)).toBeGreaterThan(spec.speedMs)
  })

  it('is named an orbit once the held turn passes the half circle', () => {
    const history = (t: number) =>
      [...Array(Math.floor(t / 15) + 1)]
        .map((_, i) => i * 15)
        .filter((s) => s >= t - SCORING.pattern.windowS)
        .map((s) => ({ tSec: s, position: track(s).position }))
    expect(detectPattern(history(180), SCORING.pattern).kind).toBeNull()
    expect(detectPattern(history(420), SCORING.pattern).kind).toBe('orbit')
  })

  it('refuses at plan time a course that never meets its circle, in so many words', () => {
    const entry = BEHAVIORS_SCENARIO.cast![1]
    const off = {
      ...entry,
      orbit: { center: { bearingDeg: 60, rangeKm: 3.0 }, radiusM: 800 },
    }
    expect(() => planScenario(TIMELINE, { ...BEHAVIORS_SCENARIO, cast: [off] })).toThrow(
      /cast inject-11: the course 335° never meets its orbit circle — the centre lies \d+\.\d km off the course, radius 800 m/,
    )
    const behind = { ...entry, courseDeg: 155 }
    expect(() => planScenario(TIMELINE, { ...BEHAVIORS_SCENARIO, cast: [behind] })).toThrow(
      /behind the origin/,
    )
  })
})

describe('return to launch (S2a, ruled A5, the descent clamp)', () => {
  const plan = planScenario(TIMELINE, BEHAVIORS_SCENARIO)
  const spec = plan.specs.find((s) => s.behavior === 'return-to-launch')!
  const script = spec.script as Extract<ScriptedMotion, { kind: 'return-to-launch' }>
  const find = (t: number) => injectTracksAt(plan, t).find((s) => s.id === spec.id)

  it('appears at its start time, at its origin, and not before (opt-in, ruled)', () => {
    expect(spec.startS).toBe(120)
    expect(find(0)).toBeUndefined()
    expect(find(119)).toBeUndefined()
    const first = find(120)!
    expect(distanceMeters(first.position, spec.origin)).toBeLessThan(2)
    expect(first).toMatchObject({ onGround: false, altitudeFt: 200, identity: 'cooperative' })
    expect(first.groundSpeedKt).toBeCloseTo(20, 0)
    // Its origin is its own first frame, for the friendly condition (ruled).
    expect(injectOriginsOf(plan)[spec.id]).toEqual(first.position)
    expect(injectOriginsOf(plan)['inject-01']).toEqual(injectTracksAt(plan, 0)[0].position)
  })

  it('flies straight to the pad, descends onto it, and lands — still, on the ground', () => {
    expect(script.arriveS).toBeCloseTo(38.9, 0)
    const inbound = find(120 + 20)!
    expect(inbound.headingDeg).toBeCloseTo(20, 0)
    expect(inbound.onGround).toBe(false)
    const landed = find(120 + 40)!
    expect(distanceMeters(landed.position, script.pad)).toBeLessThan(2)
    expect(landed).toMatchObject({
      onGround: true,
      altitudeFt: 0,
      groundSpeedKt: 0,
      headingDeg: null,
      verticalRateFpm: 0,
    })
    expect(find(1000)).toMatchObject({ onGround: true, position: landed.position })
  })

  it('clamps the 60 s descent to the leg when the leg is shorter, and keeps 60 s on a longer one', () => {
    // The mocked decoy's leg is 39 s: it descends from its first frame (ruled).
    expect(script.descentS).toBeCloseTo(script.arriveS, 6)
    expect(find(120)!.altitudeFt).toBe(200)
    expect(find(120 + script.arriveS / 2)!.altitudeFt).toBeCloseTo(100, -1)
    // A 2 km leg at 20 kt is 194 s: level until 60 s out, then down.
    const longReturn: CastEntry = {
      behavior: 'return-to-launch',
      remoteId: 'broadcasting',
      speedKt: 20,
      altitudeFt: 200,
      from: { bearingDeg: 200, rangeKm: 6.0 },
      pad: { bearingDeg: 200, rangeKm: 4.0 },
    }
    const long = planScenario(TIMELINE, {
      ...BEHAVIORS_SCENARIO,
      cast: [longReturn],
    })
    const longScript = long.specs.at(-1)!.script as Extract<
      ScriptedMotion,
      { kind: 'return-to-launch' }
    >
    expect(longScript.arriveS).toBeCloseTo(194, 0)
    expect(longScript.descentS).toBe(60)
    const at = (t: number) => injectTracksAt(long, t).at(-1)!
    expect(at(100).altitudeFt).toBe(200)
    expect(at(longScript.arriveS - 30).altitudeFt).toBeCloseTo(100, -1)
    expect(at(longScript.arriveS + 1)).toMatchObject({ onGround: true, altitudeFt: 0 })
  })
})

describe('round 1 of #142 — the cast refuses what it cannot fly, and flies what it accepts honestly', () => {
  const entry = BEHAVIORS_SCENARIO.cast![1] as Extract<CastEntry, { behavior: 'transit-orbit' }>
  const withCast = (cast: CastEntry[]) => planScenario(TIMELINE, { ...BEHAVIORS_SCENARIO, cast })

  it('turns onto the circle toward the side the centre lies on — a centre to the left is joined counter-clockwise, not by a reversal', () => {
    // The fixture's centre lies to the right of the course and turns clockwise, as before. Moved
    // 790 m to the left — bearing 170.3° at 3.0 km — the course still meets the circle, and the
    // track must turn the other way: the heading a quarter-minute after the meeting stays within
    // a right angle of the inbound course, where a clockwise sweep would reverse it by ~170°.
    const left = withCast([
      { ...entry, orbit: { center: { bearingDeg: 170.3, rangeKm: 3.0 }, radiusM: 800 } },
    ])
    const spec = left.specs.at(-1)!
    const script = spec.script as Extract<ScriptedMotion, { kind: 'transit-orbit' }>
    expect(script.turn).toBe(-1)
    const at = (t: number) => injectTracksAt(left, t).at(-1)!
    const inbound = at(script.meetS - 20).headingDeg!
    const after = at(script.meetS + 20).headingDeg!
    const turned = Math.abs(((((after - inbound) % 360) + 360) % 360) - 180)
    expect(turned).toBeGreaterThan(90)
    for (const t of [script.meetS + 30, script.meetS + 120, script.meetS + 400]) {
      expect(distanceMeters(script.center, at(t).position)).toBeCloseTo(800, -1)
    }
    // The fixture's own centre, to the right: clockwise, as the golden holds it.
    const right = planScenario(TIMELINE, BEHAVIORS_SCENARIO).specs.find(
      (s) => s.behavior === 'transit-orbit',
    )!
    expect((right.script as Extract<ScriptedMotion, { kind: 'transit-orbit' }>).turn).toBe(1)
  })

  it('refuses a shuttle whose two points are the same place, rather than flying NaN', () => {
    const shuttle = BEHAVIORS_SCENARIO.cast![0] as Extract<CastEntry, { behavior: 'shuttle' }>
    expect(() => withCast([{ ...shuttle, to: shuttle.from }])).toThrow(
      /cast inject-11: the shuttle's two points are the same place/,
    )
  })

  it('refuses a deal that could reach inject-11 beside a cast, so no id can collide silently', () => {
    const wide = {
      ...BEHAVIORS_SCENARIO,
      minInjects: 11,
      maxInjects: 12,
      launchPoints: Array.from({ length: 12 }, (_, i) => ({
        id: `lp-${i}`,
        name: `launch ${i}`,
        bearingDeg: i * 30,
        rangeKm: 8,
      })),
    }
    expect(() => planScenario(TIMELINE, wide)).toThrow(/a scenario with a cast deals at most 10/)
    // The same deal with no cast is fine, and the cast beside a deal of ten is fine.
    expect(() => planScenario(TIMELINE, { ...wide, cast: [] })).not.toThrow()
    expect(() => planScenario(TIMELINE, { ...wide, minInjects: 5, maxInjects: 10 })).not.toThrow()
  })

  it('refuses an origin already inside its orbit circle in its own words, not as a miss', () => {
    expect(() => withCast([{ ...entry, from: entry.orbit.center }])).toThrow(
      /cast inject-11: its origin lies inside its orbit circle — 0 m from the centre, radius 800 m; start it outside/,
    )
  })

  it('never prints zero altitude on an airborne return — the last fraction of the descent rounds to 1 ft', () => {
    const plan = planScenario(TIMELINE, BEHAVIORS_SCENARIO)
    const spec = plan.specs.find((s) => s.behavior === 'return-to-launch')!
    const script = spec.script as Extract<ScriptedMotion, { kind: 'return-to-launch' }>
    // A tick 0.05 s before the arrival: the descent is at 0.26 ft, airborne still.
    const justBefore = injectTracksAt(plan, spec.startS + script.arriveS - 0.05).find(
      (t) => t.id === spec.id,
    )!
    expect(justBefore.onGround).toBe(false)
    expect(justBefore.altitudeFt).toBe(1)
    const landed = injectTracksAt(plan, spec.startS + script.arriveS + 0.01).find(
      (t) => t.id === spec.id,
    )!
    expect(landed).toMatchObject({ onGround: true, altitudeFt: 0 })
    // Zero altitude only on the ground, on every frame of the golden.
    for (const track of allTracks(behaviorsGolden)) {
      if (track.altitudeFt === 0) expect(track.onGround).toBe(true)
    }
  })
})

describe('the broadcast offset (S2b, #134, ruled A1)', () => {
  const plan = planScenario(TIMELINE, BEHAVIORS_SCENARIO)
  const lying = plan.specs.find((spec) => spec.broadcastOffset !== null)!
  const at = (t: number) => injectTracksAt(plan, t).find((track) => track.id === lying.id)!

  it('moves the broadcast’s claimed position by the entry’s constant vector, and nothing else', () => {
    expect(lying.id).toBe('inject-14')
    expect(lying.broadcastOffset).toEqual({ bearingDeg: 90, distanceM: 1100 })
    for (const t of [0, 60, 120, 300, 600]) {
      const track = at(t)
      expect(track.broadcast).not.toBeNull()
      expect(distanceMeters(track.position, track.broadcast!.position)).toBeCloseTo(1100, 0)
      expect(bearingDegrees(track.position, track.broadcast!.position)).toBeCloseTo(90, 0)
      expect(track.broadcast!.label).toBe('UAS-8F21')
    }
    // The sensor's track is untouched: the same motion as the same entry without the offset,
    // and the generator's record still says heard — the feed decides what the picture shows.
    const straight = planScenario(TIMELINE, {
      ...BEHAVIORS_SCENARIO,
      cast: BEHAVIORS_SCENARIO.cast!.map((entry) =>
        entry.broadcastOffset ? { ...entry, broadcastOffset: undefined } : entry,
      ),
    })
    const same = (t: number) => injectTracksAt(straight, t).find((track) => track.id === lying.id)!
    for (const t of [0, 60, 300]) {
      const { broadcast: _a, ...moving } = at(t)
      const { broadcast: _b, ...moved } = same(t)
      expect(moving).toEqual(moved)
      expect(same(t).broadcast!.position).toEqual(same(t).position)
    }
    expect(at(60)).toMatchObject({ identity: 'cooperative', callsign: 'UAS-8F21' })
  })

  it('is a function of the entry alone — no seed, timeline, or dealt inject reads it', () => {
    const other = planScenario(gridTimeline(81, 15000), { ...BEHAVIORS_SCENARIO, seed: 'b' })
    const spec = other.specs.find((s) => s.id === lying.id)!
    expect(spec.broadcastOffset).toEqual(lying.broadcastOffset)
    for (const spec of plan.specs.filter((s) => s.id !== lying.id)) {
      expect(spec.broadcastOffset).toBeNull()
    }
    for (const track of injectTracksAt(planScenario(TIMELINE), 300)) {
      if (track.broadcast) expect(track.broadcast.position).toEqual(track.position)
    }
  })

  it('reproduces the behaviors golden with inject-14, and 001’s own is byte-identical', () => {
    expect(generateScenario(TIMELINE, BEHAVIORS_SCENARIO)).toEqual(behaviorsGolden)
    expect(generateScenario(TIMELINE)).toEqual(golden)
    const fourteen = allTracks(behaviorsGolden).filter((track) => track.id === 'inject-14')
    expect(fourteen).toHaveLength(80)
    for (const track of fourteen) {
      expect(track).toMatchObject({ identity: 'cooperative', callsign: 'UAS-8F21' })
      expect(distanceMeters(track.position, track.broadcast!.position)).toBeCloseTo(1100, 0)
    }
  })
})
