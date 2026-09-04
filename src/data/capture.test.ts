import { describe, expect, it, vi } from 'vitest'
import { assertCaptureMatchesAo, captureUrl, frameTracks, loadCapture } from './capture'
import type { AdsbCapture } from '../lib/adsb'
import { PHL } from '../config/ao'
import { DEFAULT_RECORDING, recordingNamed } from '../config/recordings'

const CAPTURE: AdsbCapture = {
  ao: 'phl',
  source: 'adsb.lol v2',
  capturedAt: '2026-08-29T23:09:25.373Z',
  intervalMs: 15000,
  bbox: PHL.bbox,
  frames: [
    {
      tMs: 0,
      records: [
        {
          hex: 'a06461',
          callsign: 'AAL423',
          position: [-75.12915, 39.69481],
          altitudeFt: 5175,
          groundSpeedKt: 275.8,
          headingDeg: 45.9,
        },
        // No altitude broadcast, and no ident — both must survive the trip as nulls.
        { hex: '501267', position: [-75.92156, 39.77119], groundSpeedKt: 60.5 },
      ],
    },
  ],
}

const respondWith = (body: unknown, ok = true, status = 200) =>
  vi.fn(async () => ({ ok, status, json: async () => body }) as unknown as Response)

describe('captureUrl', () => {
  it('serves each registry entry’s file from the app’s base (#84)', () => {
    expect(captureUrl(DEFAULT_RECORDING)).toBe('/adsb-phl.json')
    expect(captureUrl(recordingNamed('vigil-phl-002'))).toBe('/adsb-phl-002.json')
  })
})

describe('assertCaptureMatchesAo', () => {
  it('accepts a recording made over this AO', () => {
    expect(() => assertCaptureMatchesAo(CAPTURE, PHL)).not.toThrow()
  })

  // Relocating the AO is one config edit away (§5), and replaying PHL traffic against a different
  // centre would silently make every proximity score meaningless.
  it('rejects a recording made over a different AO', () => {
    expect(() => assertCaptureMatchesAo({ ...CAPTURE, ao: 'elsewhere' }, PHL)).toThrow(
      /elsewhere.*phl/,
    )
  })

  it('rejects a recording with no frames', () => {
    expect(() => assertCaptureMatchesAo({ ...CAPTURE, frames: [] }, PHL)).toThrow(/no frames/)
  })
})

describe('loadCapture', () => {
  it('fetches, validates, and returns the recording', async () => {
    const fetcher = respondWith(CAPTURE)
    await expect(loadCapture('/adsb-phl.json', fetcher, PHL)).resolves.toEqual(CAPTURE)
    expect(fetcher).toHaveBeenCalledWith('/adsb-phl.json')
  })

  it('reports an HTTP failure rather than parsing the body', async () => {
    const fetcher = respondWith(null, false, 404)
    await expect(loadCapture('/missing.json', fetcher, PHL)).rejects.toThrow(/HTTP 404/)
  })

  it('refuses a recording from the wrong AO even when the fetch succeeds', async () => {
    const fetcher = respondWith({ ...CAPTURE, ao: 'elsewhere' })
    await expect(loadCapture('/adsb-phl.json', fetcher, PHL)).rejects.toThrow(/elsewhere/)
  })
})

describe('frameTracks', () => {
  it('stamps every track cooperative, which the file has no field for', () => {
    const tracks = frameTracks(CAPTURE.frames[0])
    expect(tracks).toHaveLength(2)
    expect(tracks.every((t) => t.identity === 'cooperative')).toBe(true)
    expect(tracks.every((t) => t.source === 'adsb')).toBe(true)
  })

  it('carries an unbroadcast altitude through as null, not as ground level', () => {
    const [, noAltitude] = frameTracks(CAPTURE.frames[0])
    expect(noAltitude.altitudeFt).toBeNull()
    expect(noAltitude.onGround).toBe(false)
    expect(noAltitude.callsign).toBeNull()
  })
})
