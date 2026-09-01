/**
 * What an airframe looks like, from what was broadcast or looked up (scope §7, #22) —
 * configuration, not code, like the contacts and the AO. Three tables the classifier in
 * `src/lib/airframe.ts` reads and nothing in the scoring path ever does:
 *
 * - the ADS-B emitter categories (the public DO-260B set A/B codes), each with the plain name the
 *   caption prints and the class it implies on its own;
 * - the ICAO type designators the recording carries and their common siblings, by class — a
 *   hand-entered subset of the public ICAO 8643 designators, no third-party table imported;
 * - the low-and-slow box that earns a track with no broadcast basis the "small UAS (kinematic
 *   class)" label: both numbers are Part 107's, public and citable.
 *
 * Every class here is a silhouette the drawer can draw. A code missing from these tables is not
 * an error — the caption says what the picture rests on, and "unknown airframe" is a class.
 */

export type Airframe =
  | 'light-piston'
  | 'turboprop'
  | 'business-jet'
  | 'narrowbody'
  | 'widebody'
  | 'rotorcraft'
  | 'small-multirotor'
  | 'fixed-wing-uas'
  | 'unknown'

/** Plain English (principle 3) — the class line on screen. */
export const AIRFRAME_LABEL: Record<Airframe, string> = {
  'light-piston': 'Light piston',
  turboprop: 'Turboprop',
  'business-jet': 'Business jet',
  narrowbody: 'Narrowbody',
  widebody: 'Widebody',
  rotorcraft: 'Rotorcraft',
  'small-multirotor': 'Small multirotor',
  'fixed-wing-uas': 'Fixed-wing UAS',
  unknown: 'Unknown airframe',
}

/**
 * ADS-B emitter categories, as the aircraft broadcasts them. The class is what the category
 * alone implies — A2 "small" is usually a regional or business jet, and the type code corrects
 * the Cessnas that broadcast it. Codes outside the airframe lane (high-performance, the B set)
 * keep their name for the caption and draw the unknown glyph: honest about what was heard,
 * silent about a shape nothing observed.
 */
export const EMITTER_CATEGORIES: Record<string, { name: string; airframe: Airframe }> = {
  A1: { name: 'light', airframe: 'light-piston' },
  A2: { name: 'small', airframe: 'business-jet' },
  A3: { name: 'large', airframe: 'narrowbody' },
  A4: { name: 'high-vortex large', airframe: 'narrowbody' },
  A5: { name: 'heavy', airframe: 'widebody' },
  A6: { name: 'high performance', airframe: 'unknown' },
  A7: { name: 'rotorcraft', airframe: 'rotorcraft' },
  B1: { name: 'glider', airframe: 'unknown' },
  B2: { name: 'lighter-than-air', airframe: 'unknown' },
  B3: { name: 'parachutist', airframe: 'unknown' },
  B4: { name: 'ultralight', airframe: 'unknown' },
  B6: { name: 'unmanned aircraft', airframe: 'unknown' },
  B7: { name: 'space vehicle', airframe: 'unknown' },
}

/** ICAO type designators by class — the codes the recording carries, plus their siblings. */
const TYPE_CODES: Record<
  Exclude<Airframe, 'small-multirotor' | 'fixed-wing-uas' | 'unknown'>,
  string
> = {
  'light-piston':
    'C150 C152 C172 C177 C182 C206 C210 C310 C340 C414 C421 P28A P28B P28R P28T PA24 PA27 PA30 PA31 PA32 PA34 PA44 PA46 M20P M20T BE33 BE35 BE36 BE55 BE58 SR20 SR22 S22T DA40 DA42 RV12 RV7 RV10 AAT4 AEST',
  turboprop: 'PC12 B350 BE20 BE9L B190 C208 C441 TBM7 TBM8 TBM9 DH8D DH8A AT72 AT76 SW4 PAY2',
  'business-jet':
    'SF50 C25A C25B C25C C510 C525 C560 C56X C680 C68A C750 CL30 CL35 CL60 E545 E550 E50P E55P F2TH F900 FA50 FA7X FA8X GLF4 GLF5 GLF6 GL5T GL7T GALX H25B HDJT LJ35 LJ45 LJ60 LJ75 PRM1 BE40 PC24',
  narrowbody:
    'A19N A20N A21N A319 A320 A321 B37M B38M B39M B3XM B712 B733 B734 B735 B736 B737 B738 B739 B752 B753 BCS1 BCS3 CRJ2 CRJ7 CRJ9 CRJX E135 E145 E45X E170 E175 E75L E75S E190 E195 E290 E295 MD88 MD90',
  widebody:
    'A306 A310 A332 A333 A338 A339 A342 A343 A345 A346 A359 A35K A388 B742 B744 B748 B762 B763 B764 B772 B773 B77L B77W B788 B789 B78X MD11 DC10',
  rotorcraft:
    'A109 A119 A139 A169 A189 AS50 AS55 AS65 AS32 AS3B B06 B06T B105 B222 B230 B407 B412 B429 B430 B505 EC20 EC30 EC35 EC45 EC55 EC75 EXPL H60 H47 H64 MD52 MD60 R22 R44 R66 S76 S92 UH1',
}

/** Type designator → class, flattened from the table above for one lookup per track. */
export const TYPE_CODE_AIRFRAME: ReadonlyMap<string, Airframe> = new Map(
  (Object.entries(TYPE_CODES) as [Airframe, string][]).flatMap(([airframe, codes]) =>
    codes.split(' ').map((code): [string, Airframe] => [code, airframe]),
  ),
)

/**
 * The envelope that earns "small UAS (kinematic class)" with nothing broadcast: at or below the
 * Part 107 ceiling (400 ft) and speed limit (87 kt). Both readings must be known — a null is a
 * gap, not a low number, and never qualifies (#35).
 */
export const KINEMATIC_CLASS = { maxAltitudeFt: 400, maxGroundSpeedKt: 87 } as const
