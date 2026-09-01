import { useEffect, useRef } from 'react'
import { IdentityDot } from './IdentityDot'
import { LAYER_BADGE, formatRangeKm, trackIdent } from '../lib/display'
import { IDENTITY_LABEL } from '../lib/identity'
import type { RankedTrack } from '../lib/ranking'

/**
 * The ranked list (§7). Two-line rows: rank, identity, and the score chip on the first line; the
 * layer badge, ident, ground state, and range on the second. Every field is something the system
 * observed or derived — behavior and Remote ID status are ground truth, and stay in the fixtures
 * until PR 05 earns the right to display a *detected* pattern.
 *
 * Rows are buttons (03a): clicking selects the track, in sync with the map — the selected row is
 * marked and scrolled into view when the selection came from the map side. Ranks are global,
 * never renumbered by a filter: a filtered list that reads 2, 5, 9 tells the operator what it
 * hid.
 */
export function Queue({
  ranked,
  selectedId = null,
  onSelect,
}: {
  ranked: RankedTrack[]
  selectedId?: string | null
  onSelect?: (id: string) => void
}) {
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    // Membership is checked against `ranked`, not just the DOM, so the selected row can render
    // on a *later* commit than the selection — a cleared filter, or a re-rank — and that
    // arriving row still gets scrolled to. Optional call: jsdom has no scrollIntoView.
    if (!selectedId || !ranked.some((entry) => entry.track.id === selectedId)) return
    listRef.current
      ?.querySelector(`[data-id="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedId, ranked])

  // A keyboard operator who closes the drawer must not be dropped on document.body: focus
  // returns to the row that anchored the selection, or to the list itself when that row is
  // filtered out. (Closing from the Review surface, where this list is unmounted, still falls
  // to body — 03b's selection ruling changed no mounting, so that gap is #46's.)
  const previousSelectedRef = useRef<string | null>(null)
  useEffect(() => {
    const previous = previousSelectedRef.current
    previousSelectedRef.current = selectedId
    if (selectedId || !previous) return
    const row = listRef.current?.querySelector<HTMLButtonElement>(
      `[data-id="${CSS.escape(previous)}"] button`,
    )
    ;(row ?? listRef.current)?.focus?.()
  }, [selectedId])

  return (
    <ol className="queue" aria-label="Ranked queue" ref={listRef} tabIndex={-1}>
      {ranked.map(({ track, rank, rangeM }) => {
        const classes = ['queue__row']
        if (track.onGround) classes.push('queue__row--ground')
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
              <span className="queue__score" title="Score arrives with the scoring engine (PR 04)">
                —
              </span>
              <span className="queue__detail">
                <span className="queue__badge" data-layer={track.source}>
                  {LAYER_BADGE[track.source]}
                </span>
                <span className="queue__ident">{trackIdent(track)}</span>
                {track.onGround && <span className="queue__ground">on ground</span>}
                <span className="queue__range">{formatRangeKm(rangeM)}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
