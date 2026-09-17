/**
 * Study scenario 03b (S7, #152; re-cut by S7d, #167, under #131's owner amendment of
 * 2026-09-17): 03a's whole cast — threats included — turned 135° about the centre, under its
 * own ids. The pair is read threat by threat, so a row's two tracks must match in range, speed
 * and entry time; only their bearing and their label differ. Row 1 is therefore 03a's row 1
 * rotated — 6.3 km at 25 kt, entering at 582 s (Begin + 102) — and row 2 is 03a's row 2
 * rotated — 6.15 km at 12 kt, entering at 668 s (Begin + 188) — so `runS` is 218 on both and
 * the brief reads the same length on both. Both are present from t = 0 and warning at Begin.
 *
 * What stops a first run from answering the second is the labels, not the geometry: the two
 * scenarios take disjoint ids, so a subject who learned *TRK-11 was the first entrant* carries
 * nothing. The skill transfers — a subject who learned to read range, speed and heading reads
 * them again — which the amendment accepts and the writeup shows by order.
 */

import type { ScenarioConfig } from '../scenario.ts'
import { SCENARIO_03A } from './03a.ts'
import { rotated } from './cast.ts'
import { CAST_IDS_03B } from './ids.ts'

/** The turn that carries 03a's cast onto other bearings. */
export const ROTATION_03B_DEG = 135

export const SCENARIO_03B: ScenarioConfig = {
  ...SCENARIO_03A,
  seed: 'study-03b',
  castIds: CAST_IDS_03B,
  cast: (SCENARIO_03A.cast ?? []).map((entry) => rotated(entry, ROTATION_03B_DEG)),
}
