import { useEffect, useState } from 'react'
import { recordingNamed } from '../config/recordings'
import { SCENARIO } from '../config/scenario'
import { captureUrl, loadCapture } from './capture'
import { recordingFeed, scenarioFeed } from '../lib/feeds'
import type { RecordingFeed, ScenarioFeed } from '../lib/feeds'
import { SessionRefusal, resolveSession } from '../lib/session'
import type { SessionConfig, SessionEnv } from '../lib/session'

export type SessionState =
  | { status: 'loading' }
  | {
      status: 'ready'
      session: SessionConfig
      feeds: readonly RecordingFeed[]
      scenario: ScenarioFeed | null
    }
  | { status: 'refused'; reason: string }
  | { status: 'error'; message: string }

/**
 * The session the env and the query string name (#115), built once on mount: the resolver says
 * which feeds and whether the scenario is on; each recording feed's capture is fetched and
 * indexed; the scenario is planned on the recording's own frame times (ruling 5).
 *
 * Two failures, kept apart because the operator reads them differently: a **refusal** is a
 * session that cannot be made from what the URL asked — an unknown feed kind, a mixed clock, a
 * recording the registry lacks — and fetches nothing; an **error** is a session that could be
 * made whose recording would not load. Both are surfaced as state rather than thrown: an
 * airspace picture that cannot show its traffic says so on the screen, never a silent fallback.
 *
 * The effect does not reset to `loading` on a search change — the initial state already is, and
 * setting it synchronously in an effect body cascades a render for no gain. A live feed (#72)
 * replaces the fetch with a subscription behind the same state.
 */
export function useSession(
  search: string = window.location.search,
  env: SessionEnv = import.meta.env as SessionEnv,
): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' })
  // The two variables as primitives, so a caller's fresh env object per render re-runs nothing.
  const feedsEnv = env.VITE_DEFAULT_FEEDS
  const scenarioEnv = env.VITE_DEFAULT_SCENARIO

  useEffect(() => {
    let cancelled = false
    Promise.resolve()
      .then(() =>
        resolveSession(search, {
          VITE_DEFAULT_FEEDS: feedsEnv,
          VITE_DEFAULT_SCENARIO: scenarioEnv,
        }),
      )
      .then(async (session) => {
        const feeds = await Promise.all(
          session.feeds.map(async (ref) => {
            const entry = recordingNamed(ref.id)
            return recordingFeed(entry, await loadCapture(captureUrl(entry)))
          }),
        )
        const scenario = session.scenario.on
          ? scenarioFeed(feeds[0].timeline, { ...SCENARIO, seed: session.scenario.seed })
          : null
        return { session, feeds, scenario }
      })
      .then((built) => {
        if (!cancelled) setState({ status: 'ready', ...built })
      })
      .catch((error: Error) => {
        if (cancelled) return
        setState(
          error instanceof SessionRefusal
            ? { status: 'refused', reason: error.message }
            : { status: 'error', message: error.message },
        )
      })
    return () => {
      cancelled = true
    }
  }, [search, feedsEnv, scenarioEnv])

  return state
}
