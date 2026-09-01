/**
 * The §7.1 incident lifecycle, pure: the transition table, the guard, and the per-track event
 * log. No React, no DOM, no clock — `at` and `tSec` are inputs, which is the seam PR 06 uses to
 * swap wall time for playback time. Client state only; nothing persists or transmits (§2).
 *
 * The log doubles as the Phase 3b training signal (§8.3b): `observed` is what the operator saw
 * when they acted — observed or derived fields only, never `behavior` or `remoteId`, which are
 * the answer key. A scorer or learner fed the answer key detects nothing; see the rule on #4.
 * Status is derived from the log's last entry rather than stored beside it, so the badge on
 * screen can never disagree with the record.
 */

import type { ContactId } from '../config/contacts.ts'
import type { DispositionId } from '../config/dispositions.ts'
import type { RankedTrack } from './ranking.ts'
import type { Identity } from './tracks.ts'

export type Status = 'new' | 'assessing' | 'escalated' | 'resolved' | 'dismissed'
export type LifecycleAction = 'assess' | 'escalate' | 'dismiss' | 'resolve'

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

/** What the operator saw when they acted (§8.3b) — the only features a label may carry. */
export interface ObservedSnapshot {
  identity: Identity
  rangeM: number
  altitudeFt: number | null
  groundSpeedKt: number | null
  /** Always null until PR 04 scores the picture; typed so the learner sees the field coming. */
  score: null
}

export interface TrackEvent {
  trackId: string
  /** Per track, from 1. */
  seq: number
  /** Wall clock, ISO — supplied by the caller, never read from a clock here. */
  at: string
  /** Scenario time in seconds; 0 until PR 06 runs the replay clock. */
  tSec: number
  action: 'first-seen' | LifecycleAction
  from: Status | null
  to: Status
  recipient?: ContactId
  disposition?: DispositionId
  observed: ObservedSnapshot
}

/** The observed-or-derived fields of a ranked track, snapshotted for the log. */
export const observedSnapshot = ({ track, rangeM }: RankedTrack): ObservedSnapshot => ({
  identity: track.identity,
  rangeM,
  altitudeFt: track.altitudeFt,
  groundSpeedKt: track.groundSpeedKt,
  score: null,
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
