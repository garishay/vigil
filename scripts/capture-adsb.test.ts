// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { CAPTURE_ETIQUETTE } from '../src/lib/adsb.ts'

// Anchored to this file's URL, never the CWD: the suite must not depend on where vitest was
// started from, and the false-case comparison below must compare against a file that is
// guaranteed to exist whatever else gets renamed.
const scriptPath = fileURLToPath(new URL('./capture-adsb.ts', import.meta.url))
const testPath = fileURLToPath(new URL('./capture-adsb.test.ts', import.meta.url))

/**
 * The spies are installed before the script is imported, and the import is dynamic for exactly
 * that reason: `main()` runs only for the true entry, and these three spies are what prove the
 * import stayed inert on every pool. A broken guard surfaces here whatever path it takes. On
 * vitest's argv the realistic one is console.error — main's first act is `parseArgs`, which
 * throws on unrecognized arguments and lands in the script's own catch; console.log covers an
 * argv that happens to parse (main's first act *then* is a log line, before any fetch), and the
 * fetch spy is the backstop if a request is ever attempted.
 */
const fetchSpy = vi.fn()
vi.stubGlobal('fetch', fetchSpy)
const logSpy = vi.spyOn(console, 'log')
const errorSpy = vi.spyOn(console, 'error')
const { entryPathsMatch, parseArgs } = await import('./capture-adsb.ts')

afterAll(() => {
  logSpy.mockRestore()
  errorSpy.mockRestore()
  // The stubbed fetch is restored too: under `isolate: false` a `vi.fn()` left on globalThis
  // would leak into whatever file next shares this worker (#30).
  vi.unstubAllGlobals()
})

describe('importing the script', () => {
  it('starts nothing — no log line, no swallowed error, no request, on any pool', () => {
    expect(logSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('invoking the script directly', () => {
  it('reaches main — the entry guard is not stuck false', () => {
    // The other half of the guard, pinned structurally network-free: an unknown flag can never
    // become a legal capture, so parseArgs rejects before any fetch on every possible future of
    // the config — unlike a below-floor interval, which is offline only while the floor stands.
    // A guard stuck false would exit 0 printing nothing — a silent no-op strictly worse than
    // the throw #27 fixed — and fail both assertions here.
    const result = spawnSync(process.execPath, [scriptPath, '--no-such-flag'], {
      encoding: 'utf8',
      timeout: 20_000,
    })
    expect(result.status).toBe(1)
    expect(result.stderr + result.stdout).toMatch(/Unknown argument --no-such-flag/)
  })
})

describe('entryPathsMatch', () => {
  // Vitest sets `import.meta.main` to false, so `isEntry()` never reaches this fallback in the
  // suite — it is exported and pinned by name because the runtimes it exists for (Node
  // 23.6–23.11, 24.0/24.1) are exactly the ones CI does not run.
  it('matches the same file however the two paths spell it', () => {
    expect(entryPathsMatch(scriptPath, scriptPath)).toBe(true)
    expect(
      entryPathsMatch(scriptPath, join(dirname(scriptPath), '..', 'scripts', 'capture-adsb.ts')),
    ).toBe(true)
  })

  it('rejects a different file', () => {
    expect(entryPathsMatch(scriptPath, testPath)).toBe(false)
  })

  it('is false — never a throw — when either side has no on-disk path', () => {
    // A bystander importing parseArgs from a context without a file path must not be crashed
    // by the guard; an entry always has both paths.
    expect(entryPathsMatch(undefined, scriptPath)).toBe(false)
    expect(entryPathsMatch(scriptPath, undefined)).toBe(false)
  })

  it('answers false when argv names something not on disk — that process is not our entry', () => {
    // An entry's argv[1] always resolves (node just loaded it), so an unresolvable argv means a
    // bystander context — `node --eval` with a stray trailing argument, a dangling symlink —
    // and the import must be answered, never crashed.
    expect(entryPathsMatch(scriptPath, join(dirname(scriptPath), 'no-such-file.ts'))).toBe(false)
  })

  it('fails loudly only when its own path cannot be resolved', () => {
    expect(() => entryPathsMatch(join(dirname(scriptPath), 'no-such-file.ts'), scriptPath)).toThrow(
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
    const source = readFileSync(scriptPath, 'utf8')
    const example = /^ \*\s+npm run capture:adsb -- (.+)$/m.exec(source)
    expect(example).not.toBeNull()
    expect(() => parseArgs(example![1].trim().split(/\s+/))).not.toThrow()
  })

  it('still refuses an interval below the etiquette floor', () => {
    // Argument and expectation both derived from the constant the file already imports: raising
    // the floor is a legal change and must not fail this test for a reason unrelated to what it
    // pins, which a hardcoded `5` against `/at least 10/` would (#30).
    expect(() => parseArgs(['--interval', String(CAPTURE_ETIQUETTE.minIntervalS - 1)])).toThrow(
      new RegExp(`at least ${CAPTURE_ETIQUETTE.minIntervalS}s`),
    )
  })

  it('refuses unknown and valueless arguments', () => {
    expect(() => parseArgs(['--frames', '10'])).toThrow(/Unknown argument/)
    expect(() => parseArgs(['--minutes'])).toThrow(/Missing value/)
  })

  it('refuses every window that does not describe at least one whole frame', () => {
    // One condition now covers what two used to, and this is the half that `main()` held and the
    // suite could not reach: `--minutes 0.1` is positive, rounds to zero frames, and a zero-frame
    // run made `missing / 0` NaN, walked past the gappiness guard, and overwrote the committed
    // recording with an empty capture.
    expect(() => parseArgs(['--minutes', '0.1'])).toThrow(/gives 0 frames/)
    // The unbounded-poll half: Infinity is > 0 and used to pass a positivity check, and `1e308`
    // is finite until multiplied by 60 — both make the frame count non-finite.
    expect(() => parseArgs(['--minutes', '1e400'])).toThrow(/gives Infinity frames/)
    expect(() => parseArgs(['--minutes', '1e308'])).toThrow(/gives Infinity frames/)
    expect(() => parseArgs(['--interval', 'abc'])).toThrow(/gives NaN frames/)
    // Still accepts the windows it should, including a sub-minute one that does round to a frame.
    expect(parseArgs(['--minutes', '0.5']).minutes).toBe(0.5)
  })

  it('wires each known flag to the option it names', () => {
    // The compile-time half — that no FLAGS entry lacks a case — is the `never` assertion in the
    // default branch, which no test can observe. This is the runtime half: a flag the parser
    // admits has to actually change its option.
    //
    // Every argument is derived from the default it must differ from, so no row can pass by
    // coincidence. `--interval` is the row that could: the sibling test deliberately leaves
    // `intervalS` out of its `toMatchObject`, so a hardcoded 20 would have held from the default
    // alone if `DEFAULT_INTERVAL_S` were ever raised to 20 — a legal change.
    const defaults = parseArgs([])
    expect(parseArgs(['--minutes', String(defaults.minutes + 5)]).minutes).toBe(
      defaults.minutes + 5,
    )
    expect(parseArgs(['--interval', String(defaults.intervalS + 5)]).intervalS).toBe(
      defaults.intervalS + 5,
    )
    expect(parseArgs(['--out', `${defaults.out}.other`]).out).toBe(`${defaults.out}.other`)
  })

  it('names the flag, not a missing value, for an unrecognised trailing flag', () => {
    // `--help` is the flag a person reaches for first and the one this script does not have.
    // It used to be met with `Missing value for --help`, which describes neither problem (#30).
    expect(() => parseArgs(['--help'])).toThrow(/Unknown argument --help/)
  })
})
