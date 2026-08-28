import { describe, expect, it } from 'vitest'
import { AO, PHL } from './ao'

describe('area of operations config', () => {
  it('opens on a center inside its own capture bbox', () => {
    const [west, south, east, north] = PHL.bbox
    const [lon, lat] = PHL.center
    expect(lon).toBeGreaterThan(west)
    expect(lon).toBeLessThan(east)
    expect(lat).toBeGreaterThan(south)
    expect(lat).toBeLessThan(north)
  })

  it('describes a well-formed bbox', () => {
    const [west, south, east, north] = PHL.bbox
    expect(east).toBeGreaterThan(west)
    expect(north).toBeGreaterThan(south)
  })

  it('places every protected site inside the capture bbox with a positive radius', () => {
    const [west, south, east, north] = PHL.bbox
    expect(PHL.protectedSites.length).toBeGreaterThan(0)
    for (const site of PHL.protectedSites) {
      const [lon, lat] = site.center
      expect(lon).toBeGreaterThan(west)
      expect(lon).toBeLessThan(east)
      expect(lat).toBeGreaterThan(south)
      expect(lat).toBeLessThan(north)
      expect(site.radiusM).toBeGreaterThan(0)
    }
  })

  it('uses a keyless basemap style', () => {
    expect(PHL.basemapStyleUrl).toMatch(/^https:\/\//)
    expect(PHL.basemapStyleUrl).not.toMatch(/api[_-]?key|access[_-]?token/i)
  })

  it('exports PHL as the active AO', () => {
    expect(AO).toBe(PHL)
  })
})
