/**
 * Scoring doctrine (scope §6) — configuration, not code (§4.4). Every number the engine in
 * `src/lib/scoring.ts` turns a track into a score with lives here, so a reviewer can argue with
 * the weights, the curves, the bands, or the ceiling without reading the module, and so the PR 07
 * slider panel has one object to edit.
 *
 * The curves are public first principles only (§2): CPA/TCPA geometry against the protected
 * site, range roll-offs in units of the site's own ring, and the Part 107 envelope the kinematic
 * class already reads from `airframes.ts`. Nothing here encodes a work system's doctrine.
 */

/** The factors, in the order the breakdown lists them: the five of 04a and the pattern row of 05a. */
export type FactorId = 'cooperativity' | 'closing' | 'proximity' | 'pattern' | 'kinematic' | 'time'

export type Band = 'calm' | 'caution' | 'warning'

/** The bands in ascending order — what "up" and "down" mean for a crossing (06b). */
export const BANDS = ['calm', 'caution', 'warning'] as const satisfies readonly Band[]

/** The band word as a line of the record prints it (06b) — one table, so a rename flows through. */
export const BAND_LABEL: Record<Band, string> = {
  calm: 'Calm',
  caution: 'Caution',
  warning: 'Warning',
}

export interface ScoringConfig {
  /** §6 default weights. The composite normalizes by their sum, so the scale is always 0–100. */
  weights: Record<FactorId, number>
  /**
   * The cooperativity spectrum, as factor values: ADS-B near the floor, a heard Remote ID low,
   * a track that has gone quiet degrading toward Unknown, a track never heard at the top.
   * `dwellS` holds the heard value after the last ident; `decayS` is the linear run from there
   * to the Unknown plateau. Both are observed history — nothing reads the generator's label.
   */
  cooperativity: {
    adsb: number
    heard: number
    unknown: number
    silent: number
    dwellS: number
    decayS: number
  }
  /**
   * Closing geometry: CPA scores 100 at or inside the ring and rolls off to 0 at `cpaRolloffRadii`
   * ring radii; time-to-CPA scores 100 at or under `tcpaFullMin` and rolls off to 0 at
   * `tcpaZeroMin`. The factor is their product, so a track has to be both heading in and near.
   */
  closing: { cpaRolloffRadii: number; tcpaFullMin: number; tcpaZeroMin: number }
  /** Proximity: 100 inside the ring, rolling off to 0 at `rolloffRadii` ring radii. */
  proximity: { rolloffRadii: number }
  /**
   * Pattern of life (05a, ruled on #5): three detectors over a track's position history — the
   * frame-grid instants of the last `windowS` seconds — and the factor is the strongest of them.
   * Loiter dwell: the longest trailing run of positions that all lie within `radiusM` of their
   * own centroid, worth 0 at `minS` and 100 at `fullS`. Orbit: the trailing run of turns in one
   * direction, each at least `minTurnDeg` between consecutive legs, held for at least `minS`,
   * worth 100 at `fullDeg` of cumulative turn; it is named an orbit only past `nameDeg` held — a
   * departure turn of 135–180° is a turn, not an orbit. Revisit: back within `radiusM` of a
   * position held at least `gapS` ago after having been `excursionM` away in between, 100 or 0.
   * Loiter and revisit are named at `onset`. The numbers are set against the default scenario:
   * 450 m holds the golden loiter's wander (309 m × √2) and 150 s excludes a 12 kt straight line
   * and a grid sweep's U-turn; 400 m clears the lane spacing the scenario draws.
   */
  pattern: {
    windowS: number
    loiter: { radiusM: number; minS: number; fullS: number }
    orbit: { minTurnDeg: number; minS: number; fullDeg: number; nameDeg: number }
    revisit: { radiusM: number; excursionM: number; gapS: number }
    onset: number
  }
  /**
   * Kinematic profile: 100 at or inside the `KINEMATIC_CLASS` box (400 ft, 87 kt), rolling off
   * to 0 at these readings. The factor is the lower of the two, so a fast low aircraft and a slow
   * high one both leave the envelope.
   */
  kinematic: { altitudeZeroFt: number; speedZeroKt: number }
  /** Local operating hours, `HH:MM`; activity outside them scores the off-hours factor at 100. */
  operatingHours: { open: string; close: string }
  /** Composite thresholds for the chip's colour: caution at or above, warning at or above. */
  bands: { caution: number; warning: number }
  /**
   * The §2 guardrail as arithmetic: the composite of any track whose observed source is ADS-B
   * is capped here, below the caution band, and the cap prints as its own breakdown line. Keyed
   * on `source`, never on a label — an inject cannot receive it and a real aircraft cannot
   * escape it (ruled A3 on #4).
   */
  adsbCeiling: number
}

export const SCORING: ScoringConfig = {
  weights: { cooperativity: 25, closing: 20, proximity: 15, pattern: 15, kinematic: 10, time: 10 },
  cooperativity: { adsb: 5, heard: 25, unknown: 70, silent: 100, dwellS: 30, decayS: 120 },
  closing: { cpaRolloffRadii: 3, tcpaFullMin: 2, tcpaZeroMin: 20 },
  proximity: { rolloffRadii: 3 },
  pattern: {
    windowS: 420,
    loiter: { radiusM: 450, minS: 150, fullS: 300 },
    orbit: { minTurnDeg: 3, minS: 90, fullDeg: 270, nameDeg: 180 },
    revisit: { radiusM: 400, excursionM: 600, gapS: 120 },
    onset: 50,
  },
  kinematic: { altitudeZeroFt: 2000, speedZeroKt: 174 },
  operatingHours: { open: '06:00', close: '22:00' },
  bands: { caution: 40, warning: 70 },
  adsbCeiling: 30,
}
