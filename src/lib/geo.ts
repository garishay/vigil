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
