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
 * The three states in queue order, in a map corner. Visible on every surface, which matters on
 * Home — there is no Queue there to read the colours from.
 */
export function IdentityLegend() {
  return (
    <ul className="legend" aria-label="Identity legend">
      {IDENTITIES.map((identity) => (
        <li key={identity} className="legend__item">
          <IdentityDot identity={identity} />
          {IDENTITY_LABEL[identity]}
        </li>
      ))}
    </ul>
  )
}
