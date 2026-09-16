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
 * conditions — the parent's text word for word, its last sentence reading the run's own length
 * (S7, #152, ruled D4): a run is as long as its scenario says (`runS` on the registry entry),
 * rounded to the half minute in words, so 02's sentence is the parent's byte for byte and 03's
 * says *about three and a half minutes*.
 */
const BRIEF_LEAD =
  'You are the airspace security operator for PHL. The ring is the protected boundary. Escalate any track you believe needs a response before it reaches the ring. Escalating dispatches a response team - do not escalate tracks you do not believe are a threat. You can open any track.'

const MINUTE_WORDS = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
]

/**
 * A run's length in words, to the nearest half minute: `six minutes` for 360 s, `about three
 * and a half minutes` for 218 s, `about three minutes` for 179 s — *about* whenever the
 * rounding moved it. Whole minutes past ten print as a number.
 */
export function runLengthWords(runS: number): string {
  const halves = Math.round(runS / 30)
  const minutes = Math.floor(halves / 2)
  const half = halves % 2 === 1
  const about = halves * 30 === runS ? '' : 'about '
  const word = minutes <= 10 ? MINUTE_WORDS[minutes] : String(minutes)
  if (minutes === 0) return `${about}half a minute`
  if (half) return `${about}${word} and a half minutes`
  return `${about}${word} minute${minutes === 1 ? '' : 's'}`
}

/** The brief for a run of `runS` seconds — the lead word for word, the last sentence its length. */
export const briefFor = (runS: number) => `${BRIEF_LEAD} The run lasts ${runLengthWords(runS)}.`

/** The brief at the default length — 02's, the parent's text word for word. */
export const BRIEF = briefFor(STUDY.runS)

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
