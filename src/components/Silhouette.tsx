import type { Airframe } from '../config/airframes'

/**
 * Nine original side-profile silhouettes, one path each on a 96 × 40 box, drawn here rather than
 * imported — no third-party artwork (#22). Filled with `currentColor` so the drawer's muted text
 * colour is the only colour they ever take: a silhouette is a shape, never a warning (§4.3).
 *
 * Deliberately schematic. Each reads as its class at a glance and claims nothing finer — the
 * caption beside it says what the class rests on.
 */
const PATHS: Record<Airframe, string> = {
  // Low wing, single engine, a fin and a spinner: the Cessna-and-Piper end of the picture.
  'light-piston':
    'M6 22 L18 20 L36 18 L62 16 L74 17 L84 20 L92 22 L84 25 L60 27 L36 27 L18 26 Z M60 16 L66 8 L74 8 L74 16 Z M40 26 L34 31 L52 31 L56 26 Z M6 20 L4 19 L4 25 L6 24 Z',
  // Longer and leaner than the piston, an engine nacelle under a high wing, a tall fin.
  turboprop:
    'M4 22 L16 19 L38 17 L66 16 L82 18 L92 22 L82 26 L66 28 L38 28 L16 26 Z M66 16 L72 6 L82 6 L82 16 Z M30 15 L52 15 L52 19 L30 19 Z M34 19 L38 24 L46 24 L48 19 Z M36 28 L30 32 L50 32 L54 28 Z',
  // A slender tube, swept T-tail, one engine hung on the rear fuselage.
  'business-jet':
    'M4 24 L14 20 L36 18 L70 17 L88 19 L94 23 L88 27 L70 28 L36 28 L14 27 Z M70 17 L78 7 L90 7 L84 17 Z M78 8 L92 8 L92 11 L78 11 Z M62 20 L76 20 L78 24 L62 24 Z M34 28 L26 33 L50 33 L56 28 Z',
  // The airliner: a wide tube, a swept fin, an engine slung under the wing.
  narrowbody:
    'M3 23 L12 18 L34 16 L76 15 L90 18 L95 23 L90 27 L76 29 L34 30 L12 28 Z M74 15 L82 5 L94 5 L88 15 Z M30 30 L24 36 L46 36 L52 30 Z M36 31 L38 36 L50 36 L52 31 Z',
  // Taller and longer than the narrowbody, two engines under a longer wing.
  widebody:
    'M2 22 L10 15 L30 12 L74 11 L90 15 L95 22 L90 28 L74 31 L30 32 L10 29 Z M72 11 L80 1 L95 1 L88 11 Z M22 32 L14 38 L38 38 L44 32 Z M26 33 L28 38 L38 38 L40 33 Z M40 33 L42 38 L52 38 L54 33 Z',
  // Cabin, tail boom, a rotor disc seen edge-on, skids underneath.
  rotorcraft:
    'M22 19 L30 13 L46 12 L56 15 L60 20 L94 20 L94 23 L60 24 L54 29 L34 30 L24 26 Z M8 9 L74 9 L74 12 L8 12 Z M38 5 L44 5 L44 9 L38 9 Z M88 12 L94 12 L94 20 L88 20 Z M26 30 L26 34 L60 34 L60 30 L56 30 L56 32 L30 32 L30 30 Z',
  // Two arms with rotors on a small body: the quad, seen side-on.
  'small-multirotor':
    'M38 21 L44 17 L52 17 L58 21 L58 26 L38 26 Z M10 21 L38 21 L38 24 L10 24 Z M58 21 L86 21 L86 24 L58 24 Z M14 17 L18 17 L18 21 L14 21 Z M4 15 L28 15 L28 17 L4 17 Z M78 17 L82 17 L82 21 L78 21 Z M68 15 L92 15 L92 17 L68 17 Z',
  // A small straight-wing aeroplane with a pusher prop and a boom tail.
  'fixed-wing-uas':
    'M20 20 L30 17 L48 17 L56 20 L56 25 L48 27 L30 27 L20 24 Z M8 19 L92 19 L92 22 L8 22 Z M56 22 L82 22 L82 25 L56 25 Z M82 16 L86 16 L86 30 L82 30 Z M14 14 L18 14 L18 19 L14 19 Z',
  // A rounded plate with a question mark: the honest glyph when nothing earned a shape.
  unknown:
    'M12 6 L84 6 Q92 6 92 14 L92 26 Q92 34 84 34 L12 34 Q4 34 4 26 L4 14 Q4 6 12 6 Z M40 14 Q40 9 48 9 Q56 9 56 14 Q56 18 50 20 L50 24 L46 24 L46 18 Q52 16 52 14 Q52 12 48 12 Q44 12 44 15 L40 15 Z M46 26 L50 26 L50 30 L46 30 Z',
}

/**
 * The picture's class, as a shape. Decorative by design: the class line beside it carries the
 * words, so the glyph is hidden from assistive tech rather than read twice.
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
