/**
 * Pattern-of-life detectors (scope §6, PR 05a): loiter dwell, orbit, and area revisit, each a
 * pure function of a track's **position history** — where it has been at the frame-grid instants
 * of the last few minutes — and nothing else. No React, no DOM, no I/O, no clock; every number
 * comes from `config/scoring.ts`.
 *
 * **Positions only** (ruled on #5, note 1). Heading and speed are derived here from consecutive
 * positions rather than read off the track, so a hovering drone's null heading is no obstacle
 * and a reported kinematic is never trusted over the path it actually flew. The input carries no
 * label of any kind: the generator's `behavior` is the answer key the tests grade against, never
 * an input, and a real aircraft's history is read by the same three functions.
 *
 * Each detector returns a 0–100 value and, when it has anything to say, the evidence in observed
 * terms — a dwell, a turn, a return. The factor is the strongest detector; the *kind* is named
 * only past a threshold, and the naming is the only verdict here: the detail line never carries
 * the word, so a breakdown row on a cooperative aircraft reads its evidence and no more (note 1,
 * amendment a).
 */

import type { PatternKind, ScoringConfig } from '../config/scoring.ts'
import { bearingDegrees, distanceMeters } from './geo.ts'

export type { PatternKind }

/** One known position of a track at a scenario instant. */
export interface HistorySample {
  tSec: number
  position: [number, number]
}

/** Oldest first, ending on where the track is now. */
export type TrackHistory = readonly HistorySample[]

/** Every track's history at one instant, by id — what rides into the scorer's context. */
export type TrackHistories = Readonly<Record<string, TrackHistory>>

export type PatternConfig = ScoringConfig['pattern']

export interface PatternReading {
  /** The named pattern, or null when no detector clears its naming threshold. */
  kind: PatternKind | null
  /** The strongest detector's 0–100 value — the factor's value. */
  value: number
  /** The strongest detector's evidence, in observed terms; no verdict word. */
  detail: string
  loiter: number
  orbit: number
  revisit: number
}

const clamp = (value: number) => Math.max(0, Math.min(100, value))

/** `4 min 15 s`, or `45 s` under a minute — the dwell and the turn as the detail prints them. */
export function formatSpan(seconds: number): string {
  const whole = Math.round(seconds)
  const minutes = Math.floor(whole / 60)
  return minutes > 0 ? `${minutes} min ${whole % 60} s` : `${whole} s`
}

/**
 * Loiter dwell: the longest trailing run of samples that all lie within `radiusM` of their own
 * centroid, in seconds. A drone holding position keeps every recent sample in one small circle
 * however its heading wanders; a slow straight line leaves the circle after `radiusM / speed`
 * seconds, which is what `minS` is set above.
 */
export function loiterDwell(history: TrackHistory, config: PatternConfig['loiter']): number {
  let dwell = 0
  for (let start = history.length - 2; start >= 0; start--) {
    const run = history.slice(start)
    const centroid: [number, number] = [
      run.reduce((sum, sample) => sum + sample.position[0], 0) / run.length,
      run.reduce((sum, sample) => sum + sample.position[1], 0) / run.length,
    ]
    if (run.some((sample) => distanceMeters(centroid, sample.position) > config.radiusM)) break
    dwell = history[history.length - 1].tSec - history[start].tSec
  }
  return dwell
}

/**
 * Orbit: the trailing run of turns in one direction. Each leg between consecutive samples at
 * least 5 m apart has a bearing; each turn is the signed change between consecutive legs; the
 * run is the trailing sequence of turns of one sign, each at least `minTurnDeg`. Returns the
 * cumulative turn held and how long the turning legs lasted — a U-turn is 180° in 45 s and an
 * orbit is a steady rate held for minutes, and `minS` is what tells them apart.
 */
export function heldTurn(
  history: TrackHistory,
  config: PatternConfig['orbit'],
): { turnDeg: number; heldS: number } {
  const legs: { bearing: number; durationS: number }[] = []
  for (let i = 1; i < history.length; i++) {
    const [from, to] = [history[i - 1], history[i]]
    if (distanceMeters(from.position, to.position) < 5) continue
    legs.push({
      bearing: bearingDegrees(from.position, to.position),
      durationS: to.tSec - from.tSec,
    })
  }
  let turnDeg = 0
  let heldS = 0
  let sign = 0
  for (let i = legs.length - 1; i >= 1; i--) {
    const delta = ((((legs[i].bearing - legs[i - 1].bearing) % 360) + 540) % 360) - 180
    if (Math.abs(delta) < config.minTurnDeg) break
    if (sign === 0) sign = Math.sign(delta)
    if (Math.sign(delta) !== sign) break
    turnDeg += Math.abs(delta)
    heldS += legs[i].durationS
  }
  return { turnDeg, heldS }
}

/**
 * Area revisit: the track is now within `radiusM` of a position it held at least `gapS` ago and
 * was at least `excursionM` from in between — it left and came back. Returns the return, or
 * null. A hover never leaves, so it never revisits; a grid sweep's return lane and an out-and-
 * back both do.
 */
export function revisit(
  history: TrackHistory,
  config: PatternConfig['revisit'],
): { distanceM: number; gapS: number } | null {
  const now = history[history.length - 1]
  for (let i = 0; i < history.length - 1; i++) {
    const earlier = history[i]
    if (now.tSec - earlier.tSec < config.gapS) break
    const distanceM = distanceMeters(earlier.position, now.position)
    if (distanceM > config.radiusM) continue
    for (let k = i + 1; k < history.length - 1; k++) {
      if (distanceMeters(earlier.position, history[k].position) >= config.excursionM) {
        return { distanceM, gapS: now.tSec - earlier.tSec }
      }
    }
  }
  return null
}

/**
 * The three detectors over one history, combined: the factor's value is the strongest, its
 * detail is that detector's evidence, and the kind is named only past the thresholds — loiter
 * and revisit at `onset`, orbit past `nameDeg` held (ruled on #5, note 1b). Fewer than two
 * samples is no history yet.
 */
export function detectPattern(history: TrackHistory, config: PatternConfig): PatternReading {
  if (history.length < 2) {
    return { kind: null, value: 0, detail: 'no history yet', loiter: 0, orbit: 0, revisit: 0 }
  }
  const dwellS = loiterDwell(history, config.loiter)
  const loiter = clamp(
    (100 * (dwellS - config.loiter.minS)) / (config.loiter.fullS - config.loiter.minS),
  )
  const turn = heldTurn(history, config.orbit)
  const orbit =
    turn.heldS >= config.orbit.minS ? clamp((100 * turn.turnDeg) / config.orbit.fullDeg) : 0
  const back = revisit(history, config.revisit)
  const revisited = back ? 100 : 0

  const readings: { kind: PatternKind; value: number; named: boolean; detail: string }[] = [
    {
      kind: 'loiter',
      value: loiter,
      named: loiter >= config.onset,
      detail: `within ${config.loiter.radiusM} m for ${formatSpan(dwellS)}`,
    },
    {
      kind: 'orbit',
      value: orbit,
      named: orbit > 0 && turn.turnDeg > config.orbit.nameDeg,
      detail: `turned ${Math.round(turn.turnDeg)}° one way over ${formatSpan(turn.heldS)}`,
    },
    {
      kind: 'revisit',
      value: revisited,
      named: revisited >= config.onset,
      detail: back
        ? `back within ${Math.round(back.distanceM)} m of a point left ${formatSpan(back.gapS)} ago`
        : '',
    },
  ]
  // The factor's value is the strongest reading; the kind is the strongest *named* reading, so
  // a dwell past its threshold is not silenced by a turn that is stronger but short of its own
  // (#80 review). The list order breaks a tie, so a hover that also traces an arc reads as the
  // dwell it is. The detail follows the named kind when there is one, else the strongest.
  const byValue = [...readings].sort((a, b) => b.value - a.value)
  const lead = byValue.find((reading) => reading.named) ?? byValue[0]
  const span = history[history.length - 1].tSec - history[0].tSec
  return {
    kind: lead.named ? lead.kind : null,
    value: byValue[0].value,
    detail:
      lead.value > 0 ? lead.detail : `no dwell, held turn, or return over ${formatSpan(span)}`,
    loiter,
    orbit,
    revisit: revisited,
  }
}
