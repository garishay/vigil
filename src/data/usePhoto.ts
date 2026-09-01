import { useEffect, useState } from 'react'
import type { Photo, PhotoLookup } from './photos'
import type { Track } from '../lib/tracks'

/**
 * The photo for the opened track, or null — while pending, on a miss, and always for an inject,
 * which the lookup is never asked about (03d). Pending shows the silhouette with no indicator.
 *
 * The answer is stored with the track it belongs to, so a different track reads null until its
 * own answer lands: the hook guards this itself rather than relying on the caller to remount per
 * track (review round 1).
 *
 * The hook never aborts. The cache owns the request and shares it across mounts, StrictMode's
 * double mount included, so an abort here would cancel an answer another mount is waiting on. A
 * drawer closed mid-flight lets the one request finish into the cache; the hook only ignores a
 * result that lands after it unmounted (#22, assumption 7).
 */
export function usePhoto(track: Track, lookup: PhotoLookup): Photo | null {
  const [answer, setAnswer] = useState<{ track: Track; photo: Photo | null } | null>(null)
  useEffect(() => {
    if (track.source !== 'adsb') return
    let cancelled = false
    lookup(track).then(
      (photo) => {
        if (!cancelled) setAnswer({ track, photo })
      },
      // The lookup's contract is to fail soft; a caller that forgets still gets the silhouette.
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [track, lookup])
  return answer?.track === track ? answer.photo : null
}
