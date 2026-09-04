import { describe, expect, it } from 'vitest'
import captureRaw from '../../public/adsb-phl.json?raw'
import { PHL } from '../config/ao'
import { SCENARIO } from '../config/scenario'
import { frameTracks } from '../data/capture'
import type { AdsbCapture, CaptureRecord } from './adsb'
import { gridTimeline, injectTracksAt, planScenario } from './injects'
import {
  historiesAt,
  historyAt,
  indexCapture,
  interpolateHeading,
  lastHeardBefore,
  memoryAt,
  pictureAt,
  trailAt,
  originsOf,
} from './replay'
import { rememberIdentities, type IdentityMemory } from './scoring'

const capture = (frames: { tMs: number; records: CaptureRecord[] }[]): AdsbCapture => ({
  ao: 'phl',
  source: 'test',
  capturedAt: '2026-09-02T00:00:00.000Z',
  intervalMs: 15000,
  bbox: PHL.bbox,
  frames,
})

const A0: CaptureRecord = {
  hex: 'a00001',
  callsign: 'TEST1',
  position: [-75.2, 39.8],
  altitudeFt: 1000,
  groundSpeedKt: 200,
  headingDeg: 350,
  verticalRateFpm: 0,
  category: 'A3',
}
const A1: CaptureRecord = {
  ...A0,
  position: [-75.0, 40.0],
  altitudeFt: 2000,
  groundSpeedKt: 300,
  headingDeg: 10,
  verticalRateFpm: 1000,
  lastSeenSec: 2,
}

describe('pictureAt', () => {
  const index = indexCapture(
    capture([
      { tMs: 0, records: [A0] },
      { tMs: 15000, records: [A1] },
    ]),
  )

  it('reads a track linearly between its two bracketing samples, heading the short way round', () => {
    const [track] = pictureAt(index, 7.5)
    expect(track.position).toEqual([-75.1, 39.9])
    expect(track.altitudeFt).toBe(1500)
    expect(track.groundSpeedKt).toBe(250)
    expect(track.verticalRateFpm).toBe(500)
    // 350° to 10° passes through north, not through 180°.
    expect(track.headingDeg).toBe(0)
    // The last message is still the earlier sample's, and it is ageing.
    expect(track.lastSeenSec).toBe(7.5)
    // The fields a sample carries whole ride the earlier one.
    expect(track.callsign).toBe('TEST1')
    expect(track.category).toBe('A3')
  })

  it('reproduces a sample exactly at its own instant', () => {
    expect(pictureAt(index, 0)).toEqual(frameTracks({ tMs: 0, records: [A0] }))
    expect(pictureAt(index, 15)).toEqual(frameTracks({ tMs: 15000, records: [A1] }))
  })

  it('is absent before its first sample — never interpolated into existence', () => {
    const late = indexCapture(
      capture([
        { tMs: 0, records: [] },
        { tMs: 15000, records: [A1] },
      ]),
    )
    expect(pictureAt(late, 10)).toEqual([])
    expect(pictureAt(late, 15)).toHaveLength(1)
  })

  it('holds at its last sample while seen accrues, then leaves once past the coast window', () => {
    const held = pictureAt(index, 60)
    expect(held).toHaveLength(1)
    expect(held[0].position).toEqual(A1.position)
    // Recorded 2 s old at the sample, 45 s later.
    expect(held[0].lastSeenSec).toBe(47)
    // 90 s of coast counts from the message, not the sample: 15 + (90 − 2) is the last instant.
    expect(pictureAt(index, 103)).toHaveLength(1)
    expect(pictureAt(index, 104)).toEqual([])
    // The window is configuration.
    expect(pictureAt(index, 60, { coastS: 30, tickMs: 1000, trailS: 120 })).toEqual([])
  })

  it('bridges an interior hole inside the coast window by the track’s own samples', () => {
    const gappy = indexCapture(
      capture([
        { tMs: 0, records: [A0] },
        { tMs: 15000, records: [] },
        { tMs: 30000, records: [A1] },
      ]),
    )
    const [track] = pictureAt(gappy, 15)
    expect(track.position).toEqual([-75.1, 39.9])
    expect(track.lastSeenSec).toBe(15)
  })

  it('does not bridge a hole wider than the coast window — it is a leave and a return', () => {
    const wide = indexCapture(
      capture([
        { tMs: 0, records: [A0] },
        { tMs: 120000, records: [A1] },
      ]),
    )
    expect(pictureAt(wide, 60)[0].position).toEqual(A0.position)
    expect(pictureAt(wide, 100)).toEqual([])
    expect(pictureAt(wide, 120)[0].position).toEqual(A1.position)
  })

  it('keeps a reading the later sample lacks rather than lerping toward a zero (#35)', () => {
    const bare: CaptureRecord = { ...A1 }
    delete bare.altitudeFt
    delete bare.headingDeg
    const partial = indexCapture(
      capture([
        { tMs: 0, records: [A0] },
        { tMs: 15000, records: [bare] },
      ]),
    )
    const [track] = pictureAt(partial, 7.5)
    expect(track.altitudeFt).toBe(1000)
    expect(track.headingDeg).toBe(350)
    expect(track.groundSpeedKt).toBe(250)
  })

  it('reads the committed recording back exactly at every frame instant, id-ordered', () => {
    const recording = JSON.parse(captureRaw) as AdsbCapture
    const index = indexCapture(recording)
    expect(index.durationS).toBe(1185)
    for (const frame of recording.frames) {
      const expected = frameTracks(frame)
      const ids = new Set(expected.map((track) => track.id))
      const picture = pictureAt(index, frame.tMs / 1000).filter((track) => ids.has(track.id))
      expect(picture).toEqual(expected)
    }
  })

  it('is a function of the clock alone — the same instant twice is the same picture', () => {
    const recording = JSON.parse(captureRaw) as AdsbCapture
    const index = indexCapture(recording)
    expect(pictureAt(index, 307)).toEqual(pictureAt(index, 307))
    expect(pictureAt(index, 307)).not.toEqual(pictureAt(index, 308))
  })
})

describe('interpolateHeading', () => {
  it('takes the short arc across the wrap in both directions', () => {
    expect(interpolateHeading(350, 10, 0.5)).toBe(0)
    expect(interpolateHeading(10, 350, 0.5)).toBe(0)
    expect(interpolateHeading(10, 350, 0.25)).toBe(5)
    expect(interpolateHeading(90, 260, 0.5)).toBe(175)
    expect(interpolateHeading(0, 90, 0.5)).toBe(45)
  })
})

describe('memoryAt', () => {
  const plan = planScenario(gridTimeline(80, 15000))
  const sample = (t: number) => injectTracksAt(plan, t)

  it('equals the frame-by-frame fold, so playing to an instant and seeking to it agree', () => {
    let folded: IdentityMemory = {}
    for (let t = 0; t <= 300; t += 15) folded = rememberIdentities(folded, sample(t), t)
    expect(memoryAt(sample, plan.intervalS, 300)).toEqual(folded)
    // Between samples the memory is the last sample's: nothing is heard at 307 that was not at 300.
    expect(memoryAt(sample, plan.intervalS, 307)).toEqual(folded)
  })

  it('stamps the sample instant a broadcast was heard at, not the tick that asked', () => {
    const intermittent = plan.specs.find((spec) => spec.remoteId === 'intermittent')
    expect(intermittent).toBeDefined()
    const heard = intermittent!.heard
    const lastHeardFrame = heard.slice(0, 21).lastIndexOf(true)
    expect(lastHeardFrame).toBeGreaterThanOrEqual(0)
    const memory = memoryAt(sample, plan.intervalS, 20 * 15 + 7)
    expect(memory[intermittent!.id]).toEqual({ lastHeardTSec: lastHeardFrame * 15 })
    expect(SCENARIO.seed).toBe(plan.seed)
  })
})

describe('pictureAt — the coast window is one clock in both branches (#73 review)', () => {
  it('drops a bridged track once the age its sample already carried runs past the window', () => {
    // Heard 23.4 s before the sample at t=0; the next sample is 75 s on — inside the gap test.
    const aged = indexCapture(
      capture([
        { tMs: 0, records: [{ ...A0, lastSeenSec: 23.4 }] },
        { tMs: 75000, records: [A1] },
      ]),
    )
    // Bridged while the message is inside the window …
    expect(pictureAt(aged, 66)[0].lastSeenSec).toBe(89.4)
    // … absent the moment it is not — the same instant a held track would leave — and back at
    // the next sample, which is a fresh message.
    expect(pictureAt(aged, 67)).toEqual([])
    expect(pictureAt(aged, 75)[0].lastSeenSec).toBe(2)
  })
})

describe('trailAt (06b)', () => {
  const plan = planScenario(gridTimeline(80, 15000))
  const samples = [...Array(8)].map((_, i) => ({
    tMs: i * 15000,
    records: [{ ...A0, position: [-75.2 + i * 0.01, 39.8] as [number, number] }],
  }))
  const index = indexCapture(capture(samples))

  it('lists an aircraft’s recorded samples inside the window, oldest first, then where it is now', () => {
    const [track] = pictureAt(index, 67)
    const trail = trailAt(index, plan, track, 67)
    // 67 − 120 < 0, so every sample before 67 s: 0, 15, 30, 45, 60 — then the current
    // interpolated position, which is not a sample.
    expect(trail).toHaveLength(6)
    expect(trail[0]).toEqual([-75.2, 39.8])
    expect(trail[4]).toEqual([-75.16, 39.8])
    expect(trail[5]).toEqual(track.position)
    // A tighter window keeps only the samples it reaches: 60 and 45, then now.
    expect(trailAt(index, plan, track, 67, { coastS: 90, tickMs: 1000, trailS: 25 })).toHaveLength(
      3,
    )
  })

  it('samples an inject at the frame-grid instants inside the window, then now', () => {
    const t = 67
    const inject = injectTracksAt(plan, t)[0]
    const trail = trailAt(index, plan, inject, t)
    expect(trail).toHaveLength(6)
    expect(trail[0]).toEqual(injectTracksAt(plan, 0)[0].position)
    expect(trail[4]).toEqual(injectTracksAt(plan, 60)[0].position)
    expect(trail[5]).toEqual(inject.position)
    // Seek-honest: the same instant asked twice is the same trail.
    expect(trailAt(index, plan, inject, t)).toEqual(trail)
  })

  it('reaches back exactly the window and no further', () => {
    const [track] = pictureAt(index, 105)
    // 105 − 120 < 0: all eight samples before 105 are in, then now.
    expect(trailAt(index, plan, track, 105)).toHaveLength(8)
    // At 135 the sample at 0 falls out of a 120 s window; the one at 15 leads.
    const later = pictureAt(index, 135)[0]
    expect(trailAt(index, plan, later, 135)[0]).toEqual([-75.19, 39.8])
  })
})

describe('trailAt — a held track (#75 review)', () => {
  const plan = planScenario(gridTimeline(80, 15000))
  const index = indexCapture(
    capture(
      [...Array(8)].map((_, i) => ({
        tMs: i * 15000,
        records: [{ ...A0, position: [-75.2 + i * 0.01, 39.8] as [number, number] }],
      })),
    ),
  )

  it('counts the sample a held track sits on once, not as a sample and a position', () => {
    // The recording ends at 105 s; at 120 s the track is held on that sample, inside the coast.
    const [held] = pictureAt(index, 120)
    expect(held.lastSeenSec).toBe(15)
    const trail = trailAt(index, plan, held, 120)
    expect(trail).toHaveLength(8)
    expect(trail[trail.length - 1]).toEqual(held.position)
  })
})

describe('historyAt and historiesAt (05a)', () => {
  const plan = planScenario(gridTimeline(80, 15000))
  const index = indexCapture(
    capture(
      [...Array(8)].map((_, i) => ({
        tMs: i * 15000,
        records: [{ ...A0, position: [-75.2 + i * 0.01, 39.8] as [number, number] }],
      })),
    ),
  )

  it('carries the instant with each position, and the trail is its positions', () => {
    const [track] = pictureAt(index, 67)
    const history = historyAt(index, plan, track, 67, 120)
    expect(history.map((sample) => sample.tSec)).toEqual([0, 15, 30, 45, 60, 67])
    expect(history.map((sample) => sample.position)).toEqual(trailAt(index, plan, track, 67))
    const inject = injectTracksAt(plan, 67)[0]
    expect(historyAt(index, plan, inject, 67, 120).map((s) => s.tSec)).toEqual([
      0, 15, 30, 45, 60, 67,
    ])
  })

  it('keys every track in the picture, each ending on where it is now, over the window asked', () => {
    // 150 s: the recording ended at 105 s and the aircraft is held on that sample, inside the
    // coast; the window reaches back past the start.
    const t = 150
    const tracks = [...pictureAt(index, t), ...injectTracksAt(plan, t)]
    expect(tracks[0].source).toBe('adsb')
    const histories = historiesAt(index, plan, tracks, t, 420)
    expect(Object.keys(histories).sort()).toEqual(tracks.map((track) => track.id).sort())
    for (const track of tracks) {
      const history = histories[track.id]
      expect(history[history.length - 1].position).toEqual(track.position)
      expect(history[0].tSec).toBeGreaterThanOrEqual(t - 420)
    }
    // The held aircraft: its eight samples, the last of which is where it sits — counted once.
    expect(histories[tracks[0].id]).toHaveLength(8)
    // An inject's: the ten grid instants before 150, then now, which is on the grid itself.
    expect(histories['inject-01'].map((sample) => sample.tSec)).toEqual([
      0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150,
    ])
    // Pure in t: asked again, the same.
    expect(historiesAt(index, plan, tracks, t, 420)).toEqual(histories)
  })
})

describe('historyAt across a hole in the recording (#80 review)', () => {
  const plan = planScenario(gridTimeline(80, 15000))
  // Three samples, six minutes of nothing, then two more: the aggregator would have dropped
  // the track through that hole, and so does pictureAt.
  const index = indexCapture(
    capture(
      [0, 15, 30, 400, 415].map((s) => ({
        tMs: s * 1000,
        records: [{ ...A0, position: [-75.2 + s * 0.0001, 39.8] as [number, number] }],
      })),
    ),
  )

  it('starts the history over on the far side of a hole wider than the coast', () => {
    const [track] = pictureAt(index, 415)
    const history = historyAt(index, plan, track, 415, 420)
    expect(history.map((sample) => sample.tSec)).toEqual([400, 415])
    // Inside the coast the track is held on its last sample, and the history is the run so far.
    const [earlier] = pictureAt(index, 90)
    expect(historyAt(index, plan, earlier, 90, 420).map((s) => s.tSec)).toEqual([0, 15, 30])
  })

  it('computes the same history for every track whether asked one at a time or all at once', () => {
    const t = 450
    const tracks = injectTracksAt(plan, t)
    const all = historiesAt(index, plan, tracks, t, 420)
    for (const track of tracks) expect(all[track.id]).toEqual(historyAt(index, plan, track, t, 420))
  })
})

describe('lastHeardBefore (#71, #36 [11])', () => {
  const index = indexCapture(
    capture([
      { tMs: 0, records: [A0] },
      { tMs: 15000, records: [{ ...A1, lastSeenSec: 2 }] },
      { tMs: 300000, records: [A0] },
    ]),
  )

  it('is the last message at or before the clock — the sample less the age it carried — and null without one', () => {
    expect(lastHeardBefore(index, 'adsb-a00001', 10)).toBe(0)
    expect(lastHeardBefore(index, 'adsb-a00001', 15)).toBe(13)
    // A seek across a hole reads the sample before the clock, not the picture as last drawn.
    expect(lastHeardBefore(index, 'adsb-a00001', 200)).toBe(13)
    expect(lastHeardBefore(index, 'adsb-a00001', 300)).toBe(300)
    expect(lastHeardBefore(index, 'adsb-a00001', -1)).toBeNull()
    expect(lastHeardBefore(index, 'inject-05', 10)).toBeNull()
  })
})

describe('originsOf (08b, ruled on #86)', () => {
  it("reads an aircraft's first sample and an inject's first frame off the data, never the session", () => {
    const real = JSON.parse(captureRaw) as AdsbCapture
    const index = indexCapture(real)
    const plan = planScenario(gridTimeline(real.frames.length, real.intervalMs))
    const origins = originsOf(index, plan)
    for (const [id, samples] of index.samples)
      expect(origins[id]).toEqual(samples[0].track.position)
    // An inject's origin is where the picture first showed it — the first frame's instant.
    for (const inject of injectTracksAt(plan, index.startS)) {
      expect(origins[inject.id]).toEqual(inject.position)
    }
    expect(Object.keys(origins)).toHaveLength(index.samples.size + plan.specs.length)
    // Pure in the data: the same map however the session was played or seeked.
    expect(originsOf(index, plan)).toEqual(origins)
    expect(origins['adsb-nope']).toBeUndefined()
    // No plan: aircraft only.
    expect(Object.keys(originsOf(index, null)).every((id) => id.startsWith('adsb-'))).toBe(true)
  })

  it("takes the recording's first frame, not frame 0, for an inject (A2 on #86)", () => {
    // A recording whose first frame is at 15 s: the injects are first in the picture then.
    const index = indexCapture(
      capture([
        { tMs: 15000, records: [A0] },
        { tMs: 30000, records: [A0] },
      ]),
    )
    expect(index.startS).toBe(15)
    const plan = planScenario(gridTimeline(3, 15000))
    const origins = originsOf(index, plan)
    const [first] = injectTracksAt(plan, 15)
    expect(origins[first.id]).toEqual(first.position)
    expect(origins[first.id]).not.toEqual(injectTracksAt(plan, 0)[0].position)
  })
})
