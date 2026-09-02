/**
 * The synthetic layer's doctrine (scope §5.2) — configuration, not code (§4.4).
 *
 * Nothing here is a coordinate. Launch points are a bearing and a range **from the AO center**,
 * so relocating Vigil relocates the launch ring with it and the scenario stays meaningful. The
 * envelope and the Remote ID dropout rates are numbers a reviewer can argue with without reading
 * the generator.
 */

import type { UaType } from '../lib/tracks.ts'

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

export interface ScenarioConfig {
  /** The scenario seed. Same seed, same picture — see `src/lib/injects.ts`. */
  seed: string
  /**
   * Scope §5.2 allows 3–8 injects. The floor is 5 rather than 3 so that every behavior and every
   * Remote ID state appears in every scenario **by construction** — the default picture is both
   * the demo and the golden fixture, and it should not depend on a lucky seed.
   */
  minInjects: number
  maxInjects: number
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
  /**
   * The sim clock's start, as a local time of day (`HH:MM`). A scenario quantity like the seed
   * (ruled D2 on #4): the recording's `capturedAt` stays on the fixture as provenance, and the
   * picture is scored — and, from PR 06, played — from this hour. §13's demo runs at 02:30.
   */
  clock: { startLocal: string }
}

export const SCENARIO: ScenarioConfig = {
  seed: 'vigil-phl-001',
  minInjects: 5,
  maxInjects: 8,
  launchPoints: [
    { id: 'lp-nne', name: 'North-northeast launch point', bearingDeg: 20, rangeKm: 8.3 },
    { id: 'lp-ene', name: 'East-northeast launch point', bearingDeg: 65, rangeKm: 6.5 },
    { id: 'lp-ese', name: 'East-southeast launch point', bearingDeg: 110, rangeKm: 9.6 },
    { id: 'lp-sse', name: 'South-southeast launch point', bearingDeg: 155, rangeKm: 7.2 },
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
  clock: { startLocal: '02:30' },
}
