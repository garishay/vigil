/**
 * Loading the recorded ADS-B picture.
 *
 * The recording is a static asset fetched at startup rather than a module bundled into the app.
 * Two reasons, in order of importance: Phase 2 replaces this function with a WebSocket feed, and
 * an already-async seam makes that swap a change to one module instead of a change to every
 * component that consumes it. Second, 1.3 MB of JSON (the recording, with its display enrichment)
 * inlined into the bundle crosses Vite's chunk-size warning and is re-downloaded on every deploy
 * rather than cached.
 */

import { AO } from '../config/ao'
import type { AreaOfOperations } from '../config/ao'
import { toTrack } from '../lib/adsb'
import type { AdsbCapture, CaptureFrame } from '../lib/adsb'
import type { AdsbTrack } from '../lib/tracks'

/** Served from `public/`, so the path is relative to whatever base the app is deployed under. */
export const CAPTURE_URL = `${import.meta.env.BASE_URL}adsb-phl.json`

/**
 * Rejects a recording that does not belong to this AO.
 *
 * Replaying a PHL capture against a relocated AO would put real traffic hundreds of miles from
 * the protected site and quietly make every proximity score meaningless. Since the AO is
 * configuration (§5), that mistake is one edit away, and it should fail loudly rather than render.
 */
export function assertCaptureMatchesAo(capture: AdsbCapture, ao: AreaOfOperations = AO): void {
  if (capture.ao !== ao.id) {
    throw new Error(`capture was recorded over "${capture.ao}", but the AO is "${ao.id}"`)
  }
  if (!Array.isArray(capture.frames) || capture.frames.length === 0) {
    throw new Error('capture contains no frames')
  }
}

/** Fetches and validates the recording. `fetcher` is injectable so tests need no network. */
export async function loadCapture(
  url: string = CAPTURE_URL,
  fetcher: typeof fetch = fetch,
  ao: AreaOfOperations = AO,
): Promise<AdsbCapture> {
  const response = await fetcher(url)
  if (!response.ok) {
    throw new Error(`could not load the ADS-B recording: HTTP ${response.status}`)
  }
  const capture = (await response.json()) as AdsbCapture
  assertCaptureMatchesAo(capture, ao)
  return capture
}

/**
 * One frame's stored records as tracks.
 *
 * This is where the fixture becomes cooperative: `toTrack` stamps the identity that the file
 * itself has no field for (§2).
 */
export function frameTracks(frame: CaptureFrame): AdsbTrack[] {
  return frame.records.map(toTrack)
}
