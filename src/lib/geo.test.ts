import { describe, expect, it } from 'vitest'
import { bearingDegrees, circlePolygon, destinationPoint, distanceMeters, offsetPoint } from './geo'

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

describe('destinationPoint', () => {
  const phl = PHL_CENTER

  it('round-trips with distanceMeters', () => {
    for (const bearing of [0, 45, 137.5, 270, 359]) {
      for (const range of [100, 5_000, 25_000]) {
        const there = destinationPoint(phl, bearing, range)
        expect(distanceMeters(phl, there)).toBeCloseTo(range, 3)
      }
    }
  })

  it('walks north, east, south, and west as expected', () => {
    expect(destinationPoint(phl, 0, 1000)[1]).toBeGreaterThan(phl[1])
    expect(destinationPoint(phl, 180, 1000)[1]).toBeLessThan(phl[1])
    expect(destinationPoint(phl, 90, 1000)[0]).toBeGreaterThan(phl[0])
    expect(destinationPoint(phl, 270, 1000)[0]).toBeLessThan(phl[0])
  })

  it('returns the origin for a zero distance', () => {
    const [lon, lat] = destinationPoint(phl, 42, 0)
    expect(lon).toBeCloseTo(phl[0], 9)
    expect(lat).toBeCloseTo(phl[1], 9)
  })
})

describe('bearingDegrees', () => {
  const phl = PHL_CENTER

  it('inverts destinationPoint', () => {
    for (const bearing of [0, 45, 137.5, 270, 359]) {
      const measured = bearingDegrees(phl, destinationPoint(phl, bearing, 8000))
      // Compared on the circle: due north round-trips as 359.999…, which is the wrap, not an error.
      const error = Math.abs(((measured - bearing + 540) % 360) - 180)
      expect(error).toBeLessThan(1e-6)
    }
  })

  it('stays inside [0, 360)', () => {
    for (const bearing of [0, 90, 180, 270, 359.9]) {
      const value = bearingDegrees(phl, destinationPoint(phl, bearing, 3000))
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(360)
    }
  })
})

describe('offsetPoint', () => {
  const phl = PHL_CENTER

  it('treats east and north as signed components', () => {
    expect(offsetPoint(phl, 500, 0)[0]).toBeGreaterThan(phl[0])
    expect(offsetPoint(phl, -500, 0)[0]).toBeLessThan(phl[0])
    expect(offsetPoint(phl, 0, 500)[1]).toBeGreaterThan(phl[1])
    expect(offsetPoint(phl, 0, -500)[1]).toBeLessThan(phl[1])
  })

  it('displaces by the hypotenuse of its components', () => {
    expect(distanceMeters(phl, offsetPoint(phl, 300, 400))).toBeCloseTo(500, 3)
  })

  it('returns the origin for a zero offset', () => {
    expect(offsetPoint(phl, 0, 0)).toEqual(phl)
  })
})
