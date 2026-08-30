import { useEffect, useState } from 'react'
import { CAPTURE_URL, loadCapture } from './capture'
import type { AdsbCapture } from '../lib/adsb'

export type CaptureState =
  | { status: 'loading' }
  | { status: 'ready'; capture: AdsbCapture }
  | { status: 'error'; message: string }

/**
 * The recording, fetched once on mount.
 *
 * A failure is surfaced as state rather than thrown: an airspace picture that cannot load its
 * traffic should say so on the screen, not blank out behind an error boundary.
 *
 * The effect does not reset to `loading` on a url change — the initial state already is, and
 * setting it synchronously in an effect body cascades a render for no gain. Phase 2 replaces this
 * hook with a socket subscription, at which point the reset question goes away with it.
 */
export function useCapture(url: string = CAPTURE_URL): CaptureState {
  const [state, setState] = useState<CaptureState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    loadCapture(url)
      .then((capture) => {
        if (!cancelled) setState({ status: 'ready', capture })
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ status: 'error', message: error.message })
      })
    return () => {
      cancelled = true
    }
  }, [url])

  return state
}
