/**
 * The study's cast vocabulary (S3b, #135, ruled A3): six kinds of entry, one builder each, so a
 * scenario file reads as its cast table — one row per entry, every number a bearing° and a range
 * in km from the AO centre, never a coordinate (§5.2). The generator has three cast behaviors
 * (S2a, #133); the six kinds compose them rather than adding a fourth: a hover is a shuttle over
 * 30 m at 1 kt with its leg laid radially outward, so the range never dips under the placement's
 * — heard and under 2 kt, the study audit's word for hovering; a mover is a shuttle on a 13 km
 * leg, longer than a recording flies at 20 kt, so it never turns.
 *
 * A leg's far end is computed on the local plane from the placement's own polar numbers: at the
 * study's ranges the plane and the sphere differ by metres, and the generator lays the leg on
 * the sphere from the two placements the file holds, so the file stays the truth.
 */

import type { CastEntry, Placement } from '../scenario.ts'

const rad = (deg: number) => (deg * Math.PI) / 180
/** To a tenth of a degree — the file holds clean numbers, not the sum's floating-point tail. */
const tenth = (deg: number) => Math.round(deg * 10) / 10

/** A placement, written as the cast table reads: bearing° / km from the AO centre. */
export const at = (bearingDeg: number, rangeKm: number): Placement => ({ bearingDeg, rangeKm })

/** The placement `m` metres along `courseDeg` from `from` — a leg's far end, to a tenth of a degree and a metre. */
export function along(from: Placement, courseDeg: number, m: number): Placement {
  const x = from.rangeKm * 1000 * Math.sin(rad(from.bearingDeg)) + m * Math.sin(rad(courseDeg))
  const y = from.rangeKm * 1000 * Math.cos(rad(from.bearingDeg)) + m * Math.cos(rad(courseDeg))
  const bearingDeg = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
  return { bearingDeg: tenth(bearingDeg), rangeKm: Math.round(Math.hypot(x, y)) / 1000 }
}

/** A mover's leg: 13 km, past the 12.2 km a 20 kt track flies in the recording's 1 185 s, so it never turns (#145 round 1). */
export const LEG_M = 13_000
/** A hover's leg: still to the picture, the detector names loiter; under 2 kt to the audit. */
export const HOVER_LEG_M = 30

/** A heard drone holding position: a 30 m shuttle at 1 kt, the leg laid outward. */
export const hover = (place: Placement): CastEntry => ({
  behavior: 'shuttle',
  remoteId: 'broadcasting',
  speedKt: 1,
  altitudeFt: 150,
  from: place,
  to: along(place, place.bearingDeg, HOVER_LEG_M),
})

/** A heard drone on a straight course at `speedKt`, never turning inside the recording. */
export const mover = (from: Placement, courseDeg: number, speedKt: number): CastEntry => ({
  behavior: 'shuttle',
  remoteId: 'broadcasting',
  speedKt,
  altitudeFt: 200,
  from,
  to: along(from, courseDeg, LEG_M),
})

/** The same course, silent. */
export const silentMover = (from: Placement, courseDeg: number, speedKt: number): CastEntry => ({
  ...mover(from, courseDeg, speedKt),
  remoteId: 'silent',
})

/** A silent shuttle on a `legM` leg along `courseDeg` — the study's one pattern, revisit. */
export const shuttle = (
  from: Placement,
  courseDeg: number,
  legM: number,
  speedKt: number,
): CastEntry => ({
  behavior: 'shuttle',
  remoteId: 'silent',
  speedKt,
  altitudeFt: 200,
  from,
  to: along(from, courseDeg, legM),
})

/** A heard drone returning to its pad at 20 kt from `startS`, landing there (S2a, A5). */
export const returning = (from: Placement, pad: Placement, startS: number): CastEntry => ({
  behavior: 'return-to-launch',
  remoteId: 'broadcasting',
  speedKt: 20,
  altitudeFt: 200,
  startS,
  from,
  pad,
})

/**
 * The threat: the study's lying drone — `UAS-8F21` at 35 kt on a straight course to a circle it
 * then orbits, its broadcast 1.1 km east of the track (S2b). `startS` puts its first frame on the
 * first tick after Begin (02a); `fromS` keeps it heard and consistent from t = 0 and starts the
 * lie on that tick instead (02b) — two presentations of one threat (ruled on #135).
 */
export const threat = (
  from: Placement,
  courseDeg: number,
  center: Placement,
  timing: { startS?: number; fromS?: number },
): CastEntry => ({
  behavior: 'transit-orbit',
  remoteId: 'broadcasting',
  label: 'UAS-8F21',
  speedKt: 35,
  altitudeFt: 200,
  ...(timing.startS === undefined ? {} : { startS: timing.startS }),
  from,
  courseDeg,
  orbit: { center, radiusM: 800 },
  broadcastOffset: {
    bearingDeg: 90,
    distanceM: 1100,
    ...(timing.fromS === undefined ? {} : { fromS: timing.fromS }),
  },
})

const turn = (place: Placement, deg: number): Placement => ({
  ...place,
  bearingDeg: tenth((place.bearingDeg + deg + 360) % 360),
})

/** The same entry on other bearings: every placement and course turned by `deg` about the centre. */
export function rotated(entry: CastEntry, deg: number): CastEntry {
  switch (entry.behavior) {
    case 'shuttle':
      return { ...entry, from: turn(entry.from, deg), to: turn(entry.to, deg) }
    case 'transit-orbit':
      return {
        ...entry,
        from: turn(entry.from, deg),
        courseDeg: tenth((entry.courseDeg + deg + 360) % 360),
        orbit: { ...entry.orbit, center: turn(entry.orbit.center, deg) },
      }
    case 'return-to-launch':
      return { ...entry, from: turn(entry.from, deg), pad: turn(entry.pad, deg) }
  }
}
