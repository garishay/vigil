/**
 * The operator study's one config (S3c, #135, ruled A8; #131): the window on the recording —
 * Begin as "recording + 08:00" and the run's length (D3) — and raw mode's association distance
 * (D2, A9), created here and read by the study bench, raw mode (S4a), and run capture (S4b).
 * Configuration, not code (§4.4): the acceptance thresholds the study bench asserts and the cue
 * audit's definitions sit beside them, so the baselines say what they count in the config's own
 * numbers.
 */

export interface StudyConfig {
  /** Scenario seconds at Begin — T0, "recording + 08:00" on 002. */
  beginS: number
  /** The run's length from Begin, seconds (D3: 6:00). */
  runS: number
  /** Raw mode's association distance, metres (D2): a broadcast labels a track within it. */
  rawAssociationM: number
  /** The four acceptance lines' thresholds. */
  acceptance: {
    /** The threat's warning crossing must fall at least this many seconds before ring entry. */
    entryLeadS: number
    /** The threat's rank-1 margin over the next candidate, from its crossing on. */
    marginAtLeast: number
    /** A heard, consistent, not-closing track never reaches this composite. */
    heardCalmUnder: number
  }
  /** The cue audit's definitions, on airborne ticks only — a landed track counts for nothing. */
  audit: {
    /** *Closing*: the closing factor at or above this on a tick in the window. */
    closingAtLeast: number
    /** *Inside*: within this many metres of the ring's centre on a tick in the window. */
    insideM: number
    /** *Remote ID hovering*: heard and under this ground speed, knots, on a tick in the window. */
    hoveringUnderKt: number
  }
}

export const STUDY: StudyConfig = {
  beginS: 480,
  runS: 360,
  rawAssociationM: 1500,
  acceptance: { entryLeadS: 60, marginAtLeast: 5, heardCalmUnder: 40 },
  audit: { closingAtLeast: 50, insideM: 6500, hoveringUnderKt: 2 },
}
