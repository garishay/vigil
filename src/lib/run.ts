/**
 * The run JSON (S4b, #137, ruled A6; #131's run-link contract): what a study run hands back —
 * the subject, the scenario, the mode, the run index, the build that produced it, when Begin was
 * pressed, every event with its sim second from Begin, and the three workload answers. Pure: the
 * record and the selections are inputs, the text is the output. Nothing here is a position, a
 * score, a label, or a name — the scenario is deterministic under its seed, so the replay (S5,
 * #138) regenerates the picture from the scenario at `t + beginS`, and a subject is a code.
 */

import type { QuestionId } from '../config/study.ts'
import type { TrackEvent } from './lifecycle.ts'
import type { Mode, SessionConfig } from './session.ts'

/** The contract's event union: a selection, the three actions, and an acknowledged alert. */
export type RunEventType = 'select' | 'assess' | 'escalate' | 'dismiss' | 'alert_ack'

export interface RunEvent {
  /** Sim seconds from Begin. */
  t: number
  type: RunEventType
  /** The track's id — `inject-11`, `adsb-a06461` — never its ident, its position, or its score. */
  track: string
}

/** The three answers, 1–10 each, keyed by the question's id (`config/study.ts`). */
export type RunAnswers = Record<QuestionId, number>

export interface RunRecord {
  subject: string
  /** The scenario's name — the seed's home; a run link always names one (#36 [36]). */
  scenario: string
  mode: Mode
  run: number
  /** The build string: the package version and the commit it was built from. */
  build: string
  /** Wall clock, ISO — when Begin was pressed. */
  began_at: string
  events: RunEvent[]
  answers: RunAnswers
}

/** A selection as the shell records it: which track, and the clock it was opened at. */
export interface Selection {
  tSec: number
  trackId: string
}

/**
 * The contract's name for each lifecycle action. Observations have none — the record's
 * first-seen, crossings, patterns, loss and return are the picture's, not the subject's — and
 * neither does Resolve, hidden during a run in both modes (ruled A5's opt-out), so the union
 * stays the contract's.
 */
const EVENT_TYPE: Partial<Record<TrackEvent['action'], RunEventType>> = {
  assess: 'assess',
  escalate: 'escalate',
  dismiss: 'dismiss',
  acknowledge: 'alert_ack',
}

/**
 * The run's events, from the record and the selections: each selection as `select`, each
 * lifecycle action under the contract's name, `t` counted from Begin, sorted by `t` — a stable
 * sort with the selections listed first, so at a tie the opening precedes the action a subject
 * took on the track just opened, and the rest keep the record's order. An entry outside the
 * window is not the run's: a first-seen stamped at Begin before the overlay lifted, an action
 * the shell refused after the end.
 */
export function runEvents(
  logs: Readonly<Record<string, readonly TrackEvent[]>>,
  selections: readonly Selection[],
  beginS: number,
  endS: number,
): RunEvent[] {
  const inWindow = (tSec: number) => tSec >= beginS && tSec <= endS
  const events: RunEvent[] = selections
    .filter((selection) => inWindow(selection.tSec))
    .map((selection) => ({ t: selection.tSec - beginS, type: 'select', track: selection.trackId }))
  for (const log of Object.values(logs)) {
    for (const event of log) {
      const type = EVENT_TYPE[event.action]
      if (type !== undefined && inWindow(event.tSec)) {
        events.push({ t: event.tSec - beginS, type, track: event.trackId })
      }
    }
  }
  return events.sort((a, b) => a.t - b.t)
}

export interface RunInput {
  session: SessionConfig
  build: string
  beganAt: string
  beginS: number
  endS: number
  logs: Readonly<Record<string, readonly TrackEvent[]>>
  selections: readonly Selection[]
  answers: RunAnswers
}

/**
 * The record, keys in the contract's order. Throws for a session that is not a study run or
 * has no scenario — states the resolver refuses before a run can open.
 */
export function runRecord(input: RunInput): RunRecord {
  const { session, answers } = input
  if (session.study === null) throw new Error('runRecord needs a study run — ?subject= and ?run=')
  if (!session.scenario.on) throw new Error('runRecord needs a scenario — a run link names one')
  return {
    subject: session.study.subject,
    scenario: session.scenario.name,
    mode: session.mode,
    run: session.study.run,
    build: input.build,
    began_at: input.beganAt,
    events: runEvents(input.logs, input.selections, input.beginS, input.endS),
    answers: { demand: answers.demand, pressure: answers.pressure, confidence: answers.confidence },
  }
}

/**
 * The record as the text Copy run puts on the clipboard: one object, the head fields one per
 * line, every event on a line of its own so a run reads down the page, the answers on one.
 * `JSON.parse` of it is `runRecord` of the same input.
 */
export const runJson = (input: RunInput): string => runText(runRecord(input))

/** One run, printed: the head fields one per line, one event per line, the answers on one. */
export function runText(record: RunRecord): string {
  const { events, answers, ...head } = record
  const headLines = Object.entries(head).map(
    ([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`,
  )
  const eventLines =
    events.length === 0
      ? '  "events": [],'
      : `  "events": [\n${events.map((event) => `    ${JSON.stringify(event)}`).join(',\n')}\n  ],`
  return `{\n${headLines.join('\n')}\n${eventLines}\n  "answers": ${JSON.stringify(answers)}\n}`
}

/**
 * The results file a subject hands over (S6a-iii, #165, item 5): their two runs under one
 * envelope, in run order, written the way `runJson` writes a run so a reader can see down the
 * page. `tools/replay/load.ts` reads it wherever it reads a run file (S6a-i).
 *
 * What it holds, and what it does not: a subject code, every selection and action with its
 * second from Begin, the three answers, the build each run was made on. No name, no position, no
 * score — the scenario is deterministic under its seed, so the replay regenerates the picture.
 */
export function resultsJson(records: readonly RunRecord[]): string {
  const runs = [...records].sort((a, b) => a.run - b.run)
  const head = [
    `  ${JSON.stringify('subject')}: ${JSON.stringify(runs[0].subject)},`,
    `  ${JSON.stringify('build')}: ${JSON.stringify(runs[0].build)},`,
  ]
  const body = runs.map((run) => runText(run).replace(/^/gm, '    ')).join(',\n')
  return `{\n${head.join('\n')}\n  "runs": [\n${body}\n  ]\n}`
}
