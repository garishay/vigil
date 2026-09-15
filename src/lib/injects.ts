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
import type { CastEntry, Placement, ScenarioConfig } from '../config/scenario.ts'
import {
  KT_TO_MS,
  bearingDegrees,
  destinationPoint,
  distanceMeters,
  firstMeeting,
  offsetPoint,
  round,
} from './geo.ts'
import { makeRng } from './rng.ts'
import type { Rng } from './rng.ts'
import type {
  Behavior,
  GeneratedInjectTrack,
  Identity,
  InjectTrack,
  RemoteIdStatus,
  UaType,
} from './tracks.ts'

/**
 * The behaviors the generator deals (§5.2) — the pool `coverThenFill` covers in every scenario.
 * Exported so the coverage guarantee is testable. The cast behaviors are not in it (S2a, #133,
 * ruled A1): a pool of eight would re-deal the default scenario and move its golden.
 */
export const BEHAVIORS = [
  'transit',
  'loiter',
  'orbit',
  'lawnmower',
  'approach-retreat',
] as const satisfies readonly Behavior[]

/** The behaviors a scenario's cast can script (S2a) — never dealt, so the deal is untouched. */
export const SCRIPTED_BEHAVIORS = [
  'shuttle',
  'transit-orbit',
  'return-to-launch',
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

/**
 * The span over which motion is measured, seconds.
 *
 * Deliberately a constant rather than the timeline's frame interval: a track's reported ground
 * speed should not change when PR 06 advances the replay clock at 1 Hz instead of every 15 s. It
 * is *set* to the capture's cadence so both layers report motion over comparable spans.
 */
const KINEMATIC_WINDOW_S = 15

/**
 * The instants the scenario is sampled at — the recording's own frame times, supplied by the
 * caller and never read from disk. They need not be contiguous: a hole in the recording is a
 * hole in both layers, never a stale offset (#39).
 */
export interface Timeline {
  intervalMs: number
  /** Milliseconds since the capture began, one per frame the recording actually has, ascending. */
  frameTimesMs: readonly number[]
}

/**
 * The timeline a recording actually has — read from its frames, never assumed from their count.
 * Sorted by time, not trusted to be, as `indexCapture` sorts its samples: the ascending contract
 * above holds by construction, so the grid the dropout chain is drawn on reads the true span and
 * a feed's health walks the same order its picture reads (#125 re-review). A no-op on every
 * committed recording, whose frames are in order — the golden holds.
 */
export function timelineOf(capture: {
  intervalMs: number
  frames: readonly { tMs: number }[]
}): Timeline {
  return {
    intervalMs: capture.intervalMs,
    frameTimesMs: capture.frames.map((frame) => frame.tMs).sort((a, b) => a - b),
  }
}

/** A contiguous grid of `frameCount` frames — the timeline a recording with no holes has. */
export function gridTimeline(frameCount: number, intervalMs: number): Timeline {
  return { intervalMs, frameTimesMs: Array.from({ length: frameCount }, (_, i) => i * intervalMs) }
}

/**
 * Slots from 0 to the last instant inclusive: the grid the dropout chain is drawn on. Sized by
 * span rather than by count, so a gappy recording and a contiguous one of the same length deal
 * the same plan — the §5.2 invariant, kept by construction.
 */
function gridLength(timeline: Timeline): number {
  const last = timeline.frameTimesMs[timeline.frameTimesMs.length - 1]
  return last === undefined ? 0 : Math.floor(last / timeline.intervalMs) + 1
}

/**
 * A cast behavior's motion, decided at plan time (S2a, #133): the shuttle's far point and leg;
 * the transit-orbit's circle with the metre along the course where it is first met, and the
 * second; the return's pad with its arrival and the descent that ends on it. Closed-form in the
 * inject's own time, like every other motion here.
 */
export type ScriptedMotion =
  | { kind: 'shuttle'; to: [number, number]; legM: number }
  | {
      kind: 'transit-orbit'
      center: [number, number]
      radiusM: number
      meetM: number
      meetS: number
      /** +1 clockwise for a centre to the right of the course, −1 for one to the left (#142 round 1). */
      turn: 1 | -1
    }
  | { kind: 'return-to-launch'; pad: [number, number]; arriveS: number; descentS: number }

/** The descent a return to launch flies onto its pad, seconds — clamped to a shorter leg (ruled). */
const DESCENT_S = 60

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
   * Scenario seconds at which the inject first appears (S2a, opt-in): absent from the picture
   * before it, its motion clocked from it. 0 for every dealt inject.
   */
  startS: number
  /** A cast behavior's motion, precomputed at plan time; null for a dealt inject. */
  script: ScriptedMotion | null
  /**
   * Where the broadcast claims to be, relative to the observed track (S2b, #134): a constant
   * vector on every heard frame; null for a dealt inject and for a cast entry without one, whose
   * broadcast claims the observed position.
   */
  broadcastOffset: { bearingDeg: number; distanceM: number } | null
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

/** One frame of the generator's own record — the tracks with the answer key they were flown from. */
export interface InjectFrame {
  tMs: number
  tracks: GeneratedInjectTrack[]
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
    case 'shuttle': {
      const script = scripted(spec, 'shuttle')
      // A triangle wave between the two points — out along the leg, back along it, at one speed.
      // The turnaround is instantaneous, as approach-retreat's reversal is: the one sample that
      // straddles it reports the distance it actually covered.
      const legS = script.legM / spec.speedMs
      const phase = (t % (2 * legS)) / legS
      const frac = phase <= 1 ? phase : 2 - phase
      return destinationPoint(
        spec.origin,
        bearingDegrees(spec.origin, script.to),
        script.legM * frac,
      )
    }
    case 'transit-orbit': {
      const script = scripted(spec, 'transit-orbit')
      // Straight along the course until it first meets the configured circle, then around it
      // from that point at the same speed, turning toward the side the centre lies on — the
      // dealt orbit turns one way because it places its centre to the right; a cast centre is
      // given, so the sense is read off the geometry (#142 round 1). Continuous by
      // construction: the meeting point lies on the course and on the circle (ruled A4).
      if (t <= script.meetS) return destinationPoint(spec.origin, spec.courseDeg, spec.speedMs * t)
      const entry = destinationPoint(spec.origin, spec.courseDeg, script.meetM)
      const sweepDeg = ((spec.speedMs / script.radiusM) * (t - script.meetS) * 180) / Math.PI
      const bearing = bearingDegrees(script.center, entry) + script.turn * sweepDeg
      return destinationPoint(script.center, ((bearing % 360) + 360) % 360, script.radiusM)
    }
    case 'return-to-launch': {
      const script = scripted(spec, 'return-to-launch')
      // Straight to the pad at speed; on it from the arrival on (ruled A5).
      if (t >= script.arriveS) return script.pad
      return destinationPoint(
        spec.origin,
        bearingDegrees(spec.origin, script.pad),
        spec.speedMs * t,
      )
    }
  }
}

/** The motion a cast behavior was planned with — absent only by a bug in the plan, never by data. */
function scripted<K extends ScriptedMotion['kind']>(
  spec: InjectSpec,
  kind: K,
): Extract<ScriptedMotion, { kind: K }> {
  if (spec.script?.kind !== kind) {
    throw new Error(`${spec.id} is a ${spec.behavior} without its ${kind} motion`)
  }
  return spec.script as Extract<ScriptedMotion, { kind: K }>
}

/**
 * Altitude at `tSec`: a climb from the launch height onto a cruise height, then level. A return
 * to launch descends onto its pad over the last `DESCENT_S` of its leg — clamped to the leg when
 * the leg is shorter (ruled), so a short return descends from its first frame — and is on the
 * ground from the arrival on.
 */
function altitudeAt(spec: InjectSpec, tSec: number): number {
  const t = Math.max(0, tSec)
  if (spec.script?.kind === 'return-to-launch') {
    const { arriveS, descentS } = spec.script
    if (t >= arriveS) return 0
    const remainingS = arriveS - t
    return remainingS >= descentS
      ? spec.baseAltitudeFt
      : (spec.baseAltitudeFt * remainingS) / descentS
  }
  const fraction = Math.min(1, t / spec.climbS)
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
 * One inject as the picture sees it at `tSec`.
 *
 * `identity` is *observed*, not copied from the label: an intermittent inject reads `cooperative`
 * on the frames its broadcast is heard and `unknown` on the frames it is not. `remoteId` is the
 * ground truth about the airframe; `identity` is what the picture can actually tell. PR 04 scores
 * the second, never the first — and the first is not on this track at all: the answer key is
 * added only by `trackAt`, for the generator's own record (#115, ruling 2).
 */
function observedAt(spec: InjectSpec, intervalS: number, tSec: number): InjectTrack {
  // The inject's own clock (S2a): a cast inject with a start time flies from that instant, and
  // its first frame is its origin, as a dealt inject's launch is.
  const t = Math.max(0, tSec - spec.startS)
  // The kinematic window is clamped forward at the start of the run, so frame zero reports the
  // motion it is about to make rather than dividing by nothing.
  const to = Math.max(t, KINEMATIC_WINDOW_S)
  const from = to - KINEMATIC_WINDOW_S
  const a = positionAt(spec, from)
  const b = positionAt(spec, to)
  const travelM = distanceMeters(a, b)
  const now = positionAt(spec, t)
  const position: [number, number] = [round(now[0], 5), round(now[1], 5)]
  // The dropout chain is indexed on the scenario's frames, not the inject's own clock.
  const heard = isHeard(spec, intervalS, Math.max(0, tSec))
  const identity: Identity =
    spec.remoteId === 'silent' ? 'non-cooperative' : heard ? 'cooperative' : 'unknown'
  // A return to launch is on its pad from the arrival on — still, at ground level (ruled A5).
  const landed = spec.script?.kind === 'return-to-launch' && t >= spec.script.arriveS
  // Where the broadcast says the drone is (S2b, #134): the observed position, or that position
  // displaced by the entry's constant vector — a broadcast that lies by the same amount every
  // frame. The sensor's track is untouched either way.
  const claimed = spec.broadcastOffset ? claimedPosition(position, spec.broadcastOffset) : position

  return {
    id: spec.id,
    source: 'inject',
    identity,
    callsign: heard ? spec.label : null,
    // Heard with the ident, lost with it: the same observed/not-observed rule (#22).
    uaType: heard ? spec.uaType : null,
    // The broadcast's own content, on the same rule (S1, #132): the position it claims — the
    // observed one unless the cast entry offsets it (S2b, #134), so every committed inject reads
    // consistent. The feed's association rule reads this against `position`.
    broadcast: heard ? { label: spec.label, position: claimed } : null,
    position,
    // Zero altitude only on the ground (the model's rule): an airborne reading rounds no lower
    // than 1 ft, so the last fraction of a descent cannot print 0 before the arrival (#142 round 1).
    altitudeFt: landed ? 0 : Math.max(1, Math.round(altitudeAt(spec, t))),
    onGround: landed,
    groundSpeedKt: landed ? 0 : round(travelM / KINEMATIC_WINDOW_S / KT_TO_MS, 1),
    // A hovering drone has no meaningful course, and the model already allows for that.
    headingDeg: landed || travelM < 1 ? null : round(bearingDegrees(a, b), 1),
    verticalRateFpm: landed
      ? 0
      : Math.round(((altitudeAt(spec, to) - altitudeAt(spec, from)) / KINEMATIC_WINDOW_S) * 60) + 0,
    // Injects are freshly observed every frame; staleness accrual belongs to the replay clock.
    lastSeenSec: 0,
  }
}

/** The observed position displaced by a broadcast's constant offset, quantized as positions are. */
function claimedPosition(
  position: [number, number],
  offset: { bearingDeg: number; distanceM: number },
): [number, number] {
  const claimed = destinationPoint(position, offset.bearingDeg, offset.distanceM)
  return [round(claimed[0], 5), round(claimed[1], 5)]
}

/** The same inject with its answer key — the generator's own record, never the picture's. */
function trackAt(spec: InjectSpec, intervalS: number, tSec: number): GeneratedInjectTrack {
  return { ...observedAt(spec, intervalS, tSec), behavior: spec.behavior, remoteId: spec.remoteId }
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
  // The floor binds the deal only when there is one (S2a, opt-in, ruled): a scenario with a cast
  // may carry no deal — `maxInjects: 0` — and the study's scenarios are cast-only by design.
  const cast = config.cast ?? []
  const dealt = config.maxInjects > 0
  if (dealt && config.minInjects < BEHAVIORS.length) {
    throw new Error(
      `minInjects is ${config.minInjects}; it must be at least ${BEHAVIORS.length} so every behavior appears in every scenario`,
    )
  }
  if (!dealt && cast.length === 0) {
    throw new Error('a scenario needs a deal or a cast; this one has neither')
  }
  const rng = makeRng(config.seed)
  const intervalS = timeline.intervalMs / 1000
  const frameCount = gridLength(timeline)
  const site = ao.protectedSites[0]?.center ?? ao.center
  const count = dealt ? config.minInjects + rng.int(config.maxInjects - config.minInjects + 1) : 0
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
    const label = drawLabel(rng)
    const id = `inject-${String(index + 1).padStart(2, '0')}`

    // The UA type came after the golden was pinned, so it draws from its own per-inject stream
    // (the a2 pattern, #16): the shared stream above is untouched and every value it dealt
    // stands. Drawn for every inject — the stream is its own, so it costs nothing, and a silent
    // inject's value is simply never observed.
    const uaType = weightedPick(makeRng(`${config.seed}:${id}:ua-type`), config.uaTypes)

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
      startS: 0,
      script: null,
      broadcastOffset: null,
      heard: dropoutChain(config, id, remoteId, frameCount),
    })
  }

  // The cast (S2a, #133, ruled A2): scripted injects after the deal, numbered from inject-11 —
  // past any deal's eight — so an entry's id is the same under every seed and every deal, which
  // the study's run JSON needs. Nothing here reads the shared stream: the deal above is identical
  // with a cast beside it or none, and every draw a cast inject still makes comes from a stream
  // keyed by its id, so it is as much a function of seed and config as a dealt one.
  if (cast.length > 89) {
    throw new Error(`a cast of ${cast.length}; ids run inject-11 to inject-99, so at most 89`)
  }
  // The other end of the range: a deal that could reach inject-11 would collide with the cast,
  // and a duplicate id vanishes from the picture silently (#142 round 1).
  if (cast.length > 0 && config.maxInjects > 10) {
    throw new Error(
      `a deal of up to ${config.maxInjects} beside a cast; cast ids start at inject-11, so a scenario with a cast deals at most 10`,
    )
  }
  const place = (at: Placement): [number, number] =>
    destinationPoint(ao.center, at.bearingDeg, at.rangeKm * 1000)
  cast.forEach((entry, index) => {
    const id = `inject-${11 + index}`
    const origin = place(entry.from)
    const speedMs = entry.speedKt * KT_TO_MS
    const { courseDeg, script } = scriptOf(entry, id, origin, speedMs, place)
    specs.push({
      id,
      label: entry.label ?? drawLabel(makeRng(`${config.seed}:${id}:label`)),
      behavior: entry.behavior,
      remoteId: entry.remoteId,
      uaType: weightedPick(makeRng(`${config.seed}:${id}:ua-type`), config.uaTypes),
      launchId: 'cast',
      origin,
      site,
      courseDeg,
      speedMs,
      inboundS: 0,
      // Level from the first frame (ruled A6): the cruise height is the base, and no climb.
      baseAltitudeFt: entry.altitudeFt,
      climbFt: 0,
      climbS: 1,
      radiusM: 0,
      legM: 0,
      laneM: 0,
      nearM: 0,
      periodS: 0,
      startS: entry.startS ?? 0,
      script,
      broadcastOffset: entry.broadcastOffset ?? null,
      heard: dropoutChain(config, id, entry.remoteId, frameCount),
    })
  })
  return { seed: config.seed, intervalS, specs }
}

/** `UAS-XXXX` off a stream — the deal's draw and the cast's, one shape. */
const drawLabel = (rng: Rng) =>
  `UAS-${rng.int(0x10000).toString(16).toUpperCase().padStart(4, '0')}`

/**
 * The dropout chain is the only draw whose length depends on the timeline, so it gets its own
 * stream, seeded by the scenario and the inject — never the shared one. Empty for a state that
 * needs no timeline.
 */
function dropoutChain(
  config: ScenarioConfig,
  id: string,
  remoteId: RemoteIdStatus,
  frameCount: number,
): boolean[] {
  const heard: boolean[] = []
  if (remoteId === 'intermittent') {
    const chain = makeRng(`${config.seed}:${id}:remote-id`)
    let on = true
    for (let frame = 0; frame < frameCount; frame++) {
      if (frame > 0) {
        on = chain.bool(on ? config.remoteId.pStayHeard : 1 - config.remoteId.pStaySilent)
      }
      heard.push(on)
    }
  }
  return heard
}

/**
 * A cast entry's motion, decided once from its placements: the course it reports, and the
 * numbers `positionAt` reads. A transit-orbit whose course never meets its circle is refused
 * here, in so many words, rather than flown to nowhere (ruled A4).
 */
function scriptOf(
  entry: CastEntry,
  id: string,
  origin: [number, number],
  speedMs: number,
  place: (at: Placement) => [number, number],
): { courseDeg: number; script: ScriptedMotion } {
  switch (entry.behavior) {
    case 'shuttle': {
      const to = place(entry.to)
      const legM = distanceMeters(origin, to)
      // A leg of no length has no period — the motion would be NaN, not a hover (#142 round 1).
      if (legM < 1) throw new Error(`cast ${id}: the shuttle's two points are the same place`)
      return { courseDeg: bearingDegrees(origin, to), script: { kind: 'shuttle', to, legM } }
    }
    case 'transit-orbit': {
      const center = place(entry.orbit.center)
      const { radiusM } = entry.orbit
      const meeting = firstMeeting(origin, entry.courseDeg, center, radiusM)
      // Three refusals, each in its own words (#142 round 1): an origin already inside the
      // circle, a circle behind the origin, a course that passes outside it.
      if (meeting.inside) {
        throw new Error(
          `cast ${id}: its origin lies inside its orbit circle — ${Math.round(distanceMeters(origin, center))} m from the centre, radius ${radiusM} m; start it outside`,
        )
      }
      if (meeting.alongM === null) {
        throw new Error(
          `cast ${id}: the course ${entry.courseDeg}° never meets its orbit circle — the centre lies ${(Math.abs(meeting.acrossM) / 1000).toFixed(1)} km off the course${meeting.behind ? ', behind the origin' : ''}, radius ${radiusM} m`,
        )
      }
      return {
        courseDeg: entry.courseDeg,
        script: {
          kind: 'transit-orbit',
          center,
          radiusM,
          meetM: meeting.alongM,
          meetS: meeting.alongM / speedMs,
          // The side the centre lies on is the way the track turns onto the circle.
          turn: meeting.acrossM >= 0 ? 1 : -1,
        },
      }
    }
    case 'return-to-launch': {
      const pad = place(entry.pad)
      const arriveS = distanceMeters(origin, pad) / speedMs
      return {
        courseDeg: bearingDegrees(origin, pad),
        script: {
          kind: 'return-to-launch',
          pad,
          arriveS,
          descentS: Math.min(DESCENT_S, arriveS),
        },
      }
    }
  }
}

/**
 * The inject picture at an arbitrary instant — observed fields only, the answer key never built.
 *
 * Continuous in `tSec` by design — PR 06's replay clock interpolates the ADS-B fixture between
 * its 15-second samples, and injects need no such treatment because they can simply be asked.
 */
export function injectTracksAt(plan: InjectPlan, tSec: number): InjectTrack[] {
  // A cast inject with a start time is not in the picture before it (S2a, opt-in).
  return plan.specs
    .filter((spec) => tSec >= spec.startS)
    .map((spec) => observedAt(spec, plan.intervalS, tSec))
}

/**
 * Every inject's observed first-seen position, by id — where the picture first shows it: the
 * recording's first frame for a dealt inject, its own start for a cast inject that appears later
 * (S2a, ruled: its first frame is its origin, as a dealt inject's launch is). What the friendly
 * condition reads as `origins`; the replay merges it with the aircraft's first samples.
 */
export function injectOriginsOf(
  plan: InjectPlan,
  fromS = 0,
): Readonly<Record<string, [number, number]>> {
  return Object.fromEntries(
    plan.specs.map((spec) => [
      spec.id,
      observedAt(spec, plan.intervalS, Math.max(fromS, spec.startS)).position,
    ]),
  )
}

/** The whole scenario, sampled at the timeline's frame times, with the answer key: the golden. */
export function generateScenario(
  timeline: Timeline,
  config: ScenarioConfig = SCENARIO,
  ao: AreaOfOperations = AO,
): InjectScenario {
  const plan = planScenario(timeline, config, ao)
  const frames: InjectFrame[] = timeline.frameTimesMs.map((tMs) => ({
    tMs,
    tracks: plan.specs
      .filter((spec) => tMs / 1000 >= spec.startS)
      .map((spec) => trackAt(spec, plan.intervalS, tMs / 1000)),
  }))
  return { seed: plan.seed, frameCount: frames.length, intervalMs: timeline.intervalMs, frames }
}
