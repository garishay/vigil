/**
 * The §7.1 incident lifecycle, pure: the transition table, the guard, and the per-track event
 * log. No React, no DOM, no clock — `at` and `tSec` are inputs, which is the seam the replay
 * clock drives. Client state only; nothing persists or transmits (§2).
 *
 * The log doubles as the Phase 3b training signal (§8.3b): `observed` is what the operator saw
 * when they acted — observed or derived fields only, never `behavior` or `remoteId`, which are
 * the answer key. A scorer or learner fed the answer key detects nothing; see the rule on #4.
 * Status is derived from the log's last entry rather than stored beside it, so the badge on
 * screen can never disagree with the record.
 *
 * Two kinds of entry share the log (06b, ruled on #6): the operator's actions, which move the
 * status, and observations — first sight, a **band crossing**, and a **pattern change** (05b)
 * — which carry the status unchanged. A crossing is what a recipient wants to know ("first
 * warning 02:33:00"); it is logged in either direction, on a terminal track too, and it is never
 * a lifecycle change. A pattern's onset and end are logged the same way, against the pattern the
 * record last saw; a track first seen with a pattern already named carries the word on its
 * first-seen entry instead (ruled on #5).
 *
 * **Re-surface** (05b, ruled on #5): a Dismissed track surfaces on the Queue row when, since its
 * dismissal, the record shows an upward crossing or a pattern onset — read off the log, never a
 * new state, and never on a real aircraft, keyed on the observed source as the ceiling is: on a
 * cooperative aircraft a pattern is ordered rather than surfaced (4A).
 *
 * **Lost and Regained** (ruled on #71): a track with a non-terminal status that coasts out of
 * the picture logs one line, **Lost**, at sim time, carrying the picture as the operator last
 * saw it and the sim time the recording last heard it — the fact the next operator needs, true
 * whenever the line is stamped (#36 [11]). A terminal track logs nothing: its record is closed. A lost track
 * heard again logs **Regained** with the return picture, and the crossing and pattern change of
 * that pass are read against the record before it, so what moved across the hole is written
 * down rather than absorbed. Both are observations: statuses carried, forward-only.
 */

import type { SiteRecord } from '../config/ao.ts'
import type { ContactId } from '../config/contacts.ts'
import type { DispositionId } from '../config/dispositions.ts'
import {
  BANDS,
  SCORING,
  type Band,
  type FactorId,
  type PatternKind,
  type ScoringConfig,
} from '../config/scoring.ts'
import type { RankedTrack } from './ranking.ts'
import { bandOf } from './scoring.ts'
import type { Identity, Track } from './tracks.ts'

export type Status = 'new' | 'assessing' | 'escalated' | 'resolved' | 'dismissed'
export type LifecycleAction = 'assess' | 'escalate' | 'dismiss' | 'resolve'
/** What the picture did, as opposed to what the operator did. */
export type ObservationEvent = 'first-seen' | 'band' | 'pattern' | 'lost' | 'regained'

/** Statuses in lifecycle order — the state filter lists them, the labels render them. */
export const STATUSES = [
  'new',
  'assessing',
  'escalated',
  'resolved',
  'dismissed',
] as const satisfies readonly Status[]

export const STATUS_LABEL: Record<Status, string> = {
  new: 'New',
  assessing: 'Assessing',
  escalated: 'Escalated',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
}

/**
 * The table as ruled on #3: Assess claims a New track; Escalate only from Assessing — a track is
 * claimed before it is handed off; Resolve only from Escalated, with a disposition; Dismiss from
 * New or Assessing. Resolved and Dismissed are terminal for MVP — no reopen.
 */
const TRANSITIONS: Record<Status, Partial<Record<LifecycleAction, Status>>> = {
  new: { assess: 'assessing', dismiss: 'dismissed' },
  assessing: { escalate: 'escalated', dismiss: 'dismissed' },
  escalated: { resolve: 'resolved' },
  resolved: {},
  dismissed: {},
}

export const canAct = (status: Status, action: LifecycleAction): boolean =>
  TRANSITIONS[status][action] !== undefined

/**
 * Terminal iff the table permits no action from it — derived rather than listed, and by the same
 * test `canAct` applies (an entry is a transition only if it is defined), so the Queue's dim and
 * its Active chip (03e) cannot disagree with the buttons the drawer enables.
 */
export const isTerminal = (status: Status): boolean =>
  Object.values(TRANSITIONS[status]).every((next) => next === undefined)

/** The next status, or a throw on a transition the table does not allow. */
export function transition(status: Status, action: LifecycleAction): Status {
  const next = TRANSITIONS[status][action]
  if (!next) throw new Error(`illegal lifecycle transition: ${action} from ${status}`)
  return next
}

/**
 * What the operator saw when they acted (§8.3b) — observed features, and the doctrine in force
 * when they were scored — never assigned labels.
 */
export interface ObservedSnapshot {
  identity: Identity
  rangeM: number
  /**
   * The site `rangeM` was measured to — the nearest at the time — so a frozen range is never
   * captioned with whichever site is nearest later (#75 review). An id, resolved at display.
   */
  siteId: string
  altitudeFt: number | null
  groundSpeedKt: number | null
  /** Degrees true, or null when unreported — the handoff prints it, so the record keeps it (06b). */
  headingDeg: number | null
  /** The composite the operator saw, 0–100 after the ceiling. */
  score: number
  /**
   * The composite before the ceiling — equal to `score` unless the ADS-B cap bound, so the
   * record reconciles with its own factors and a learner can tell the cap from a bug (#63
   * review). Capped is the inequality; no flag.
   */
  uncapped: number
  /** Each factor's 0–100 value at action time — what §8.3b learns from (ruled on #4). */
  factors: Record<FactorId, number>
  /**
   * The pattern the history named when the operator acted, or null (05b). Derived, and seen —
   * it is the word on the row's tag — so it is part of the moment by the #36 [8] reasoning.
   */
  pattern: PatternKind | null
  /**
   * The weight set the factors were scored under. Doctrine rather than a reading, and in the
   * record for the reason the breakdown puts contribution over weight: the operator saw it, so
   * it is part of the moment. Without it an event stops reconciling the first time a weight
   * moves — PR 07's sliders, or any doctrine edit — and a learner cannot tell a re-weighted
   * picture from a scoring bug (ruled on #36 [8], #64).
   */
  weights: Record<FactorId, number>
  /**
   * The site set the track was scored against — id, kind, tier, centre, radius, and the name
   * (08a, ruled on #86): what the operator saw, by the same reasoning as the weights, so the
   * frozen handoff still names a site removed after the escalation and a learner knows which
   * geometry produced the label.
   */
  sites: readonly SiteRecord[]
  /**
   * The friendly-launch condition at the moment (08b): first seen inside a friendly area and
   * heard. Derived from two observations, and seen — it is the word the tag leads with and the
   * line the cap prints — so it is part of the moment, and the frozen handoff prints its cap.
   */
  friendly: boolean
}

export interface TrackEvent {
  trackId: string
  /** Per track, from 1. */
  seq: number
  /** Wall clock, ISO — supplied by the caller, never read from a clock here. */
  at: string
  /** Scenario time in seconds, from the replay clock. */
  tSec: number
  action: ObservationEvent | LifecycleAction
  from: Status | null
  to: Status
  recipient?: ContactId
  disposition?: DispositionId
  /** The crossing, on a `band` entry only: which band the score left and which it entered. */
  band?: { from: Band; to: Band }
  /** The change, on a `pattern` entry only: the pattern the record last saw and the one now. */
  pattern?: { from: PatternKind | null; to: PatternKind | null }
  /**
   * On a `lost` entry only: the sim time, in seconds, the recording last heard the track — the
   * last message before the loss, not the tick the fold noticed the absence, so the line reads
   * true whether the entry was stamped by play or by a seek across the loss (#36 [11]).
   */
  lost?: { lastHeardTSec: number }
  observed: ObservedSnapshot
}

/** The observed-or-derived fields of a ranked track, snapshotted for the log. */
export const observedSnapshot = ({
  track,
  rangeM,
  siteId,
  score,
}: RankedTrack): ObservedSnapshot => ({
  identity: track.identity,
  rangeM,
  siteId,
  altitudeFt: track.altitudeFt,
  groundSpeedKt: track.groundSpeedKt,
  headingDeg: track.headingDeg,
  score: score.composite,
  uncapped: score.uncapped,
  pattern: score.pattern,
  factors: Object.fromEntries(score.factors.map((factor) => [factor.id, factor.value])) as Record<
    FactorId,
    number
  >,
  weights: Object.fromEntries(score.factors.map((factor) => [factor.id, factor.weight])) as Record<
    FactorId,
    number
  >,
  sites: score.sites,
  friendly: score.friendly,
})

/** Every track starts New: a log opens with its synthetic first-seen entry. */
export const firstSeen = (
  trackId: string,
  observed: ObservedSnapshot,
  at: string,
  tSec = 0,
): TrackEvent[] => [
  { trackId, seq: 1, at, tSec, action: 'first-seen', from: null, to: 'new', observed },
]

/** A track's status is its last event's `to` — the log is the single source of truth. */
export const statusOf = (log: readonly TrackEvent[] | undefined): Status =>
  log && log.length > 0 ? log[log.length - 1].to : 'new'

/**
 * The band the record last saw for a track: its last entry's score, banded the way the chip
 * bands it. Read off the score rather than stored, so a crossing is detected against what the
 * record says and nothing else.
 */
export const lastBand = (
  log: readonly TrackEvent[],
  bands: ScoringConfig['bands'] = SCORING.bands,
) => bandOf(Math.round(log[log.length - 1].observed.score), bands)

/**
 * The log with a band crossing appended, or null when the band the record last saw is the band
 * the entry is in now. Statuses ride unchanged — a crossing is never a lifecycle change — so
 * `statusOf` reads through it. Compared against the last entry rather than the previous tick, so
 * a seek logs at most one crossing rather than every intermediate band.
 *
 * **Forward only.** A crossing is derived from the picture, and a rewound picture is the past
 * the record already holds: a band read at a sim time earlier than the last entry's is not
 * logged, so re-watching never writes a contradictory line beneath a later one (#75 review).
 * The operator's own actions are stamped when they are taken, whatever the clock reads.
 */
export function bandCrossing(
  log: readonly TrackEvent[],
  entry: RankedTrack,
  at: string,
  tSec: number,
  bands: ScoringConfig['bands'] = SCORING.bands,
): TrackEvent[] | null {
  if (log.length === 0) throw new Error('bandCrossing needs a log opened by firstSeen')
  if (tSec < log[log.length - 1].tSec) return null
  const from = lastBand(log, bands)
  const to = entry.score.band
  if (from === to) return null
  const status = statusOf(log)
  return [
    ...log,
    {
      trackId: log[0].trackId,
      seq: log.length + 1,
      at,
      tSec,
      action: 'band',
      from: status,
      to: status,
      band: { from, to },
      observed: observedSnapshot(entry),
    },
  ]
}

/** The pattern the record last saw for a track — its last entry's snapshot. */
export const lastPattern = (log: readonly TrackEvent[]): PatternKind | null =>
  log[log.length - 1].observed.pattern

/**
 * The log with a pattern change appended, or null when the pattern the record last saw is the
 * pattern named now — the crossing's shape exactly (05b, ruled on #5): statuses carried, on a
 * terminal track too, compared against the last entry so a seek logs at most one change, and
 * forward-only. A track opened with a pattern already named carries it on its first-seen entry
 * and logs no onset here.
 */
export function patternChange(
  log: readonly TrackEvent[],
  entry: RankedTrack,
  at: string,
  tSec: number,
): TrackEvent[] | null {
  if (log.length === 0) throw new Error('patternChange needs a log opened by firstSeen')
  if (tSec < log[log.length - 1].tSec) return null
  const from = lastPattern(log)
  const to = entry.score.pattern
  if (from === to) return null
  const status = statusOf(log)
  return [
    ...log,
    {
      trackId: log[0].trackId,
      seq: log.length + 1,
      at,
      tSec,
      action: 'pattern',
      from: status,
      to: status,
      pattern: { from, to },
      observed: observedSnapshot(entry),
    },
  ]
}

/**
 * Whether a track absent from the picture at `tSec` is owed a Lost line: its status is not
 * terminal, its record does not already end on one, and the clock is at or past the record's
 * frontier. The frontier test is load-bearing here rather than a courtesy: rewound to before a
 * track's first sight, the picture shows it absent, and this is what keeps that from writing
 * Lost. The fold reads it so its predicate settles without a write.
 */
export const canLose = (log: readonly TrackEvent[], tSec: number): boolean => {
  const last = log[log.length - 1]
  return tSec >= last.tSec && last.action !== 'lost' && !isTerminal(statusOf(log))
}

/** Whether a track in the picture at `tSec` is owed a Regained line: its record ends on Lost. */
export const canRegain = (log: readonly TrackEvent[], tSec: number): boolean => {
  const last = log[log.length - 1]
  return last.action === 'lost' && tSec >= last.tSec
}

/**
 * The log with a Lost line appended, or null when `canLose` says nothing is owed (ruled on #71).
 * `lastDrawn` is the picture as the operator last saw the track — under play, the last sample
 * held to the coast's edge — since a loss is observed as an absence and there is nothing else
 * to snapshot. Statuses carried: a loss is not a lifecycle transition, and the §7.1 table gains
 * no state.
 */
export function lost(
  log: readonly TrackEvent[],
  lastDrawn: ObservedSnapshot,
  at: string,
  tSec: number,
  lastHeardTSec: number,
): TrackEvent[] | null {
  if (log.length === 0) throw new Error('lost needs a log opened by firstSeen')
  if (!canLose(log, tSec)) return null
  const status = statusOf(log)
  return [
    ...log,
    {
      trackId: log[0].trackId,
      seq: log.length + 1,
      at,
      tSec,
      action: 'lost',
      from: status,
      to: status,
      lost: { lastHeardTSec },
      observed: lastDrawn,
    },
  ]
}

/**
 * The log with a Regained line appended, or null when the record does not end on Lost or the
 * clock is behind it (ruled on #71). It carries the return picture; the caller reads the pass's
 * crossing and pattern change against the record before it, so a band left or a pattern ended
 * across the hole is logged after this line rather than absorbed into it.
 */
export function regained(
  log: readonly TrackEvent[],
  entry: RankedTrack,
  at: string,
  tSec: number,
): TrackEvent[] | null {
  if (log.length === 0) throw new Error('regained needs a log opened by firstSeen')
  if (!canRegain(log, tSec)) return null
  const status = statusOf(log)
  return [
    ...log,
    {
      trackId: log[0].trackId,
      seq: log.length + 1,
      at,
      tSec,
      action: 'regained',
      from: status,
      to: status,
      observed: observedSnapshot(entry),
    },
  ]
}

/**
 * Whether a Dismissed track has re-surfaced (05b, ruled on #5): since its dismissal the record
 * shows an upward band crossing or a pattern onset. Read off the log — the status stays
 * Dismissed and the §7.1 table gains nothing — and never true of a real aircraft, keyed on the
 * observed source exactly as the ceiling is (#82 review): an airliner under the ceiling is not
 * capped, and on a cooperative aircraft a pattern is ordered, not surfaced (4A). Never a track
 * under the friendly-launch condition either (08b, ruled on #86) — keyed on the condition, not on
 * the cap having bound, as the cooperative rule is; once the ident lapses the guard lifts with it.
 */
export function resurfaced(
  log: readonly TrackEvent[] | undefined,
  source: Track['source'],
  friendly = false,
): boolean {
  if (source === 'adsb' || friendly || !log || statusOf(log) !== 'dismissed') return false
  const dismissedAt = log.findLastIndex((event) => event.action === 'dismiss')
  return log
    .slice(dismissedAt + 1)
    .some(
      (event) =>
        (event.action === 'band' &&
          event.band !== undefined &&
          BANDS.indexOf(event.band.to) > BANDS.indexOf(event.band.from)) ||
        (event.action === 'pattern' && event.pattern?.to != null),
    )
}

export interface ActionInput {
  at: string
  tSec: number
  observed: ObservedSnapshot
  recipient?: ContactId
  disposition?: DispositionId
}

/**
 * The log with one operator action appended. Throws on an illegal transition, an escalation
 * without a recipient, or a resolution without a disposition — the UI disables those buttons,
 * and the module refuses them anyway. A recipient or disposition passed with any other action is
 * dropped, so the record carries each field only where the action defines it.
 */
export function appendEvent(
  log: readonly TrackEvent[],
  action: LifecycleAction,
  input: ActionInput,
): TrackEvent[] {
  if (log.length === 0) throw new Error('appendEvent needs a log opened by firstSeen')
  if (action === 'escalate' && !input.recipient) throw new Error('escalate needs a recipient')
  if (action === 'resolve' && !input.disposition) throw new Error('resolve needs a disposition')
  const from = statusOf(log)
  return [
    ...log,
    {
      trackId: log[0].trackId,
      seq: log.length + 1,
      at: input.at,
      tSec: input.tSec,
      action,
      from,
      to: transition(from, action),
      ...(action === 'escalate' ? { recipient: input.recipient } : {}),
      ...(action === 'resolve' ? { disposition: input.disposition } : {}),
      observed: input.observed,
    },
  ]
}
