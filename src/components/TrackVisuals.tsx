import { Silhouette } from './Silhouette'
import { classify } from '../lib/airframe'
import type { Track } from '../lib/tracks'

/**
 * The Track Visuals slot (§7, #22 — 03c): a silhouette by class, the class line, and the basis
 * line that says what the silhouette rests on. Reads the classifier; decides nothing itself.
 *
 * The image area is a fixed height for every track, so 03d's photo — which arrives after the
 * silhouette, when it arrives at all — swaps in without moving the rows beneath it.
 */
export function TrackVisuals({ track }: { track: Track }) {
  const { airframe, label, caption } = classify(track)
  return (
    <section className="visuals" aria-label="Track visuals">
      <div className="visuals__image">
        <Silhouette airframe={airframe} />
      </div>
      <p className="visuals__class">{label}</p>
      <p className="visuals__basis">{caption}</p>
    </section>
  )
}
