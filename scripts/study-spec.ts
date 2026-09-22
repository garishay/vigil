/**
 * The study's casts by role — the answer key, and the one pure module that holds it (S6a, #165).
 *
 * It was `scripts/study.ts`'s until the sheet had to render in a browser: the bench script reads
 * files and writes them, so a module that imports it cannot be bundled, and the replay's metrics
 * and figure read this table. Pure data and types, nothing else, so the sheet's path carries no
 * `node:` import. `scripts/study.ts` re-exports every name, so the bench and its tests are
 * unchanged.
 *
 * The table stays out of `src/`: the app never imports it on the run's own path, and the sheet
 * reaches it through the chunk the results view loads (S6a A2), so a build a subject runs does
 * not carry it.
 */

import type { RecordingEntry } from '../src/config/recordings.ts'
import { STUDY } from '../src/config/study.ts'
import type { AdsbCapture } from '../src/lib/adsb.ts'

/** The study runs on 002 — the evening arrivals bank, the window inside it (the S3 gate's check 4). */
export const STUDY_RECORDING = 'vigil-phl-002'
/**
 * The corroboration pair, by registry name — the replay tool's list (`tools/replay/load.ts`)
 * until the #138 re-gate carries the prioritization pair; the bench runs `BENCH_SCENARIOS`.
 */
export const STUDY_SCENARIOS = ['02a', '02b'] as const
/** Every scenario the bench baselines, by registry name — the demo's 03d last, never pooled (S11b, #214). */
export const BENCH_SCENARIOS = ['02a', '02b', '03a', '03b', '03d'] as const
/** The cast's first row is the threat, its second the revisit track (the study files' numbering). */
export const THREAT_ID = 'inject-11'
export const REVISIT_ID = 'inject-12'

export type Family = 'corroboration' | 'prioritization'

/**
 * Each study cast's roles by the study files' own numbering — ids, never the generator's labels
 * (S7, #152, ruled A8): the answer key stays out of the app, where a subject cannot reach it.
 * `lockS` is T_lock, the tick the prioritization lock is stated from.
 */
export interface CastRoles {
  family: Family
  threats: readonly string[]
  revisit?: string
  tangential?: readonly string[]
  orbit?: string
  band?: readonly string[]
  lockS?: number
  /**
   * A demonstration scenario (S11b, #214): measured on the bench and drawn per run or as a pair,
   * never pooled — `--study` skips its runs in words, the sheet refuses it beside a counted run,
   * whatever the subject code. The demo's 03d.
   */
  demo?: true
}

export const STUDY_CAST: Record<string, CastRoles> = {
  '02a': { family: 'corroboration', threats: [THREAT_ID], revisit: REVISIT_ID },
  '02b': { family: 'corroboration', threats: [THREAT_ID], revisit: REVISIT_ID },
  // The prioritization pair's ids are its own, disjoint between the two scenarios and in no role
  // order (S7d, #167; `src/config/scenarios/ids.ts`), so this table is the only place a role and
  // an id meet — which is what it has always been for.
  '03a': {
    family: 'prioritization',
    threats: ['inject-31', 'inject-57'],
    tangential: ['inject-36'],
    orbit: 'inject-25',
    band: ['inject-65', 'inject-74', 'inject-94', 'inject-15'],
    lockS: STUDY.beginS,
  },
  '03b': {
    family: 'prioritization',
    threats: ['inject-29', 'inject-23'],
    tangential: ['inject-79'],
    orbit: 'inject-19',
    band: ['inject-80', 'inject-33', 'inject-13', 'inject-95'],
    lockS: STUDY.beginS,
  },
  // The demo's member (S11, #213; S11b, #214): read with the family's lines on its own window
  // from t = 0 — its threats in entry order, 03a's baits and band rows under 03d's ids — and
  // T_lock at 93 s, the tick the far threat overtakes the close one (the ranges cross, #153).
  '03d': {
    family: 'prioritization',
    demo: true,
    threats: ['inject-44', 'inject-39'],
    tangential: ['inject-93'],
    orbit: 'inject-97',
    band: ['inject-16', 'inject-72', 'inject-14', 'inject-92'],
    lockS: 93,
  },
}

/** A recording in hand: its registry entry and its capture — the bench's, the tool's, the app's. */
export interface Recording {
  entry: RecordingEntry
  capture: AdsbCapture
}
