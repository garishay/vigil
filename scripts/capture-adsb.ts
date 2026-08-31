/**
 * Records a window of real PHL-area ADS-B traffic to the committed fixture (scope §5.1).
 *
 * Run by hand, never at runtime:
 *
 *   npm run capture:adsb -- --minutes 20 --interval 15
 *
 * Vigil replays a recording rather than polling a live feed, which is what keeps tests
 * deterministic, demos reproducible, and the MVP clear of rate limits, CORS, and outage risk.
 * Going live belongs in Phase 2, behind the backend.
 *
 * This file is the I/O half and nothing else. Every transformation it performs lives in
 * `src/lib/adsb.ts`, where it is unit-tested without a network.
 */

import { realpathSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { AO } from '../src/config/ao.ts'
import {
  CAPTURE_ETIQUETTE,
  captureRadiusNm,
  decideAfterFailure,
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
 * made the bare `npm run capture:adsb` throw on the script's own etiquette check (#27).
 */
const DEFAULT_INTERVAL_S = 15
const DEFAULT_OUT = 'public/adsb-phl.json'
const REQUEST_TIMEOUT_MS = 15_000
/** Abandon the capture rather than commit a fixture riddled with gaps. */
const MAX_FAILURE_RATE = 0.1

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

export function parseArgs(argv: string[]): Options {
  const options: Options = {
    minutes: DEFAULT_MINUTES,
    intervalS: DEFAULT_INTERVAL_S,
    out: DEFAULT_OUT,
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
    }
  }
  if (!(options.minutes > 0) || !(options.intervalS > 0)) {
    throw new Error('--minutes and --interval must be positive numbers')
  }
  if (options.intervalS < CAPTURE_ETIQUETTE.minIntervalS) {
    throw new Error(
      `--interval must be at least ${CAPTURE_ETIQUETTE.minIntervalS}s; adsb.lol is a free service`,
    )
  }
  return options
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
  const frameCount = Math.round((minutes * 60) / intervalS)
  // Before anything reaches the network: `missing / 0` is NaN and `NaN > rate` is false, so a
  // zero-frame run would sail straight past the gappiness guard below and overwrite the committed
  // recording with nothing at all.
  if (frameCount < 1) throw new Error(`${minutes} minutes at ${intervalS}s is not one frame`)
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
  while (i < frameCount) {
    const requestedAt = Date.now()
    const snapshot = await fetchSnapshot(url)

    if (snapshot.ok) {
      const records = normalizeResponse(snapshot.response, AO.bbox)
      frames.push({ tMs: i * intervalMs, records })
      consecutiveFailures = 0
      if (i % 12 === 0 || i === frameCount - 1) {
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
        console.warn(`  backing off ${decision.backOffS}s before the next request`)
        await sleep(decision.backOffS * 1000)
      }
    }

    const next = scheduleNextFrame({ attempted: i, requestedAt, startedAt, intervalMs })
    if (next.index >= frameCount) break
    await sleep(next.waitMs)
    i = next.index
  }

  // Measured as gaps rather than as failures: a slot skipped to hold the etiquette floor after a
  // backoff (#29) leaves the same hole in the recording as a frame that failed outright, and this
  // guard exists for the hole, not for its cause.
  const missing = frameCount - frames.length
  if (missing / frameCount > MAX_FAILURE_RATE) {
    throw new Error(`${missing}/${frameCount} frames missing — not writing a fixture this gappy`)
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
  console.log(`  ${frames.length} frames, ${missing} missing (${failures} of them failed)`)
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
