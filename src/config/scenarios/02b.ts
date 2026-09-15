/**
 * Study scenario 02b (S3b, #135, ruled): 02a's composition on other bearings — every decoy turned
 * 225° about the centre — with the threat presented by a different mechanism. It is in the
 * picture from t = 0, heard and consistent, 7.2 km out at T0 with 122 s to entry on course 290°
 * through the circle at 105° / 3.0 km; its broadcast begins lying at T0 + 30 s (`fromS` 510), so
 * it crosses warning on a tick with 92 s to entry and the ident is withheld from that tick — a
 * track the subject was already looking at, where 02a's is a new track at Begin.
 */

import type { ScenarioConfig } from '../scenario.ts'
import { at, rotated, threat } from './cast.ts'
import { SCENARIO_02A } from './02a.ts'

/** The turn that carries 02a's threat geometry onto the ruled one: 245° → 110°, 240° → 105°. */
export const ROTATION_02B_DEG = 225

export const SCENARIO_02B: ScenarioConfig = {
  ...SCENARIO_02A,
  seed: 'study-02b',
  cast: [
    threat(at(110, 15.84), 290, at(105, 3.0), { fromS: 510 }), // 11 · from t = 0 at 35 kt: 7.2 km at T0, lying from 510 s, enters the ring at 604
    ...(SCENARIO_02A.cast ?? []).slice(1).map((entry) => rotated(entry, ROTATION_02B_DEG)), // 12–40 · 02a's decoys, turned 225°
  ],
}
