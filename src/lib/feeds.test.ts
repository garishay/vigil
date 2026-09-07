import { describe, expect, it } from 'vitest'
import {
  CLOCK_OF_KIND,
  FEED_KINDS,
  NAMESPACES,
  feedRefText,
  mergePicture,
  recordingFeed,
  scenarioFeed,
} from './feeds'
import type { Feed } from './feeds'
import { AO } from '../config/ao'
import { DEFAULT_RECORDING } from '../config/recordings'
import { REPLAY } from '../config/replay'
import type { AdsbCapture } from './adsb'
import { injectTracksAt, planScenario, timelineOf } from './injects'
import { indexCapture, pictureAt } from './replay'
import type { AdsbTrack, Track } from './tracks'

/** Two frames, fifteen seconds apart, one aircraft in each: the smallest recording that coasts. */
const CAPTURE: AdsbCapture = {
  ao: 'phl',
  source: 'adsb.lol v2',
  capturedAt: '2026-08-29T06:30:00.000Z',
  intervalMs: 15000,
  bbox: AO.bbox,
  frames: [
    {
      tMs: 0,
      records: [
        { hex: 'a06461', callsign: 'AAL423', position: [-75.1, 39.7], groundSpeedKt: 275 },
        { hex: '501267', position: [-75.9, 39.8], groundSpeedKt: 60 },
      ],
    },
    {
      tMs: 15000,
      records: [{ hex: 'a06461', callsign: 'AAL423', position: [-75.2, 39.7], groundSpeedKt: 275 }],
    },
  ],
}

const fake = (id: string, tracks: readonly Track[]): Feed => ({
  ref: { kind: 'recording', id },
  clock: 'recording',
  coastS: 0,
  pictureAt: () => tracks,
  healthAt: () => ({ ageS: 0, reason: null }),
})

const aircraft = (id: string, callsign: string | null = null): AdsbTrack => ({
  id,
  source: 'adsb',
  icaoHex: id.slice('adsb-'.length),
  identity: 'cooperative',
  callsign,
  position: [-75, 39.9],
  altitudeFt: 3000,
  onGround: false,
  groundSpeedKt: 120,
  headingDeg: 90,
  verticalRateFpm: 0,
  lastSeenSec: 0,
  category: null,
  registry: null,
})

describe('the vocabulary (#115)', () => {
  it('names the three feed kinds, the two clocks, and the four namespaces in one place', () => {
    expect(FEED_KINDS).toEqual(['recording', 'adsb', 'cot'])
    expect(CLOCK_OF_KIND).toEqual({ recording: 'recording', adsb: 'wall', cot: 'wall' })
    // The spellings the tree already uses, by identity kind: a CoT-forwarded aircraft is `adsb-`.
    expect(NAMESPACES).toEqual({
      adsb: 'adsb-<hex>',
      rid: 'rid-<serial>',
      cot: 'cot-<uid>',
      inject: 'inject-<nn>',
    })
    expect(feedRefText({ kind: 'recording', id: 'vigil-phl-001' })).toBe('recording:vigil-phl-001')
    expect(feedRefText({ kind: 'adsb', id: '' })).toBe('adsb')
  })
})

describe('the recording feed', () => {
  const feed = recordingFeed(DEFAULT_RECORDING, CAPTURE)

  it('is the replay, tick for tick: interpolated, held, then dropped, on the config coast', () => {
    const index = indexCapture(CAPTURE)
    for (const tSec of [0, 7, 15, 30, 15 + REPLAY.coastS, 16 + REPLAY.coastS]) {
      expect(feed.pictureAt(tSec)).toEqual(pictureAt(index, tSec))
    }
    expect(feed.pictureAt(0).map((track) => track.id)).toEqual(['adsb-501267', 'adsb-a06461'])
    expect(feed.pictureAt(16 + REPLAY.coastS)).toEqual([])
    expect(feed.coastS).toBe(REPLAY.coastS)
  })

  it('names itself, its clock, and carries the recording for the history functions', () => {
    expect(feed.ref).toEqual({ kind: 'recording', id: 'vigil-phl-001' })
    expect(feed.clock).toBe('recording')
    expect(feed.entry).toBe(DEFAULT_RECORDING)
    expect(feed.capture).toBe(CAPTURE)
    expect(feed.index.durationS).toBe(15)
    expect(feed.timeline).toEqual(timelineOf(CAPTURE))
  })

  it('reads its health as the age of the last frame at or before the clock', () => {
    expect(feed.healthAt(0)).toEqual({ ageS: 0, reason: null })
    expect(feed.healthAt(7)).toEqual({ ageS: 7, reason: null })
    expect(feed.healthAt(15)).toEqual({ ageS: 0, reason: null })
    expect(feed.healthAt(100)).toEqual({ ageS: 85, reason: null })
    expect(feed.healthAt(-1)).toEqual({ ageS: null, reason: 'before the first frame' })
  })
})

describe('the recording feed on frames out of order (#125 round 1)', () => {
  it('reads its health off the same order its picture reads — sorted by time, not trusted to be', () => {
    const shuffled: AdsbCapture = {
      ...CAPTURE,
      frames: [CAPTURE.frames[0], { tMs: 30000, records: [] }, CAPTURE.frames[1]],
    }
    const feed = recordingFeed(DEFAULT_RECORDING, shuffled)
    // At 20 s the last frame at or before the clock is the one at 15 s, wherever it sits in the file.
    expect(feed.healthAt(20)).toEqual({ ageS: 5, reason: null })
    expect(feed.healthAt(31)).toEqual({ ageS: 1, reason: null })
    expect(feed.pictureAt(20)).toEqual(pictureAt(indexCapture(shuffled), 20))
  })
})

describe('the scenario as a feed', () => {
  const timeline = timelineOf(CAPTURE)
  const scenario = scenarioFeed(timeline)

  it('samples the plan drawn on the recording’s own frame times, the seed the config’s', () => {
    const plan = planScenario(timeline)
    expect(scenario.plan).toEqual(plan)
    expect(scenario.seed).toBe(plan.seed)
    for (const tSec of [0, 1, 7.5, 15]) {
      expect(scenario.pictureAt(tSec)).toEqual(injectTracksAt(plan, tSec))
    }
  })

  it('emits observed tracks only — no behavior, no Remote ID status — on every tick', () => {
    for (const tSec of [0, 1, 300, 1185]) {
      for (const track of scenario.pictureAt(tSec)) {
        expect(track).not.toHaveProperty('behavior')
        expect(track).not.toHaveProperty('remoteId')
        expect(track.source).toBe('inject')
      }
    }
  })

  it('is always in the picture: no coast, no age, on the recording clock', () => {
    expect(scenario.clock).toBe('recording')
    expect(scenario.coastS).toBe(0)
    expect(scenario.healthAt(500)).toEqual({ ageS: 0, reason: null })
  })
})

describe('the merge', () => {
  it('is the recording then the scenario, each in its own order — the list the app built by hand', () => {
    const feed = recordingFeed(DEFAULT_RECORDING, CAPTURE)
    const scenario = scenarioFeed(feed.timeline)
    for (const tSec of [0, 7, 15]) {
      expect(mergePicture([feed], scenario, tSec)).toEqual([
        ...feed.pictureAt(tSec),
        ...scenario.pictureAt(tSec),
      ])
    }
    expect(mergePicture([feed], null, 0)).toEqual(feed.pictureAt(0))
  })

  it('keeps the feeds in session order and the first feed’s track for an id seen twice', () => {
    const first = fake('one', [aircraft('adsb-aaaaaa', 'FIRST'), aircraft('adsb-bbbbbb')])
    const second = fake('two', [aircraft('adsb-aaaaaa', 'SECOND'), aircraft('adsb-cccccc')])
    const merged = mergePicture([first, second], null, 0)
    expect(merged.map((track) => track.id)).toEqual(['adsb-aaaaaa', 'adsb-bbbbbb', 'adsb-cccccc'])
    expect(merged[0].callsign).toBe('FIRST')
    expect(mergePicture([second, first], null, 0)[0].callsign).toBe('SECOND')
  })

  it('is empty with no feed and no scenario', () => {
    expect(mergePicture([], null, 0)).toEqual([])
  })
})
