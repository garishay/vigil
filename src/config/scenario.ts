/**
 * The synthetic layer's doctrine (scope §5.2) — configuration, not code (§4.4).
 *
 * Nothing here is a coordinate. Launch points are a bearing and a range **from the AO center**,
 * so relocating Vigil relocates the launch ring with it and the scenario stays meaningful. The
 * envelope and the Remote ID dropout rates are numbers a reviewer can argue with without reading
 * the generator.
 */

import type { RemoteIdStatus, UaType } from '../lib/tracks.ts'

/** Where an inject starts, expressed relative to the AO center rather than as a fixed point. */
export interface LaunchPoint {
  id: string
  /** Compass-derived and plainly synthetic — no real site is named or implied (§2). */
  name: string
  /** Degrees true from the AO center. */
  bearingDeg: number
  /** Kilometers from the AO center. Must clear every protected-site radius; see the tests. */
  rangeKm: number
}

/**
 * The low-and-slow box every inject stays inside.
 *
 * 400 ft is the Part 107 ceiling — public, citable, and a real-world referent. The 35 kt cap is
 * **not** regulatory (Part 107 allows 87 kt); it is a scenario choice for what "slow" means here,
 * picked so the injects sit well inside the small-UAS end of the spectrum.
 */
export interface InjectEnvelope {
  minAltitudeFt: number
  maxAltitudeFt: number
  maxGroundSpeedKt: number
  maxVerticalRateFpm: number
}

/** A place relative to the AO centre, as a launch point is — never a coordinate (S2a, #133). */
export interface Placement {
  /** Degrees true from the AO center. */
  bearingDeg: number
  /** Kilometers from the AO center. */
  rangeKm: number
}

/**
 * A scripted inject (S2a, #133, ruled): one entry of a scenario's cast, beside the dealt injects
 * or in their place. The three cast behaviors are reachable only this way — never dealt — so the
 * default deal, its golden, and the bench baseline are untouched by their existence (A1). Every
 * number the motion needs is written here; the UA type, the dropout chain, and the label when it
 * is not scripted still come from per-inject derived streams, so a cast inject is a function of
 * seed and config alone, like a dealt one.
 */
export type CastEntry = {
  remoteId: RemoteIdStatus
  speedKt: number
  /** Level from the first frame — a cast inject is already flying when the picture shows it (A6). */
  altitudeFt: number
  /** The synthetic Remote ID label, `UAS-XXXX`; drawn from `${seed}:${id}:label` when absent. */
  label?: string
  /**
   * Scenario seconds at which the inject first appears (opt-in, ruled): absent from the picture
   * before it, and its first frame is its origin, as a dealt inject's launch is. 0 when absent.
   */
  startS?: number
  /**
   * Where the Remote ID broadcast claims to be, relative to where the sensor observes the track
   * (S2b, #134, ruled A1): a constant vector, applied on every heard frame. Absent, the broadcast
   * claims the observed position — consistent, as every dealt inject is. At or beyond the
   * scorer's `mismatchM` the picture withholds the ident and reads the mismatch (#36 [27]).
   */
  broadcastOffset?: { bearingDeg: number; distanceM: number }
} & (
  | { behavior: 'shuttle'; from: Placement; to: Placement }
  | {
      behavior: 'transit-orbit'
      from: Placement
      /** The transit course, degrees true; it must meet the circle, or the plan is refused. */
      courseDeg: number
      orbit: { center: Placement; radiusM: number }
    }
  | { behavior: 'return-to-launch'; from: Placement; pad: Placement }
)

export interface ScenarioConfig {
  /**
   * The scenario seed. Same seed, same picture — see `src/lib/injects.ts`. One seed under every
   * recording (ruled on #84): the sim clock's start is the recording's, in `config/recordings.ts`.
   */
  seed: string
  /**
   * Scope §5.2 allows 3–8 injects. The floor is 5 rather than 3 so that every behavior and every
   * Remote ID state appears in every scenario **by construction** — the default picture is both
   * the demo and the golden fixture, and it should not depend on a lucky seed. A scenario with
   * a non-empty cast may carry no deal at all — `maxInjects: 0` (opt-in, ruled on #133): the
   * floor binds the deal only when there is one, and the study's scenarios are cast-only.
   */
  minInjects: number
  maxInjects: number
  /** The scripted injects (S2a); none by default, so the deal is the whole default scenario. */
  cast?: readonly CastEntry[]
  /** At least `maxInjects` of them, so every inject gets a distinct launch point. */
  launchPoints: LaunchPoint[]
  envelope: InjectEnvelope
  /**
   * The Remote ID dropout chain for an `intermittent` inject, as sticky per-frame probabilities.
   * Sticky rather than an independent coin flip per frame because real dropout comes in runs —
   * an obstruction or an antenna angle lasts longer than one sample.
   */
  remoteId: {
    /** P(heard on this frame | heard on the last). */
    pStayHeard: number
    /** P(not heard on this frame | not heard on the last). */
    pStaySilent: number
  }
  /**
   * Draw weights for the Remote ID UA type each inject broadcasts (#22). Multirotors dominate
   * the hobby and Part 107 fleet, so they dominate the draw — an assumption a reviewer can
   * change here without touching the generator.
   */
  uaTypes: Record<UaType, number>
}

export const SCENARIO: ScenarioConfig = {
  seed: 'vigil-phl-001',
  minInjects: 5,
  maxInjects: 8,
  launchPoints: [
    { id: 'lp-nne', name: 'North-northeast launch point', bearingDeg: 20, rangeKm: 8.3 },
    { id: 'lp-ene', name: 'East-northeast launch point', bearingDeg: 65, rangeKm: 6.5 },
    { id: 'lp-ese', name: 'East-southeast launch point', bearingDeg: 110, rangeKm: 9.6 },
    // 10.0 km puts the §13 hero on its arc (ruled on #5, note 3): it opens caution, crosses to
    // warning on approach, and climbs to the top of the queue as it begins to loiter.
    { id: 'lp-sse', name: 'South-southeast launch point', bearingDeg: 155, rangeKm: 10.0 },
    { id: 'lp-ssw', name: 'South-southwest launch point', bearingDeg: 200, rangeKm: 10.2 },
    { id: 'lp-wsw', name: 'West-southwest launch point', bearingDeg: 245, rangeKm: 7.8 },
    { id: 'lp-wnw', name: 'West-northwest launch point', bearingDeg: 290, rangeKm: 8.8 },
    { id: 'lp-nnw', name: 'North-northwest launch point', bearingDeg: 335, rangeKm: 9.2 },
  ],
  envelope: {
    minAltitudeFt: 50,
    maxAltitudeFt: 400,
    maxGroundSpeedKt: 35,
    maxVerticalRateFpm: 500,
  },
  remoteId: { pStayHeard: 0.8, pStaySilent: 0.6 },
  uaTypes: { multirotor: 4, aeroplane: 1, 'hybrid-lift': 1 },
}
