/**
 * The engine at a scenario second (S5b, #138, ruled B1; the S5 gate's A3 and A5 under the
 * ruling): the fused picture scored and ranked as the app does it, through the study bench's
 * own per-tick context — the identity memory, the histories, the origins, the minute of day,
 * the scorer, the queue's comparator — so a rank, a composite, or a band here is the app's
 * number. Mode-independent by construction: the score reads the broadcast, never the word
 * (S2b, ruled A3), so the above-calm set at the freeze — the analyst's overlay — is one set for
 * both conditions. The Vigil frame's annotations (S5c) read this too.
 */

import { AO } from '../../src/config/ao.ts'
import { SCORING, type Band } from '../../src/config/scoring.ts'
import { associate } from '../../src/lib/feeds.ts'
import { injectTracksAt, type InjectPlan } from '../../src/lib/injects.ts'
import { queueOrder } from '../../src/lib/ranking.ts'
import { historiesAt, memoryAt, originsOf, pictureAt } from '../../src/lib/replay.ts'
import { clockStartOf, minuteOfDay, scoreTrack, type Score } from '../../src/lib/scoring.ts'
import type { Track } from '../../src/lib/tracks.ts'
import type { Study } from './load.ts'

export interface RankedAt {
  track: Track
  /** 1-based position in the queue at that second. */
  rank: number
  /** The composite the chip prints, rounded as the chip rounds it. */
  composite: number
  band: Band
  rangeM: number
  /** The site the range is measured to — the score's own. */
  siteId: string
  /** The app's score, with its mismatch evidence: what `reasonTag` and `mismatchLine` read (S5c-ii, C1). */
  score: Score
}

/**
 * Every track at a scenario second in queue order, scored as Vigil scores it — the injects
 * through the association rule at the scorer's threshold, the feed Vigil shows.
 */
export function rankedAtSecond(study: Study, plan: InjectPlan, tSec: number): RankedAt[] {
  const { index, recording } = study
  const startLocal = clockStartOf(recording.entry, recording.capture, AO)
  const adsb = pictureAt(index, tSec)
  const layer = injectTracksAt(plan, tSec).map((track) =>
    associate(track, SCORING.cooperativity.mismatchM),
  )
  const tracks = [...adsb, ...layer]
  const context = {
    tSec,
    minuteOfDay: minuteOfDay(startLocal, tSec),
    memory: memoryAt((t) => injectTracksAt(plan, t), plan.intervalS, tSec),
    history: historiesAt(index, plan, tracks, tSec, SCORING.pattern.windowS),
    friendly: AO.friendlyAreas,
    origins: originsOf(index, plan),
    config: SCORING,
  }
  return tracks
    .map((track) => {
      const score = scoreTrack(track, AO.protectedSites, context)
      return { track, score, rangeM: score.rangeM }
    })
    .sort(queueOrder)
    .map(({ track, score, rangeM }, i) => ({
      track,
      rank: i + 1,
      composite: Math.round(score.composite),
      band: score.band,
      rangeM,
      siteId: score.siteId,
      score,
    }))
}

/** The candidates: the injects above calm, in queue order — the bench's own predicate. */
export const candidatesAt = (ranked: readonly RankedAt[]): RankedAt[] =>
  ranked.filter((entry) => entry.track.source === 'inject' && entry.band !== 'calm')
