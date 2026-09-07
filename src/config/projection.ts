/**
 * Time to entry (#102, ruled): how far ahead the dead-reckoned path is followed for an entry
 * into a protected site. Configuration, not code (§4.4), in its own file as `alerts.ts` is — a
 * display value the scorer never reads has no place among the weights and curves in
 * `scoring.ts`, and `replay.ts` is the clock's, not the picture's.
 */

export interface ProjectionConfig {
  /** The horizon, seconds: an entry later than this reads as none. */
  horizonS: number
}

export const PROJECTION: ProjectionConfig = { horizonS: 600 }
