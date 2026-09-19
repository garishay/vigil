/**
 * The operator study's one config (S3c, #135, ruled A8; #131): the window on the recording —
 * Begin as "recording + 08:00" and the run's length (D3) — and raw mode's association distance
 * (D2, A9), created here and read by the study bench, raw mode (S4a), and run capture (S4b).
 * Configuration, not code (§4.4): the acceptance thresholds the study bench asserts and the cue
 * audit's definitions sit beside them, so the baselines say what they count in the config's own
 * numbers. The brief's blocks and the three questions sit here too, as the words a run shows.
 */

import type { TrackShape } from '../lib/display.ts'
import type { Mark } from '../lib/lifecycle.ts'

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
  /**
   * The prioritization pair's lines (S7, #152, ruled A8; S7b): the lock — ranks 1 and 2 the
   * threats in entry order through the first entry — may land this many ticks after T_lock; a
   * tangential bait's course misses the ring by at least this on every airborne tick; the leak
   * tell is threat 1 opened on raw under this many seconds by both volunteers.
   */
  prioritization: { lockToleranceTicks: number; baitMissM: number; leakOpenS: number }
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
  prioritization: { lockToleranceTicks: 3, baitMissM: 1000, leakOpenS: 30 },
  audit: { closingAtLeast: 50, insideM: 6500, hoveringUnderKt: 2 },
}

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

/** One line of the brief: a symbol before it — a shape, a mark, the ring, a button — or none. */
export interface BriefLine {
  /** The map's own shape, drawn with `ShapeGlyph` so the key cannot drift from the marker. */
  shape?: TrackShape
  /** The subject's own mark on that shape (S8-i, S9b): opened, or the marker drawn hollow. */
  mark?: Mark
  /** A row of marks on the dot (S9b): untouched, opened, handled — one line for the three. */
  marks?: readonly (Mark | null)[]
  /** Vigil's one colour (S9b): the dot drawn in the warning colour. */
  warning?: true
  /** The protected ring, drawn in the ring's own stroke. */
  ring?: true
  /** An action drawn as the button it is, so the word on the brief is the word on the screen. */
  button?: string
  text: string
}

export interface BriefBlock {
  heading: string
  lines: readonly BriefLine[]
  /** Vigil only: the one block that is not identical across the two conditions. */
  vigilOnly?: true
}

/** The goal, in the largest type on the brief — one line, the same in both conditions. */
export const BRIEF_GOAL = 'Stop drones before they reach the ring'

/** *Run 1 of 2* — where this run sits in the subject's session, above the goal. */
export const runOfSession = (run: number, runs: number) => `Run ${run} of ${runs}`

const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * The brief a study run opens on, rebuilt for reading (S8, #180 item 6, ruled at its gate; S4b,
 * #137, ruled A2, A9; #131): one screen at 1280×720 with no scrolling, the run's place in the
 * session and the goal in large type, then labelled blocks. The clock line reads the run's own
 * length (S7, #152, ruled D4) to the half minute in words. Every block but the last is identical
 * across the conditions. The legend is the map's own three shapes (S9), the protected ring, and
 * the subject's two marks (S8-i, R1): the faint ring means a track they have opened — opening is
 * what marks it (the owner's amendment of 2026-09-19) — and the hollow marker one they have
 * escalated or dismissed. The actions are the two the run offers, drawn as their buttons; there
 * is no Assess line, since there is no Assess button. The restraint sentence stays (the owner's
 * note of 09-18), the brief never says who an escalation goes to (ruled R4), and it never says
 * how many tracks will enter the ring. The three states are one row of three dots (S9b, #199),
 * and the Vigil block says what red means, since red is the one colour a run spends. 159 words
 * in Vigil and 134 unaided, the title and Begin included, at and under the accepted 159 and 141
 * and pinned — the brief does not grow.
 */
export function briefBlocks(runS: number): readonly BriefBlock[] {
  return [
    {
      heading: 'The clock',
      lines: [
        {
          text: `${sentenceCase(runLengthWords(runS))}. The clock starts when you press Begin and cannot be paused.`,
        },
      ],
    },
    {
      heading: 'On the map',
      lines: [
        {
          shape: 'aircraft',
          text: 'Aircraft, broadcasting who they are. Escalating one is an error.',
        },
        { shape: 'drone', text: 'Drone, broadcasting its ID.' },
        { shape: 'dot', text: 'Unidentified track, broadcasting nothing.' },
        { ring: true, text: 'The ring around the protected site.' },
        {
          marks: [null, 'assessed', 'handled'],
          text: 'Untouched, opened, escalated or dismissed.',
        },
      ],
    },
    {
      heading: 'What you do',
      lines: [
        { text: 'Click a track to read it.' },
        {
          button: 'Escalate',
          text: 'if you think it will enter the ring. One click, and you are done with that track.',
        },
        { button: 'Dismiss', text: 'if it is not a concern.' },
      ],
    },
    {
      heading: 'What counts',
      lines: [
        { text: 'Earlier is better. Escalate a track before it reaches the ring.' },
        {
          text: 'Escalating sends a response team. Do not escalate a track you do not believe is a threat.',
        },
      ],
    },
    {
      heading: 'The priority list',
      vigilOnly: true,
      lines: [
        { text: 'The priority list on the left ranks every track. The top row needs you first.' },
        { warning: true, text: 'Red is warning: it needs you now.' },
      ],
    },
  ]
}

export type QuestionId = 'demand' | 'pressure' | 'confidence'

export interface WorkloadQuestion {
  /** The key the run JSON's `answers` carries, and the replay reads (S5). */
  id: QuestionId
  /** The question as the subject reads it — a question, not a heading (S8, #180 item 5). */
  label: string
  /** What the scale's low end means, and what its high end means — said, not guessed. */
  ends: { low: string; high: string }
}

/**
 * The three workload questions after every run (ruled A7; #131; S8, #180 item 5): full
 * questions with labelled ends, adapted from NASA-TLX's mental demand and temporal demand items
 * plus a confidence item. The ids and the 1–10 scale are unchanged, so the run JSON's answer
 * keys, the store, the results envelope and every committed fixture read exactly as before.
 */
export const QUESTIONS: readonly WorkloadQuestion[] = [
  {
    id: 'demand',
    label: 'How mentally demanding was the task?',
    ends: { low: 'very low', high: 'very high' },
  },
  {
    id: 'pressure',
    label: 'How hurried or rushed was the pace?',
    ends: { low: 'very low', high: 'very high' },
  },
  {
    id: 'confidence',
    label: 'How confident are you that you escalated the right tracks?',
    ends: { low: 'not at all', high: 'extremely' },
  },
]

/** The answers' scale, whole numbers inclusive (#131: 1–10 each). */
export const WORKLOAD_SCALE = { min: 1, max: 10 } as const
