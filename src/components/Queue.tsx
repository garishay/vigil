import { useEffect, useRef } from 'react'
import { IdentityDot } from './IdentityDot'
import type { ProtectedSite } from '../config/ao'
import {
  LAYER_BADGE,
  formatRangeKm,
  formatScore,
  reasonTag,
  scoreSummary,
  trackIdent,
} from '../lib/display'
import { IDENTITY_LABEL } from '../lib/identity'
import { STATUS_LABEL, isTerminal, type Status } from '../lib/lifecycle'
import type { RankedTrack } from '../lib/ranking'

/**
 * The ranked list (§7). Three-line rows: rank, identity, and the score chip on the first line;
 * the layer badge, ident, ground state, and range on the second; the reason tag on the third —
 * the top-contributing factors in plain English, leading with the *detected* pattern (05b).
 * Every field is something the system observed or derived — behavior and Remote ID status are
 * ground truth and stay in the fixtures; the pattern on the row is what the history showed. The
 * chip carries the composite with its top contributions as hover text, and wears the band's
 * colour — the one place on the row a warm colour can appear, and only a score can put it there
 * (§4.3).
 *
 * Rows are buttons (03a): clicking selects the track, in sync with the map — the selected row is
 * marked and scrolled into view when the selection came from the map side. Ranks are global,
 * never renumbered by a filter: a filtered list that reads 2, 5, 9 tells the operator what it
 * hid.
 *
 * Lifecycle state rides the row (03e): a tag beside the layer badge, omitted when New, and a
 * terminal row dims in place — rank and position untouched, since ranking never reads status.
 * The status arrives through `statusFor`, read from the event log at render, after the sort.
 * A Dismissed track that has re-surfaced (05b) keeps its status and loses its dim: the tag reads
 * RE-SURFACED, so the evidence the record logged is seen where triage happens.
 */
export function Queue({
  ranked,
  selectedId = null,
  restoreFocus = true,
  statusFor = () => 'new',
  resurfacedFor = () => false,
  sites = [],
  onSelect,
}: {
  ranked: RankedTrack[]
  selectedId?: string | null
  /** A track's lifecycle status; an untouched track reads New. */
  statusFor?: (id: string) => Status
  /** Whether a Dismissed track has re-surfaced since its dismissal (05b); never a real aircraft. */
  resurfacedFor?: (entry: RankedTrack) => boolean
  /** The protected sites, for the reason tag's site name. */
  sites?: readonly ProtectedSite[]
  /**
   * Whether a cleared selection returns focus to its row. The caller passes `false` for a
   * pointer-driven close — the effect below cannot see the click, and a mouse user parked on a
   * row would have Space re-select it instead of scrolling (03b round 6, #54). Focus then goes
   * to the list instead, which has no activation to misfire and keeps the operator's place.
   */
  restoreFocus?: boolean
  onSelect?: (id: string) => void
}) {
  const listRef = useRef<HTMLOListElement>(null)

  // Scrolls on a change of selection, never on a re-render of the same one. The effect still
  // depends on `ranked` — it has to, for the arriving-row case below — but under playback
  // `ranked` is a new array every tick, so acting on that dependency alone snapped the list back
  // to the selected row once a second and undid an operator's scroll as fast as they made it
  // (#76). The ref records the id actually scrolled to, which is the id the effect has already
  // served; anything else is a genuinely new selection.
  const scrolledToRef = useRef<string | null>(null)
  useEffect(() => {
    // A cleared selection forgets, so re-selecting the same track scrolls to it again.
    if (!selectedId) {
      scrolledToRef.current = null
      return
    }
    // Membership is checked against `ranked`, not just the DOM, so the selected row can render
    // on a *later* commit than the selection — a cleared filter, or a re-rank — and that
    // arriving row still gets scrolled to. A row that is absent forgets, so one that comes back
    // is owed its scroll again: the selection outlives a filter that hides it (App keeps the
    // drawer), and returning to a longer list puts it off-screen. This test has to come *before*
    // the already-served one below, or a row that was scrolled to would never reach it.
    if (!ranked.some((entry) => entry.track.id === selectedId)) {
      scrolledToRef.current = null
      return
    }
    // Present, and already served: this is the tick case — do nothing.
    if (selectedId === scrolledToRef.current) return
    // Optional call: jsdom has no scrollIntoView.
    listRef.current
      ?.querySelector(`[data-id="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView?.({ block: 'nearest' })
    scrolledToRef.current = selectedId
  }, [selectedId, ranked])

  // A keyboard operator who closes the drawer must not be dropped on document.body: focus
  // returns to the row that anchored the selection, or to the list itself when that row is
  // filtered out. A pointer-driven close skips the row and takes the list — `restoreFocus`
  // carries the modality gate the drawer and Review already apply, and only the row has an
  // activation for Space to misfire (#54, shape from its review). (Closing from the Review
  // surface, where this list is unmounted, is App's to catch — the Review nav item, #46.)
  const previousSelectedRef = useRef<string | null>(null)
  useEffect(() => {
    const previous = previousSelectedRef.current
    previousSelectedRef.current = selectedId
    if (selectedId || !previous) return
    const row = restoreFocus
      ? listRef.current?.querySelector<HTMLButtonElement>(
          `[data-id="${CSS.escape(previous)}"] button`,
        )
      : null
    ;(row ?? listRef.current)?.focus?.()
  }, [selectedId, restoreFocus])

  return (
    <ol className="queue" aria-label="Ranked queue" ref={listRef} tabIndex={-1}>
      {ranked.map((entry) => {
        const { track, rank, rangeM, score } = entry
        const status = statusFor(track.id)
        const surfaced = resurfacedFor(entry)
        const classes = ['queue__row']
        if (track.onGround) classes.push('queue__row--ground')
        if (isTerminal(status) && !surfaced) classes.push('queue__row--terminal')
        if (track.id === selectedId) classes.push('queue__row--selected')
        return (
          <li key={track.id} className={classes.join(' ')} data-id={track.id}>
            <button
              type="button"
              className="queue__rowbutton"
              aria-current={track.id === selectedId ? 'true' : undefined}
              onClick={() => onSelect?.(track.id)}
            >
              <span className="queue__rank">{rank}</span>
              <span className="queue__identity">
                <IdentityDot identity={track.identity} />
                {IDENTITY_LABEL[track.identity]}
              </span>
              <span className="queue__score" data-band={score.band} title={scoreSummary(score)}>
                {formatScore(score)}
              </span>
              <span className="queue__detail">
                <span className="queue__badge" data-layer={track.source}>
                  {LAYER_BADGE[track.source]}
                </span>
                {status !== 'new' && (
                  <span className="queue__badge queue__badge--state">
                    {surfaced ? 'Re-surfaced' : STATUS_LABEL[status]}
                  </span>
                )}
                <span className="queue__ident">{trackIdent(track)}</span>
                {track.onGround && <span className="queue__ground">on ground</span>}
                <span className="queue__range">{formatRangeKm(rangeM)}</span>
              </span>
              <span className="queue__reason">{reasonTag(entry, sites)}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
