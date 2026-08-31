import { describe, expect, it } from 'vitest'
import {
  CAPTURE_ETIQUETTE,
  captureRadiusNm,
  decideAfterFailure,
  isWithinBbox,
  normalizeAircraft,
  normalizeResponse,
  retryAfterSeconds,
  toTrack,
} from './adsb'
import type { AdsbLolAircraft, CaptureFailure } from './adsb'
import { PHL } from '../config/ao'

/** Shapes recorded from adsb.lol v2 over the AO, trimmed to the fields the normalizer reads. */
const AIRBORNE: AdsbLolAircraft = {
  hex: '0d0afe',
  flight: 'LET5686 ',
  lat: 39.5116,
  lon: -75.90078,
  alt_baro: 19850,
  gs: 395,
  track: 39.51,
  baro_rate: -2048,
  seen: 0,
}

const PARKED: AdsbLolAircraft = {
  hex: 'a6039a',
  flight: 'N487LF  ',
  lat: 39.8735,
  lon: -75.2445,
  alt_baro: 'ground',
  gs: 0,
  seen: 1.6,
}

describe('normalizeAircraft', () => {
  it('maps the broadcast fields onto the stored record', () => {
    expect(normalizeAircraft(AIRBORNE)).toEqual({
      hex: '0d0afe',
      callsign: 'LET5686',
      position: [-75.90078, 39.5116],
      altitudeFt: 19850,
      groundSpeedKt: 395,
      headingDeg: 39.5,
      verticalRateFpm: -2048,
    })
  })

  // Display enrichment (§5.1): the broadcast category and the registry lookups are kept apart,
  // so a display can label the lookup as one and the scoring path has nothing to read by accident.
  it('keeps the enrichment fields, split by provenance: broadcast category vs registry lookups', () => {
    const enriched = {
      ...AIRBORNE,
      category: 'A3',
      t: 'B738',
      desc: 'BOEING 737-800',
      r: 'XA-TEST',
      ownOp: 'Example Air',
    }
    expect(normalizeAircraft(enriched)).toMatchObject({
      category: 'A3',
      registry: {
        typeCode: 'B738',
        typeDesc: 'BOEING 737-800',
        registration: 'XA-TEST',
        operator: 'Example Air',
      },
    })
  })

  it('omits the enrichment entirely when the feed carried none, and blanks are none', () => {
    expect(normalizeAircraft(AIRBORNE)).not.toHaveProperty('category')
    expect(normalizeAircraft(AIRBORNE)).not.toHaveProperty('registry')
    const blank = normalizeAircraft({ ...AIRBORNE, category: ' ', t: '', r: '  ' })
    expect(blank).not.toHaveProperty('category')
    expect(blank).not.toHaveProperty('registry')
    // A partial lookup keeps only what it has, rather than padding the rest with empties.
    expect(normalizeAircraft({ ...AIRBORNE, t: 'C172' })).toMatchObject({
      registry: { typeCode: 'C172' },
    })
    expect(normalizeAircraft({ ...AIRBORNE, t: 'C172' })!.registry).not.toHaveProperty(
      'registration',
    )
  })

  it('flags a parked aircraft rather than storing "ground" as an altitude', () => {
    const record = normalizeAircraft(PARKED)
    expect(record).toMatchObject({ altitudeFt: 0, onGround: true, lastSeenSec: 1.6 })
  })

  // 1.6% of the recorded traffic broadcasts no altitude. Flattening that to zero would drag a
  // real aircraft toward the low-and-slow envelope the kinematic factor reads as small-UAS (§6).
  it('omits altitude entirely when the aircraft broadcast none', () => {
    const record = normalizeAircraft({ ...AIRBORNE, alt_baro: undefined })
    expect(record).not.toHaveProperty('altitudeFt')
    expect(record).not.toHaveProperty('onGround')
  })

  it('keeps a genuine zero apart from a missing one', () => {
    expect(normalizeAircraft(PARKED)).toMatchObject({ altitudeFt: 0, onGround: true })
    expect(normalizeAircraft({ ...AIRBORNE, alt_baro: 0 })).toMatchObject({ altitudeFt: 0 })
    expect(normalizeAircraft({ ...AIRBORNE, alt_baro: 0 })).not.toHaveProperty('onGround')
  })

  it('omits fields the aircraft did not broadcast instead of storing nulls', () => {
    const record = normalizeAircraft({ hex: 'abc123', flight: '        ', lat: 39.9, lon: -75.2 })
    expect(record).not.toHaveProperty('callsign')
    expect(record).not.toHaveProperty('headingDeg')
    expect(record).not.toHaveProperty('verticalRateFpm')
    expect(record).not.toHaveProperty('onGround')
    expect(record).not.toHaveProperty('lastSeenSec')
  })

  it('falls back to the geometric rate when the barometric rate is absent', () => {
    expect(normalizeAircraft({ ...AIRBORNE, baro_rate: undefined, geom_rate: -64 })).toMatchObject({
      verticalRateFpm: -64,
    })
    expect(normalizeAircraft({ ...AIRBORNE, baro_rate: 128, geom_rate: -64 })).toMatchObject({
      verticalRateFpm: 128,
    })
  })

  it('drops records with no usable position', () => {
    expect(normalizeAircraft({ ...AIRBORNE, lat: undefined })).toBeNull()
    expect(normalizeAircraft({ ...AIRBORNE, lon: undefined })).toBeNull()
    expect(normalizeAircraft({ ...AIRBORNE, hex: undefined })).toBeNull()
  })

  it('rounds position to about a metre so the fixture stores no float noise', () => {
    const record = normalizeAircraft({ ...AIRBORNE, lat: 39.87213456789, lon: -75.24119876543 })
    expect(record?.position).toEqual([-75.2412, 39.87213])
  })
})

describe('isWithinBbox', () => {
  it('accepts points inside and on the boundary, rejects points outside', () => {
    expect(isWithinBbox(PHL.bbox, PHL.center)).toBe(true)
    expect(isWithinBbox(PHL.bbox, [PHL.bbox[0], PHL.bbox[1]])).toBe(true)
    expect(isWithinBbox(PHL.bbox, [-76.5, 39.9])).toBe(false)
    expect(isWithinBbox(PHL.bbox, [-75.2, 41.2])).toBe(false)
  })
})

describe('captureRadiusNm', () => {
  it('reaches every corner of the AO bbox', () => {
    const radiusM = captureRadiusNm(PHL) * 1852
    const [west, south, east, north] = PHL.bbox
    const corners: [number, number][] = [
      [west, south],
      [west, north],
      [east, south],
      [east, north],
    ]
    for (const corner of corners) {
      expect(isWithinBbox(PHL.bbox, corner)).toBe(true)
      expect(radiusM).toBeGreaterThanOrEqual(
        Math.hypot((corner[0] - PHL.center[0]) * 85400, (corner[1] - PHL.center[1]) * 111320),
      )
    }
  })

  it('stays small enough to be a courteous request of a free service', () => {
    expect(captureRadiusNm(PHL)).toBeLessThanOrEqual(250)
  })
})

describe('normalizeResponse', () => {
  const outside: AdsbLolAircraft = { ...AIRBORNE, hex: 'ffffff', lat: 41.5, lon: -75.2 }

  it('keeps only aircraft inside the bbox', () => {
    const records = normalizeResponse({ ac: [AIRBORNE, outside, PARKED] }, PHL.bbox)
    expect(records.map((r) => r.hex)).toEqual(['0d0afe', 'a6039a'])
  })

  it('orders by ICAO hex so a recapture diffs as data, not as reordering', () => {
    const forward = normalizeResponse({ ac: [AIRBORNE, PARKED] }, PHL.bbox)
    const reversed = normalizeResponse({ ac: [PARKED, AIRBORNE] }, PHL.bbox)
    expect(forward).toEqual(reversed)
  })

  it('orders by codepoint, so a ~-prefixed TIS-B address sorts the same on every machine', () => {
    // ICU collation puts `~` before the digits; codepoint order puts it after the letters. The
    // recording contains three such addresses, and their position must not depend on the locale
    // of whoever recaptures.
    const tisb = { ...AIRBORNE, hex: '~2ac753' }
    const hexes = normalizeResponse({ ac: [tisb, AIRBORNE, PARKED] }, PHL.bbox).map((r) => r.hex)
    expect(hexes.at(-1)).toBe('~2ac753')
    expect(hexes).toEqual([...hexes].sort())
  })

  it('survives an empty or absent aircraft list', () => {
    expect(normalizeResponse({ ac: [] }, PHL.bbox)).toEqual([])
    expect(normalizeResponse({}, PHL.bbox)).toEqual([])
  })
})

describe('toTrack', () => {
  it('restores the fields the fixture omits', () => {
    const record = normalizeAircraft({ hex: 'abc123', lat: 39.9, lon: -75.2, gs: 0 })!
    expect(toTrack(record)).toMatchObject({
      callsign: null,
      altitudeFt: null,
      headingDeg: null,
      verticalRateFpm: null,
      onGround: false,
      lastSeenSec: 0,
    })
  })

  it('carries the enrichment through as nullable display fields', () => {
    const bare = toTrack(normalizeAircraft(AIRBORNE)!)
    expect(bare.category).toBeNull()
    expect(bare.registry).toBeNull()
    const enriched = toTrack(normalizeAircraft({ ...AIRBORNE, category: 'A1', t: 'C172' })!)
    expect(enriched.category).toBe('A1')
    expect(enriched.registry).toEqual({ typeCode: 'C172' })
  })

  it('prefixes the id by source so a real hex can never collide with an inject', () => {
    expect(toTrack(normalizeAircraft(AIRBORNE)!).id).toBe('adsb-0d0afe')
  })

  // §2: real aircraft are never the threat. The fixture has no identity field to tamper with,
  // and this is the only place an AdsbTrack is built.
  it('stamps every ADS-B track cooperative, whatever the fixture says', () => {
    const tampered = { ...normalizeAircraft(AIRBORNE)!, identity: 'non-cooperative' }
    expect(toTrack(tampered).identity).toBe('cooperative')
    expect(toTrack(tampered).source).toBe('adsb')
  })
})

describe('retryAfterSeconds', () => {
  const NOW = Date.parse('2026-08-29T21:00:00Z')

  it('reads the delay-seconds form', () => {
    expect(retryAfterSeconds('120', NOW)).toBe(120)
    expect(retryAfterSeconds(' 45 ', NOW)).toBe(45)
  })

  it('reads the HTTP-date form as a delay from now', () => {
    expect(retryAfterSeconds('Sat, 29 Aug 2026 21:02:00 GMT', NOW)).toBe(120)
  })

  it('never returns a negative wait for a date already past', () => {
    expect(retryAfterSeconds('Sat, 29 Aug 2026 20:58:00 GMT', NOW)).toBe(0)
  })

  it('falls back rather than retrying hot when the header is absent, empty, or junk', () => {
    expect(retryAfterSeconds(null, NOW)).toBe(CAPTURE_ETIQUETTE.rateLimitBackoffS)
    expect(retryAfterSeconds('soon', NOW)).toBe(CAPTURE_ETIQUETTE.rateLimitBackoffS)
    // `Number('')` is 0, which would have been a zero-second backoff — a hot retry.
    expect(retryAfterSeconds('', NOW)).toBe(CAPTURE_ETIQUETTE.rateLimitBackoffS)
    expect(retryAfterSeconds('   ', NOW)).toBe(CAPTURE_ETIQUETTE.rateLimitBackoffS)
  })
})

describe('decideAfterFailure', () => {
  const NOW = Date.parse('2026-08-29T21:00:00Z')
  const dropped: CaptureFailure = { rateLimited: false, retryAfter: null, message: 'fetch failed' }
  const limited: CaptureFailure = { rateLimited: true, retryAfter: '30', message: 'HTTP 429' }

  it('rides out a single dropped connection without backing off', () => {
    expect(decideAfterFailure(dropped, { rateLimits: 0, consecutiveFailures: 1 }, NOW)).toEqual({
      action: 'continue',
      backOffS: 0,
    })
  })

  it('backs off for the interval the service asked for after a first 429', () => {
    expect(decideAfterFailure(limited, { rateLimits: 1, consecutiveFailures: 1 }, NOW)).toEqual({
      action: 'continue',
      backOffS: 30,
    })
  })

  // This is the behavior whose absence turned a rate limit into an IP block.
  it('aborts on the second 429 rather than pushing toward a ban', () => {
    const decision = decideAfterFailure(limited, { rateLimits: 2, consecutiveFailures: 1 }, NOW)
    expect(decision.action).toBe('abort')
    expect(decision).toMatchObject({ reason: expect.stringContaining('rate limited') })
  })

  it('aborts once the feed has gone away, whatever the cause', () => {
    const decision = decideAfterFailure(
      dropped,
      { rateLimits: 0, consecutiveFailures: CAPTURE_ETIQUETTE.maxConsecutiveFailures },
      NOW,
    )
    expect(decision.action).toBe('abort')
    expect(decision).toMatchObject({ reason: expect.stringContaining('consecutive failures') })
  })

  it('treats a rate limit as terminal even while consecutive failures look survivable', () => {
    expect(decideAfterFailure(limited, { rateLimits: 2, consecutiveFailures: 1 }, NOW).action).toBe(
      'abort',
    )
  })
})

describe('capture etiquette', () => {
  it('floors the polling interval well above what earned a block', () => {
    expect(CAPTURE_ETIQUETTE.minIntervalS).toBeGreaterThanOrEqual(10)
  })
})
