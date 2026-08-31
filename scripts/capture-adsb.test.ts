import { describe, expect, it, vi } from 'vitest'
import { CAPTURE_ETIQUETTE } from '../src/lib/adsb.ts'

/**
 * The fetch stub is installed before the script is imported, and the import is dynamic for
 * exactly that reason: `main()` is guarded on `import.meta.main`, and the assertion below is
 * what proves the guard holds — a broken guard would otherwise fail quietly (parseArgs throws on
 * vitest's argv and the script's own `.catch` swallows it), not hang or hit the network.
 */
const fetchSpy = vi.fn()
vi.stubGlobal('fetch', fetchSpy)
const { parseArgs } = await import('./capture-adsb.ts')

describe('importing the script', () => {
  it('starts nothing — the entry guard holds and no request is ever made', () => {
    expect(import.meta.main).toBeFalsy()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('parseArgs', () => {
  it('defaults to an interval the etiquette floor accepts (#27)', () => {
    // The old default of 5 s sat below the 10 s floor, so the bare `npm run capture:adsb`
    // threw on the script's own etiquette check. Both real captures used 15 s.
    const options = parseArgs([])
    expect(options).toEqual({ minutes: 20, intervalS: 15, out: 'public/adsb-phl.json' })
    expect(options.intervalS).toBeGreaterThanOrEqual(CAPTURE_ETIQUETTE.minIntervalS)
  })

  it('accepts the header example verbatim', () => {
    expect(parseArgs(['--minutes', '20', '--interval', '15'])).toMatchObject({
      minutes: 20,
      intervalS: 15,
    })
  })

  it('still refuses an interval below the etiquette floor', () => {
    expect(() => parseArgs(['--interval', '5'])).toThrow(/at least 10/)
  })

  it('refuses unknown and valueless arguments', () => {
    expect(() => parseArgs(['--frames', '10'])).toThrow(/Unknown argument/)
    expect(() => parseArgs(['--minutes'])).toThrow(/Missing value/)
  })
})
