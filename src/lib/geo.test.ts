import { describe, expect, it } from 'vitest'
import { circlePolygon } from './geo'

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
