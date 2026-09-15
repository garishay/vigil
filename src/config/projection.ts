/**
 * Time to entry (#102, ruled): how far ahead the dead-reckoned path is followed for an entry
 * into a protected site — the Entry row's horizon, and the horizon is the factor's own: the
 * closing ramp's end, `closing.entryZeroMin` in `scoring.ts`, read here in seconds so the two
 * cannot drift — one horizon, one number (#36 [31], ruled A). The row prints a time wherever
 * the factor scores and none exactly where it reads nothing. Configuration, not code (§4.4),
 * in its own file as `alerts.ts` is; `replay.ts` is the clock's, not the picture's.
 */

import { SCORING } from './scoring.ts'

export interface ProjectionConfig {
  /** The horizon, seconds: an entry later than this reads as none. */
  horizonS: number
}

export const PROJECTION: ProjectionConfig = { horizonS: SCORING.closing.entryZeroMin * 60 }
