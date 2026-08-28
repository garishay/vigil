import type { Feature, Polygon } from 'geojson'

/** WGS-84 equatorial radius, meters. */
const EARTH_RADIUS_M = 6378137

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
