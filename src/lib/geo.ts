import type { Feature, Polygon } from 'geojson'

/** WGS-84 equatorial radius, meters. Used where a local ring is drawn, not where range is measured. */
const EARTH_RADIUS_M = 6378137

/**
 * Mean earth radius, meters. The right sphere for a haversine range: the equatorial radius
 * overstates distance by about 0.11%, which is a hundred metres across the AO.
 */
const MEAN_EARTH_RADIUS_M = 6371008.8

/**
 * A GeoJSON polygon approximating a circle of `radiusM` around `center`.
 *
 * MapLibre has no metre-radius circle primitive, so a protection ring is drawn as a polygon.
 * The equirectangular approximation is exact enough at protection-ring scale (single-digit km)
 * and keeps this module dependency-free.
 */
export function circlePolygon(
  center: [number, number],
  radiusM: number,
  properties: Record<string, string> = {},
  steps = 72,
): Feature<Polygon> {
  const [lon, lat] = center
  const deltaLat = (radiusM / EARTH_RADIUS_M) * (180 / Math.PI)
  const deltaLon = deltaLat / Math.cos((lat * Math.PI) / 180)
  const ring: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI
    ring.push([lon + deltaLon * Math.cos(angle), lat + deltaLat * Math.sin(angle)])
  }
  return { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [ring] } }
}

/**
 * Great-circle distance in meters between two [longitude, latitude] points.
 *
 * Haversine rather than the equirectangular shortcut above: this one is used at AO scale — sizing
 * the capture radius from the bounding box, and ranking the Queue by range to a protected site —
 * where the flat-earth error stops being negligible.
 */
export function distanceMeters(a: [number, number], b: [number, number]): number {
  const toRad = Math.PI / 180
  const [lonA, latA] = a
  const [lonB, latB] = b
  const dLat = (latB - latA) * toRad
  const dLon = (lonB - lonA) * toRad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(latA * toRad) * Math.cos(latB * toRad) * Math.sin(dLon / 2) ** 2
  return 2 * MEAN_EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * The point `distanceM` from `origin` along the great circle on initial bearing `bearingDeg`.
 *
 * The inverse of `distanceMeters`, and the inject generator's whole vocabulary of motion: every
 * behavior is expressed as offsets from a launch point rather than as raw coordinate arithmetic,
 * which is what keeps the AO relocatable (§5). Spherical rather than the equirectangular
 * shortcut above, on the same mean radius, so that stepping out and measuring back agrees.
 */
export function destinationPoint(
  origin: [number, number],
  bearingDeg: number,
  distanceM: number,
): [number, number] {
  const toRad = Math.PI / 180
  const [lon, lat] = origin
  const delta = distanceM / MEAN_EARTH_RADIUS_M
  const theta = bearingDeg * toRad
  const phi1 = lat * toRad
  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta),
  )
  const lambda =
    lon * toRad +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2),
    )
  return [((lambda / toRad + 540) % 360) - 180, phi2 / toRad]
}

/** Initial great-circle bearing from `a` to `b`, degrees true in [0, 360). */
export function bearingDegrees(a: [number, number], b: [number, number]): number {
  const toRad = Math.PI / 180
  const phi1 = a[1] * toRad
  const phi2 = b[1] * toRad
  const dLambda = (b[0] - a[0]) * toRad
  const y = Math.sin(dLambda) * Math.cos(phi2)
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda)
  return (Math.atan2(y, x) / toRad + 360) % 360
}

/** `origin` displaced by a local east/north offset in meters. Either component may be negative. */
export function offsetPoint(
  origin: [number, number],
  eastM: number,
  northM: number,
): [number, number] {
  const range = Math.hypot(eastM, northM)
  if (range === 0) return [origin[0], origin[1]]
  return destinationPoint(origin, (Math.atan2(eastM, northM) * 180) / Math.PI, range)
}
