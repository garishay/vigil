/**
 * The behavior test scenario (S2a, #133, ruled A7): 001's deal exactly as committed, plus one
 * cast entry per scripted behavior, so each motion has a golden of its own on 001's timeline —
 * `injects-vigil-phl-001-behaviors.json`, written by `npm run fixture:injects -- --behaviors`
 * and pinned by test. A fixture, not doctrine: the committed `SCENARIO` carries no cast, so
 * nothing here reaches the demo, the bench, or the 001 golden.
 *
 * The placements are the gate's (#133): the shuttle a 1 km tangential chord at 7.5 km, the
 * transit-then-orbit from 7.2 km on a course through a circle 3 km out, the return from 6.0 km
 * to a pad at 5.6 km — with a start time on the return, so the golden exercises an inject that
 * appears mid-run (the ruled opt-in) as well as one on the ground.
 */

import { SCENARIO } from '../../config/scenario.ts'
import type { ScenarioConfig } from '../../config/scenario.ts'

export const BEHAVIORS_SCENARIO: ScenarioConfig = {
  ...SCENARIO,
  cast: [
    {
      behavior: 'shuttle',
      remoteId: 'silent',
      speedKt: 15,
      altitudeFt: 200,
      from: { bearingDeg: 155, rangeKm: 7.5 },
      to: { bearingDeg: 162.6, rangeKm: 7.57 },
    },
    {
      behavior: 'transit-orbit',
      remoteId: 'silent',
      speedKt: 35,
      altitudeFt: 200,
      from: { bearingDeg: 155, rangeKm: 7.2 },
      courseDeg: 335,
      orbit: { center: { bearingDeg: 150, rangeKm: 3.0 }, radiusM: 800 },
    },
    {
      behavior: 'return-to-launch',
      remoteId: 'broadcasting',
      speedKt: 20,
      altitudeFt: 200,
      startS: 120,
      from: { bearingDeg: 200, rangeKm: 6.0 },
      pad: { bearingDeg: 200, rangeKm: 5.6 },
    },
  ],
}
