/**
 * The scenarios a session can name (S3b, #135, ruled A5; #36 [26] A): `?scenario=<name>` opens
 * one, `on` the first — the demo's, 03d since S11 (#213) — and `off` none. A name is a scenario
 * file, so the operator study's links say which cast they open; a named combination
 * (Study-02a-vigil) is a README row, never a value here (#115 ruling 1). The default deal the
 * golden runs on is `001`, named for its seed and the recording it was cut on. A study scenario
 * may carry its run's length (S7, #152); one that does not runs the study's default.
 */

import { SCENARIO, type ScenarioConfig } from './scenario.ts'
import { SCENARIO_02A } from './scenarios/02a.ts'
import { SCENARIO_02B } from './scenarios/02b.ts'
import { SCENARIO_03A } from './scenarios/03a.ts'
import { SCENARIO_03B } from './scenarios/03b.ts'
import { SCENARIO_03D } from './scenarios/03d.ts'

export interface NamedScenario {
  name: string
  config: ScenarioConfig
  /**
   * The study run's length from Begin, seconds, when the scenario sets its own (S7, #152, ruled
   * D3): the prioritization pair ends 30 s after its last threat's ring entry, the run-length
   * rule of #131's amendment, so each carries a number the bench pins against that rule. Absent,
   * a run is `STUDY.runS` — 02a and 02b keep their 360. The registry, not the scenario file: the
   * file is the generator's doctrine, the run length is the study's.
   */
  runS?: number
  /**
   * The other scenario of this one's matched pair (S6a-iii, #165): a subject runs one of a pair
   * and then the other, so run 1's end screen can name run 2's link without asking anyone. The
   * registry, not the roles table — this says which two scenarios are a pair, never which track
   * is a threat, so the app can read it and the answer key stays where it is (R1).
   */
  pairedWith?: string
}

/** The registry, the default first: what the bare link opens, and what `on` names. */
export const SCENARIOS: readonly NamedScenario[] = [
  // The demo (S11, #213): the 03 crowd with its own threats, never a study scenario — no run
  // length and no pair, so a run link on it is the study flow shown, not a run counted.
  { name: '03d', config: SCENARIO_03D },
  { name: '001', config: SCENARIO },
  { name: '02a', config: SCENARIO_02A, pairedWith: '02b' },
  { name: '02b', config: SCENARIO_02B, pairedWith: '02a' },
  // the last threat enters at 668 s: 668 − 480 + 30
  { name: '03a', config: SCENARIO_03A, runS: 218, pairedWith: '03b' },
  // 03a rotated, so 03a's last entry: 668 − 480 + 30 (S7d)
  { name: '03b', config: SCENARIO_03B, runS: 218, pairedWith: '03a' },
]

/** The scenario a resolved session names — the resolver already refused any name not here. */
export function scenarioNamed(name: string, registry: readonly NamedScenario[] = SCENARIOS) {
  const found = registry.find((scenario) => scenario.name === name)
  if (!found) throw new Error(`No scenario named "${name}"`)
  return found
}
