import { describe, expect, it } from 'vitest'
import { parseArgs } from './capture-adsb.ts'
import { CAPTURE_ETIQUETTE } from '../src/lib/adsb.ts'

/**
 * Importing the script must not run it — the main() call is guarded on direct invocation, and a
 * capture started by a test would hammer a free service. If these tests hang or hit the network,
 * that guard is what broke.
 */
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
