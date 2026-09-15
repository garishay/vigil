/**
 * Time to entry (#102, ruled): how far ahead the dead-reckoned path is followed for an entry
 * into a protected site — the Entry row's horizon. Configuration, not code (§4.4), in its own
 * file as `alerts.ts` is: the scorer reads the projection's geometry (`entryAt`, S3a) but never
 * this horizon — the factor's own is `closing.entryZeroMin` in `scoring.ts`, among the weights
 * and curves — and `replay.ts` is the clock's, not the picture's.
 */

export interface ProjectionConfig {
  /** The horizon, seconds: an entry later than this reads as none. */
  horizonS: number
}

export const PROJECTION: ProjectionConfig = { horizonS: 600 }
