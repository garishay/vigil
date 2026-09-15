import { useEffect, useState } from 'react'
import { recordingNamed } from '../config/recordings'
import { scenarioNamed } from '../config/scenarios'
import { STUDY } from '../config/study'
import { captureUrl, loadCapture } from './capture'
import { recordingFeed, scenarioFeed } from '../lib/feeds'
import type { RecordingFeed, ScenarioFeed } from '../lib/feeds'
import { SessionRefusal, resolveSession } from '../lib/session'
import type { SessionConfig, SessionEnv } from '../lib/session'

export type SessionState =
  /**
   * Loading carries the session the URL resolved to, synchronously, so the shell can wear the
   * requested mode before the recording is in (S4a, #148 round 1): a study subject on a raw
   * link must never see Vigil's shell flash. Absent only for a test's bare loading state.
   */
  | { status: 'loading'; session?: SessionConfig }
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
  // The URL resolves synchronously; only the recording's fetch is asynchronous. Resolving here
  // gives the first render the mode (S4a); the effect below resolves again on its own path.
  const [state, setState] = useState<SessionState>(() => {
    try {
      return { status: 'loading', session: resolveSession(search, env) }
    } catch (error) {
      return error instanceof SessionRefusal
        ? { status: 'refused', reason: error.message }
        : { status: 'error', message: (error as Error).message }
    }
  })
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
        // The named config from the registry (S3b): its seed is the session's (ruling 5). In
        // raw mode the same picture goes through the association rule at raw's own distance
        // (S4a, #136, ruled A2; #131) — the one thing raw computes; Vigil's feed keeps the
        // scorer's threshold, the default.
        const scenario = session.scenario.on
          ? session.mode === 'raw'
            ? scenarioFeed(
                feeds[0].timeline,
                scenarioNamed(session.scenario.name).config,
                undefined,
                STUDY.rawAssociationM,
              )
            : scenarioFeed(feeds[0].timeline, scenarioNamed(session.scenario.name).config)
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
