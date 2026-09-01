import type { AdsbTrack } from '../lib/tracks'

/**
 * The photo tier of Track Visuals (§7, #22 — 03d): one Planespotters thumbnail per opened ADS-B
 * track, looked up by hex at runtime and failing soft to the silhouette.
 *
 * This is the first runtime call to a third party, permitted by §5.1 for display enrichment that
 * fails soft: nothing in the scoring path reads it, and nothing from the response is written to
 * the repo or to persistent storage — the session cache below lives in module memory and dies
 * with the tab. The image itself is loaded by the browser from Planespotters' URL, unchanged, and
 * never stored or re-hosted, as their API terms require.
 *
 * Typed on `AdsbTrack`, so no call site can pass an inject. A specific make is something the
 * system never observed of a synthetic track; the type makes the photo path unrepresentable for
 * one rather than merely unused (#22 acceptance criteria).
 */

/** The four fields the API terms require the display to carry, and nothing else. */
export interface Photo {
  /** The thumbnail URL, loaded by the browser as-is. */
  src: string
  width: number
  height: number
  /** The photo's page. The terms want a plain link to it, unchanged, without `nofollow`. */
  link: string
  /** Credited in text beside the image. */
  photographer: string
}

export type PhotoLookup = (track: AdsbTrack) => Promise<Photo | null>

const API_URL = 'https://api.planespotters.net/pub/photos/hex/'
/** A slow answer holds the silhouette with no indicator, so the wait it hides is bounded. */
const TIMEOUT_MS = 5000

/**
 * Session cache, keyed by hex. The in-flight promise is the entry, so concurrent callers — a
 * StrictMode double mount included — share one request. A definitive answer (a photo, or a miss:
 * empty list, error body, client error) stays for the session; a thrown fetch, a timeout, a rate
 * limit, or a server failure is dropped, so the next open of that hex may ask once more — a
 * session that started offline should not stay silhouette-only after the network returns (ruled
 * on #22, assumption 8). Each open still makes at most one request.
 */
const cache = new Map<string, Promise<Photo | null>>()

export function clearPhotoCache(): void {
  cache.clear()
}

/** One lookup per hex per session. Never rejects — every failure is a `null`. */
export function lookupPhoto(
  track: AdsbTrack,
  fetcher: typeof fetch = fetch,
): Promise<Photo | null> {
  const hex = track.icaoHex
  // A TIS-B/MLAT track carries a synthetic `~` hex with no registry behind it: no request.
  if (hex.startsWith('~')) return Promise.resolve(null)
  const pending = cache.get(hex)
  if (pending) return pending
  const request = fetchPhoto(hex, fetcher).catch(() => {
    cache.delete(hex)
    return null
  })
  cache.set(hex, request)
  return request
}

/** Resolves for a definitive answer, throws for one that says nothing about the hex. */
async function fetchPhoto(hex: string, fetcher: typeof fetch): Promise<Photo | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetcher(`${API_URL}${encodeURIComponent(hex)}`, {
      signal: controller.signal,
    })
    if (response.status === 429 || response.status >= 500) {
      throw new Error(`photo lookup answered HTTP ${response.status}`)
    }
    if (!response.ok) return null
    return firstPhoto(await response.json().catch(() => null))
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fail-soft keys on the body's shape, never on the status alone: a malformed hex is a 200 with
 * `{ error: "Hex invalid or missing" }` and no `photos` key, and a true miss is `{ photos: [] }`
 * (both probed on 2026-09-01). Only the four fields the terms need are kept.
 */
function firstPhoto(body: unknown): Photo | null {
  if (!isRecord(body) || !Array.isArray(body.photos)) return null
  const entry: unknown = body.photos[0]
  if (!isRecord(entry) || !isRecord(entry.thumbnail) || !isRecord(entry.thumbnail.size)) {
    return null
  }
  const { src } = entry.thumbnail
  const { width, height } = entry.thumbnail.size
  const { link, photographer } = entry
  if (typeof src !== 'string' || typeof link !== 'string' || typeof photographer !== 'string') {
    return null
  }
  if (typeof width !== 'number' || typeof height !== 'number') return null
  return { src, width, height, link, photographer }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
