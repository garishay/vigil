import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { IdentityDot } from './IdentityDot'
import { ScoreBreakdown } from './ScoreBreakdown'
import { TrackVisuals } from './TrackVisuals'
import type { ProtectedSite } from '../config/ao'
import type { ContactId } from '../config/contacts'
import type { DispositionId } from '../config/dispositions'
import type { PhotoLookup } from '../data/photos'
import { describeCategory } from '../lib/airframe'
import { LAYER_BADGE, describeEvent, formatRangeKm, roundHeading, trackIdent } from '../lib/display'
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

/** A value, or an em dash for one the track did not broadcast or carry — never a zero (§7). */
const dash = (value: string | null | undefined) => value || '—'

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
 * The score breakdown (04b) sits between the kinematics and the history line, which counts the
 * trail the map draws (06b). The Track Visuals slot is 03c's silhouette tier; 03d adds the photo
 * tier for ADS-B tracks. The event log and the handoff timeline read in sim time (06b): the
 * caller supplies the clock, so the drawer never knows the scenario's start.
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
  lookupPhoto,
  clock,
  trail,
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
  /** Receives the click, so the caller can read its modality (`detail`) before moving focus. */
  onClose: (event: MouseEvent<HTMLButtonElement>) => void
  /** The photo tier's lookup (03d), injected so no test reaches the network. */
  lookupPhoto: PhotoLookup
  /** Sim time as the record prints it — the event log and the handoff timeline (06b). */
  clock: (tSec: number) => string
  /** The history trail the map draws: how many known positions, over what window (06b). */
  trail: { count: number; windowS: number }
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
  // terminal. The same guard Queue.tsx keeps for its rows (#47 review). Three gates, one per
  // false-positive found in review:
  //   - only on an actual transition of the watched values — never on mount, never on
  //     StrictMode's dev remount, whose second setup re-runs with refs intact (round 5);
  //   - only for keyboard-driven interactions — a keyboard-activated click carries detail 0,
  //     a mouse click a positive count, and a mouse user whose focus was parked on a button
  //     would have Space activate it instead of scrolling (round 6). Transitions that arrive
  //     without any click (the parent re-rendering the log) keep the keyboard-safe default;
  //   - only when focus actually fell to body.
  const prevFocusKeyRef = useRef<string | null>(null)
  const keyboardIntentRef = useRef(true)
  useEffect(() => {
    const key = `${status}:${pending ?? ''}`
    const prev = prevFocusKeyRef.current
    prevFocusKeyRef.current = key
    if (prev === null || prev === key) return
    if (!keyboardIntentRef.current) return
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
  // The enrichment rows, ADS-B only — an inject has no registry. Each is labelled by provenance
  // (§5.1): the category is broadcast, the type and registration are lookups (ruled on #22).
  // Displayed and never scored; the Queue never shows them, so nothing here singles a tail
  // number out of the list (§2).
  const enrichment: { label: string; value: string }[] =
    track.source === 'adsb'
      ? [
          { label: 'Category', value: dash(track.category && describeCategory(track.category)) },
          {
            label: 'Type',
            value: dash(
              track.registry?.typeCode
                ? `${track.registry.typeCode}${track.registry.typeDesc ? ` — ${track.registry.typeDesc}` : ''} (lookup)`
                : null,
            ),
          },
          {
            label: 'Registration',
            value: dash(
              track.registry?.registration ? `${track.registry.registration} (lookup)` : null,
            ),
          },
        ]
      : []
  const rows: { label: string; value: string; className?: string }[] = [
    { label: 'Status', value: STATUS_LABEL[status], className: 'drawer__status' },
    { label: 'Rank', value: `${rank}` },
    { label: 'Range', value: `${formatRangeKm(rangeM)} to ${siteName}` },
    ...enrichment,
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
      value: dash(track.headingDeg === null ? null : `${roundHeading(track.headingDeg)}°`),
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
    ? handoffText({ entry, siteName, recipient, log, contacts, dispositions, clock })
    : null

  const copy = async () => {
    if (handoff === null) return
    let copied: boolean
    try {
      await navigator.clipboard.writeText(handoff)
      copied = true
    } catch {
      // No clipboard API (or permission refused): select the visible textarea and copy that.
      // The selection stands either way, so a manual Ctrl+C works when even this path fails —
      // including on engines that refuse (or throw from) execCommand outside the original
      // gesture (#47 round 5).
      handoffRef.current?.select()
      try {
        copied = document.execCommand?.('copy') ?? false
      } catch {
        copied = false
      }
    }
    // "Copied" only when a copy actually happened — a false claim here puts stale clipboard
    // content into an escalation (review finding on #47).
    setCopiedText(copied ? handoff : null)
  }

  return (
    // The capture-phase handler only sniffs input modality; the aside handles no interaction.
    <aside
      className="drawer"
      aria-label={`Track review: ${trackIdent(track)}`}
      ref={asideRef}
      onClickCapture={(event) => {
        keyboardIntentRef.current = event.detail === 0
      }}
    >
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

      <TrackVisuals track={track} lookupPhoto={lookupPhoto} />

      <dl className="drawer__kinematics">
        {rows.map((row) => (
          <div className="drawer__row" key={row.label}>
            <dt>{row.label}</dt>
            <dd className={row.className}>{row.value}</dd>
          </div>
        ))}
      </dl>

      <ScoreBreakdown score={entry.score} />

      {/* The trail the map draws behind the selected track (06b): recorded samples for an
          aircraft, frame-grid instants for an inject, the current position last. */}
      <p className="drawer__history">
        History: {trail.count} known {trail.count === 1 ? 'position' : 'positions'} over the last{' '}
        {Math.round(trail.windowS / 60)} min
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
              <span className="drawer__eventclock">{clock(event.tSec)}</span>
              <span>{describeEvent(event, contacts, dispositions)}</span>
            </li>
          ))}
        </ol>
      </section>
    </aside>
  )
}
