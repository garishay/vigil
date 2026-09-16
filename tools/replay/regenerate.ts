/**
 * The picture at a scenario second (S5a, #138, ruled A3): the real layer from the recording's
 * index and the injects from the plan — the seed on the recording's own grid — each inject
 * through the association rule at the run's mode, so an ident here is the one that run's screen
 * showed. Positions and idents need no scoring; the engine runs only where a Vigil frame
 * annotates what Vigil showed (S5c). The ring the standoff is measured against is the study's
 * protected site, and a track's range is the distance to its centre, as the Queue measures it.
 */

import { AO, type ProtectedSite } from '../../src/config/ao.ts'
import { SCORING } from '../../src/config/scoring.ts'
import { STUDY } from '../../src/config/study.ts'
import { associate } from '../../src/lib/feeds.ts'
import { distanceMeters } from '../../src/lib/geo.ts'
import { injectTracksAt, type InjectPlan } from '../../src/lib/injects.ts'
import { pictureAt, type ReplayIndex } from '../../src/lib/replay.ts'
import type { Mode } from '../../src/lib/session.ts'
import type { Track } from '../../src/lib/tracks.ts'

/** The study's protected site: the 5 km ring (#131). */
export const SITE: ProtectedSite = AO.protectedSites[0]

/** The association distance each condition's screen used (S4a, ruled A2; S2b, ruled A3, A4). */
export const associationFor = (mode: Mode): number =>
  mode === 'raw' ? STUDY.rawAssociationM : SCORING.cooperativity.mismatchM

/** Every track at a scenario second, the injects' idents as the run's mode showed them. */
export function pictureAtSecond(
  index: ReplayIndex,
  plan: InjectPlan,
  tSec: number,
  mode: Mode,
): Track[] {
  const associationM = associationFor(mode)
  return [
    ...pictureAt(index, tSec),
    ...injectTracksAt(plan, tSec).map((track) => associate(track, associationM)),
  ]
}

/** One track at a scenario second, or null when it is not in the picture then. */
export const trackAtSecond = (
  index: ReplayIndex,
  plan: InjectPlan,
  id: string,
  tSec: number,
  mode: Mode,
): Track | null => pictureAtSecond(index, plan, tSec, mode).find((track) => track.id === id) ?? null

/** A track's range to the ring's centre, metres — the Queue's definition. */
export const rangeM = (track: Track, site: ProtectedSite = SITE): number =>
  distanceMeters(site.center, track.position)

/**
 * The first scenario second, from `fromS` to `untilS` inclusive, an inject's regenerated position
 * lies within the ring — its ring entry — or null when it never does in that span.
 */
export function entrySecond(
  plan: InjectPlan,
  id: string,
  fromS: number,
  untilS: number,
  site: ProtectedSite = SITE,
): number | null {
  for (let tSec = fromS; tSec <= untilS; tSec++) {
    const track = injectTracksAt(plan, tSec).find((candidate) => candidate.id === id)
    if (track && rangeM(track, site) <= site.radiusM) return tSec
  }
  return null
}
