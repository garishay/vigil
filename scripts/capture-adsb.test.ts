import { readFileSync } from 'node:fs'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { CAPTURE_ETIQUETTE } from '../src/lib/adsb.ts'

/**
 * The spies are installed before the script is imported, and the import is dynamic for exactly
 * that reason: `main()` runs only for the true entry, and these three spies are what prove the
 * import stayed inert on every pool. A broken guard surfaces here whatever path it takes —
 * console.log if main starts (its first act is a log line, before any fetch), console.error if
 * parseArgs throws on vitest's argv and the script's own catch swallows it, fetch if a request
 * is ever attempted.
 */
const fetchSpy = vi.fn()
vi.stubGlobal('fetch', fetchSpy)
const logSpy = vi.spyOn(console, 'log')
const errorSpy = vi.spyOn(console, 'error')
const { parseArgs } = await import('./capture-adsb.ts')

afterAll(() => {
  logSpy.mockRestore()
  errorSpy.mockRestore()
})

describe('importing the script', () => {
  it('starts nothing — no log line, no swallowed error, no request, on any pool', () => {
    expect(logSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('parseArgs', () => {
  it('defaults to an interval the etiquette floor accepts (#27)', () => {
    // The old default of 5 s sat below the 10 s floor, so the bare `npm run capture:adsb` threw
    // on the script's own etiquette check. The floor comparison is the pin — a legal future
    // change to the default stays green here, and one below the floor fires this line.
    const options = parseArgs([])
    expect(options).toMatchObject({ minutes: 20, out: 'public/adsb-phl.json' })
    expect(options.intervalS).toBeGreaterThanOrEqual(CAPTURE_ETIQUETTE.minIntervalS)
  })

  it('accepts the usage example actually written in the header', () => {
    // Read from the file, not hardcoded: reverting the header to a below-floor example is the
    // documentation half of #27, and this is the test that guards it.
    const source = readFileSync(new URL('./capture-adsb.ts', import.meta.url), 'utf8')
    const example = /npm run capture:adsb -- (.+)$/m.exec(source)
    expect(example).not.toBeNull()
    expect(() => parseArgs(example![1].trim().split(/\s+/))).not.toThrow()
  })

  it('still refuses an interval below the etiquette floor', () => {
    expect(() => parseArgs(['--interval', '5'])).toThrow(/at least 10/)
  })

  it('refuses unknown and valueless arguments', () => {
    expect(() => parseArgs(['--frames', '10'])).toThrow(/Unknown argument/)
    expect(() => parseArgs(['--minutes'])).toThrow(/Missing value/)
  })
})
