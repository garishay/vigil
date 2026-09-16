/**
 * The study's cast vocabulary (S3b, #135, ruled A3; S7, #152): nine kinds of entry, one builder
 * each, so a scenario file reads as its cast table — one row per entry, every number a bearing° and a range
 * in km from the AO centre, never a coordinate (§5.2). The generator has three cast behaviors
 * (S2a, #133); the six kinds compose them rather than adding a fourth: a hover is a shuttle over
 * 30 m at 1 kt with its leg laid radially outward, so the range never dips under the placement's
 * — heard and under 2 kt, the study audit's word for hovering; a mover is a shuttle on a 13 km
 * leg, longer than a recording flies at 20 kt, so it never turns. The prioritization pair (S7)
 * adds three silent kinds: a hover whose leg lies across its bearing, a mover written where it
 * is at Begin, and an orbit joined from a bearing off its centre.
 *
 * A leg's far end is computed on the local plane from the placement's own polar numbers: at the
 * study's ranges the plane and the sphere differ by metres, and the generator lays the leg on
 * the sphere from the two placements the file holds, so the file stays the truth.
 */

import { KT_TO_MS } from '../../lib/geo.ts'
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

/**
 * The same entry on other bearings: every placement and course turned by `deg` about the centre
 * — a broadcast offset's bearing too, so a lie stays on the same side of its track (#145 round 2).
 */
export function rotated(entry: CastEntry, deg: number): CastEntry {
  const offset = entry.broadcastOffset && {
    ...entry.broadcastOffset,
    bearingDeg: tenth((entry.broadcastOffset.bearingDeg + deg + 360) % 360),
  }
  const turned = offset ? { ...entry, broadcastOffset: offset } : entry
  switch (turned.behavior) {
    case 'shuttle':
      return { ...turned, from: turn(turned.from, deg), to: turn(turned.to, deg) }
    case 'transit-orbit':
      return {
        ...turned,
        from: turn(turned.from, deg),
        courseDeg: tenth((turned.courseDeg + deg + 360) % 360),
        orbit: { ...turned.orbit, center: turn(turned.orbit.center, deg) },
      }
    case 'return-to-launch':
      return { ...turned, from: turn(turned.from, deg), pad: turn(turned.pad, deg) }
  }
}

/**
 * A silent drone holding position (S7, #152): the hover's 30 m shuttle at 1 kt, the leg laid
 * across the bearing rather than along it — neither half of the leg points at the ring, so the
 * closing read is a miss on every tick instead of a thirteen-minute entry on the inbound half.
 */
export const silentHover = (place: Placement): CastEntry =>
  shuttle(place, (place.bearingDeg + 90) % 360, HOVER_LEG_M, 1)

/** The longest recording a leg must outlast, seconds — 002's 1 185 s, rounded up. */
export const LEG_S = 1200

/**
 * A silent mover written where it is at `atS` (S7): the table reads the picture at Begin, and
 * the origin is `atS` seconds back along the course — the generator flies it forward from 0. Its
 * leg is sized from its own speed, never shorter than a mover's: 35 kt flies 21.3 km in the
 * recording, past the 13 km a 20 kt leg needs, and a leg it reaches turns it around (#154 round 1).
 */
export const silentAt = (
  place: Placement,
  courseDeg: number,
  speedKt: number,
  atS: number,
): CastEntry => {
  const origin = along(place, (courseDeg + 180) % 360, speedKt * KT_TO_MS * atS)
  const legM = Math.max(LEG_M, Math.ceil(speedKt * KT_TO_MS * LEG_S))
  return shuttle(origin, courseDeg, legM, speedKt)
}

/**
 * A silent orbit (S7): a transit onto a circle of `radiusM` about `center`, then around it at
 * `speedKt`. It is joined from `joinM` off the centre on bearing `joinDeg` (from the centre), on
 * a course aimed `offsetDeg` to one side of the centre: the join bearing sets where on the circle
 * it arrives, and so the phase of every lap — which stretch of the run its heading points inbound
 * on — and the offset puts the centre unambiguously on one side of the course, which is the side
 * the generator turns toward (positive aims the course right of the centre, so the centre lies
 * to the left and the lap runs counter-clockwise).
 */
export const silentOrbit = (
  center: Placement,
  radiusM: number,
  speedKt: number,
  join: { joinDeg: number; joinM: number; offsetDeg: number },
): CastEntry => ({
  behavior: 'transit-orbit',
  remoteId: 'silent',
  speedKt,
  altitudeFt: 200,
  from: along(center, join.joinDeg, join.joinM),
  courseDeg: (join.joinDeg + 180 + join.offsetDeg + 360) % 360,
  orbit: { center, radiusM },
})
