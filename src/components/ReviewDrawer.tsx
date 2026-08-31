import { IdentityDot } from './IdentityDot'
import type { ProtectedSite } from '../config/ao'
import { IDENTITY_LABEL } from '../lib/identity'
import type { RankedTrack } from '../lib/ranking'
import type { Track } from '../lib/tracks'

/**
 * What the drawer calls the track — the same observed-or-derived rule as the Queue row (§7):
 * broadcast ident, else the ICAO address, else the neutral track number. Duplicated deliberately
 * small rather than exported from Queue.tsx, which react-refresh wants component-only.
 */
function ident(track: Track): string {
  if (track.callsign) return track.callsign
  if (track.source === 'adsb') return track.icaoHex
  return `TRK-${track.id.slice(track.id.lastIndexOf('-') + 1)}`
}

const LAYER_BADGE: Record<Track['source'], string> = { adsb: 'ADS-B', inject: 'INJECT' }

/** A kinematic value, or an em dash for one the track did not broadcast — never a zero (§7). */
const dash = (value: string | null) => value ?? '—'

/**
 * The Review drawer (§7, PR 03a): everything known about one track, observed or derived. Its own
 * column beside the Queue, so the operator never loses the list to read a track (§4.2); the
 * Review surface shows the same component alone.
 *
 * Reserved here, filled later: the Track Visuals slot (03c), the score breakdown (PR 04), the
 * history trail's content (PR 06 — at a static frame 0 there is exactly one known position).
 * Status, actions, and the event log are 03b's.
 */
export function ReviewDrawer({
  entry,
  sites,
  onClose,
}: {
  entry: RankedTrack
  sites: ProtectedSite[]
  onClose: () => void
}) {
  const { track, rank, rangeM } = entry
  // Named from the site the range was actually measured to — `rangeM` is to the *nearest* site,
  // so with two sites configured, indexing `[0]` would caption one site's distance with the
  // other's name.
  const siteName = sites.find((site) => site.id === entry.siteId)?.name ?? entry.siteId
  const rows: { label: string; value: string }[] = [
    { label: 'Rank', value: `${rank}` },
    { label: 'Range', value: `${(rangeM / 1000).toFixed(1)} km to ${siteName}` },
    {
      label: 'Altitude',
      value: dash(track.altitudeFt === null ? null : `${track.altitudeFt} ft`),
    },
    { label: 'Ground speed', value: `${track.groundSpeedKt} kt` },
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

  return (
    <aside className="drawer" aria-label={`Track review: ${ident(track)}`}>
      <header className="drawer__header">
        <h3 className="drawer__ident">{ident(track)}</h3>
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
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>

      <div className="drawer__slot">
        Score — <span className="drawer__pending">factors arrive with PR 04</span>
      </div>

      <p className="drawer__history">
        History: 1 known position (frame 0) — the trail fills when the clock runs (PR 06).
      </p>
    </aside>
  )
}
