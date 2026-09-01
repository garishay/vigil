import { PATHS } from './silhouettes'
import type { Airframe } from '../config/airframes'

/**
 * The picture's class, as a shape — the path data lives in `silhouettes.ts`. Filled with
 * `currentColor` so the drawer's muted text colour is the only colour a glyph ever takes: a
 * silhouette is a shape, never a warning (§4.3). Decorative by design: the class line beside it
 * carries the words, so the glyph is hidden from assistive tech rather than read twice.
 */
export function Silhouette({ airframe }: { airframe: Airframe }) {
  return (
    <svg
      className="silhouette"
      viewBox="0 0 96 40"
      aria-hidden="true"
      focusable="false"
      data-airframe={airframe}
    >
      <path d={PATHS[airframe]} fill="currentColor" fillRule="evenodd" />
    </svg>
  )
}
