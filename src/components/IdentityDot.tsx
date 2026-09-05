import { BANDS, BAND_LABEL } from '../config/scoring'
import { BAND_COLOR, type WarmBand } from '../lib/display'
import { IDENTITIES, IDENTITY_COLOR, IDENTITY_LABEL } from '../lib/identity'
import type { Identity } from '../lib/tracks'

/**
 * The identity swatch the Queue rows and the map legend share. One component, so the two cannot
 * disagree about what a colour means. Decorative: the plain-English label beside it carries the
 * meaning for a reader who cannot see the colour.
 */
export function IdentityDot({ identity }: { identity: Identity }) {
  return (
    <span
      className="identity-dot"
      style={{ background: IDENTITY_COLOR[identity] }}
      data-identity={identity}
      aria-hidden="true"
    />
  )
}

/**
 * The band swatch (#96): the fill an inject marker wears in that band, from the same literal the
 * map paints with, so the key and the marker cannot drift. Decorative, as the identity dot is.
 */
export function BandDot({ band }: { band: WarmBand }) {
  return (
    <span
      className="band-dot"
      style={{ background: BAND_COLOR[band] }}
      data-band={band}
      aria-hidden="true"
    />
  )
}

/** The bands that have a swatch, in band order — calm is the marker's default and has none. */
const WARM_BANDS = BANDS.filter((band): band is WarmBand => band !== 'calm')

/**
 * The three identity states in queue order, then the two warm bands beside them (#96), in a map
 * corner. Visible on every surface, which matters on Home — there is no Queue there to read the
 * colours from.
 */
export function IdentityLegend() {
  return (
    <div className="legend" role="group" aria-label="Map legend">
      <ul className="legend__group" aria-label="Identity legend">
        {IDENTITIES.map((identity) => (
          <li key={identity} className="legend__item">
            <IdentityDot identity={identity} />
            {IDENTITY_LABEL[identity]}
          </li>
        ))}
      </ul>
      <ul className="legend__group" aria-label="Band legend">
        {WARM_BANDS.map((band) => (
          <li key={band} className="legend__item">
            <BandDot band={band} />
            {BAND_LABEL[band]}
          </li>
        ))}
      </ul>
    </div>
  )
}
