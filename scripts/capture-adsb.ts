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

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { AO } from '../src/config/ao.ts'
import {
  CAPTURE_ETIQUETTE,
  captureRadiusNm,
  decideAfterFailure,
  normalizeResponse,
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

export function parseArgs(argv: string[]): Options {
  const options: Options = {
    minutes: DEFAULT_MINUTES,
    intervalS: DEFAULT_INTERVAL_S,
    out: DEFAULT_OUT,
  }
  for (let i = 0; i < argv.length; i += 2) {
    const value = argv[i + 1]
    if (value === undefined) throw new Error(`Missing value for ${argv[i]}`)
    switch (argv[i]) {
      case '--minutes':
        options.minutes = Number(value)
        break
      case '--interval':
        options.intervalS = Number(value)
        break
      case '--out':
        options.out = value
        break
      default:
        throw new Error(`Unknown argument ${argv[i]}`)
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

  for (let i = 0; i < frameCount; i++) {
    const dueAt = startedAt + i * intervalMs
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

    const remaining = dueAt + intervalMs - Date.now()
    if (i < frameCount - 1 && remaining > 0) await sleep(remaining)
  }

  if (failures / frameCount > MAX_FAILURE_RATE) {
    throw new Error(`${failures}/${frameCount} frames failed — not writing a fixture this gappy`)
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
  console.log(`  ${frames.length} frames, ${failures} dropped`)
  console.log(
    `  tracks per frame: min ${Math.min(...counts)}, ` +
      `max ${Math.max(...counts)}, mean ${(total / counts.length).toFixed(1)}`,
  )
}

// Run only when invoked directly. Importing this module — which the parseArgs test does — must
// never start a capture against a free service.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: Error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
