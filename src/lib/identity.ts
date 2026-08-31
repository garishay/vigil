/**
 * The three identity states as the screen presents them (scope §7, Principle 3).
 *
 * One module for the order, the plain-English label, and the colour, so that the map stroke, the
 * Queue row, and the legend are reading the same three values rather than three copies of them.
 */

import type { Identity } from './tracks.ts'

/**
 * Identity in the order the Queue ranks it and the legend lists it. Silence carries the burden
 * of proof (§2, §6): non-cooperative first, then unknown, then cooperative.
 */
export const IDENTITIES = [
  'non-cooperative',
  'unknown',
  'cooperative',
] as const satisfies readonly Identity[]

/** Plain English. Vigil ships no military identification symbology (§9). */
export const IDENTITY_LABEL: Record<Identity, string> = {
  'non-cooperative': 'Non-cooperative',
  unknown: 'Unknown',
  cooperative: 'Cooperative',
}

/**
 * Literals rather than CSS variables, because MapLibre paint properties cannot read the theme;
 * the dot component inlines the same values so the legend and the Queue cannot drift from the
 * map. Every one is cool or neutral — the warm end stays unspent until a score earns it (§4.3).
 */
export const IDENTITY_COLOR: Record<Identity, string> = {
  /** Violet. */
  'non-cooperative': '#a78bfa',
  /** Pale grey-white — the lowest-contrast of the three by design; see the note on #6. */
  unknown: '#c9d4e3',
  /** Blue, the same as the protection ring and `--accent`. */
  cooperative: '#4c9aff',
}
