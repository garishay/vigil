/**
 * The recordings Vigil can replay (#84, ruled): configuration, not code (§4.4).
 *
 * A recording is the real layer's file and the hour its picture opens at. The scenario — the
 * seed, the injects it deals — is `config/scenario.ts` and is the same under every recording:
 * the contrast between two recordings is the sky and the hour, never the drones. The id is what
 * the strip's Recording field prints and what a session names a recording feed by —
 * `?feed=recording:<id>`, or `?recording=<id>` as its alias (`lib/session.ts`, #115).
 */

/**
 * Where the sim clock opens. A configured `HH:MM` scores the picture at that hour whatever the
 * capture's wall time — §13's demo runs 001 at 02:30. `'captured'` reads the recording's own
 * `capturedAt` in the AO's time zone, so an evening bank opens in the evening.
 */
export type ClockStart = { startLocal: string } | 'captured'

export interface RecordingEntry {
  id: string
  /** The file under `public/`, served from the app's base. */
  file: string
  clock: ClockStart
}

/** The small-hours recording: the golden, every pinned test, and §13's demo (R5 on #84). */
const PHL_001 = {
  id: 'vigil-phl-001',
  file: 'adsb-phl.json',
  clock: { startLocal: '02:30' },
} satisfies RecordingEntry

/** An evening arrivals bank into PHL, inside operating hours — the contrast (R1 on #84). */
const PHL_002 = {
  id: 'vigil-phl-002',
  file: 'adsb-phl-002.json',
  clock: 'captured',
} satisfies RecordingEntry

export const RECORDINGS: readonly RecordingEntry[] = [PHL_001, PHL_002]

/**
 * The golden's recording, and every pinned test's (A2 on #84) — the bare link's until S11 (#213).
 * Typed as 001's literal rather than as an entry, so its configured clock is readable where no
 * capture is at hand yet: a caller without a clock scores frame 0 at this hour (`lib/ranking.ts`).
 */
export const DEFAULT_RECORDING = PHL_001

/**
 * The recording the app opens without a query parameter (S11, #213): the evening bank the 03
 * family is cut on, so the bare link shows the crowd under load. `lib/session.ts` reads it into
 * the build's defaults; the golden and the tests stay on 001.
 */
export const DEMO_RECORDING = PHL_002

/** The entry with this id. An unknown name is a refusal that says so, never a fallback. */
export function recordingNamed(id: string): RecordingEntry {
  const entry = RECORDINGS.find((recording) => recording.id === id)
  if (!entry) throw new Error(`No recording named "${id}"`)
  return entry
}
