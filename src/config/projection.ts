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
  /**
   * How far the map draws a course that meets no ring, metres (S10, #182; #192, ruled 1): the
   * rule stays the horizon, and the line stops here — past the map's edge at the working zoom
   * for anything the study flies, where an airliner's twenty minutes would run 278 km.
   */
  runOutM: number
}

export const PROJECTION: ProjectionConfig = {
  horizonS: SCORING.closing.entryZeroMin * 60,
  runOutM: 25_000,
}
