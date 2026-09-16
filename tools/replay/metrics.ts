/**
 * The study's metrics per run (S5a, #138, ruled A4; #131): the threat is the cast's first row by
 * the study files' numbering — an id, never the generator's label. The freeze is the threat's
 * first Escalate, or the run's end with a miss. Standoff at decision is the threat's range to
 * the ring's centre at the freeze less the ring's radius, signed, metres exact; the figure
 * rounds it. Time to escalate is the freeze's t. A miss is no Escalate on the threat in the
 * window. A false escalation is an Escalate on any other track. Looks before first correct are
 * the selections logged before the threat's Escalate, the threat's own looks included — every
 * look, on a miss. The entry is the first scenario second the threat's regenerated position
 * lies within the ring, over the whole recording, counted from Begin.
 */

import { THREAT_ID } from '../../scripts/study.ts'
import { STUDY } from '../../src/config/study.ts'
import type { InjectPlan } from '../../src/lib/injects.ts'
import type { ReplayIndex } from '../../src/lib/replay.ts'
import type { RunAnswers, RunRecord } from '../../src/lib/run.ts'
import type { Mode } from '../../src/lib/session.ts'
import { entrySecond, rangeM, SITE, trackAtSecond } from './regenerate.ts'

export interface RunMetrics {
  subject: string
  scenario: string
  mode: Mode
  run: number
  build: string
  began_at: string
  /** Sim seconds from Begin the frame freezes at: the threat's first Escalate, or `runS` on a miss. */
  freezeT: number
  /** Standoff at decision, metres, signed — positive outside the ring; null on a miss. */
  standoffM: number | null
  /** The threat's Escalate, sim seconds from Begin; null on a miss. */
  timeToEscalateS: number | null
  miss: boolean
  falseEscalations: number
  looksBeforeFirstCorrect: number
  looks: number
  /** The threat's ring entry, sim seconds from Begin — past the window if it enters after it — or null. */
  entryT: number | null
  answers: RunAnswers
}

export function runMetrics(
  record: RunRecord,
  index: ReplayIndex,
  plan: InjectPlan,
  threatId: string = THREAT_ID,
): RunMetrics {
  const { beginS, runS } = STUDY
  const escalate = record.events.find(
    (event) => event.type === 'escalate' && event.track === threatId,
  )
  const miss = escalate === undefined
  const freezeT = escalate?.t ?? runS
  const threat = escalate
    ? trackAtSecond(index, plan, threatId, beginS + escalate.t, record.mode)
    : null
  if (escalate && threat === null) {
    throw new Error(
      `${record.subject} run ${record.run}: the threat ${threatId} is not in the picture at t ${escalate.t}`,
    )
  }
  const entry = entrySecond(plan, threatId, beginS, index.durationS)
  return {
    subject: record.subject,
    scenario: record.scenario,
    mode: record.mode,
    run: record.run,
    build: record.build,
    began_at: record.began_at,
    freezeT,
    standoffM: threat ? Math.round(rangeM(threat) - SITE.radiusM) : null,
    timeToEscalateS: escalate?.t ?? null,
    miss,
    falseEscalations: record.events.filter(
      (event) => event.type === 'escalate' && event.track !== threatId,
    ).length,
    looksBeforeFirstCorrect: record.events.filter(
      (event) => event.type === 'select' && (miss || event.t < freezeT),
    ).length,
    looks: record.events.filter((event) => event.type === 'select').length,
    entryT: entry === null ? null : entry - beginS,
    answers: record.answers,
  }
}
