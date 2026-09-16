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

import { STUDY_CAST } from '../../scripts/study.ts'
import { STUDY } from '../../src/config/study.ts'
import { runSOf } from './load.ts'
import type { InjectPlan } from '../../src/lib/injects.ts'
import type { ReplayIndex } from '../../src/lib/replay.ts'
import type { RunAnswers, RunRecord } from '../../src/lib/run.ts'
import type { Mode } from '../../src/lib/session.ts'
import { entrySecond, rangeM, SITE, trackAtSecond } from './regenerate.ts'

/** One threat's numbers (#138 re-gate; the #131 amendment): its first open, its first Escalate, the standoff then, its entry. */
export interface ThreatMetrics {
  id: string
  /** The first select on the threat, sim seconds from Begin; null when never opened. */
  firstOpenS: number | null
  /** The first Escalate on the threat, sim seconds from Begin; null on a miss. */
  timeToEscalateS: number | null
  /** Standoff at that decision, metres, signed; null on a miss. */
  standoffM: number | null
  miss: boolean
  /** Its ring entry, sim seconds from Begin — past the window if after it — or null. */
  entryT: number | null
}

export interface RunMetrics {
  subject: string
  scenario: string
  mode: Mode
  run: number
  build: string
  began_at: string
  /** The run's length, the scenario's own. */
  runS: number
  /** The threats in the bench's row order — entry order — with their numbers; one on the corroboration pair. */
  threats: ThreatMetrics[]
  /** Sim seconds from Begin the frame freezes at: the last threat's first Escalate, or `runS` when any threat is missed. */
  freezeT: number
  /** Standoff at decision, metres, signed — positive outside the ring; null on a miss. */
  standoffM: number | null
  /** The threat's Escalate, sim seconds from Begin; null on a miss. */
  timeToEscalateS: number | null
  miss: boolean
  /** Escalations of tracks that never enter the ring inside the recording — hovers, misses, orbits (the addendum on #138). */
  falseEscalations: number
  /** Escalations of tracks that enter the ring after the run — the band rows, the far inbounds — their own line, never folded into either. */
  escalationsOfLaterEntrants: number
  /** Selections before the first Escalate on any threat; every look when no threat is escalated. */
  looksBeforeFirstCorrect: number
  looks: number
  /** Distinct non-threat tracks selected before any threat is first selected (the #131 amendment). */
  openedBeforeFirstThreat: number
  /** The threats escalated in entry order — true or false once every threat is escalated, null before. */
  orderCorrect: boolean | null
  /** The threat's ring entry, sim seconds from Begin — past the window if it enters after it — or null. */
  entryT: number | null
  answers: RunAnswers
}

/** The threat set of a scenario: the bench's roles table, by the study files' numbering — never the tool's own list. */
export const threatsOf = (scenario: string): readonly string[] => {
  const roles = STUDY_CAST[scenario]
  if (!roles) throw new Error(`${scenario}: not a study scenario the bench knows`)
  return roles.threats
}

export function runMetrics(record: RunRecord, index: ReplayIndex, plan: InjectPlan): RunMetrics {
  const { beginS } = STUDY
  const runS = runSOf(record.scenario)
  const threatIds = threatsOf(record.scenario)
  const threats: ThreatMetrics[] = threatIds.map((id) => {
    // By position: the events are in t order (the loader's rule), and a look tied with the
    // Escalate on one second precedes it in the record's order, so it counts (#150 round 1).
    const escalate = record.events.find((event) => event.type === 'escalate' && event.track === id)
    const track = escalate ? trackAtSecond(index, plan, id, beginS + escalate.t, record.mode) : null
    if (escalate && track === null) {
      throw new Error(
        `${record.subject} run ${record.run}: the threat ${id} is not in the picture at t ${escalate.t}`,
      )
    }
    // Over the whole recording, as the bench reads it: negative from Begin when the threat is
    // inside the ring already (#150 round 1).
    const entry = entrySecond(plan, id, 0, index.durationS)
    return {
      id,
      firstOpenS:
        record.events.find((event) => event.type === 'select' && event.track === id)?.t ?? null,
      timeToEscalateS: escalate?.t ?? null,
      standoffM: track ? Math.round(rangeM(track) - SITE.radiusM) : null,
      miss: escalate === undefined,
      entryT: entry === null ? null : entry - beginS,
    }
  })
  const first = threats[0]
  // The first correct: the first Escalate on any threat — one threat, and it is that threat's.
  const firstEscalateIndex = record.events.findIndex(
    (event) => event.type === 'escalate' && threatIds.includes(event.track),
  )
  const anyMiss = threats.some((threat) => threat.miss)
  // The freeze: the last threat's first Escalate, or the run's end when any threat is missed —
  // one threat, and it is that threat's Escalate or the miss, as S5a wrote it.
  const freezeT = anyMiss ? runS : Math.max(...threats.map((threat) => threat.timeToEscalateS!))
  // Every escalation of a non-threat, classed by the track's ring entry over the recording (the
  // addendum on #138): never entering is false; entering after the run is a later entrant.
  const others = record.events.filter(
    (event) => event.type === 'escalate' && !threatIds.includes(event.track),
  )
  const entryOf = new Map<string, number | null>()
  for (const event of others) {
    if (!entryOf.has(event.track))
      entryOf.set(event.track, entrySecond(plan, event.track, 0, index.durationS))
  }
  const laterEntrant = (id: string) => {
    const entry = entryOf.get(id) ?? null
    return entry !== null && entry - beginS > runS
  }
  const firstThreatOpen = record.events.find(
    (event) => event.type === 'select' && threatIds.includes(event.track),
  )
  const openedBefore = new Set(
    record.events
      .filter(
        (event) =>
          event.type === 'select' &&
          !threatIds.includes(event.track) &&
          (firstThreatOpen === undefined || event.t < firstThreatOpen.t),
      )
      .map((event) => event.track),
  )
  return {
    subject: record.subject,
    scenario: record.scenario,
    mode: record.mode,
    run: record.run,
    build: record.build,
    began_at: record.began_at,
    runS,
    threats,
    freezeT,
    standoffM: first.standoffM,
    timeToEscalateS: first.timeToEscalateS,
    miss: first.miss,
    falseEscalations: others.filter((event) => (entryOf.get(event.track) ?? null) === null).length,
    escalationsOfLaterEntrants: others.filter((event) => laterEntrant(event.track)).length,
    looksBeforeFirstCorrect: record.events.filter(
      (event, i) => event.type === 'select' && (firstEscalateIndex < 0 || i < firstEscalateIndex),
    ).length,
    looks: record.events.filter((event) => event.type === 'select').length,
    openedBeforeFirstThreat: openedBefore.size,
    orderCorrect:
      threats.length < 2 || anyMiss
        ? null
        : threats.every(
            (threat, i) => i === 0 || threat.timeToEscalateS! > threats[i - 1].timeToEscalateS!,
          ),
    entryT: first.entryT,
    answers: record.answers,
  }
}
