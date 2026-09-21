import { describe, expect, it } from 'vitest'
import { DEFAULT_RECORDING, DEMO_RECORDING, RECORDINGS, recordingNamed } from './recordings'

describe('recordings registry (#84)', () => {
  it('keeps 001 as the golden’s and §13’s recording, with its configured small-hours clock', () => {
    expect(DEFAULT_RECORDING.id).toBe('vigil-phl-001')
    expect(DEFAULT_RECORDING.file).toBe('adsb-phl.json')
    expect(DEFAULT_RECORDING.clock).toEqual({ startLocal: '02:30' })
  })

  it('opens on 002 without a query parameter — the demo’s recording, the 03 family’s (S11, #213)', () => {
    expect(DEMO_RECORDING).toBe(recordingNamed('vigil-phl-002'))
  })

  it('names 002 as an evening bank that takes its clock from its capture', () => {
    expect(recordingNamed('vigil-phl-002')).toEqual({
      id: 'vigil-phl-002',
      file: 'adsb-phl-002.json',
      clock: 'captured',
    })
  })

  it('gives every recording a distinct id and a distinct file', () => {
    expect(new Set(RECORDINGS.map((r) => r.id)).size).toBe(RECORDINGS.length)
    expect(new Set(RECORDINGS.map((r) => r.file)).size).toBe(RECORDINGS.length)
  })

  // Selection by the query string is the session resolver's (#115, session.test.ts).
  it('refuses an unknown name in so many words rather than falling back to 001', () => {
    expect(() => recordingNamed('vigil-phl-003')).toThrow('No recording named "vigil-phl-003"')
    expect(() => recordingNamed('')).toThrow('No recording named ""')
  })
})
