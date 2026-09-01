import type { Airframe } from '../config/airframes'

/**
 * Nine original silhouettes, one path each on a 96 × 40 box, drawn here rather than imported —
 * no third-party artwork (#22). Path data only; `Silhouette.tsx` renders it (a component file
 * exports components alone, for react-refresh's sake).
 *
 * Deliberately schematic. Each reads as its class at the drawer's 8.5 rem image area and claims
 * nothing finer — the caption beside it says what the class rests on. The aircraft are side-on,
 * nose left. The two small-UAS glyphs are top-down (#57): side-on, a quadcopter is a bar with two
 * knobs and a long-wing drone is a bar with none, and the injects are the rows that never get a
 * photo.
 *
 * Filled even-odd, so the subpaths of one glyph must never overlap: an overlap is a hole, not
 * detail (the on-open review of #55 caught engines rendering as cut-outs). Every glyph but the
 * last is therefore one outline — fin, wing stub, and engine pods are bumps on the body's edge —
 * or a few subpaths that touch at an edge and never cross. `unknown` is the one glyph that
 * *wants* holes: its question mark and dot sit inside the plate on purpose. A test pins both
 * properties on the path data.
 */
export const PATHS: Record<Airframe, string> = {
  // High wing, one engine, fixed gear — the Cessna end of the picture: spinner and prop blade, the
  // windshield rising to the wing band, a swept fin, a wheel under the nose and one under the cabin.
  'light-piston':
    'M9 17.5 L6.5 18.5 L6.5 11 L4 11 L4 30 L6.5 30 L6.5 22.5 L9 23.5 L14 25.5 L14 31 L19 31 L19 26 L40 27 L40 31 L45 31 L46 26.5 L88 21.5 L94 20.5 L94 18.5 L89 18.5 L86 5.5 L78 5.5 L57 16.5 L50 15.5 L44 11.5 L44 9 L18 9 L18 11.5 L28 11.5 L22 16.5 L21 16.5 Z',
  // The regional twin: a high wing band above the roof, a nacelle beneath it, a prop blade ahead of
  // the nacelle tall enough to show above the roof and below the belly, and a T-tail.
  turboprop:
    'M3 21 L10 17 L20 15.5 L22.5 15.5 L22.5 4 L25.5 4 L25.5 15.5 L30 15.5 L30 11.5 L56 11.5 L56 15.5 L68 15.5 L80 3 L78 3 L78 0.5 L94 0.5 L94 3 L86 3 L89 17 L93 19.5 L93 22 L70 26 L52 28 L50 32 L30 32 L27 31 L25.5 29 L25.5 37 L22.5 37 L22.5 26.5 L14 25 Z',
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
  // The quad from above: a body with a camera nub forward, four arms, four rotor discs — 16-gons,
  // so the sweep sees them exactly. Each arm shares one edge with its disc and lands on the body's
  // side: touching, never crossing.
  'small-multirotor':
    'M38 16 L40 14 L45 14 L45 11.5 L51 11.5 L51 14 L56 14 L58 16 L58 24 L56 26 L40 26 L38 24 Z M27.3 11.7 L26 14.8 L38 19.8 L38 16.2 Z M70 14.8 L68.7 11.7 L58 16.2 L58 19.8 Z M26 25.2 L27.3 28.3 L38 23.8 L38 20.2 Z M68.7 28.3 L70 25.2 L58 20.2 L58 23.8 Z M26 14.8 L23.7 17.1 L20.6 18.3 L17.3 18.3 L14.2 17 L11.9 14.7 L10.7 11.6 L10.7 8.3 L12 5.2 L14.3 2.9 L17.4 1.7 L20.7 1.7 L23.8 3 L26.1 5.3 L27.3 8.4 L27.3 11.7 Z M68.7 11.7 L68.7 8.4 L69.9 5.3 L72.2 3 L75.3 1.7 L78.6 1.7 L81.7 2.9 L84 5.2 L85.3 8.3 L85.3 11.6 L84.1 14.7 L81.8 17 L78.7 18.3 L75.4 18.3 L72.3 17.1 L70 14.8 Z M27.3 28.3 L27.3 31.6 L26.1 34.7 L23.8 37 L20.7 38.3 L17.4 38.3 L14.3 37.1 L12 34.8 L10.7 31.7 L10.7 28.4 L11.9 25.3 L14.2 23 L17.3 21.7 L20.6 21.7 L23.7 22.9 L26 25.2 Z M70 25.2 L72.3 22.9 L75.4 21.7 L78.7 21.7 L81.8 23 L84.1 25.3 L85.3 28.4 L85.3 31.7 L84 34.8 L81.7 37.1 L78.6 38.3 L75.3 38.3 L72.2 37 L69.9 34.7 L68.7 31.6 L68.7 28.3 Z',
  // The long-wing drone from above, nose up: a slender pod, one wing spanning the box, a boom
  // down to the tailplane. One outline, straight edges only — the nose and the tips are chamfered
  // rather than curved, so the sweep sees this glyph exactly (the unknown plate is the one curve).
  'fixed-wing-uas':
    'M44.5 8 L45.5 4.5 L48 3 L50.5 4.5 L51.5 8 L51.5 17.5 L91 19.5 L92.5 20 L93 21.5 L93 23 L92.5 24.5 L91 25 L49.5 25 L49.5 34 L62 34 L62 37.5 L34 37.5 L34 34 L46.5 34 L46.5 25 L5 25 L3.5 24.5 L3 23 L3 21.5 L3.5 20 L5 19.5 L44.5 17.5 Z',
  // A rounded plate with a question mark: the honest glyph when nothing earned a shape.
  unknown:
    'M12 6 L84 6 Q92 6 92 14 L92 26 Q92 34 84 34 L12 34 Q4 34 4 26 L4 14 Q4 6 12 6 Z M40 14 Q40 9 48 9 Q56 9 56 14 Q56 18 50 20 L50 24 L46 24 L46 18 Q52 16 52 14 Q52 12 48 12 Q44 12 44 15 L40 15 Z M46 26 L50 26 L50 30 L46 30 Z',
}
