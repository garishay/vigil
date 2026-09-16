/**
 * The replay's inputs (S5a, #138, ruled A2): a run JSON as S4b writes it (#137), validated in so
 * many words before anything runs — a bad file is refused with its path and the field, never
 * guessed at; the scenario the JSON names, through the registry; the study's recording, loaded
 * as the bench loads it; the plan on the recording's own frame grid — the seed exactly as the
 * app ran it. Nothing here is a position or a score: the file is read, checked, and handed on.
 */

import { readFileSync } from 'node:fs'
import {
  BENCH_SCENARIOS,
  STUDY_RECORDING,
  loadRecording,
  type Recording,
} from '../../scripts/study.ts'
import { scenarioNamed } from '../../src/config/scenarios.ts'
import { QUESTIONS, STUDY, WORKLOAD_SCALE } from '../../src/config/study.ts'
import { planScenario, timelineOf, type InjectPlan, type Timeline } from '../../src/lib/injects.ts'
import { indexCapture, type ReplayIndex } from '../../src/lib/replay.ts'
import type { RunAnswers, RunEvent, RunEventType, RunRecord } from '../../src/lib/run.ts'
import { MODES, type Mode } from '../../src/lib/session.ts'

/** A run file that cannot be read as a run, with the reason — the tool's one refusal shape. */
export class RunRefusal extends Error {
  override readonly name = 'RunRefusal'
}

const refuse = (path: string, reason: string): never => {
  throw new RunRefusal(`${path}: ${reason}`)
}

/** The contract's event union (#131; `lib/run.ts`). */
const EVENT_TYPES: readonly RunEventType[] = [
  'select',
  'assess',
  'escalate',
  'dismiss',
  'alert_ack',
]
/** A subject code as the resolver reads it (`lib/session.ts`): letters, digits, and dashes. */
const SUBJECT_CODE = /^[A-Za-z0-9-]+$/
const KEYS = [
  'subject',
  'scenario',
  'mode',
  'run',
  'build',
  'began_at',
  'events',
  'answers',
] as const

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The ISO form S4b writes (`toISOString`): a calendar date and a UTC time. `Date.parse` alone
 * accepts a bare digit or a locale date and normalises an impossible one, so the shape is
 * required and the date read back must be the date written (#150 round 1).
 */
const ISO_TIME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$/
const isIsoTime = (text: string): boolean => {
  if (!ISO_TIME.test(text)) return false
  const parsed = new Date(text)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 19) === text.slice(0, 19)
}

/** A study run's length on a scenario: the registry entry's own, or the study's default (S7, ruled D3). */
export const runSOf = (scenario: string): number => scenarioNamed(scenario).runS ?? STUDY.runS

function parseEvent(value: unknown, i: number, path: string, runS: number): RunEvent {
  if (!isObject(value)) return refuse(path, `events[${i}] is an object {t, type, track}`)
  const { t, type, track } = value
  if (typeof t !== 'number' || !Number.isInteger(t) || t < 0 || t > runS) {
    return refuse(path, `events[${i}].t is ${JSON.stringify(t)} — a run's t runs 0 to ${runS}`)
  }
  if (typeof type !== 'string' || !(EVENT_TYPES as readonly string[]).includes(type)) {
    return refuse(
      path,
      `events[${i}].type reads ${JSON.stringify(type)}, not ${EVENT_TYPES.join(' | ')}`,
    )
  }
  if (typeof track !== 'string' || track === '') {
    return refuse(path, `events[${i}].track is a track id, not ${JSON.stringify(track)}`)
  }
  return { t, type: type as RunEventType, track }
}

/**
 * The run a file's text holds, or a refusal naming the path and the field: every key of the
 * contract present, the subject a code, the scenario one the registry knows, the mode raw or
 * vigil, the run index a whole number from 1, the build and began_at strings, every event in
 * the window with a type from the union, every answer on the scale.
 */
export function parseRun(text: string, path: string): RunRecord {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return refuse(path, `not JSON — ${(error as Error).message}`)
  }
  if (!isObject(value)) return refuse(path, 'a run is one JSON object')
  for (const key of KEYS) if (!(key in value)) return refuse(path, `"${key}" is missing`)
  const { subject, scenario, mode, run, build, began_at: beganAt, events, answers } = value
  if (typeof subject !== 'string' || !SUBJECT_CODE.test(subject)) {
    return refuse(path, `subject is a subject code, not ${JSON.stringify(subject)}`)
  }
  // A study scenario only: the metrics measure the study cast's threats, which the default deal
  // never holds — a run on it would read as a fabricated miss (#150 round 1). Every scenario the
  // bench baselines, the corroboration pair and the prioritization pair (#138 re-gate).
  if (typeof scenario !== 'string' || !(BENCH_SCENARIOS as readonly string[]).includes(scenario)) {
    return refuse(
      path,
      `scenario ${JSON.stringify(scenario)} — the replay reads a study scenario: ${BENCH_SCENARIOS.join(', ')}`,
    )
  }
  const runS = runSOf(scenario)
  if (typeof mode !== 'string' || !(MODES as readonly string[]).includes(mode)) {
    return refuse(path, `mode reads ${JSON.stringify(mode)}, not raw or vigil`)
  }
  if (typeof run !== 'number' || !Number.isSafeInteger(run) || run < 1) {
    return refuse(path, `run is a run number from 1, not ${JSON.stringify(run)}`)
  }
  if (typeof build !== 'string' || build === '') {
    return refuse(path, `build is the build string, not ${JSON.stringify(build)}`)
  }
  if (typeof beganAt !== 'string' || !isIsoTime(beganAt)) {
    return refuse(
      path,
      `began_at is an ISO time like 2026-09-16T00:31:10.057Z, not ${JSON.stringify(beganAt)}`,
    )
  }
  if (!Array.isArray(events)) return refuse(path, 'events is a list')
  const parsedEvents = events.map((event, i) => parseEvent(event, i, path, runS))
  // In t order, as the contract writes them: the metrics read the first Escalate by position,
  // and a look tied with it counts by position too (#150 round 1).
  for (let i = 1; i < parsedEvents.length; i++) {
    if (parsedEvents[i].t < parsedEvents[i - 1].t) {
      return refuse(
        path,
        `events[${i}].t is ${parsedEvents[i].t}, before events[${i - 1}].t ${parsedEvents[i - 1].t} — a run's events are in t order`,
      )
    }
  }
  if (!isObject(answers)) return refuse(path, 'answers is an object of the three questions')
  const { min, max } = WORKLOAD_SCALE
  for (const question of QUESTIONS) {
    const answer = answers[question.id]
    if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < min || answer > max) {
      return refuse(
        path,
        `answers.${question.id} is ${JSON.stringify(answer)} — an answer is ${min} to ${max}`,
      )
    }
  }
  const parsedAnswers = Object.fromEntries(
    QUESTIONS.map((question) => [question.id, answers[question.id] as number]),
  ) as RunAnswers
  return {
    subject,
    scenario,
    mode: mode as Mode,
    run,
    build,
    began_at: beganAt,
    events: parsedEvents,
    answers: parsedAnswers,
  }
}

/** The run a file holds, read from disk. */
export const readRun = (path: string): RunRecord => parseRun(readFileSync(path, 'utf8'), path)

/** The study's recording, indexed, with its frame grid — loaded once and shared by every run. */
export interface Study {
  recording: Recording
  index: ReplayIndex
  timeline: Timeline
}

export function loadStudy(id: string = STUDY_RECORDING): Study {
  const recording = loadRecording(id)
  return {
    recording,
    index: indexCapture(recording.capture),
    timeline: timelineOf(recording.capture),
  }
}

/** The scenario's plan on the recording's own frame grid — the seed exactly as the app dealt it. */
export const planFor = (scenario: string, timeline: Timeline): InjectPlan =>
  planScenario(timeline, scenarioNamed(scenario).config)
