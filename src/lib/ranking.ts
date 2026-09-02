/**
 * The ranked queue (scope §7): every track scored by the engine, ordered by composite.
 *
 * Pure — no React, no DOM, no clock; time arrives inside the scoring context. The Queue is a
 * function of the track list and that context and nothing else, so the same frame always
 * produces the same order. Ranking never reads lifecycle status (CLAUDE.md): status is applied
 * at render, after this sort.
 */

import type { ProtectedSite } from '../config/ao.ts'
import { SCENARIO } from '../config/scenario.ts'
import { IDENTITIES } from './identity.ts'
import { minuteOfDay, scoreTrack, type Score, type ScoringContext } from './scoring.ts'
import type { Track } from './tracks.ts'

export interface RankedTrack {
  track: Track
  /** 1-based position in the queue. */
  rank: number
  /** Range from the track to the nearest protected site's center, meters. */
  rangeM: number
  /** The site that range is measured to. */
  siteId: string
  score: Score
}

/** Frame 0 at the scenario's clock start, nothing yet heard — what a caller without a clock gets. */
const FRAME_ZERO: ScoringContext = {
  tSec: 0,
  minuteOfDay: minuteOfDay(SCENARIO.clock.startLocal, 0),
  memory: {},
}

/**
 * Tracks in queue order. The sort key, in order:
 *
 * 1. **composite score**, descending — the engine's answer, breakdown retained on the entry.
 * 2. **uncapped composite**, descending — orders the ADS-B block the ceiling flattened.
 * 3. **identity** — non-cooperative, unknown, cooperative; silence carries the burden (§2).
 * 4. **airborne before on-ground** — the Queue orders rather than hides.
 * 5. **range to the nearest protected site**, ascending.
 * 6. **track id** — the stable tie-break, so a recapture reorders only by data.
 */
export function rankTracks(
  tracks: readonly Track[],
  sites: readonly ProtectedSite[],
  context: ScoringContext = FRAME_ZERO,
): RankedTrack[] {
  if (sites.length === 0) {
    throw new Error('rankTracks needs at least one protected site to measure range against')
  }
  return tracks
    .map((track) => {
      const score = scoreTrack(track, sites, context)
      return { track, score, rangeM: score.rangeM, siteId: score.siteId }
    })
    .sort(
      (a, b) =>
        b.score.composite - a.score.composite ||
        b.score.uncapped - a.score.uncapped ||
        IDENTITIES.indexOf(a.track.identity) - IDENTITIES.indexOf(b.track.identity) ||
        Number(a.track.onGround) - Number(b.track.onGround) ||
        a.rangeM - b.rangeM ||
        (a.track.id < b.track.id ? -1 : a.track.id > b.track.id ? 1 : 0),
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }))
}
