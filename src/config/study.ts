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

/**
 * The on-screen brief a study run opens on (S4b, #137, ruled A2, A9; #131), identical in both
 * conditions — the parent's text word for word.
 */
export const BRIEF =
  'You are the airspace security operator for PHL. The ring is the protected boundary. Escalate any track you believe needs a response before it reaches the ring. Escalating dispatches a response team - do not escalate tracks you do not believe are a threat. You can open any track. The run lasts six minutes.'

export type QuestionId = 'demand' | 'pressure' | 'confidence'

export interface WorkloadQuestion {
  /** The key the run JSON's `answers` carries, and the replay reads (S5). */
  id: QuestionId
  label: string
}

/** The three workload questions after every run (ruled A7; #131), each answered on the scale. */
export const QUESTIONS: readonly WorkloadQuestion[] = [
  { id: 'demand', label: 'Mental demand' },
  { id: 'pressure', label: 'Time pressure' },
  { id: 'confidence', label: 'Confidence in your decisions' },
]

/** The answers' scale, whole numbers inclusive (#131: 1–10 each). */
export const WORKLOAD_SCALE = { min: 1, max: 10 } as const
