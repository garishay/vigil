import { describe, expect, it } from 'vitest'
import { DEFAULT_RECORDING, RECORDINGS, recordingNamed, selectedRecording } from './recordings'

describe('recordings registry (#84)', () => {
  it('opens on 001 with its configured small-hours clock, the golden’s and §13’s recording', () => {
    expect(DEFAULT_RECORDING.id).toBe('vigil-phl-001')
    expect(DEFAULT_RECORDING.file).toBe('adsb-phl.json')
    expect(DEFAULT_RECORDING.clock).toEqual({ startLocal: '02:30' })
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

  it('selects by the query parameter and defaults without one', () => {
    expect(selectedRecording('')).toBe(DEFAULT_RECORDING)
    expect(selectedRecording('?other=1')).toBe(DEFAULT_RECORDING)
    expect(selectedRecording('?recording=vigil-phl-002').id).toBe('vigil-phl-002')
  })

  it('refuses an unknown name in so many words rather than falling back to 001', () => {
    expect(() => selectedRecording('?recording=vigil-phl-003')).toThrow(
      'No recording named "vigil-phl-003"',
    )
    expect(() => recordingNamed('')).toThrow('No recording named ""')
  })
})
