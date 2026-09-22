/**
 * The study's metrics per run (S5a, #138, ruled A4; #131; S5c-i, the re-gate after S7 with the
 * owner note and its addendum): the threats are the bench's roles table for the scenario, by
 * the study files' numbering, in its row order — entry order, asserted here — ids, never the
 * generator's labels; one on the corroboration pair, two on the prioritization pair. Per
 * threat: its first open, its first Escalate, the standoff then — its range to the ring's
 * centre less the ring's radius, signed, metres exact; the figure rounds it — whether it was
 * missed, and its ring entry over the whole recording, from Begin. The freeze is the last
 * threat's first Escalate, or the scenario's own window when any threat is missed; S5a's fields
 * read threat 1's. Every escalation of a non-threat: a track from the recording's real layer —
 * an aircraft — counts false whatever its path, since the brief calls escalating one an error
 * (#36 [40] B); an inject is classed by its ring entry over the recording, read from the plan:
 * never entering is a false escalation; entering after the run is a later entrant, its own
 * count, folded into neither; anything else — inside the ring within the run, or a plan that
 * enters past the recording's end — cannot be read and throws in words. Looks before first
 * correct are the selections before the first Escalate on any threat — every look when none is.
 * Opened before the first threat is the distinct non-threats selected before any threat is,
 * ties by record position. The order is true or false once every threat is escalated, by the
 * escalations' positions in the record, and null before.
 */

import { STUDY_CAST } from '../../scripts/study-spec.ts'
import { beginSOf, runSOf } from './load.ts'
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

/**
 * How far past the recording's end the plan is read for a non-threat's ring entry (E5, extended):
 * a track on an entering course whose entry lies past the end is not a never-entrant, so it is
 * never counted false — the run throws instead. An hour covers any cast row's leg.
 */
export const BEYOND_S = 3600

/** The threat set of a scenario: the bench's roles table, by the study files' numbering — never the tool's own list. */
export const threatsOf = (scenario: string): readonly string[] => {
  const roles = STUDY_CAST[scenario]
  if (!roles) throw new Error(`${scenario}: not a study scenario the bench knows`)
  return roles.threats
}

/** One escalation the run made on a track that is not a threat (S5f, #173). */
export interface OtherEscalation {
  /** The track as the record names it. */
  id: string
  /** The Escalate, sim seconds from Begin. */
  t: number
  /** Its ring entry over the whole recording, sim seconds from Begin; null when it never enters. */
  entryT: number | null
  /** A track from the recording's real layer — an aircraft, which counts false whatever its path (#36 [40] B). */
  real: boolean
}

/**
 * Every escalation of a non-threat, in the record's order, classed as the addendum on #138 and
 * #36 [40] B class it — the counts below are counted from this list, and the frame's caption and
 * the sheet's third row name its rows (S5f, #173). The two throws are here: an inject inside the
 * ring within the run, and one on an entering course whose entry lies past the recording, are
 * neither never-entrants nor later entrants and cannot be read (E5, extended).
 */
export function otherEscalations(
  record: RunRecord,
  index: ReplayIndex,
  plan: InjectPlan,
): OtherEscalation[] {
  const beginS = beginSOf(record.scenario)
  const runS = runSOf(record.scenario)
  const threatIds = threatsOf(record.scenario)
  const isInject = (id: string) => plan.specs.some((spec) => spec.id === id)
  const entryOf = new Map<string, number | null>()
  return record.events
    .filter((event) => event.type === 'escalate' && !threatIds.includes(event.track))
    .map((event) => {
      const real = !isInject(event.track)
      if (real) return { id: event.track, t: event.t, entryT: null, real }
      if (!entryOf.has(event.track)) {
        const entry = entrySecond(plan, event.track, 0, index.durationS)
        entryOf.set(event.track, entry === null ? null : entry - beginS)
        // The addendum's two classes are the four casts' only ones (the bench's line 2, its entry
        // list); a run that escalates anything else cannot be read and says so (E5, extended).
        if (entry !== null && entry - beginS <= runS) {
          throw new Error(
            `${record.subject} run ${record.run}: ${event.track} is not a threat but is inside the ring within the run (entry ${entry - beginS} s from Begin) — neither a never-entrant nor a later entrant`,
          )
        }
        const beyond =
          entry === null
            ? entrySecond(plan, event.track, index.durationS + 1, index.durationS + BEYOND_S)
            : null
        if (beyond !== null) {
          throw new Error(
            `${record.subject} run ${record.run}: ${event.track} is not a threat but is on an entering course — its entry lies ${beyond - index.durationS} s past the recording's end — not a never-entrant, so never a false escalation`,
          )
        }
      }
      return { id: event.track, t: event.t, entryT: entryOf.get(event.track)!, real }
    })
}

export function runMetrics(record: RunRecord, index: ReplayIndex, plan: InjectPlan): RunMetrics {
  const beginS = beginSOf(record.scenario)
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
  // Row order is entry order — the bench's line 3 on the prioritization pair, held here too, so
  // "threat 1" and the order column mean what they say whatever a table edit does (round 1).
  for (let i = 1; i < threats.length; i++) {
    const earlier = threats[i - 1]
    const later = threats[i]
    if (earlier.entryT === null || later.entryT === null || earlier.entryT >= later.entryT) {
      throw new Error(
        `${record.scenario}: the roles table's row order is not entry order — ${earlier.id} enters ${earlier.entryT ?? 'never'}, ${later.id} enters ${later.entryT ?? 'never'} (seconds from Begin)`,
      )
    }
  }
  const first = threats[0]
  // The first correct: the first Escalate on any threat — one threat, and it is that threat's.
  const firstEscalateIndex = record.events.findIndex(
    (event) => event.type === 'escalate' && threatIds.includes(event.track),
  )
  const anyMiss = threats.some((threat) => threat.miss)
  // The freeze: the last threat's first Escalate, or the run's end when any threat is missed —
  // one threat, and it is that threat's Escalate or the miss, as S5a wrote it.
  const freezeT = anyMiss ? runS : Math.max(...threats.map((threat) => threat.timeToEscalateS!))
  // Every escalation of a non-threat, classed once and counted here (S5f, #173): a track from
  // the recording's real layer counts false whatever its path — the brief calls escalating an
  // aircraft an error (#36 [40] B, round 2); an inject is classed by its ring entry over the
  // recording (the addendum on #138): never entering is false, entering after the run is a
  // later entrant.
  const others = otherEscalations(record, index, plan)
  // By position, as every tie in the record is settled (#150 round 1): two looks on one second
  // are two looks, in the order the record writes them (round 1).
  const firstThreatOpenIndex = record.events.findIndex(
    (event) => event.type === 'select' && threatIds.includes(event.track),
  )
  const openedBefore = new Set(
    record.events
      .filter(
        (event, i) =>
          event.type === 'select' &&
          !threatIds.includes(event.track) &&
          (firstThreatOpenIndex < 0 || i < firstThreatOpenIndex),
      )
      .map((event) => event.track),
  )
  const escalateIndexOf = (id: string) =>
    record.events.findIndex((event) => event.type === 'escalate' && event.track === id)
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
    falseEscalations: others.filter((other) => other.real || other.entryT === null).length,
    escalationsOfLaterEntrants: others.filter(
      (other) => !other.real && other.entryT !== null && other.entryT > runS,
    ).length,
    looksBeforeFirstCorrect: record.events.filter(
      (event, i) => event.type === 'select' && (firstEscalateIndex < 0 || i < firstEscalateIndex),
    ).length,
    looks: record.events.filter((event) => event.type === 'select').length,
    openedBeforeFirstThreat: openedBefore.size,
    // By the escalations' positions in the record, so two on one second keep their order.
    orderCorrect:
      threats.length < 2 || anyMiss
        ? null
        : threats.every(
            (threat, i) =>
              i === 0 || escalateIndexOf(threat.id) > escalateIndexOf(threats[i - 1].id),
          ),
    entryT: first.entryT,
    answers: record.answers,
  }
}
