import { Silhouette } from './Silhouette'
import type { PhotoLookup } from '../data/photos'
import { usePhoto } from '../data/usePhoto'
import { classify } from '../lib/airframe'
import type { Track } from '../lib/tracks'

/**
 * The Track Visuals slot (§7, #22): a silhouette by class (03c), the class line, and the basis
 * line that says what the silhouette rests on. Reads the classifier; decides nothing itself.
 *
 * In a study run the image area is withheld outright (S8, #180, ruled R2, and round 1's
 * finding 6): the silhouette's grey "?" is a box that says nothing, and an inject — every
 * non-cooperative track a subject opens — never has a photo to fill it, so a subject's drawer
 * opened on a box and read its one class line underneath.
 *
 * Withheld **for the whole run**, not only where no photo arrived. Of the two shapes the owner
 * named, reserving the area from the start keeps the rows still but puts the empty box back,
 * which is the thing R2 removed; withholding it only until a photo lands moves every row beneath
 * it when one does, because `usePhoto` resolves after the first render. So it is withheld for
 * every track, and nothing below it ever moves. The cost is the ADS-B photo, which a Vigil run
 * no longer shows — the fairness spec already withholds it from the unaided condition, so the
 * two now agree rather than differ. The class line and the basis line stay in both.
 *
 * The demo is unchanged — there the silhouette is the class tier's own reading, and the rows
 * beneath it hold still because the area never leaves.
 *
 * For an ADS-B track a photo may arrive after the silhouette (03d) and takes its place inside the
 * same fixed-height image area, so the rows beneath never move. The thumbnail and its credit are
 * one plain anchor to the photo's page, in a new tab, as the API terms require: the photographer
 * credited in text beside the image, the link unchanged, no `nofollow`. An inject is never
 * looked up — the lookup's type does not admit one.
 */
export function TrackVisuals({
  track,
  lookupPhoto,
  run = false,
}: {
  track: Track
  lookupPhoto: PhotoLookup
  /** A study run: no image area at all, so nothing beneath it moves (ruled R2, round 1). */
  run?: boolean
}) {
  const { airframe, label, caption } = classify(track)
  const photo = usePhoto(track, lookupPhoto)
  // The class line alone in a study run: no image area, reserved or otherwise, so no row beneath
  // it can move once the panel is drawn (round 1, finding 6).
  if (run)
    return (
      <section className="visuals" aria-label="Track visuals">
        <p className="visuals__class">{label}</p>
        <p className="visuals__basis">{caption}</p>
      </section>
    )
  return (
    <section className="visuals" aria-label="Track visuals">
      {photo ? (
        <a
          className="visuals__image visuals__photo"
          href={photo.link}
          target="_blank"
          rel="noopener"
        >
          {/* The class line beside it says what the airframe is; the credit names the anchor. */}
          <img
            className="visuals__thumb"
            src={photo.src}
            width={photo.width}
            height={photo.height}
            alt=""
          />
          <span className="visuals__credit">© {photo.photographer} · Planespotters.net</span>
        </a>
      ) : (
        <div className="visuals__image">
          <Silhouette airframe={airframe} />
        </div>
      )}
      <p className="visuals__class">{label}</p>
      <p className="visuals__basis">{caption}</p>
    </section>
  )
}
