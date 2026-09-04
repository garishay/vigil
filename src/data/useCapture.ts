import { useEffect, useState } from 'react'
import { selectedRecording } from '../config/recordings'
import type { RecordingEntry } from '../config/recordings'
import { captureUrl, loadCapture } from './capture'
import type { AdsbCapture } from '../lib/adsb'

export type CaptureState =
  | { status: 'loading' }
  | { status: 'ready'; recording: RecordingEntry; capture: AdsbCapture }
  | { status: 'error'; message: string }

/**
 * The recording the query string names, fetched once on mount (#84): `?recording=<id>` selects
 * it from the registry, the default without one. The ready state carries the entry beside the
 * capture, since the clock start and the strip's Recording field read both.
 *
 * A failure is surfaced as state rather than thrown: an airspace picture that cannot load its
 * traffic should say so on the screen, not blank out behind an error boundary — and a name that
 * matches no recording is the same kind of failure, in its own words, never a silent fallback.
 *
 * The effect does not reset to `loading` on a search change — the initial state already is, and
 * setting it synchronously in an effect body cascades a render for no gain. Phase 2 replaces this
 * hook with a socket subscription, at which point the reset question goes away with it.
 */
export function useCapture(search: string = window.location.search): CaptureState {
  const [state, setState] = useState<CaptureState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    Promise.resolve()
      .then(() => selectedRecording(search))
      .then(async (recording) => ({ recording, capture: await loadCapture(captureUrl(recording)) }))
      .then((loaded) => {
        if (!cancelled) setState({ status: 'ready', ...loaded })
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ status: 'error', message: error.message })
      })
    return () => {
      cancelled = true
    }
  }, [search])

  return state
}
