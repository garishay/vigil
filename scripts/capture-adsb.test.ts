// @vitest-environment node
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
const { entryPathsMatch, parseArgs } = await import('./capture-adsb.ts')

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

describe('entryPathsMatch', () => {
  // Vitest sets `import.meta.main` to false, so `isEntry()` never reaches this fallback in the
  // suite — it is exported and pinned by name because the runtimes it exists for (Node
  // 23.6–23.11, 24.0/24.1) are exactly the ones CI does not run.
  const script = 'scripts/capture-adsb.ts'

  it('matches the same file however the two paths spell it', () => {
    expect(entryPathsMatch(script, script)).toBe(true)
    expect(entryPathsMatch(script, './scripts/../scripts/capture-adsb.ts')).toBe(true)
  })

  it('rejects a different file', () => {
    expect(entryPathsMatch(script, 'vite.config.ts')).toBe(false)
  })

  it('is false — never a throw — when either side has no on-disk path', () => {
    // A bystander importing parseArgs from a context without a file path must not be crashed
    // by the guard; an entry always has both paths.
    expect(entryPathsMatch(undefined, script)).toBe(false)
    expect(entryPathsMatch(script, undefined)).toBe(false)
  })

  it('fails loudly when both paths exist but cannot be resolved', () => {
    expect(() => entryPathsMatch(script, 'scripts/no-such-file.ts')).toThrow(
      /cannot determine whether capture-adsb\.ts is the entry/,
    )
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
    // Read from the file and anchored to the header block's ` *   ` prefix, so this matches the
    // usage example and never a prose mention elsewhere — reverting the doc to a below-floor
    // example is the documentation half of #27, and this is the test that guards it.
    const source = readFileSync('scripts/capture-adsb.ts', 'utf8')
    const example = /^ \*\s+npm run capture:adsb -- (.+)$/m.exec(source)
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
