import type { Airframe } from '../config/airframes'

/**
 * Nine original side-profile silhouettes, one path each on a 96 × 40 box, drawn here rather than
 * imported — no third-party artwork (#22). Path data only; `Silhouette.tsx` renders it (a
 * component file exports components alone, for react-refresh's sake).
 *
 * Deliberately schematic. Each reads as its class at a glance and claims nothing finer — the
 * caption beside it says what the class rests on.
 *
 * Filled even-odd, so the subpaths of one glyph must never overlap: an overlap is a hole, not
 * detail (the on-open review of #55 caught engines rendering as cut-outs). Every glyph but the
 * last is therefore one outline — fin, wing stub, and engine pods are bumps on the body's edge —
 * or a few subpaths that touch at an edge and never cross. `unknown` is the one glyph that
 * *wants* holes: its question mark and dot sit inside the plate on purpose. A test pins both
 * properties on the path data.
 */
export const PATHS: Record<Airframe, string> = {
  // Low wing, single engine, a fin and a spinner: the Cessna-and-Piper end of the picture.
  'light-piston':
    'M4 22 L10 19 L34 17 L58 16 L62 9 L72 9 L74 16 L86 19 L92 22 L86 25 L60 27 L54 30 L36 30 L32 27 L12 26 Z',
  // Longer and leaner than the piston, a high wing with an engine nacelle beneath it, a tall fin.
  turboprop:
    'M4 22 L14 19 L28 17 L30 13 L52 13 L54 17 L66 16 L70 6 L82 6 L82 16 L92 22 L82 26 L66 28 L50 28 L48 32 L34 32 L32 28 L14 26 Z',
  // A slender tube, swept T-tail, one engine on the rear fuselage, a low wing stub.
  'business-jet':
    'M4 24 L14 20 L36 18 L62 17 L70 17 L78 7 L92 7 L92 11 L83 11 L80 17 L88 19 L94 23 L88 27 L80 28 L78 31 L62 31 L60 28 L48 28 L44 33 L26 33 L30 28 L14 27 Z',
  // The airliner: a wide tube, a swept fin, an engine pod hung below the wing stub.
  narrowbody:
    'M3 23 L12 18 L34 16 L74 15 L82 5 L94 5 L88 15 L90 18 L95 23 L90 27 L76 29 L52 30 L46 35 L44 35 L44 39 L34 39 L34 35 L28 35 L30 30 L12 28 Z',
  // Taller and longer than the narrowbody, two pods under a longer wing.
  widebody:
    'M2 22 L10 15 L30 12 L72 11 L80 1 L95 1 L88 11 L90 15 L95 22 L90 28 L74 31 L54 32 L50 35 L50 39 L40 39 L40 35 L36 35 L36 39 L26 39 L26 35 L22 35 L20 32 L10 29 Z',
  // Cabin with mast and boom, a rotor disc seen edge-on above, skids beneath: touching, never crossing.
  rotorcraft:
    'M22 19 L30 13 L38 12 L38 8 L44 8 L44 12 L46 12 L56 15 L60 20 L88 20 L88 12 L94 12 L94 23 L60 24 L54 29 L34 30 L24 26 Z M8 5 L74 5 L74 8 L8 8 Z M30 30 L33 30 L33 32 L30 32 Z M52 29 L55 29 L55 32 L52 32 Z M26 32 L60 32 L60 34 L26 34 Z',
  // Two arms with rotors on a small body: the quad, seen side-on. Arms touch the body's edges.
  'small-multirotor':
    'M38 21 L44 17 L52 17 L58 21 L58 26 L38 26 Z M10 21 L38 21 L38 24 L10 24 Z M58 21 L86 21 L86 24 L58 24 Z M14 17 L18 17 L18 21 L14 21 Z M4 15 L28 15 L28 17 L4 17 Z M78 17 L82 17 L82 21 L78 21 Z M68 15 L92 15 L92 17 L68 17 Z',
  // A small straight-wing aeroplane with a pusher prop and a boom tail; the wing is two pieces
  // that meet the fuselage's sides rather than one band through it, and stop short of the tail.
  'fixed-wing-uas':
    'M20 20 L30 17 L48 17 L56 20 L56 25 L48 27 L30 27 L20 24 Z M8 19 L20 19 L20 22 L8 22 Z M56 19 L82 19 L82 22 L56 22 Z M56 22 L82 22 L82 25 L56 25 Z M82 16 L86 16 L86 30 L82 30 Z M14 14 L18 14 L18 19 L14 19 Z',
  // A rounded plate with a question mark: the honest glyph when nothing earned a shape.
  unknown:
    'M12 6 L84 6 Q92 6 92 14 L92 26 Q92 34 84 34 L12 34 Q4 34 4 26 L4 14 Q4 6 12 6 Z M40 14 Q40 9 48 9 Q56 9 56 14 Q56 18 50 20 L50 24 L46 24 L46 18 Q52 16 52 14 Q52 12 48 12 Q44 12 44 15 L40 15 Z M46 26 L50 26 L50 30 L46 30 Z',
}
