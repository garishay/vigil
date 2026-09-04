/**
 * The recording on a clock (scope §5.1, PR 06a): the real picture at any instant, not only at
 * the fifteen-second samples the capture holds. Pure — no React, no DOM, no I/O, no timer; the
 * clock is an input, which is what lets a test seek anywhere without waiting.
 *
 * **Interpolate, never snap** (ruled on #6). At 400 kt an aircraft moves 3 km between samples;
 * snapping to the nearest frame would teleport the calm background traffic once every fifteen
 * seconds. So each aircraft is bracketed by its *own* two samples either side of the clock and
 * read linearly between them — position, altitude, ground speed, vertical rate — with the
 * heading taken the short way round the compass. A one-frame hole inside a track's span is
 * bridged the same way; the position stays plausible while `lastSeenSec` says the last message
 * is ageing, and the two stay honest separately.
 *
 * **Never into existence.** A track is absent before its first sample. After its last — or
 * across a hole wider than the coast window — it holds at that sample while `lastSeenSec`
 * accrues, and leaves the picture once that passes the window: the aggregator drops a track
 * at 60 s of silence, and the replay follows it one sample later.
 *
 * This reads the *next* sample, which a live feed cannot. `pictureAt` is the seam where Phase 2
 * replaces interpolation with dead reckoning; nothing above it knows the difference.
 */

import { REPLAY, type ReplayConfig } from '../config/replay.ts'
import { toTrack } from './adsb.ts'
import type { AdsbCapture } from './adsb.ts'
import { round } from './geo.ts'
import { injectTracksAt, type InjectPlan } from './injects.ts'
import type { HistorySample, TrackHistories, TrackHistory } from './patterns.ts'
import { rememberIdentities, type IdentityMemory, type ObservedTrack } from './scoring.ts'
import type { AdsbTrack, InjectTrack, Track } from './tracks.ts'

interface Sample {
  tSec: number
  track: AdsbTrack
}

/** The recording re-keyed by aircraft, so the clock can ask for one track's neighbours. */
export interface ReplayIndex {
  /** The first frame's time, seconds — the instant an inject is first in the picture (08b). */
  startS: number
  /** The last frame's time, seconds — where the clock stops. */
  durationS: number
  samples: ReadonlyMap<string, readonly Sample[]>
}

/** Built once per recording; `pictureAt` reads it on every tick. */
export function indexCapture(capture: AdsbCapture): ReplayIndex {
  const samples = new Map<string, Sample[]>()
  // Sorted by time, not trusted to be: a gap is honest in `tMs`, and so must be the order.
  const frames = [...capture.frames].sort((a, b) => a.tMs - b.tMs)
  for (const frame of frames) {
    for (const record of frame.records) {
      const track = toTrack(record)
      const list = samples.get(track.id) ?? []
      list.push({ tSec: frame.tMs / 1000, track })
      samples.set(track.id, list)
    }
  }
  return {
    startS: frames.length > 0 ? frames[0].tMs / 1000 : 0,
    durationS: frames.length > 0 ? frames[frames.length - 1].tMs / 1000 : 0,
    samples,
  }
}

/**
 * Every track's observed first-seen position, by id (08b, ruled on #86): an aircraft's first
 * sample off the index, an inject's position at the recording's first frame — read from the
 * data, never from what the session has rendered, so a session opened at a seek reads the same
 * origin a session played from the start would (the determinism criterion), and a live feed has
 * the same fact in a track's first message. Nothing here reads the generator's launch points:
 * an inject's origin is where the picture first showed it. Built once per recording; the
 * friendly-launch condition in the scorer reads it as `origins`.
 */
export function originsOf(
  index: ReplayIndex,
  plan: InjectPlan | null,
): Readonly<Record<string, [number, number]>> {
  const origins: Record<string, [number, number]> = {}
  for (const [id, samples] of index.samples) origins[id] = samples[0].track.position
  if (plan)
    for (const inject of injectTracksAt(plan, index.startS)) origins[inject.id] = inject.position
  return origins
}

/**
 * The sim time the recording last heard an aircraft at or before `tSec`: its last sample not
 * past the clock, less the age that sample already carried — the message time, the same one
 * `pictureAt` measures the coast from. Null for a track the recording holds no sample of. What
 * a Lost line carries (#71, #36 [11]): read off the recording rather than the picture as last
 * drawn, since under a seek that commit can predate later samples.
 */
export function lastHeardBefore(index: ReplayIndex, trackId: string, tSec: number): number | null {
  const samples = index.samples.get(trackId)
  if (!samples) return null
  let last: Sample | null = null
  for (const sample of samples) {
    if (sample.tSec > tSec) break
    last = sample
  }
  return last ? round(last.tSec - last.track.lastSeenSec, 1) : null
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f

/** Both readings, or the earlier one when the later is missing — a null is a gap, not a zero. */
const between = (a: number | null, b: number | null, f: number, places: number) =>
  a === null || b === null ? a : round(lerp(a, b, f), places)

/** The short way round: 350° to 10° passes through 0, never through 180. */
export function interpolateHeading(a: number, b: number, f: number): number {
  const delta = ((((b - a) % 360) + 540) % 360) - 180
  return round((((a + delta * f) % 360) + 360) % 360, 1)
}

function interpolate(prev: Sample, next: Sample, tSec: number): AdsbTrack {
  const f = (tSec - prev.tSec) / (next.tSec - prev.tSec)
  const a = prev.track
  const b = next.track
  return {
    ...a,
    position: [
      round(lerp(a.position[0], b.position[0], f), 5),
      round(lerp(a.position[1], b.position[1], f), 5),
    ],
    altitudeFt: between(a.altitudeFt, b.altitudeFt, f, 0),
    groundSpeedKt: between(a.groundSpeedKt, b.groundSpeedKt, f, 1),
    verticalRateFpm: between(a.verticalRateFpm, b.verticalRateFpm, f, 0),
    headingDeg:
      a.headingDeg === null || b.headingDeg === null
        ? a.headingDeg
        : interpolateHeading(a.headingDeg, b.headingDeg, f),
  }
}

/**
 * The real picture at `tSec`: every aircraft the recording knows about at that instant, in id
 * order. At a sample's own instant a track reads exactly as `frameTracks` would read it.
 */
export function pictureAt(
  index: ReplayIndex,
  tSec: number,
  config: ReplayConfig = REPLAY,
): AdsbTrack[] {
  const picture: AdsbTrack[] = []
  for (const samples of index.samples.values()) {
    let prevIndex = -1
    for (let i = 0; i < samples.length && samples[i].tSec <= tSec; i++) prevIndex = i
    if (prevIndex < 0) continue
    const prev = samples[prevIndex]
    const next = samples[prevIndex + 1] as Sample | undefined
    // The last message is the previous sample's, however the position between is derived, and
    // the coast window is measured from that message in both branches: a sample that already
    // carried an age spends it here too, so a bridged hole cannot outlive the window a held
    // track is dropped at (#73 review). The gap test stays beside it — a hole the aggregator
    // itself would have dropped the track through is a leave and a return, held, not bridged.
    const lastSeenSec = round(prev.track.lastSeenSec + (tSec - prev.tSec), 1)
    if (lastSeenSec > config.coastS) continue
    if (next && next.tSec - prev.tSec <= config.coastS) {
      picture.push({ ...interpolate(prev, next, tSec), lastSeenSec })
    } else {
      picture.push({ ...prev.track, lastSeenSec })
    }
  }
  return picture.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * The identity memory at `tSec` as a pure fold over the frame grid up to it — the instants a
 * broadcast is actually sampled at — so playing to a time tick by tick and seeking straight to
 * it land on the same memory, and the same score (the determinism criterion on #6). Cheap
 * enough to rebuild every tick: at most eighty frames of a handful of injects.
 */
export function memoryAt(
  sample: (tSec: number) => readonly ObservedTrack[],
  intervalS: number,
  tSec: number,
): IdentityMemory {
  let memory: IdentityMemory = {}
  for (let t = 0; t <= tSec; t += intervalS) memory = rememberIdentities(memory, sample(t), t)
  return memory
}

/** The inject picture at an instant, computed once however many tracks ask for it (#80 review). */
type InjectSampler = (tSec: number) => readonly InjectTrack[]

function injectSampler(plan: InjectPlan | null): InjectSampler {
  const cache = new Map<number, InjectTrack[]>()
  return (tSec) => {
    if (!plan) return []
    let tracks = cache.get(tSec)
    if (!tracks) {
      tracks = injectTracksAt(plan, tSec)
      cache.set(tSec, tracks)
    }
    return tracks
  }
}

function sampleHistory(
  index: ReplayIndex,
  plan: InjectPlan | null,
  track: Track,
  tSec: number,
  windowS: number,
  coastS: number,
  injectsAt: InjectSampler,
): TrackHistory {
  const since = tSec - windowS
  let past: HistorySample[] = []
  if (track.source === 'adsb') {
    for (const sample of index.samples.get(track.id) ?? []) {
      if (sample.tSec < since || sample.tSec >= tSec) continue
      // A hole wider than the coast is a leave and a return — `pictureAt` drops the track through
      // it — so the history starts over on the far side: a dwell or a return is never read
      // across time in which nothing was observed (#80 review). A narrower hole is the one the
      // picture bridges, and the history bridges it the same way.
      const last = past[past.length - 1]
      if (last && sample.tSec - last.tSec > coastS) past = []
      past.push({ tSec: sample.tSec, position: sample.track.position })
    }
  } else if (plan) {
    const first = Math.max(0, Math.ceil(since / plan.intervalS) * plan.intervalS)
    for (let t = first; t < tSec; t += plan.intervalS) {
      const position = injectsAt(t).find((inject) => inject.id === track.id)?.position
      if (position) past.push({ tSec: t, position })
    }
  }
  // A held track sits on its last sample; that is one known position, not two (#75 review).
  const last = past[past.length - 1]
  const [lon, lat] = track.position
  if (last && last.position[0] === lon && last.position[1] === lat) return past
  return [...past, { tSec, position: track.position }]
}

/**
 * One track's position history: where it has been over the last `windowS` seconds, oldest first,
 * ending on where it is now. Pure in `tSec`, like the picture — no fold state, so a seek gets
 * the same history play would. Recorded samples only for an aircraft — real observations, never
 * the interpolations between them, and never across a hole wider than the coast — and the
 * frame-grid instants for an inject. The trail the map draws (06b) and the history the pattern
 * detectors read (05a) are this one sampler at two windows.
 */
export function historyAt(
  index: ReplayIndex,
  plan: InjectPlan | null,
  track: Track,
  tSec: number,
  windowS: number,
  config: ReplayConfig = REPLAY,
): TrackHistory {
  return sampleHistory(index, plan, track, tSec, windowS, config.coastS, injectSampler(plan))
}

/** The selected track's history trail (06b): its positions over the last `trailS` seconds. */
export function trailAt(
  index: ReplayIndex,
  plan: InjectPlan | null,
  track: Track,
  tSec: number,
  config: ReplayConfig = REPLAY,
): [number, number][] {
  return historyAt(index, plan, track, tSec, config.trailS, config).map((sample) => sample.position)
}

/**
 * Every track's history at `tSec`, by id — the scorer's `history` (05a). Sampled afresh each
 * tick rather than accumulated, so a seek and a play agree. Each inject instant in the window
 * is computed once and shared by every track that reads it, so the cost is the grid, not the
 * grid times the tracks (#80 review).
 */
export function historiesAt(
  index: ReplayIndex,
  plan: InjectPlan | null,
  tracks: readonly Track[],
  tSec: number,
  windowS: number,
  config: ReplayConfig = REPLAY,
): TrackHistories {
  const injectsAt = injectSampler(plan)
  return Object.fromEntries(
    tracks.map((track) => [
      track.id,
      sampleHistory(index, plan, track, tSec, windowS, config.coastS, injectsAt),
    ]),
  )
}
