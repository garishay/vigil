/**
 * The resolved session (#115, ruling 6): one feed set and one scenario switch, from three layers
 * with the later winning — (a) the build's defaults, from the env the deploy sets; (b) runtime
 * configuration, reserved for the backend (#116) and not read here; (c) the URL. The result is
 * one object a backend can later supply whole, which is why the layers resolve to a value rather
 * than to a chain of lookups.
 *
 * Pure: the env is an argument, the query string is a string, the registry is a parameter.
 * Anything that cannot make a session is a refusal in so many words, never a guess — a session
 * is what the operator asked for or nothing (the #77 rule, applied to the URL).
 */

import { DEFAULT_RECORDING, RECORDINGS } from '../config/recordings.ts'
import type { RecordingEntry } from '../config/recordings.ts'
import { SCENARIOS, type NamedScenario } from '../config/scenarios.ts'
import { STUDY } from '../config/study.ts'
import { CLOCK_OF_KIND, FEED_KINDS, feedRefText } from './feeds.ts'
import type { FeedKind, FeedRef } from './feeds.ts'

/**
 * The scenario switch as a name (S3b, #135, ruled A5; #36 [26] A): `on` is the registry's first,
 * `off` none. `runS` is a study run's length on this scenario (S7, #152, ruled D3): the registry
 * entry's own when it carries one, the study's default otherwise — so a run link fixes its
 * length with its scenario, and App's window never reads the registry itself.
 */
export type ScenarioState = { on: true; name: string; seed: string; runS: number } | { on: false }

/**
 * The study's two conditions (S4a, #136, ruled A1; #131): `vigil` is the app as built, `raw` the
 * honest unaided picture — the same tracks through the association rule at raw's own distance,
 * every derived reading hidden. A run's parameter, read from the URL once with the session and
 * never switched inside a run: nothing in the UI sets it.
 */
export type Mode = 'raw' | 'vigil'
export const MODES: readonly Mode[] = ['raw', 'vigil']

/**
 * A study run (S4b, #137, ruled A1; #131's run-link contract): the subject's code and the run's
 * index, from the URL only, both or neither. A session with one is a study run — the brief,
 * Begin, the window, the end screen, in either mode; without one the app is the demo it was.
 */
export interface StudyRun {
  /** A subject code — `S03` — never a name (#131: subject codes only, no names in the file). */
  subject: string
  /** The run's index for that subject, from 1. */
  run: number
}

export interface SessionConfig {
  feeds: readonly FeedRef[]
  scenario: ScenarioState
  mode: Mode
  study: StudyRun | null
}

/** The two build-time variables, PAGES_BASE-style; both optional, both plain strings. */
export interface SessionEnv {
  VITE_DEFAULT_FEEDS?: string
  VITE_DEFAULT_SCENARIO?: string
}

/**
 * Layer (a) when the build set nothing — the demo: the default recording with the scenario on.
 * The Pages deploy and local dev read exactly these, so an unset env changes nothing (A8).
 */
export const BUILD_DEFAULTS = {
  feeds: `recording:${DEFAULT_RECORDING.id}`,
  scenario: 'on',
} as const

/** A session that cannot be made, with the reason the strip prints (ruling 4). */
export class SessionRefusal extends Error {
  override readonly name = 'SessionRefusal'
}

const refuse = (reason: string): never => {
  throw new SessionRefusal(reason)
}

const isKind = (text: string): text is FeedKind => (FEED_KINDS as readonly string[]).includes(text)

/** `kind:id` → a ref; a bare `kind` is a ref with an empty id. An unknown kind is refused. */
export function parseFeedRef(text: string): FeedRef {
  const colon = text.indexOf(':')
  const kind = colon < 0 ? text : text.slice(0, colon)
  const id = colon < 0 ? '' : text.slice(colon + 1)
  if (!isKind(kind)) return refuse(`Feed "${text}" — unknown feed kind "${kind}"`)
  return { kind, id }
}

/** A comma list of refs, blanks dropped; an empty list is refused. */
function parseFeeds(text: string): FeedRef[] {
  const refs = text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map(parseFeedRef)
  if (refs.length === 0) return refuse('No feed named — a session needs at least one feed')
  return refs
}

/**
 * `on`, `off`, or a scenario the registry names (#36 [26] A): `on` is the registry's first — the
 * default deal — and the refusal lists the names it knows, so the sentence is the registry's.
 */
function parseScenario(
  where: string,
  text: string,
  registry: readonly NamedScenario[],
): NamedScenario | null {
  if (text === 'off') return null
  const named = text === 'on' ? registry[0] : registry.find((scenario) => scenario.name === text)
  if (named) return named
  const names = registry.map((scenario) => scenario.name).join(', ')
  return refuse(`${where} reads on, off, or a scenario name — ${names} — not "${text}"`)
}

/** `raw` or `vigil`, nothing else — a run link that says anything else is refused, not guessed. */
function parseMode(text: string): Mode {
  if ((MODES as readonly string[]).includes(text)) return text as Mode
  return refuse(`?mode= reads raw or vigil, not "${text}"`)
}

/** A subject code: letters, digits, and dashes. Anything else — a name, a blank — is refused. */
const SUBJECT_CODE = /^[A-Za-z0-9-]+$/

/**
 * `?subject=<code>&run=<n>`, both or neither (S4b, ruled A1): one without the other is a run
 * link with half its name, refused rather than guessed; a code is letters, digits, and dashes; a
 * run index is a whole number from 1; either given twice is refused as the others are ([24]).
 */
function parseStudy(params: URLSearchParams): StudyRun | null {
  const subjects = params.getAll('subject')
  if (subjects.length > 1) refuse('?subject= is given more than once — give it once')
  const runs = params.getAll('run')
  if (runs.length > 1) refuse('?run= is given more than once — give it once')
  const subject: string | null = subjects[0] ?? null
  const run: string | null = runs[0] ?? null
  if (subject === null && run === null) return null
  if (subject === null || run === null) return refuse('a run link names both ?subject= and ?run=')
  if (!SUBJECT_CODE.test(subject)) refuse(`?subject= is a subject code, not "${subject}"`)
  // A whole number from 1 that a JSON number holds exactly: past the safe range two links
  // would collapse to one run, and past what a double holds the JSON would read null (#149).
  const index = Number(run)
  if (!/^[1-9][0-9]*$/.test(run) || !Number.isSafeInteger(index)) {
    refuse(`?run= is a run number from 1, not "${run}"`)
  }
  return { subject, run: index }
}

/** Where the picker would go for a live feed: the number of the Issue that brings it. */
const LIVE_ISSUE: Readonly<Record<Exclude<FeedKind, 'recording'>, string>> = {
  adsb: '#72',
  cot: '#116',
}

/**
 * The session the env and the query string name.
 *
 * `?recording=<id>` is the alias for `?feed=recording:<id>` — the Tuesday link never changes.
 * Given beside a `?feed=` that names the same recording it folds away; naming a different one is
 * refused rather than resolved by precedence (A6, amended). The cross-check fires only on that
 * genuine disagreement — both name a recording and they differ; a `?feed=` naming no recording,
 * or two, falls through to its own refusal (#125 round 1). A parameter given more than once is
 * refused, never picked from (ruled on #125; #36 [24] for the alias and the switch): the list is
 * the comma, and the alias is the one an operator hand-edits, where a pasted duplicate is a guess
 * before anywhere else.
 *
 * A declared-but-empty env variable reads as unset: the env is the one layer the operator cannot
 * correct from the URL, so an empty string is the build setting nothing, not a refusal of every
 * visitor (#125 round 1).
 */
export function resolveSession(
  search: string,
  env: SessionEnv = {},
  registry: readonly RecordingEntry[] = RECORDINGS,
  scenarios: readonly NamedScenario[] = SCENARIOS,
): SessionConfig {
  const params = new URLSearchParams(search)

  let feedsText = env.VITE_DEFAULT_FEEDS || BUILD_DEFAULTS.feeds
  const aliases = params.getAll('recording')
  if (aliases.length > 1) refuse('?recording= is given more than once — give it once')
  const alias: string | null = aliases[0] ?? null
  const feedParams = params.getAll('feed')
  if (feedParams.length > 1) {
    refuse('?feed= is given more than once — give it once, comma-separated')
  }
  // Annotated: without `noUncheckedIndexedAccess` the index reads as `string`, and the guards
  // below are on the nullability (#125 re-review).
  const feedParam: string | null = feedParams[0] ?? null
  if (feedParam !== null) feedsText = feedParam
  else if (alias !== null) feedsText = `recording:${alias}`
  const feeds = parseFeeds(feedsText)
  if (feedParam !== null && alias !== null) {
    const named = feeds.filter((ref) => ref.kind === 'recording').map((ref) => ref.id)
    if (named.length === 1 && named[0] !== alias) {
      refuse('?recording= and ?feed= name different recordings — say one')
    }
  }

  const clocks = new Set(feeds.map((ref) => CLOCK_OF_KIND[ref.kind]))
  if (clocks.size > 1) {
    refuse('A recording and a live feed cannot share a session — one clock kind (#115)')
  }
  for (const ref of feeds) {
    if (ref.kind !== 'recording') {
      refuse(
        `Feed "${feedRefText(ref)}" — no ${ref.kind} feed in this build (${LIVE_ISSUE[ref.kind]})`,
      )
    }
  }
  if (feeds.length > 1) refuse('One recording per session')
  for (const ref of feeds) {
    if (!registry.some((entry) => entry.id === ref.id)) refuse(`No recording named "${ref.id}"`)
  }

  // The mode (S4a): URL only — a run's, not a build's — `vigil` when absent.
  const modeParams = params.getAll('mode')
  if (modeParams.length > 1) refuse('?mode= is given more than once — give it once')
  const modeParam: string | null = modeParams[0] ?? null
  const mode: Mode = modeParam === null ? 'vigil' : parseMode(modeParam)

  const scenarioParams = params.getAll('scenario')
  if (scenarioParams.length > 1) refuse('?scenario= is given more than once — give it once')
  const scenarioParam: string | null = scenarioParams[0] ?? null
  const named =
    scenarioParam !== null
      ? parseScenario('?scenario=', scenarioParam, scenarios)
      : parseScenario(
          'VITE_DEFAULT_SCENARIO',
          env.VITE_DEFAULT_SCENARIO || BUILD_DEFAULTS.scenario,
          scenarios,
        )

  // The study run (S4b): URL only, as the mode is — the link fixes scenario, mode, and subject.
  // A run names a study scenario (#36 [36], ruled B): with the scenario off there is no threat
  // to find and nothing for the replay to regenerate, so the link is refused, not run.
  const study = parseStudy(params)
  if (study !== null && named === null) {
    refuse('a run link names a study scenario — ?scenario=off is not a run')
  }

  return {
    feeds,
    scenario: named
      ? { on: true, name: named.name, seed: named.config.seed, runS: named.runS ?? STUDY.runS }
      : { on: false },
    mode,
    study,
  }
}

/**
 * `?sheet` — the sheet page rather than the app (S6a, #165, A4). Read before the session is
 * resolved: the page takes files, not a feed, and a link to it names neither.
 */
export const isSheetPage = (search: string): boolean => new URLSearchParams(search).has('sheet')

/** A study session is two runs: one of a matched pair in each condition (#131). */
export const RUNS_PER_SUBJECT = 2

/**
 * The link run 2 opens at (S6a-iii, #165, item 3): the same subject, run 2, the other scenario
 * of this one's pair and the other mode. The subject is sent one link; the second is the first
 * turned over, so the counterbalancing the protocol asks for follows from the code that was sent
 * rather than from a second link anyone has to remember to compose.
 *
 * Pure — the search is a string, as the resolver takes one — and it reads the registry only
 * for the pairing, never the roles table (R1). This module is on the replay tool’s own path, so
 * it touches no DOM.
 */
export function nextRunSearch(
  session: SessionConfig,
  search: string,
  registry: readonly NamedScenario[] = SCENARIOS,
): string | null {
  const { study, scenario } = session
  if (!study || !scenario.on || study.run >= RUNS_PER_SUBJECT) return null
  const paired = registry.find((named) => named.name === scenario.name)?.pairedWith
  if (paired === undefined) return null
  const params = new URLSearchParams(search)
  params.set('scenario', paired)
  params.set('mode', session.mode === 'raw' ? 'vigil' : 'raw')
  params.set('subject', study.subject)
  params.set('run', String(study.run + 1))
  return `?${params.toString()}`
}
