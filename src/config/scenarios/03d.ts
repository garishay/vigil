/**
 * Demo scenario 03d (S11, #213): the 03 family's third member, cut for the bare link and never
 * counted — the crowd the prioritization pair is read against, with a threat cast of its own.
 * The picture is 03a's whole cast turned 270° about the centre under its own ids, as 03b is 03a
 * turned 135°: the same hover, tangential, orbit and far-inbound baits, 02a's twenty-four
 * furniture rows, the nineteen load rows written at the study's Begin. What differs is the
 * threats. 03a's two threat rows are re-cut as near misses — the same ranges and speeds, their
 * courses laid across the ring so each passes about 1.1 km outside it at 597 and 615 s — and two
 * silent inbounds of this scenario's own are written where they are at t = 0, so the cold open
 * reads the demo's story from the top of the recording without a Begin:
 *
 * - row 1, far and fast: 7.2 km at 35 kt from 330°, warning from t = 0 at rank 2, enters at 123 s;
 * - row 2, close: 6.3 km at 16 kt from 120°, warning at rank 1 from t = 0, enters at 158 s.
 *
 * Both are red at the top of the list from the first tick; the far one overtakes the close one
 * at 93 s, the tick their ranges cross (#153: under two minutes to entry the closing factor is
 * saturated, so two closing tracks order by range), and enters 35 s before it. No other track is
 * warning before 608 s, when the band rows cross as they do on 03a. No 03d threat ident is a 03a
 * or 03b threat ident — the id sets are disjoint whole (`./ids.ts`) — and a threat here is a
 * near miss there, so a viewer who has watched the bare link carries nothing into a 03 run; the
 * 02 pair numbers from 11 and shares two load idents, TRK-14 and TRK-16, non-threats on both sides.
 * Row order is entry order, the family's convention; the number beside each row is its id.
 */

import { SCENARIO, type ScenarioConfig } from '../scenario.ts'
import { STUDY } from '../study.ts'
import { SCENARIO_03A } from './03a.ts'
import { at, rotated, silentAt } from './cast.ts'
import { CAST_IDS_03D } from './ids.ts'

/** The turn that carries 03a's crowd onto 03d's bearings — 02b's 225° and 03b's 135° are taken. */
export const ROTATION_03D_DEG = 270

const T0 = STUDY.beginS
const crowd = (SCENARIO_03A.cast ?? []).slice(2).map((entry) => rotated(entry, ROTATION_03D_DEG))

export const SCENARIO_03D: ScenarioConfig = {
  ...SCENARIO,
  seed: 'demo-03d',
  castIds: CAST_IDS_03D,
  minInjects: 0,
  maxInjects: 0,
  cast: [
    silentAt(at(330, 7.2), 150, 35, 0), // 44 · threat 1: 7.2 km at t = 0, 35 kt inbound, warning at rank 2 from the first tick, rank 1 from 93 s, enters the ring at 123 s
    silentAt(at(120, 6.3), 300, 16, 0), // 39 · threat 2: 6.3 km, 16 kt inbound, warning at rank 1 from the first tick, enters at 158 s
    ...crowd, // 32, 93, 97, 53 · the four baits; 148–171 · the furniture; then the nineteen load rows under the two-digit ids `ids.ts` lists — 03a's rows 3–49, turned 270°
    rotated(silentAt(at(285, 6.3), 29, 25, T0), ROTATION_03D_DEG), // 81 · 03a's threat 1 as a near miss: 6.3 km at 25 kt at Begin, its course 76° off the centre line — closest approach 6.12 km, 1.12 km outside the ring, at 597 s
    rotated(silentAt(at(50, 6.15), 312, 12, T0), ROTATION_03D_DEG), // 90 · 03a's threat 2 as a near miss: 6.15 km at 12 kt at Begin, 82° off — closest approach 6.09 km, 1.09 km outside, at 615 s
  ],
}
