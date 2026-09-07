/**
 * Time to entry into a protected site, by dead reckoning (#102, ruled) — the decision number
 * behind the closing and proximity factors, displayed: "ninety seconds to the north gate", not a
 * score. Pure — no React, no map, no I/O — so the feeds seam (#115) and a live feed (#72) can
 * call it over whatever produced the picture.
 *
 * Straight-line projection from the observed position, on the observed ground track at the
 * observed ground speed, over the configured horizon, against every protected site: the moment
 * the path first meets each ring, the soonest reported with its site named and its tier carried
 * — named, never weighted. Already inside a ring is an entry at zero and wins (the nearer
 * enclosing site when inside two, as the scorer names it). A track on the ground has nothing to
 * show; one with no speed or heading, one moving away, one whose path misses every ring, and one
 * that would enter past the horizon all read none.
 *
 * The geometry is the closing factor's own — `closestApproach`, on the local tangent plane. With
 * the closest approach inside the ring at `cpa` and `tcpa` seconds away, the path meets the ring
 * at `tcpa − √(r² − cpa²) / v`. The entry point is then stepped out on the sphere, so the line
 * the map draws ends on the ring the map draws — within a metre at the scenario's ranges.
 *
 * **The age of the last message** (ruled A4; #119 round 1): every position is `lastSeenSec` old
 * — a sample arrives already aged, and a track the replay holds past its last sample ages on —
 * so the entry time counts that age off on every track, clamped at zero, and the value cannot
 * step by the sample's age at the tick a hold begins. The caption is another matter: only a track
 * marked `coasting` at the seam sits where it was last heard rather than at an estimate of now,
 * and only that track carries the age out for the display to say so.
 *
 * A display value, not a factor: nothing in the scoring path imports this module.
 */

import type { ProtectedSite, SiteTier } from '../config/ao.ts'
import { PROJECTION, type ProjectionConfig } from '../config/projection.ts'
import { closestApproach, destinationPoint, distanceMeters } from './geo.ts'

const KT_TO_MS = 0.514444

/** The observed fields the projection reads — every track has them; none is the answer key. */
export interface Projectable {
  position: [number, number]
  headingDeg: number | null
  groundSpeedKt: number | null
  onGround: boolean
  lastSeenSec: number
  coasting?: boolean
}

/** A protected site as the projection needs it — the config's shape and the record's alike. */
export type EntrySite = Pick<ProtectedSite, 'id' | 'name' | 'center' | 'radiusM' | 'tier'>

interface Named {
  siteId: string
  siteName: string
  tier: SiteTier
}

export type EntryEstimate = (
  | { kind: 'none' }
  | ({ kind: 'inside' } & Named)
  | ({
      kind: 'entry'
      /** Seconds from now until the path meets the ring. */
      tSec: number
      /** Where it meets it, [longitude, latitude]. */
      point: [number, number]
    } & Named)
) & {
  /**
   * The age of the last message, seconds, when the track is coasting and its position is where
   * it was last heard — what the caption under the value says; null when the position is the
   * picture's estimate of now. The value counts the age off either way.
   */
  coastedS: number | null
}

/**
 * Where the track will be `dtS` from now on its observed speed and heading — its own position
 * when either is unobserved. The projection's one motion primitive, exported for the live feed's
 * dead reckoning at the `pictureAt` seam (#72).
 */
export function projectPosition(track: Projectable, dtS: number): [number, number] {
  if (track.groundSpeedKt === null || track.headingDeg === null || dtS <= 0) return track.position
  return destinationPoint(track.position, track.headingDeg, track.groundSpeedKt * KT_TO_MS * dtS)
}

export function timeToEntry(
  track: Projectable,
  sites: readonly EntrySite[],
  config: ProjectionConfig = PROJECTION,
): EntryEstimate | null {
  if (track.onGround) return null
  const coastedS = track.coasting ? track.lastSeenSec : null
  const named = (site: EntrySite): Named => ({
    siteId: site.id,
    siteName: site.name,
    tier: site.tier,
  })
  let inside: { site: EntrySite; rangeM: number } | null = null
  let best: EntryEstimate = { kind: 'none', coastedS }
  for (const site of sites) {
    const rangeM = distanceMeters(site.center, track.position)
    if (rangeM <= site.radiusM) {
      if (inside === null || rangeM < inside.rangeM) inside = { site, rangeM }
      continue
    }
    if (track.groundSpeedKt === null || track.headingDeg === null) continue
    const speedMs = track.groundSpeedKt * KT_TO_MS
    const approach = closestApproach(track.position, track.headingDeg, speedMs, site.center)
    // Opening, or a path that misses the ring: no entry on this site, whatever the others say.
    if (approach === null || approach.tcpaS <= 0 || approach.cpaM >= site.radiusM) continue
    // Clamped at zero: the two frames can disagree by a metre at the ring itself.
    const pathS = Math.max(
      0,
      approach.tcpaS - Math.sqrt(site.radiusM ** 2 - approach.cpaM ** 2) / speedMs,
    )
    const tSec = Math.max(0, pathS - track.lastSeenSec)
    if (tSec > config.horizonS) continue
    if (best.kind === 'entry' && best.tSec <= tSec) continue
    best = { kind: 'entry', ...named(site), tSec, point: projectPosition(track, pathS), coastedS }
  }
  return inside ? { kind: 'inside', ...named(inside.site), coastedS } : best
}
