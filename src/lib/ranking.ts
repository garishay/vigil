/**
 * The placeholder ranking (scope §11, PR 02c): identity, then range to the protected site.
 *
 * Pure — no React, no DOM, no clock. The Queue is a function of the track list and nothing else,
 * so the same frame always produces the same order, and the scoring engine (PR 04) replaces the
 * sort key without touching the component that renders it.
 */

import type { ProtectedSite } from '../config/ao.ts'
import { distanceMeters } from './geo.ts'
import { IDENTITIES } from './identity.ts'
import type { Track } from './tracks.ts'

export interface RankedTrack {
  track: Track
  /** 1-based position in the queue. */
  rank: number
  /** Range from the track to the nearest protected site's center, meters. */
  rangeM: number
  /** The site that range is measured to. */
  siteId: string
}

/** The nearest protected site and the range to its center. */
function nearestSite(
  position: [number, number],
  sites: readonly ProtectedSite[],
): { siteId: string; rangeM: number } {
  let best = { siteId: sites[0].id, rangeM: distanceMeters(sites[0].center, position) }
  for (const site of sites.slice(1)) {
    const rangeM = distanceMeters(site.center, position)
    if (rangeM < best.rangeM) best = { siteId: site.id, rangeM }
  }
  return best
}

/**
 * Tracks in queue order. The sort key, in order:
 *
 * 1. **identity** — non-cooperative, unknown, cooperative. Silence carries the burden of proof
 *    (§2), and ADS-B is cooperative by construction, so no real aircraft can rank above any
 *    non-cooperative or unknown inject whatever the ranges. A broadcasting inject competes with
 *    ADS-B on range, which is §5.2 working as written.
 * 2. **airborne before on-ground** — a parked aircraft inside the ring reads as zero range, and
 *    the Queue orders rather than hides. Whether scoring filters ground traffic out is PR 04's.
 * 3. **range to the nearest protected site**, ascending.
 * 4. **track id** — the stable tie-break, so a recapture reorders only by data.
 */
export function rankTracks(
  tracks: readonly Track[],
  sites: readonly ProtectedSite[],
): RankedTrack[] {
  if (sites.length === 0) {
    throw new Error('rankTracks needs at least one protected site to measure range against')
  }
  return tracks
    .map((track) => ({ track, ...nearestSite(track.position, sites) }))
    .sort(
      (a, b) =>
        IDENTITIES.indexOf(a.track.identity) - IDENTITIES.indexOf(b.track.identity) ||
        Number(a.track.onGround) - Number(b.track.onGround) ||
        a.rangeM - b.rangeM ||
        (a.track.id < b.track.id ? -1 : a.track.id > b.track.id ? 1 : 0),
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }))
}
