import { Silhouette } from './Silhouette'
import type { PhotoLookup } from '../data/photos'
import { usePhoto } from '../data/usePhoto'
import { classify } from '../lib/airframe'
import type { Track } from '../lib/tracks'

/**
 * The Track Visuals slot (§7, #22): a silhouette by class (03c), the class line, and the basis
 * line that says what the silhouette rests on. Reads the classifier; decides nothing itself.
 *
 * For an ADS-B track a photo may arrive after the silhouette (03d) and takes its place inside the
 * same fixed-height image area, so the rows beneath never move. The thumbnail and its credit are
 * one plain anchor to the photo's page, in a new tab, as the API terms require: the photographer
 * credited in text beside the image, the link unchanged, no `nofollow`. An inject is never
 * looked up — the lookup's type does not admit one.
 */
export function TrackVisuals({ track, lookupPhoto }: { track: Track; lookupPhoto: PhotoLookup }) {
  const { airframe, label, caption } = classify(track)
  const photo = usePhoto(track, lookupPhoto)
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
