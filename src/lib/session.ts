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
import { SCENARIO } from '../config/scenario.ts'
import { CLOCK_OF_KIND, FEED_KINDS, feedRefText } from './feeds.ts'
import type { FeedKind, FeedRef } from './feeds.ts'

export type ScenarioState = { on: true; seed: string } | { on: false }

export interface SessionConfig {
  feeds: readonly FeedRef[]
  scenario: ScenarioState
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

function parseScenario(where: string, text: string): boolean {
  if (text === 'on') return true
  if (text === 'off') return false
  return refuse(`${where} reads on or off, not "${text}"`)
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
 * or two, falls through to its own refusal (#125 round 1). A repeated `?feed=` is refused the
 * same way, never picked from (ruled on #125): the list is the comma.
 *
 * A declared-but-empty env variable reads as unset: the env is the one layer the operator cannot
 * correct from the URL, so an empty string is the build setting nothing, not a refusal of every
 * visitor (#125 round 1).
 */
export function resolveSession(
  search: string,
  env: SessionEnv = {},
  registry: readonly RecordingEntry[] = RECORDINGS,
  seed: string = SCENARIO.seed,
): SessionConfig {
  const params = new URLSearchParams(search)

  let feedsText = env.VITE_DEFAULT_FEEDS || BUILD_DEFAULTS.feeds
  const alias = params.get('recording')
  const feedParams = params.getAll('feed')
  if (feedParams.length > 1) refuse('?feed= is given twice — give it once, comma-separated')
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

  const scenarioParam = params.get('scenario')
  const on =
    scenarioParam !== null
      ? parseScenario('?scenario=', scenarioParam)
      : parseScenario('VITE_DEFAULT_SCENARIO', env.VITE_DEFAULT_SCENARIO || BUILD_DEFAULTS.scenario)

  return { feeds, scenario: on ? { on: true, seed } : { on: false } }
}
