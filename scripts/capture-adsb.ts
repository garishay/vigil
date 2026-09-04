/**
 * Records a window of real PHL-area ADS-B traffic to the committed fixture (scope §5.1).
 *
 * Run by hand, never at runtime:
 *
 *   npm run capture:adsb -- --minutes 20 --interval 15 --out public/adsb-phl-003.json
 *
 * The output is named on every run and must not exist yet (ruled on #99): the committed
 * recordings — 001, the golden's and every pinned test's; 002 beside it — are never overwritten
 * by a default. A new recording is then an entry in `src/config/recordings.ts`.
 *
 * Vigil replays a recording rather than polling a live feed, which is what keeps tests
 * deterministic, demos reproducible, and the MVP clear of rate limits, CORS, and outage risk.
 * Going live belongs in Phase 2, behind the backend.
 *
 * This file is the I/O half and nothing else. Every transformation it performs lives in
 * `src/lib/adsb.ts`, where it is unit-tested without a network.
 */

import { existsSync, realpathSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { AO } from '../src/config/ao.ts'
import {
  CAPTURE_ETIQUETTE,
  backoffOutlastsWindow,
  captureRadiusNm,
  decideAfterFailure,
  gapBudget,
  normalizeResponse,
  scheduleNextFrame,
} from '../src/lib/adsb.ts'
import type { AdsbCapture, AdsbLolResponse, CaptureFailure, CaptureFrame } from '../src/lib/adsb.ts'

/** Free, open-data, unfiltered, and keyless. OpenSky is the documented backup (scope §5.1). */
const API_ROOT = 'https://api.adsb.lol/v2'
const USER_AGENT = 'vigil-capture (educational demo; github.com/garishay/vigil)'
const DEFAULT_MINUTES = 20
/**
 * 15, not the etiquette floor of 10: both real captures used 15 s, and a default below the floor
 * made a run that named only its output throw on the script's own etiquette check (#27).
 */
const DEFAULT_INTERVAL_S = 15
const REQUEST_TIMEOUT_MS = 15_000

interface Options {
  minutes: number
  intervalS: number
  out: string
}

const FLAGS = ['--minutes', '--interval', '--out'] as const
type Flag = (typeof FLAGS)[number]

function isKnownFlag(arg: string): arg is Flag {
  return (FLAGS as readonly string[]).includes(arg)
}

/**
 * `exists` is the filesystem seam: the suite parses with a stub, and the one test that reaches the
 * real one pins that both committed recordings are refused by name.
 */
export function parseArgs(argv: string[], exists: (path: string) => boolean = existsSync): Options {
  const options: Omit<Options, 'out'> & { out?: string } = {
    minutes: DEFAULT_MINUTES,
    intervalS: DEFAULT_INTERVAL_S,
  }
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]
    // The flag is judged before its value, so a trailing unrecognised one — `--help` being the
    // one a person actually types — is told what is wrong with the flag rather than accused of
    // omitting a value it was never going to take (#30).
    if (!isKnownFlag(flag)) throw new Error(`Unknown argument ${flag}`)
    const value = argv[i + 1]
    if (value === undefined) throw new Error(`Missing value for ${flag}`)
    switch (flag) {
      case '--minutes':
        options.minutes = Number(value)
        break
      case '--interval':
        options.intervalS = Number(value)
        break
      case '--out':
        options.out = value
        break
      default: {
        // Unreachable while every FLAGS entry has a case above — which is the point. TypeScript
        // does not check a string switch for exhaustiveness, so a flag added to FLAGS without a
        // case would otherwise parse, do nothing, and leave the operator with a default they
        // thought they had overridden. This line is the compile error that says so instead.
        const unhandled: never = flag
        throw new Error(`Unhandled flag ${String(unhandled)}`)
      }
    }
  }
  // One check, on the rounded frame count, because every bad argument arrives here: Infinity and
  // NaN both fail `isFinite`, and zero, negative, or too-short windows all round below one frame.
  // It has to be the derived value — `--minutes 1e308` is finite until multiplied by 60, and the
  // Infinity that produced turned the capture loop into an unbounded poll of a free service. And
  // rounded, because `--minutes 0.1 --interval 15` is a positive 0.4 that becomes zero frames, and
  // a zero-frame run made `missing / 0` NaN, sailed past the gappiness guard, and overwrote the
  // committed recording with nothing. Both used to be caught here and in `main()` respectively;
  // one condition covers them, and unlike `main()` this one is reachable from the suite.
  const frames = Math.round((options.minutes * 60) / options.intervalS)
  if (!Number.isFinite(frames) || frames < 1) {
    // Both flags named with what each parsed to, and the count itself rather than a claim about
    // which way it went wrong: one condition covers several mistakes, and they do not point the
    // same direction. `--interval 0` yields Infinity frames, so "describes no whole frame" told
    // the operator the opposite of what happened, and the etiquette-floor check that would have
    // named the real fault sits below this one and never runs.
    throw new Error(
      `--minutes ${options.minutes} --interval ${options.intervalS} gives ${frames} frames`,
    )
  }
  // A floor and no ceiling, by ruling (#44, scope §5.1): the window's length is the operator's
  // to choose. The etiquette risk is rate, which the check below floors whatever the length.
  if (options.intervalS < CAPTURE_ETIQUETTE.minIntervalS) {
    throw new Error(
      `--interval must be at least ${CAPTURE_ETIQUETTE.minIntervalS}s; adsb.lol is a free service`,
    )
  }
  // Last, after the window is known good, so a run wrong in two ways hears about the window
  // first — and before any request, so a refused run costs the service nothing (#99).
  if (options.out === undefined) {
    throw new Error('--out is required: name the file to write; there is no default')
  }
  if (exists(options.out)) {
    throw new Error(`${options.out} already exists — a committed recording is never overwritten`)
  }
  return { ...options, out: options.out }
}

/**
 * A snapshot, or why it could not be had.
 *
 * Failures are returned rather than thrown because the caller has to tell a rate limit — which
 * obliges it to stop — apart from a dropped connection, which it may reasonably ride out.
 */
type Snapshot = { ok: true; response: AdsbLolResponse } | ({ ok: false } & CaptureFailure)

async function fetchSnapshot(url: string): Promise<Snapshot> {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (response.status === 429) {
      return {
        ok: false,
        rateLimited: true,
        retryAfter: response.headers.get('retry-after'),
        message: 'HTTP 429 Too Many Requests',
      }
    }
    if (!response.ok) {
      const message = `HTTP ${response.status} ${response.statusText}`
      return { ok: false, rateLimited: false, retryAfter: null, message }
    }
    return { ok: true, response: (await response.json()) as AdsbLolResponse }
  } catch (error) {
    return {
      ok: false,
      rateLimited: false,
      retryAfter: null,
      message: (error as Error).message,
    }
  }
}

/**
 * One frame per line.
 *
 * `JSON.stringify(capture, null, 2)` would multiply a two-megabyte fixture severalfold, and a
 * single-line file makes every recapture one unreadable diff. A line per frame costs nothing and
 * keeps the fixture reviewable as text.
 */
function serialize(capture: AdsbCapture): string {
  const { frames, ...header } = capture
  const headerJson = JSON.stringify(header).slice(1, -1)
  const frameLines = frames.map((frame) => JSON.stringify(frame)).join(',\n')
  return `{${headerJson},\n"frames": [\n${frameLines}\n]}\n`
}

async function main(): Promise<void> {
  const { minutes, intervalS, out } = parseArgs(process.argv.slice(2))
  const intervalMs = intervalS * 1000
  // At least one, and finite: `parseArgs` refuses anything else, and is tested for it.
  const frameCount = Math.round((minutes * 60) / intervalS)
  const radiusNm = captureRadiusNm(AO)
  const [lon, lat] = AO.center
  const url = `${API_ROOT}/lat/${lat}/lon/${lon}/dist/${radiusNm}`

  console.log(`AO ${AO.id} · ${radiusNm} nm around ${lat}, ${lon}, filtered to the AO bbox`)
  console.log(`${frameCount} frames every ${intervalS}s — about ${minutes} minutes\n`)

  const frames: CaptureFrame[] = []
  const startedAt = Date.now()
  let failures = 0
  let rateLimits = 0
  let consecutiveFailures = 0

  // Not a `for` step: a backoff can run the clock past whole slots, and the next frame is then
  // the next one still ahead of us rather than the one after this (#29).
  let i = 0
  // Set when the run stops before its last slot; printed beside the shortfall it left.
  let stoppedEarly: string | undefined
  while (i < frameCount) {
    const snapshot = await fetchSnapshot(url)

    if (snapshot.ok) {
      const records = normalizeResponse(snapshot.response, AO.bbox)
      frames.push({ tMs: i * intervalMs, records })
      consecutiveFailures = 0
      // Every twelfth frame only: `i === frameCount - 1` was written when this was a `for` loop
      // visiting every index, and after #29 the run can skip past that slot and never print it.
      // The summary block below reports the end of the run, and does it whatever the loop skipped.
      if (i % 12 === 0) {
        const elapsed = Math.round((Date.now() - startedAt) / 1000)
        console.log(`  frame ${i + 1}/${frameCount}  ${records.length} tracks  ${elapsed}s elapsed`)
      }
    } else {
      // A dropped frame leaves a visible gap in tMs rather than a silently shifted timeline.
      failures++
      consecutiveFailures++
      console.warn(`  frame ${i + 1}/${frameCount} failed: ${snapshot.message}`)

      if (snapshot.rateLimited) rateLimits++
      const decision = decideAfterFailure(snapshot, { rateLimits, consecutiveFailures })
      if (decision.action === 'abort') throw new Error(decision.reason)
      if (decision.backOffS > 0) {
        // Decided before the sleep: a Retry-After longer than what is left of the window used to
        // be slept through in full, for a run that was already lost (#41).
        const schedule = { attempted: i, startedAt, intervalMs }
        // On the last slot there is nothing left to wait for and nothing was cut short: the
        // projection is trivially true there, so it would name a reason for a run that
        // completed (#85 review). No sleep either — the window is over.
        if (i + 1 >= frameCount) break
        if (backoffOutlastsWindow(schedule, decision.backOffS, frameCount)) {
          stoppedEarly = `a ${decision.backOffS}s backoff outlasts the capture window`
          break
        }
        console.warn(`  backing off ${decision.backOffS}s before the next request`)
        await sleep(decision.backOffS * 1000)
      }
    }

    const next = scheduleNextFrame({ attempted: i, startedAt, intervalMs })
    if (next.index >= frameCount) break
    await sleep(next.waitMs)
    i = next.index
  }

  // Measured as gaps rather than as failures: a slot skipped to hold the etiquette floor after a
  // backoff (#29) leaves the same hole in the recording as a frame that failed outright, and this
  // guard exists for the hole, not for its cause. A run that stopped early is judged on the same
  // count — its shortfall is trailing, which leaves `tMs` contiguous from 0 and harms nothing
  // (#39) — and the budget is a rate with a floor under it (#36 [3]).
  const missing = frameCount - frames.length
  const budget = gapBudget(frameCount, intervalMs)
  if (missing > budget) {
    const why = stoppedEarly ? ` — ${stoppedEarly}` : ''
    throw new Error(
      `${missing}/${frameCount} frames missing${why} — not writing a fixture this gappy`,
    )
  }

  const capture: AdsbCapture = {
    ao: AO.id,
    source: 'adsb.lol v2',
    capturedAt: new Date(startedAt).toISOString(),
    intervalMs,
    bbox: AO.bbox,
    frames,
  }
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, serialize(capture), 'utf8')

  const counts = frames.map((frame) => frame.records.length)
  const total = counts.reduce((sum, n) => sum + n, 0)
  console.log(`\nWrote ${out}`)
  if (stoppedEarly) console.log(`  stopped early: ${stoppedEarly}`)
  console.log(
    `  ${frames.length} frames, ${missing} missing of ${budget} allowed (${failures} failed)`,
  )
  console.log(
    `  tracks per frame: min ${Math.min(...counts)}, ` +
      `max ${Math.max(...counts)}, mean ${(total / counts.length).toFixed(1)}`,
  )
}

/**
 * The fallback entry comparison, both sides realpathed so a symlinked checkout still matches.
 * Exported so the test can pin it directly — under Vitest `import.meta.main` is `false`, not
 * undefined, so `isEntry()` never reaches this path in the suite and it must be tested by name.
 *
 * Loud, not false, on a realpath failure: a fallback that swallows its own failure is the silent
 * no-op it exists to prevent, and it only runs at all on runtimes without `import.meta.main`.
 */
export function entryPathsMatch(
  scriptPath: string | undefined,
  argvPath: string | undefined,
): boolean {
  // An importer without an on-disk path cannot be running us as the entry — false is the
  // truthful answer there, not a swallowed failure, and a bystander import can never be
  // crashed by this guard. import.meta.filename (not a URL parse) sidesteps non-file schemes.
  if (!scriptPath || !argvPath) return false
  let self: string
  try {
    self = realpathSync(scriptPath)
  } catch (error) {
    // Our own path failing to resolve is undiagnosable — loud: a fallback that swallows its own
    // failure is the silent no-op it exists to prevent.
    throw new Error(
      `cannot determine whether capture-adsb.ts is the entry: ${(error as Error).message}`,
      { cause: error },
    )
  }
  try {
    return self === realpathSync(argvPath)
  } catch {
    // argv naming something that is not on disk means that process's entry is not us — an
    // entry's argv[1] always resolves, node just loaded it — so a bystander import (say,
    // `node --eval` with a stray trailing argument) is answered false, never crashed.
    return false
  }
}

/**
 * This module's own on-disk path, from the richest source the runtime offers:
 * `import.meta.filename` (Node 20.11+), else the URL when it is genuinely file-scheme, else
 * undefined — a non-file scheme means a bundler or test harness, which is never the entry.
 */
function entryScriptPath(): string | undefined {
  if (import.meta.filename) return import.meta.filename
  return import.meta.url?.startsWith('file:') ? fileURLToPath(import.meta.url) : undefined
}

/**
 * Run only when invoked directly. Importing this module — which the parseArgs test does — must
 * never start a capture against a free service.
 *
 * `import.meta.main` where the runtime provides it: `true` for the entry, `false` for an import
 * (Vitest sets `false` too, verified empirically, so a test import is inert). Where the property
 * does not exist — Node 23.6–23.11 and 24.0/24.1, inside the `engines` warning npm only advises
 * about — the realpath comparison decides, so neither an old runtime nor a symlinked checkout
 * can silently no-op the script.
 */
function isEntry(): boolean {
  return import.meta.main ?? entryPathsMatch(entryScriptPath(), process.argv[1])
}

if (isEntry()) {
  main().catch((error: Error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
