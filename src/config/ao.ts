/**
 * The area of operations is configuration, not code (scope §5). Relocating Vigil from PHL
 * to any other region is an edit to this file — no component reads a coordinate of its own.
 */

/** A site Vigil scores tracks against. Point plus radius; schedules are a later phase. */
export interface ProtectedSite {
  id: string
  name: string
  /** [longitude, latitude] — GeoJSON order, which is also MapLibre's order. */
  center: [number, number]
  /** Protection ring radius in meters. */
  radiusM: number
}

export interface AreaOfOperations {
  id: string
  name: string
  /** [longitude, latitude] the map opens on. */
  center: [number, number]
  /** Initial map zoom. */
  zoom: number
  /** [west, south, east, north] — the ADS-B capture window the PR 02 script will pull. */
  bbox: [number, number, number, number]
  /** MapLibre style document. Keyless and dark; see the PR 01 basemap decision. */
  basemapStyleUrl: string
  protectedSites: ProtectedSite[]
}

/**
 * CARTO Dark Matter: free, keyless, near-black, and it leaves the warm end of the spectrum
 * unspent so alarm color stays something a score has to earn (scope §4.3).
 */
const DARK_MATTER = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

export const PHL: AreaOfOperations = {
  id: 'phl',
  name: 'Philadelphia',
  center: [-75.2411, 39.8721],
  zoom: 10,
  bbox: [-76.05, 39.27, -74.43, 40.47],
  basemapStyleUrl: DARK_MATTER,
  protectedSites: [
    {
      id: 'phl-airfield',
      name: 'PHL Airfield',
      center: [-75.2411, 39.8721],
      // Demonstration value, not a published boundary — tuned when scoring lands in PR 04.
      radiusM: 5000,
    },
  ],
}

/** The AO Vigil currently watches. */
export const AO: AreaOfOperations = PHL
