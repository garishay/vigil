/**
 * The feed layer (#115, PR 09a): where frames come from, behind one seam.
 *
 * A **feed** is a place the picture's frames come from — a recording today, live ADS-B (#72) and
 * a CoT listener (#116) later. The word is new so it cannot collide with **source**, which keeps
 * its meaning in the engine: a track's observed identity kind (`'adsb'`, `'inject'`), what the
 * ceiling and the Cooperative tag key on. Nothing here, in config, or on screen uses "source" to
 * mean a feed.
 *
 * Every feed implements the seam the recording implements today — `pictureAt` over its own
 * frames, a coast, an id namespace, a health value — and emits observed tracks only. The
 * **scenario** — the seeded injects — implements the same seam internally, so the merge is
 * exercised from the first session with a recording and the scenario; on the strip and in the
 * URL it is its own switch and is never listed among the feeds (ruling 2).
 *
 * The picture is the union of the active feeds, plus the scenario when on, keyed by track id.
 * Ids are namespaced by the *identity kind*, not the feed, so an aircraft heard by two feeds is
 * one track (ruling 3); the spellings are the ones the tree already uses, in `NAMESPACES`.
 */

import { AO } from '../config/ao.ts'
import type { AreaOfOperations } from '../config/ao.ts'
import type { RecordingEntry } from '../config/recordings.ts'
import { REPLAY } from '../config/replay.ts'
import type { ReplayConfig } from '../config/replay.ts'
import { SCENARIO } from '../config/scenario.ts'
import type { ScenarioConfig } from '../config/scenario.ts'
import type { AdsbCapture } from './adsb.ts'
import { injectTracksAt, planScenario, timelineOf } from './injects.ts'
import type { InjectPlan, Timeline } from './injects.ts'
import { indexCapture, pictureAt } from './replay.ts'
import type { ReplayIndex } from './replay.ts'
import type { AdsbTrack, InjectTrack, Track } from './tracks.ts'

/** The feed kinds a session may name. Only `recording` has a builder in this build. */
export type FeedKind = 'recording' | 'adsb' | 'cot'
export const FEED_KINDS: readonly FeedKind[] = ['recording', 'adsb', 'cot']

/**
 * One clock kind per session (ruling 4): a recording owns the sim clock; a live feed runs on the
 * wall clock. The session resolver refuses a set that mixes the two before any feed is built.
 */
export type ClockKind = 'recording' | 'wall'
export const CLOCK_OF_KIND: Readonly<Record<FeedKind, ClockKind>> = {
  recording: 'recording',
  adsb: 'wall',
  cot: 'wall',
}

/**
 * The id namespaces, by identity kind. `adsb-` and `inject-` are what `toTrack` and the
 * generator stamp today; the two live kinds follow the same form when their feeds arrive. A
 * CoT-forwarded aircraft lands in `adsb-`, so it merges with the ADS-B feed's track rather than
 * duplicating it (#116).
 */
export const NAMESPACES = {
  adsb: 'adsb-<hex>',
  rid: 'rid-<serial>',
  cot: 'cot-<uid>',
  inject: 'inject-<nn>',
} as const

/** Which feed, of which kind: `recording:vigil-phl-001` is `{ kind: 'recording', id: 'vigil-phl-001' }`. */
export interface FeedRef {
  kind: FeedKind
  id: string
}

/** The `kind:id` spelling of a ref — the URL's, the env's, and the snapshot's (09b). */
export const feedRefText = (ref: FeedRef): string =>
  ref.id === '' ? ref.kind : `${ref.kind}:${ref.id}`

/**
 * How fresh a feed is at the clock: the age of its last frame at or before `tSec`, and a reason
 * when it has none. A recording's is the replay's own cadence; a live feed's is what the strip
 * prints as its health (ruling 8, 10 — the print waits for a feed whose age can grow, #72).
 */
export interface FeedHealth {
  ageS: number | null
  reason: string | null
}

/** What every source of frames answers — a feed, and the scenario alongside them. */
export interface Picture {
  readonly clock: ClockKind
  /** Seconds a track is held past its last frame before it drops. */
  readonly coastS: number
  pictureAt(tSec: number): readonly Track[]
  healthAt(tSec: number): FeedHealth
}

export interface Feed extends Picture {
  readonly ref: FeedRef
}

/**
 * The recording as a feed. Besides the seam it carries what the replay's history functions read
 * — the index and the timeline — since a recording's past is its frames; a live feed's history
 * is its own (#72), and nothing above the seam reads either without asking the feed.
 */
export interface RecordingFeed extends Feed {
  readonly ref: { kind: 'recording'; id: string }
  readonly clock: 'recording'
  readonly entry: RecordingEntry
  readonly capture: AdsbCapture
  readonly index: ReplayIndex
  readonly timeline: Timeline
  pictureAt(tSec: number): AdsbTrack[]
}

export function recordingFeed(
  entry: RecordingEntry,
  capture: AdsbCapture,
  config: ReplayConfig = REPLAY,
): RecordingFeed {
  const index = indexCapture(capture)
  const timeline = timelineOf(capture)
  return {
    ref: { kind: 'recording', id: entry.id },
    clock: 'recording',
    coastS: config.coastS,
    entry,
    capture,
    index,
    timeline,
    pictureAt: (tSec) => pictureAt(index, tSec, config),
    healthAt: (tSec) => {
      let lastS: number | null = null
      for (const tMs of timeline.frameTimesMs) {
        if (tMs / 1000 > tSec) break
        lastS = tMs / 1000
      }
      return lastS === null
        ? { ageS: null, reason: 'before the first frame' }
        : { ageS: tSec - lastS, reason: null }
    },
  }
}

/**
 * The scenario as a feed: the same seam, sampled continuously from the plan, on the active
 * clock's origin — a recording's own frame times (ruling 5; #39 A). An inject is in the picture
 * on every tick, so it neither coasts nor ages.
 */
export interface ScenarioFeed extends Picture {
  readonly seed: string
  readonly plan: InjectPlan
  pictureAt(tSec: number): InjectTrack[]
}

export function scenarioFeed(
  timeline: Timeline,
  config: ScenarioConfig = SCENARIO,
  ao: AreaOfOperations = AO,
): ScenarioFeed {
  const plan = planScenario(timeline, config, ao)
  return {
    seed: plan.seed,
    plan,
    clock: 'recording',
    coastS: 0,
    pictureAt: (tSec) => injectTracksAt(plan, tSec),
    healthAt: () => ({ ageS: 0, reason: null }),
  }
}

/**
 * The picture at the clock: the feeds in session order, each in its own order, then the scenario
 * — for one recording and the scenario, exactly the list the app built by hand before the seam,
 * so every fold above sees what it saw. A track id seen twice keeps its first feed's track
 * (ruling 3; association beyond an identical id is #116's).
 */
export function mergePicture(
  feeds: readonly Feed[],
  scenario: ScenarioFeed | null,
  tSec: number,
): Track[] {
  const seen = new Set<string>()
  const picture: Track[] = []
  const layers: readonly Picture[] = scenario ? [...feeds, scenario] : feeds
  for (const layer of layers) {
    for (const track of layer.pictureAt(tSec)) {
      if (seen.has(track.id)) continue
      seen.add(track.id)
      picture.push(track)
    }
  }
  return picture
}
