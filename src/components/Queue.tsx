import { useEffect, useRef } from 'react'
import { IdentityDot } from './IdentityDot'
import { IDENTITY_LABEL } from '../lib/identity'
import type { RankedTrack } from '../lib/ranking'
import type { Track } from '../lib/tracks'

/**
 * What the row calls the track — observed or derived, never assigned. A broadcast ident when
 * there is one; the ICAO address a real aircraft broadcasts when it sends no flight ident; and
 * for a track with no broadcast identity at all, a neutral track number derived from its stable
 * id. Not `inject-nn`: the inject id says what the track *is*, and the layer badge is the one
 * place the Queue discloses that.
 */
function ident(track: Track): string {
  if (track.callsign) return track.callsign
  if (track.source === 'adsb') return track.icaoHex
  return `TRK-${track.id.slice(track.id.lastIndexOf('-') + 1)}`
}

const LAYER_BADGE: Record<Track['source'], string> = { adsb: 'ADS-B', inject: 'INJECT' }

/** Range to the protected site's center, km to one decimal (§7). */
const formatRange = (rangeM: number) => `${(rangeM / 1000).toFixed(1)} km`

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
    if (!selectedId) return
    // Optional call: jsdom implements querySelector but not scrollIntoView.
    listRef.current
      ?.querySelector(`[data-id="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedId])

  return (
    <ol className="queue" aria-label="Ranked queue" ref={listRef}>
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
                <span className="queue__ident">{ident(track)}</span>
                {track.onGround && <span className="queue__ground">on ground</span>}
                <span className="queue__range">{formatRange(rangeM)}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
