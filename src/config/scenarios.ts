/**
 * The scenarios a session can name (S3b, #135, ruled A5; #36 [26] A): `?scenario=<name>` opens
 * one, `on` the first — the default deal the demo and the golden run on — and `off` none. A
 * name is a scenario file, so the operator study's links say which cast they open; a named
 * combination (Study-02a-vigil) is a README row, never a value here (#115 ruling 1).
 */

import { SCENARIO, type ScenarioConfig } from './scenario.ts'
import { SCENARIO_02A } from './scenarios/02a.ts'
import { SCENARIO_02B } from './scenarios/02b.ts'

export interface NamedScenario {
  name: string
  config: ScenarioConfig
}

/** The registry, the default first. */
export const SCENARIOS: readonly NamedScenario[] = [
  { name: '001', config: SCENARIO },
  { name: '02a', config: SCENARIO_02A },
  { name: '02b', config: SCENARIO_02B },
]

/** The scenario a resolved session names — the resolver already refused any name not here. */
export function scenarioNamed(name: string, registry: readonly NamedScenario[] = SCENARIOS) {
  const found = registry.find((scenario) => scenario.name === name)
  if (!found) throw new Error(`No scenario named "${name}"`)
  return found
}
