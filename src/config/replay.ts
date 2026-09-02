/**
 * The replay's doctrine (scope §5.1, PR 06a) — configuration, not code (§4.4), like the AO and
 * the scoring numbers. Two values the playback reads and nothing in the scoring path does.
 */

export interface ReplayConfig {
  /**
   * How long a cooperative track is held at its last sample before it leaves the picture, in
   * seconds since that sample was heard. The aggregator itself coasts a track to 60 s (the
   * recording's own `seen` values run up to exactly that), so 90 s is one sample past what the
   * feed already does — a public referent rather than doctrine invented here (ruled on #6).
   * The same window bounds an interior gap the interpolator will bridge.
   */
  coastS: number
  /** Wall milliseconds between replay ticks; each tick advances the sim clock one second. */
  tickMs: number
  /** How far back the selected track's history trail reaches, seconds (06b). */
  trailS: number
}

export const REPLAY: ReplayConfig = { coastS: 90, tickMs: 1000, trailS: 120 }
