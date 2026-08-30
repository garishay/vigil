import { describe, expect, it } from 'vitest'
import { circlePolygon, distanceMeters } from './geo'

const PHL_CENTER: [number, number] = [-75.2411, 39.8721]

describe('circlePolygon', () => {
  it('returns a closed ring', () => {
    const ring = circlePolygon(PHL_CENTER, 5000).geometry.coordinates[0]
    expect(ring[0]).toEqual(ring[ring.length - 1])
  })

  it('puts every vertex at the requested radius from the center', () => {
    const radiusM = 5000
    const ring = circlePolygon(PHL_CENTER, radiusM).geometry.coordinates[0]
    const metersPerDegree = 111319.49
    for (const [lon, lat] of ring) {
      const dy = (lat - PHL_CENTER[1]) * metersPerDegree
      const dx = (lon - PHL_CENTER[0]) * metersPerDegree * Math.cos((PHL_CENTER[1] * Math.PI) / 180)
      expect(Math.hypot(dx, dy)).toBeCloseTo(radiusM, -2)
    }
  })

  it('scales with radius and carries properties through', () => {
    const small = circlePolygon(PHL_CENTER, 1000).geometry.coordinates[0][0]
    const large = circlePolygon(PHL_CENTER, 5000, { name: 'PHL Airfield' })
    expect(large.geometry.coordinates[0][0][0] - PHL_CENTER[0]).toBeGreaterThan(
      small[0] - PHL_CENTER[0],
    )
    expect(large.properties).toEqual({ name: 'PHL Airfield' })
  })
})

describe('distanceMeters', () => {
  const PHL_AIRFIELD: [number, number] = [-75.2411, 39.8721]

  it('is zero between a point and itself', () => {
    expect(distanceMeters(PHL_AIRFIELD, PHL_AIRFIELD)).toBe(0)
  })

  it('is symmetric', () => {
    const elsewhere: [number, number] = [-74.43, 40.47]
    expect(distanceMeters(PHL_AIRFIELD, elsewhere)).toBeCloseTo(
      distanceMeters(elsewhere, PHL_AIRFIELD),
      6,
    )
  })

  it('measures a degree of latitude as about 111 km', () => {
    expect(distanceMeters(PHL_AIRFIELD, [-75.2411, 40.8721])).toBeCloseTo(111195, -2)
  })

  it('shortens a degree of longitude by the cosine of the latitude', () => {
    const alongLon = distanceMeters(PHL_AIRFIELD, [-74.2411, 39.8721])
    expect(alongLon).toBeCloseTo(111195 * Math.cos((39.8721 * Math.PI) / 180), -2)
  })
})
