import { useEffect, useRef, useState } from 'react'
import { IdentityDot } from './IdentityDot'
import type { ProtectedSite } from '../config/ao'
import type { ContactId } from '../config/contacts'
import type { DispositionId } from '../config/dispositions'
import { LAYER_BADGE, describeEvent, eventClock, formatRangeKm, trackIdent } from '../lib/display'
import { handoffText } from '../lib/handoff'
import { IDENTITY_LABEL } from '../lib/identity'
import {
  STATUS_LABEL,
  canAct,
  statusOf,
  type LifecycleAction,
  type TrackEvent,
} from '../lib/lifecycle'
import type { RankedTrack } from '../lib/ranking'

/** A kinematic value, or an em dash for one the track did not broadcast — never a zero (§7). */
const dash = (value: string | null) => value ?? '—'

const ACTIONS: { action: LifecycleAction; label: string }[] = [
  { action: 'assess', label: 'Assess' },
  { action: 'escalate', label: 'Escalate' },
  { action: 'dismiss', label: 'Dismiss' },
  { action: 'resolve', label: 'Resolve' },
]

/**
 * One inline choose-and-confirm block, used by Escalate (recipient) and Resolve (disposition).
 * Cancel backs out with no event logged (ruled on #3); Confirm stays disabled until a choice is
 * made, so neither action can fire without the field the record requires.
 */
function Picker<Id extends string>({
  legend,
  options,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  legend: string
  options: readonly { id: Id; label: string }[]
  confirmLabel: string
  onConfirm: (id: Id) => void
  onCancel: () => void
}) {
  const [choice, setChoice] = useState<Id | null>(null)
  return (
    <fieldset className="drawer__picker">
      <legend>{legend}</legend>
      {options.map((option) => (
        <label className="drawer__option" key={option.id}>
          <input
            type="radio"
            name={legend}
            value={option.id}
            checked={choice === option.id}
            onChange={() => setChoice(option.id)}
          />
          {option.label}
        </label>
      ))}
      <div className="drawer__confirm">
        <button
          type="button"
          className="drawer__action"
          disabled={choice === null}
          onClick={() => choice !== null && onConfirm(choice)}
        >
          {confirmLabel}
        </button>
        <button type="button" className="drawer__action" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </fieldset>
  )
}

/**
 * The Review drawer (§7, PR 03): everything known about one track, observed or derived, plus the
 * §7.1 lifecycle — status, actions, escalation handoff, and the per-track event log. Its own
 * column beside the Queue, so the operator never loses the list to read a track (§4.2); the
 * Review surface shows the same component alone, at the same 26 rem (ruled B1 on #3).
 *
 * Reserved here, filled later: the Track Visuals slot (03c), the score breakdown (PR 04), the
 * history trail's content (PR 06 — at a static frame 0 there is exactly one known position).
 *
 * The caller keys this component by track id, so picker and copied state belong to one track.
 */
export function ReviewDrawer({
  entry,
  sites,
  log,
  contacts,
  dispositions,
  onAction,
  onClose,
}: {
  entry: RankedTrack
  sites: ProtectedSite[]
  log: readonly TrackEvent[]
  contacts: readonly { id: ContactId; name: string }[]
  dispositions: readonly { id: DispositionId; label: string }[]
  onAction: (
    action: LifecycleAction,
    detail?: { recipient?: ContactId; disposition?: DispositionId },
  ) => void
  onClose: () => void
}) {
  const { track, rank, rangeM } = entry
  const status = statusOf(log)
  // Escalate and Resolve gather a required field before they act; the other two fire directly.
  const [pending, setPending] = useState<'escalate' | 'resolve' | null>(null)
  // "Copied" is a claim about the current text: an event appended after the copy regenerates the
  // handoff, and the button honestly reverts to "Copy".
  const [copiedText, setCopiedText] = useState<string | null>(null)
  const handoffRef = useRef<HTMLTextAreaElement>(null)
  const asideRef = useRef<HTMLElement>(null)

  // A keyboard operator must not be dropped on document.body mid-walk: the activated action
  // re-renders disabled (browsers blur it), and Confirm/Cancel unmount under the finger. When
  // focus has fallen to body, land it on the next legal action — or Close, when the state is
  // terminal. The same guard Queue.tsx keeps for its rows (#47 review). Recovery only, never on
  // mount: engines that don't focus a clicked button (Safari) leave focus on body during plain
  // mouse use, and opening a track must not yank it into the drawer (#47 round 4).
  const mountedRef = useRef(false)
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    if (document.activeElement !== document.body) return
    const aside = asideRef.current
    const target =
      aside?.querySelector<HTMLButtonElement>('.drawer__actions button:not(:disabled)') ??
      aside?.querySelector<HTMLButtonElement>('.drawer__close')
    target?.focus?.()
  }, [status, pending])

  // Named from the site the range was actually measured to — `rangeM` is to the *nearest* site,
  // so with two sites configured, indexing `[0]` would caption one site's distance with the
  // other's name.
  const siteName = sites.find((site) => site.id === entry.siteId)?.name ?? entry.siteId
  const rows: { label: string; value: string; className?: string }[] = [
    { label: 'Status', value: STATUS_LABEL[status], className: 'drawer__status' },
    { label: 'Rank', value: `${rank}` },
    { label: 'Range', value: `${formatRangeKm(rangeM)} to ${siteName}` },
    {
      label: 'Altitude',
      value: dash(track.altitudeFt === null ? null : `${track.altitudeFt} ft`),
    },
    {
      label: 'Ground speed',
      value: dash(track.groundSpeedKt === null ? null : `${track.groundSpeedKt} kt`),
    },
    {
      label: 'Heading',
      value: dash(track.headingDeg === null ? null : `${track.headingDeg}°`),
    },
    {
      label: 'Vertical rate',
      value: dash(
        track.verticalRateFpm === null
          ? null
          : `${track.verticalRateFpm > 0 ? '+' : ''}${track.verticalRateFpm} fpm`,
      ),
    },
    { label: 'Seen', value: `${track.lastSeenSec} s ago` },
  ]

  // The panel renders from the log, not from transient UI state, so an escalated track shows its
  // handoff after Resolve, a close-and-reopen, or a surface switch — regenerated in full.
  const escalation = log.findLast((event) => event.action === 'escalate')
  const recipient = escalation && contacts.find((contact) => contact.id === escalation.recipient)
  const handoff = recipient
    ? handoffText({ entry, siteName, recipient, log, contacts, dispositions })
    : null

  const copy = async () => {
    if (handoff === null) return
    let copied: boolean
    try {
      await navigator.clipboard.writeText(handoff)
      copied = true
    } catch {
      // No clipboard API (or permission refused): select the visible textarea and copy that.
      // The selection stands either way, so a manual Ctrl+C works when even this path fails.
      handoffRef.current?.select()
      copied = document.execCommand?.('copy') ?? false
    }
    // "Copied" only when a copy actually happened — a false claim here puts stale clipboard
    // content into an escalation (review finding on #47).
    setCopiedText(copied ? handoff : null)
  }

  return (
    <aside className="drawer" aria-label={`Track review: ${trackIdent(track)}`} ref={asideRef}>
      <header className="drawer__header">
        <h3 className="drawer__ident">{trackIdent(track)}</h3>
        <span className="drawer__identity">
          <IdentityDot identity={track.identity} />
          {IDENTITY_LABEL[track.identity]}
        </span>
        <span className="queue__badge" data-layer={track.source}>
          {LAYER_BADGE[track.source]}
        </span>
        {track.onGround && <span className="queue__ground">on ground</span>}
        <button type="button" className="drawer__close" onClick={onClose} aria-label="Close review">
          ×
        </button>
      </header>

      {/* Reserved for 03c: the airframe silhouette by class, photo tier for ADS-B only. */}
      <div className="drawer__slot" aria-hidden="true">
        Track Visuals — 03c
      </div>

      <dl className="drawer__kinematics">
        {rows.map((row) => (
          <div className="drawer__row" key={row.label}>
            <dt>{row.label}</dt>
            <dd className={row.className}>{row.value}</dd>
          </div>
        ))}
      </dl>

      <div className="drawer__slot">
        Score — <span className="drawer__pending">factors arrive with PR 04</span>
      </div>

      <p className="drawer__history">
        History: 1 known position (frame 0) — the trail fills when the clock runs (PR 06).
      </p>

      {/* Disabled rather than hidden, so the whole action vocabulary stays visible (§7.1). */}
      <div className="drawer__actions" role="group" aria-label="Lifecycle actions">
        {ACTIONS.map(({ action, label }) => (
          <button
            key={action}
            type="button"
            className="drawer__action"
            disabled={!canAct(status, action)}
            onClick={() => {
              if (action === 'escalate' || action === 'resolve') setPending(action)
              else {
                onAction(action)
                setPending(null)
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {pending === 'escalate' && (
        <Picker
          legend="Escalate to:"
          confirmLabel="Confirm escalation"
          options={contacts.map((contact) => ({ id: contact.id, label: contact.name }))}
          onConfirm={(recipientId) => {
            onAction('escalate', { recipient: recipientId })
            setPending(null)
          }}
          onCancel={() => setPending(null)}
        />
      )}
      {pending === 'resolve' && (
        <Picker
          legend="Resolve as:"
          confirmLabel="Confirm resolution"
          options={dispositions}
          onConfirm={(dispositionId) => {
            onAction('resolve', { disposition: dispositionId })
            setPending(null)
          }}
          onCancel={() => setPending(null)}
        />
      )}

      {handoff !== null && (
        <section className="drawer__handoff" aria-label="Handoff summary">
          <div className="drawer__subhead">
            <h4 className="drawer__subtitle">Handoff — copyable</h4>
            <button type="button" className="drawer__action" onClick={() => void copy()}>
              {copiedText === handoff ? 'Copied' : 'Copy'}
            </button>
          </div>
          <textarea
            ref={handoffRef}
            className="drawer__handofftext"
            readOnly
            value={handoff}
            rows={handoff.split('\n').length}
            aria-label="Handoff text"
          />
        </section>
      )}

      <section className="drawer__events" aria-label="Event log">
        <h4 className="drawer__subtitle">Event log</h4>
        <ol className="drawer__log">
          {log.map((event) => (
            <li className="drawer__event" key={event.seq}>
              <span className="drawer__eventclock">{eventClock(event.at)}</span>
              <span>{describeEvent(event, contacts, dispositions)}</span>
            </li>
          ))}
        </ol>
      </section>
    </aside>
  )
}
