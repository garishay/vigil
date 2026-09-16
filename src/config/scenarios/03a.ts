/**
 * Study scenario 03a (S7, #152): the prioritization pair's first half — cast-only, one row per
 * entry, T0 = 480 s on recording 002. Two silent threats on steady inbound courses, both in the
 * picture from t = 0 and both warning at Begin: the farther one is faster and enters the ring
 * first (582 s, Begin + 102), the closer one is slower and enters second (668 s, Begin + 188).
 * Four silent baits, each winning on one cue and none entering inside the run (480–698 s): a
 * hover inside 6 km, a tangential transit missing the ring by 1.05 km, an orbit at 9 km whose
 * heading sweeps through inbound, a far slow inbound at 8 km. The furniture is 02a's rows 17–40
 * — the three returns, the fifteen hovers, the six movers — under the same ids. The load (ruled
 * R1, placed at #154 round 2): two silent inbounds in the threats' own band — 6.5 and 6.35 km at
 * 11 kt on courses 42° and 44° off the centre line, so they enter 392 s or more after Begin and
 * read as the threats do on the map, separated only by the drawer's Speed and the Entry row —
 * three more silent steady inbounds at 9–12 km entering 650 s or more after Begin, and two
 * silent movers on courses that miss, so *silent and pointing at the ring* is a question only the
 * entry time settles — thirteen silent tracks, eight of them steady inbound. A mover is written
 * where it is at Begin; its origin is flown back along its course (`silentAt`).
 */

import { SCENARIO, type ScenarioConfig } from '../scenario.ts'
import { STUDY } from '../study.ts'
import { SCENARIO_02A } from './02a.ts'
import { at, silentAt, silentHover, silentOrbit } from './cast.ts'

const T0 = STUDY.beginS

export const SCENARIO_03A: ScenarioConfig = {
  ...SCENARIO,
  seed: 'study-03a',
  minInjects: 0,
  maxInjects: 0,
  cast: [
    silentAt(at(285, 6.3), 111, 25, T0), // 11 · threat 1: 6.3 km at Begin, 25 kt inbound, enters the ring at 582 s
    silentAt(at(50, 6.15), 225, 12, T0), // 12 · threat 2: 6.15 km, 12 kt inbound, enters at 668 s
    silentHover(at(160, 5.4)), // 13 · the hover bait: the closest silent track, 5.4 km
    silentAt(at(204.9, 6.146), 305, 35, T0), // 14 · the tangential bait: 35 kt, its tangent point 215° / 6.05 km at Begin + 60, missing the ring by 1.05 km
    silentOrbit(at(340, 9.0), 500, 8, { joinDeg: 125, joinM: 800, offsetDeg: 8 }), // 15 · the orbit bait: r 500 m at 8 kt about 340° / 9.0 km, joined from 125° / 800 m off its centre, on the circle from 73 s; its heading points inbound from Begin + 27 to Begin + 169
    silentAt(at(95, 8.0), 279, 10, T0), // 16 · the far inbound bait: 8.0 km, 10 kt, enters at 1066 s — after the run
    ...(SCENARIO_02A.cast ?? []).slice(6), // 17–40 · 02a's furniture: the three returns, the fifteen hovers, the six movers, the same ids
    silentAt(at(20, 6.5), 242, 11, T0), // 41 · load in the threats' band: silent, 6.5 km, inbound 42° off the centre line at 11 kt — enters after the run
    silentAt(at(125, 6.35), 261, 11, T0), // 42 · load in the threats' band: silent, 6.35 km, inbound 44° off the centre line at 11 kt — enters after the run
    silentAt(at(240, 9.0), 63, 12, T0), // 43 · load: silent, steady inbound, enters at 1128 s
    silentAt(at(310, 12.0), 124, 20, T0), // 44 · load: silent, steady inbound, enters at 1160 s
    silentAt(at(70, 10.5), 254, 16, T0), // 45 · load: silent, steady inbound, enters at 1148 s
    silentAt(at(132.4, 6.557), 230, 14, T0), // 46 · load: silent, a course that misses — its closest approach 140° / 6.5 km at Begin + 120
    silentAt(at(345.2, 8.12), 85, 18, T0), // 47 · load: silent, a course that misses — its closest approach 355° / 8.0 km at Begin + 150
  ],
}
