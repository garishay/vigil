/**
 * The synthetic layer (scope §5.2): 3–8 simulated small UAS, seeded and deterministic.
 *
 * Pure — no React, no DOM, no I/O, no clock, and no `Math.random` (an ESLint rule in
 * `eslint.config.js` enforces the last two rather than trusting anyone to remember). Every
 * random choice comes from `makeRng(seed)` in a fixed order, which is what makes the committed
 * golden fixture a meaningful test rather than a formality.
 *
 * **Motion is closed-form in time, not integrated from the previous frame.** `positionAt(spec, t)`
 * depends on `t` alone, so PR 06 can seek to any instant without replaying, evaluate between
 * fixture frames (issue #6), and never accumulate float drift across eighty steps.
 *
 * **Speed and heading are derived from the motion, not declared alongside it.** A track cannot
 * claim 5 kt while covering 300 m in fifteen seconds, because the ground speed *is* the distance
 * it covered. The same goes for vertical rate.
 *
 * Only injects can score as threats (§2). Nothing in this module can produce an `AdsbTrack`.
 */

import { AO } from '../config/ao.ts'
import type { AreaOfOperations } from '../config/ao.ts'
import { SCENARIO } from '../config/scenario.ts'
import type { ScenarioConfig } from '../config/scenario.ts'
import { bearingDegrees, destinationPoint, distanceMeters, offsetPoint, round } from './geo.ts'
import { makeRng } from './rng.ts'
import type { Rng } from './rng.ts'
import type { Behavior, Identity, InjectTrack, RemoteIdStatus, UaType } from './tracks.ts'

/** Every behavior in the model (§5.2). Exported so the coverage guarantee is testable. */
export const BEHAVIORS = [
  'transit',
  'loiter',
  'orbit',
  'lawnmower',
  'approach-retreat',
] as const satisfies readonly Behavior[]

/** Every Remote ID state in the model. */
export const REMOTE_ID_STATES = [
  'broadcasting',
  'intermittent',
  'silent',
] as const satisfies readonly RemoteIdStatus[]

/** Every UA type an inject can broadcast (§5.2). Exported so the draw's range is testable. */
export const UA_TYPES = [
  'multirotor',
  'aeroplane',
  'hybrid-lift',
] as const satisfies readonly UaType[]

const KT_TO_MS = 0.514444

/**
 * The span over which motion is measured, seconds.
 *
 * Deliberately a constant rather than the timeline's frame interval: a track's reported ground
 * speed should not change when PR 06 advances the replay clock at 1 Hz instead of every 15 s. It
 * is *set* to the capture's cadence so both layers report motion over comparable spans.
 */
const KINEMATIC_WINDOW_S = 15

/** The frame grid the scenario is sampled on — supplied by the caller, never read from disk. */
export interface Timeline {
  frameCount: number
  intervalMs: number
}

/**
 * One inject's entire future, decided at plan time. Every random draw in the scenario lives here;
 * everything after this point is arithmetic.
 */
export interface InjectSpec {
  id: string
  /** The synthetic Remote ID label. Shown only on frames where the broadcast is heard. */
  label: string
  behavior: Behavior
  remoteId: RemoteIdStatus
  /** The UA type the Remote ID broadcast carries. Shown only on frames the broadcast is heard. */
  uaType: UaType
  launchId: string
  origin: [number, number]
  /** The protected site the approach-retreat leg works against. */
  site: [number, number]
  /** Outbound course from the launch point, degrees true. */
  courseDeg: number
  speedMs: number
  /** Seconds of inbound transit before the pattern begins — loiter, orbit, and lawnmower. */
  inboundS: number
  baseAltitudeFt: number
  climbFt: number
  climbS: number
  /** Orbit radius, or loiter wander radius, meters. */
  radiusM: number
  /** Lawnmower leg length and lane spacing, meters. */
  legM: number
  laneM: number
  /** Approach-retreat: closest approach to the site, and the full out-and-back period. */
  nearM: number
  periodS: number
  /**
   * Per frame, whether the Remote ID broadcast was heard. Populated only for `intermittent` —
   * `broadcasting` is always heard and `silent` never is, so neither needs a timeline.
   */
  heard: boolean[]
}

export interface InjectPlan {
  seed: string
  /** The frame spacing the `heard` timeline is indexed on, seconds. */
  intervalS: number
  specs: InjectSpec[]
}

export interface InjectFrame {
  tMs: number
  tracks: InjectTrack[]
}

export interface InjectScenario {
  seed: string
  frameCount: number
  intervalMs: number
  frames: InjectFrame[]
}

/*
 * Every emitted number is quantized — `round` from geo.ts, or `Math.round` with the same `+ 0`.
 *
 * `Math.sin` and friends are not specified to agree bit-for-bit across engines, so the generator
 * rounds at its boundary: five decimals of longitude is about a meter, matching the ADS-B
 * fixture's precision and sitting orders of magnitude above any plausible trig disagreement. That
 * is what lets the golden-fixture test be an exact deep-equal instead of a tolerance compare —
 * and a tolerance compare is the one that quietly stops catching regressions.
 */

/**
 * `count` values in which every one of `values` appears at least once.
 *
 * The default scenario is simultaneously the demo and the golden fixture, so it has to exercise
 * the whole model — all five behaviors, all three Remote ID states. Guaranteeing that by
 * construction beats hunting for a seed that happens to do it, and "room permitting" is not left
 * to configuration either: `planScenario` refuses a floor below the behavior count.
 */
function coverThenFill<T>(rng: Rng, values: readonly T[], count: number): T[] {
  const out = rng.shuffle(values).slice(0, count)
  while (out.length < count) out.push(rng.pick(values))
  return out
}

/** One of `weights`' keys, with probability proportional to its weight. One draw, always. */
function weightedPick<T extends string>(rng: Rng, weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][]
  let draw = rng.next() * entries.reduce((sum, [, weight]) => sum + weight, 0)
  for (const [value, weight] of entries) {
    draw -= weight
    if (draw < 0) return value
  }
  return entries[entries.length - 1][0]
}

/** Where the scripted pattern starts: the launch point, run in along the course for `inboundS`. */
function patternOrigin(spec: InjectSpec, tSec: number): [number, number] {
  return destinationPoint(spec.origin, spec.courseDeg, spec.speedMs * Math.min(tSec, spec.inboundS))
}

/**
 * Position at `tSec`, in [longitude, latitude].
 *
 * Every pattern is continuous where it joins its inbound leg — the orbit is centered off to one
 * side so the drone rolls onto the circle rather than teleporting to its rim, and the loiter
 * wander starts at zero offset. A discontinuity here would surface as a speed spike, because the
 * speed is derived from the position.
 */
function positionAt(spec: InjectSpec, tSec: number): [number, number] {
  const t = Math.max(0, tSec)
  const anchor = patternOrigin(spec, t)
  switch (spec.behavior) {
    case 'transit':
      return destinationPoint(spec.origin, spec.courseDeg, spec.speedMs * t)
    case 'loiter': {
      if (t <= spec.inboundS) return anchor
      const phase = (t - spec.inboundS) / 90
      // Two sine terms on an irrational-ish frequency ratio: a wander that does not retrace
      // itself, and is still a function of `t` alone.
      return offsetPoint(
        anchor,
        spec.radiusM * Math.sin(phase),
        spec.radiusM * Math.sin(phase * 0.618),
      )
    }
    case 'orbit': {
      if (t <= spec.inboundS) return anchor
      const center = destinationPoint(anchor, (spec.courseDeg + 90) % 360, spec.radiusM)
      const sweepDeg = ((spec.speedMs / spec.radiusM) * (t - spec.inboundS) * 180) / Math.PI
      return destinationPoint(center, (spec.courseDeg - 90 + sweepDeg + 360) % 360, spec.radiusM)
    }
    case 'lawnmower': {
      if (t <= spec.inboundS) return anchor
      const run = spec.speedMs * (t - spec.inboundS)
      // The turn onto the next lane is part of the path, not a jump between lanes: one cycle is
      // a leg plus a lane shift, and the drone flies both. Stepping the lane offset instantly
      // would displace it by the lane spacing in a single sample, which reads as a speed spike.
      const cycleM = spec.legM + spec.laneM
      const lane = Math.floor(run / cycleM)
      const withinM = run - lane * cycleM
      const legRun = Math.min(withinM, spec.legM)
      const along = lane % 2 === 0 ? legRun : spec.legM - legRun
      const across = lane * spec.laneM + Math.max(0, withinM - spec.legM)
      return destinationPoint(
        destinationPoint(anchor, spec.courseDeg, along),
        (spec.courseDeg + 90) % 360,
        across,
      )
    }
    case 'approach-retreat': {
      const farM = distanceMeters(spec.site, spec.origin)
      const phase = (t % spec.periodS) / spec.periodS
      // A triangle wave: 1 at the launch point, 0 at closest approach, back to 1. The reversal is
      // instantaneous, so the one sample that straddles it reports a low ground speed — a true
      // statement about the distance covered in that window, not a glitch.
      const away = phase < 0.5 ? 1 - 2 * phase : 2 * phase - 1
      return destinationPoint(
        spec.site,
        bearingDegrees(spec.site, spec.origin),
        spec.nearM + (farM - spec.nearM) * away,
      )
    }
  }
}

/** Altitude at `tSec`: a climb from the launch height onto a cruise height, then level. */
function altitudeAt(spec: InjectSpec, tSec: number): number {
  const fraction = Math.min(1, Math.max(0, tSec) / spec.climbS)
  return spec.baseAltitudeFt + spec.climbFt * fraction
}

/**
 * Whether the Remote ID broadcast is heard at `tSec`.
 *
 * Held between frames rather than interpolated: whether a broadcast arrived is an observation,
 * not a quantity, and there is no meaningful value halfway between heard and not.
 */
function isHeard(spec: InjectSpec, intervalS: number, tSec: number): boolean {
  if (spec.remoteId === 'broadcasting') return true
  if (spec.remoteId === 'silent') return false
  const index = Math.floor(Math.max(0, tSec) / intervalS)
  return spec.heard[Math.min(index, spec.heard.length - 1)] ?? false
}

/**
 * One inject as a track at `tSec`.
 *
 * `identity` is *observed*, not copied from the label: an intermittent inject reads `cooperative`
 * on the frames its broadcast is heard and `unknown` on the frames it is not. `remoteId` is the
 * ground truth about the airframe; `identity` is what the picture can actually tell. PR 04 scores
 * the second, never the first.
 */
function trackAt(spec: InjectSpec, intervalS: number, tSec: number): InjectTrack {
  const t = Math.max(0, tSec)
  // The kinematic window is clamped forward at the start of the run, so frame zero reports the
  // motion it is about to make rather than dividing by nothing.
  const to = Math.max(t, KINEMATIC_WINDOW_S)
  const from = to - KINEMATIC_WINDOW_S
  const a = positionAt(spec, from)
  const b = positionAt(spec, to)
  const travelM = distanceMeters(a, b)
  const position = positionAt(spec, t)
  const heard = isHeard(spec, intervalS, t)
  const identity: Identity =
    spec.remoteId === 'silent' ? 'non-cooperative' : heard ? 'cooperative' : 'unknown'

  return {
    id: spec.id,
    source: 'inject',
    behavior: spec.behavior,
    remoteId: spec.remoteId,
    identity,
    callsign: heard ? spec.label : null,
    // Heard with the ident, lost with it: the same observed/not-observed rule (#22).
    uaType: heard ? spec.uaType : null,
    position: [round(position[0], 5), round(position[1], 5)],
    altitudeFt: Math.round(altitudeAt(spec, t)) + 0,
    onGround: false,
    groundSpeedKt: round(travelM / KINEMATIC_WINDOW_S / KT_TO_MS, 1),
    // A hovering drone has no meaningful course, and the model already allows for that.
    headingDeg: travelM < 1 ? null : round(bearingDegrees(a, b), 1),
    verticalRateFpm:
      Math.round(((altitudeAt(spec, to) - altitudeAt(spec, from)) / KINEMATIC_WINDOW_S) * 60) + 0,
    // Injects are freshly observed every frame; staleness accrual belongs to the replay clock.
    lastSeenSec: 0,
  }
}

/**
 * Every random decision in the scenario, made once, in a fixed order.
 *
 * **A scenario is a function of seed and config alone; the timeline samples it and never
 * reshapes it** (§5.2). That holds because the main stream draws the same number of values for
 * every inject whatever its behavior — every parameter is drawn even where the behavior ignores
 * it — and because the one timeline-length-dependent draw, the intermittent dropout chain, comes
 * from a stream derived per inject rather than from the main one. Lengthening the recording adds
 * frames to that chain; it cannot reshuffle the injects that come after it.
 */
export function planScenario(
  timeline: Timeline,
  config: ScenarioConfig = SCENARIO,
  ao: AreaOfOperations = AO,
): InjectPlan {
  if (config.minInjects < BEHAVIORS.length) {
    throw new Error(
      `minInjects is ${config.minInjects}; it must be at least ${BEHAVIORS.length} so every behavior appears in every scenario`,
    )
  }
  const rng = makeRng(config.seed)
  const intervalS = timeline.intervalMs / 1000
  const site = ao.protectedSites[0]?.center ?? ao.center
  const count = config.minInjects + rng.int(config.maxInjects - config.minInjects + 1)
  const behaviors = coverThenFill(rng, BEHAVIORS, count)
  const remoteIds = coverThenFill(rng, REMOTE_ID_STATES, count)
  const launchPoints = rng.shuffle(config.launchPoints).slice(0, count)

  const specs: InjectSpec[] = []
  for (let index = 0; index < count; index++) {
    const behavior = behaviors[index]
    const remoteId = remoteIds[index]
    const launch = launchPoints[index]
    const origin = destinationPoint(ao.center, launch.bearingDeg, launch.rangeKm * 1000)
    const patterned = behavior === 'loiter' || behavior === 'orbit' || behavior === 'lawnmower'

    const speedKt =
      behavior === 'approach-retreat'
        ? rng.range(28, 33)
        : behavior === 'lawnmower'
          ? rng.range(12, 18)
          : behavior === 'transit'
            ? rng.range(22, 30)
            : rng.range(16, 22)
    const speedMs = speedKt * KT_TO_MS
    // How close to the protected site the scripted pattern sets up. Inside the ring for some
    // injects and outside it for others — which is the whole point of PR 04's proximity factor.
    const patternRangeM = rng.range(1200, 4200)
    const radiusM = behavior === 'orbit' ? rng.range(450, 900) : rng.range(150, 320)
    const legM = rng.range(1200, 1900)
    const laneM = rng.range(220, 380)
    const nearM = rng.range(800, 1400)
    const baseAltitudeFt = rng.range(50, 90)
    const cruiseFt = patterned ? rng.range(130, 280) : rng.range(200, 400)
    const climbS = rng.range(90, 180)
    // Courses point at the protected site, off by a few degrees so the picture is not a starburst.
    const courseDeg = (bearingDegrees(origin, site) + rng.range(-12, 12) + 360) % 360
    const label = `UAS-${rng.int(0x10000).toString(16).toUpperCase().padStart(4, '0')}`
    const id = `inject-${String(index + 1).padStart(2, '0')}`

    // The UA type came after the golden was pinned, so it draws from its own per-inject stream
    // (the a2 pattern, #16): the shared stream above is untouched and every value it dealt
    // stands. Drawn for every inject — the stream is its own, so it costs nothing, and a silent
    // inject's value is simply never observed.
    const uaType = weightedPick(makeRng(`${config.seed}:${id}:ua-type`), config.uaTypes)

    // The dropout chain is the only draw whose length depends on the timeline, so it gets its own
    // stream, seeded by the scenario and the inject — never the shared one above.
    const heard: boolean[] = []
    if (remoteId === 'intermittent') {
      const chain = makeRng(`${config.seed}:${id}:remote-id`)
      let on = true
      for (let frame = 0; frame < timeline.frameCount; frame++) {
        if (frame > 0) {
          on = chain.bool(on ? config.remoteId.pStayHeard : 1 - config.remoteId.pStaySilent)
        }
        heard.push(on)
      }
    }

    specs.push({
      id,
      label,
      behavior,
      remoteId,
      uaType,
      launchId: launch.id,
      origin,
      site,
      courseDeg,
      speedMs,
      inboundS: patterned ? Math.max(0, (launch.rangeKm * 1000 - patternRangeM) / speedMs) : 0,
      baseAltitudeFt,
      climbFt: cruiseFt - baseAltitudeFt,
      climbS,
      radiusM,
      legM,
      laneM,
      nearM,
      // Derived, not drawn: the period that carries this inject from its launch point to its
      // closest approach and back, at the speed it was given.
      periodS: (2 * (distanceMeters(site, origin) - nearM)) / speedMs,
      heard,
    })
  }
  return { seed: config.seed, intervalS, specs }
}

/**
 * The inject picture at an arbitrary instant.
 *
 * Continuous in `tSec` by design — PR 06's replay clock interpolates the ADS-B fixture between
 * its 15-second samples, and injects need no such treatment because they can simply be asked.
 */
export function injectTracksAt(plan: InjectPlan, tSec: number): InjectTrack[] {
  return plan.specs.map((spec) => trackAt(spec, plan.intervalS, tSec))
}

/** The whole scenario, sampled onto the timeline's frame grid. */
export function generateScenario(
  timeline: Timeline,
  config: ScenarioConfig = SCENARIO,
  ao: AreaOfOperations = AO,
): InjectScenario {
  const plan = planScenario(timeline, config, ao)
  const frames: InjectFrame[] = []
  for (let index = 0; index < timeline.frameCount; index++) {
    const tMs = index * timeline.intervalMs
    frames.push({ tMs, tracks: injectTracksAt(plan, tMs / 1000) })
  }
  return {
    seed: plan.seed,
    frameCount: timeline.frameCount,
    intervalMs: timeline.intervalMs,
    frames,
  }
}
