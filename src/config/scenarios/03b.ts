/**
 * Study scenario 03b (S7, #152): 03a's baits, furniture, and load turned 135° about the centre,
 * with the threats varied under one constraint — the farther, faster threat enters second. A subject who
 * learned 03a's answer as a rule (farther and faster first) gets 03b wrong, and each single-cue
 * scan still opens a bait first. Row 1 is the first entrant, as in 03a: the closer, slower one at
 * 5.65 km and 12 kt enters at 586 s (Begin + 106); the farther, faster one at 6.9 km and 25 kt
 * enters at 629 s (Begin + 149). Both are present from t = 0 and warning at Begin.
 */

import type { ScenarioConfig } from '../scenario.ts'
import { STUDY } from '../study.ts'
import { SCENARIO_03A } from './03a.ts'
import { at, rotated, silentAt } from './cast.ts'

/** The turn that carries 03a's baits and furniture onto other bearings. */
export const ROTATION_03B_DEG = 135
const T0 = STUDY.beginS

export const SCENARIO_03B: ScenarioConfig = {
  ...SCENARIO_03A,
  seed: 'study-03b',
  cast: [
    silentAt(at(185, 5.65), 0, 12, T0), // 11 · threat 1: the closer, slower one — 5.65 km, 12 kt, enters at 586 s
    silentAt(at(60, 6.9), 246, 25, T0), // 12 · threat 2: the farther, faster one — 6.9 km, 25 kt, enters at 629 s
    ...(SCENARIO_03A.cast ?? []).slice(2).map((entry) => rotated(entry, ROTATION_03B_DEG)), // 13–47 · 03a's baits, furniture, and load, turned 135°
  ],
}
