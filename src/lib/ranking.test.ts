import { describe, expect, it } from 'vitest'
import { rankTracks } from './ranking'
import { AO } from '../config/ao'
import type { ProtectedSite } from '../config/ao'
import { frameTracks } from '../data/capture'
import type { AdsbCapture } from './adsb'
import { destinationPoint, distanceMeters } from './geo'
import type { InjectScenario } from './injects'
import type { AdsbTrack, Identity, InjectTrack, Track } from './tracks'
import captureRaw from '../../public/adsb-phl.json?raw'
import goldenRaw from './__fixtures__/injects-vigil-phl-001.json?raw'

const capture = JSON.parse(captureRaw) as AdsbCapture
const golden = JSON.parse(goldenRaw) as InjectScenario

const SITE = AO.protectedSites[0]
const SITES = AO.protectedSites

/** A point `rangeM` from the protected site, due north unless told otherwise. */
const at = (rangeM: number, bearingDeg = 0) => destinationPoint(SITE.center, bearingDeg, rangeM)

function adsb(hex: string, rangeM: number, extra: Partial<AdsbTrack> = {}): AdsbTrack {
  return {
    id: `adsb-${hex}`,
    source: 'adsb',
    icaoHex: hex,
    identity: 'cooperative',
    callsign: null,
    position: at(rangeM),
    altitudeFt: 3000,
    onGround: false,
    groundSpeedKt: 200,
    headingDeg: 90,
    verticalRateFpm: 0,
    lastSeenSec: 0,
    category: null,
    registry: null,
    ...extra,
  }
}

function inject(n: number, identity: Identity, rangeM: number): InjectTrack {
  return {
    id: `inject-${String(n).padStart(2, '0')}`,
    source: 'inject',
    behavior: 'transit',
    remoteId: identity === 'non-cooperative' ? 'silent' : 'intermittent',
    identity,
    callsign: identity === 'cooperative' ? `UAS-${n}` : null,
    position: at(rangeM),
    altitudeFt: 200,
    onGround: false,
    groundSpeedKt: 20,
    headingDeg: 180,
    verticalRateFpm: 0,
    lastSeenSec: 0,
  }
}

const order = (tracks: Track[], sites: ProtectedSite[] = SITES) =>
  rankTracks(tracks, sites).map((entry) => entry.track.id)

describe('rankTracks', () => {
  it('orders by identity first: non-cooperative, unknown, cooperative', () => {
    // The nearest track is the cooperative one; identity still wins (§2: silence carries the burden).
    const tracks = [
      inject(1, 'cooperative', 500),
      inject(2, 'unknown', 5000),
      inject(3, 'non-cooperative', 9000),
    ]
    expect(order(tracks)).toEqual(['inject-03', 'inject-02', 'inject-01'])
  })

  it('never ranks an ADS-B track above any non-cooperative or unknown inject, whatever the ranges', () => {
    // The §2 guardrail as a test rather than a convention: ADS-B is cooperative by construction,
    // and identity is the first key, so a real aircraft parked on the site still sits below a
    // silent drone thirty kilometres out.
    const tracks = [
      adsb('a00001', 0),
      adsb('a00002', 100),
      inject(1, 'non-cooperative', 30_000),
      inject(2, 'unknown', 30_000),
    ]
    const ranked = rankTracks(tracks, SITES)
    const injects = ranked.filter((r) => r.track.source === 'inject').map((r) => r.rank)
    const adsbRanks = ranked.filter((r) => r.track.source === 'adsb').map((r) => r.rank)
    expect(Math.min(...adsbRanks)).toBeGreaterThan(Math.max(...injects))
  })

  it('lets a broadcasting inject compete with ADS-B on range', () => {
    // §5.2 working as written: a drone identifying itself is cooperative, and nothing more.
    const tracks = [inject(1, 'cooperative', 4000), adsb('a00001', 2000), adsb('a00002', 6000)]
    expect(order(tracks)).toEqual(['adsb-a00001', 'inject-01', 'adsb-a00002'])
  })

  it('puts airborne traffic ahead of ground traffic within the cooperative block', () => {
    // A parked aircraft inside the ring reads as near-zero range; the Queue orders it beneath
    // airborne traffic rather than hiding it. Whether scoring filters it out is for PR 04 (#4).
    const tracks = [adsb('a00001', 100, { onGround: true, altitudeFt: 0 }), adsb('a00002', 20_000)]
    expect(order(tracks)).toEqual(['adsb-a00002', 'adsb-a00001'])
  })

  it('orders by range to the protected site within a block, ascending', () => {
    const tracks = [adsb('a00001', 9000), adsb('a00002', 1000), adsb('a00003', 5000)]
    expect(order(tracks)).toEqual(['adsb-a00002', 'adsb-a00003', 'adsb-a00001'])
  })

  it('breaks an exact tie by track id, so a recapture reorders only by data', () => {
    const tracks = [adsb('b', 3000), adsb('a', 3000), adsb('c', 3000)]
    expect(order(tracks)).toEqual(['adsb-a', 'adsb-b', 'adsb-c'])
  })

  it('reports range to the site center in meters, and which site it measured', () => {
    const [entry] = rankTracks([adsb('a00001', 2500)], SITES)
    expect(entry.rangeM).toBeCloseTo(distanceMeters(SITE.center, entry.track.position), 6)
    expect(entry.rangeM).toBeCloseTo(2500, -1)
    expect(entry.siteId).toBe(SITE.id)
  })

  it('measures to the nearest protected site when there is more than one', () => {
    // The constraint parked on #4: with one site, "nearest" and "[0]" coincide. Here they do not.
    const other: ProtectedSite = {
      id: 'other',
      name: 'Other',
      center: at(20_000, 90),
      radiusM: 1000,
    }
    const nearOther = adsb('a00001', 0, { position: at(19_000, 90) })
    const [entry] = rankTracks([nearOther], [SITE, other])
    expect(entry.siteId).toBe('other')
    expect(entry.rangeM).toBeCloseTo(1000, -1)
  })

  it('numbers ranks from one, in order', () => {
    const ranked = rankTracks([adsb('a', 1), adsb('b', 2), adsb('c', 3)], SITES)
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3])
  })

  it('refuses to rank without a protected site to measure against', () => {
    expect(() => rankTracks([adsb('a', 1)], [])).toThrow(/protected site/)
  })

  it('does not mutate its input', () => {
    const tracks = [adsb('b', 2), adsb('a', 1)]
    const before = tracks.map((t) => t.id)
    rankTracks(tracks, SITES)
    expect(tracks.map((t) => t.id)).toEqual(before)
  })
})

describe('determinism', () => {
  // The Queue is a pure function of the track list: the golden's frame 0 plus the recording's
  // frame 0 is the picture the app opens on, and this is the order it opens in.
  const frame0: Track[] = [...frameTracks(capture.frames[0]), ...golden.frames[0].tracks]

  it('ranks the default picture identically every time, and pins its top rows', () => {
    const ids = order(frame0)
    expect(ids).toEqual(order(frame0))
    expect(ids).toHaveLength(capture.frames[0].records.length + golden.frames[0].tracks.length)
    // The three silent injects first, by range; then the cooperative block, which reads ADS-B and
    // broadcasting injects interleaved by range — on this frame the injects sit 6.5–10 km out.
    expect(ids.slice(0, 7)).toEqual([
      'inject-05',
      'inject-03',
      'inject-06',
      'adsb-c00b80',
      'inject-01',
      'inject-04',
      'adsb-a28904',
    ])
  })

  it('ends the default picture with its parked aircraft, dimmed rather than dropped', () => {
    const ranked = rankTracks(frame0, SITES)
    const tail = ranked.slice(-3)
    expect(tail.every((r) => r.track.onGround)).toBe(true)
    expect(tail.map((r) => r.track.id)).toEqual(['adsb-a8f5ba', 'adsb-abf0ca', 'adsb-a1bc1f'])
    expect(ranked.slice(0, -3).some((r) => r.track.onGround)).toBe(false)
  })
})

describe('arrival order', () => {
  // Synthetic on purpose: the capture is data, not a test oracle, so a recapture re-pins the
  // frame-0 tests above and nothing else.
  it('produces the same order whatever order the tracks arrive in', () => {
    const tracks: Track[] = [
      adsb('a00003', 9000),
      inject(2, 'cooperative', 4000),
      adsb('a00001', 100, { onGround: true, altitudeFt: 0 }),
      inject(1, 'non-cooperative', 30_000),
      adsb('a00002', 2000),
      inject(3, 'unknown', 12_000),
    ]
    const expected = order(tracks)
    expect(expected).toEqual([
      'inject-01',
      'inject-03',
      'adsb-a00002',
      'inject-02',
      'adsb-a00003',
      'adsb-a00001',
    ])
    expect(order([...tracks].reverse())).toEqual(expected)
    expect(order([tracks[3], tracks[0], tracks[5], tracks[1], tracks[4], tracks[2]])).toEqual(
      expected,
    )
  })
})
