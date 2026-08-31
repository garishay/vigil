import { describe, expect, it } from 'vitest'
import type { AdsbTrack, Identity, InjectTrack, RemoteIdStatus, Track } from './tracks'

const BASE = {
  callsign: 'LET5686',
  position: [-75.9, 39.5] as [number, number],
  altitudeFt: 19850,
  onGround: false,
  groundSpeedKt: 395,
  headingDeg: 39.5,
  verticalRateFpm: -2048,
  lastSeenSec: 0,
}

/**
 * §2 — real aircraft are never the threat — is a type-level guarantee, not a convention, so the
 * proof belongs at compile time. `AdsbTrack.identity` is the literal `'cooperative'` rather than
 * the `Identity` union: the assignment below does not compile.
 *
 * If someone widens that field to `Identity`, the error disappears, `@ts-expect-error` becomes an
 * unused directive, and `npm run typecheck` fails. The guardrail cannot be relaxed quietly.
 */
describe('the ADS-B cooperativity guardrail', () => {
  it('will not compile a non-cooperative real aircraft', () => {
    const threatening: AdsbTrack = {
      ...BASE,
      id: 'adsb-0d0afe',
      source: 'adsb',
      icaoHex: '0d0afe',
      category: null,
      registry: null,
      // @ts-expect-error §2: an ADS-B-sourced track cannot be anything but cooperative.
      identity: 'non-cooperative',
    }
    expect(threatening.identity).not.toBe('cooperative')
  })

  it('accepts the cooperative literal', () => {
    const track: AdsbTrack = {
      ...BASE,
      id: 'adsb-0d0afe',
      source: 'adsb',
      icaoHex: '0d0afe',
      identity: 'cooperative',
      category: null,
      registry: null,
    }
    expect(track.identity).toBe('cooperative')
  })
})

describe('the shared track model', () => {
  it('discriminates the two layers on source alone', () => {
    const tracks: Track[] = [
      {
        ...BASE,
        id: 'adsb-0d0afe',
        source: 'adsb',
        icaoHex: '0d0afe',
        identity: 'cooperative',
        category: null,
        registry: null,
      },
      {
        ...BASE,
        id: 'inject-01',
        source: 'inject',
        behavior: 'orbit',
        remoteId: 'silent',
        identity: 'non-cooperative',
      },
    ]
    const hexes = tracks.map((track) => (track.source === 'adsb' ? track.icaoHex : track.behavior))
    expect(hexes).toEqual(['0d0afe', 'orbit'])
  })

  it('lets injects hold any identity, which is what makes them the only possible threat', () => {
    const identities: Identity[] = ['cooperative', 'unknown', 'non-cooperative']
    const statuses: RemoteIdStatus[] = ['broadcasting', 'intermittent', 'silent']
    const injects: InjectTrack[] = statuses.map((remoteId, i) => ({
      ...BASE,
      id: `inject-0${i}`,
      source: 'inject',
      behavior: 'transit',
      remoteId,
      identity: identities[i],
    }))
    expect(injects.map((inject) => inject.identity)).toEqual(identities)
  })
})
