/**
 * The area of operations is configuration, not code (scope §5). Relocating Vigil from PHL
 * to any other region is an edit to this file — no component reads a coordinate of its own.
 */

/**
 * A site's tier (08a, ruled on #86): 1 is protected in full; 2 scales the geometry factors by
 * `tierMultiplier` in `config/scoring.ts` — attend, not act, until the track behaves.
 */
export type SiteTier = 1 | 2

/** A site Vigil scores tracks against. Point plus radius; schedules are a later phase. */
export interface ProtectedSite {
  id: string
  name: string
  /** [longitude, latitude] — GeoJSON order, which is also MapLibre's order. */
  center: [number, number]
  /** Protection ring radius in meters. */
  radiusM: number
  tier: SiteTier
}

/** The kinds of site an operator can declare (08a, 08b). */
export type SiteKind = 'protected' | 'friendly'

/**
 * A friendly launch area (08b, ruled on #86): a declared launch zone — a department's own drone
 * unit's pad. A track whose observed first-seen position lies inside one *and* which is heard
 * on Remote ID is capped like a cooperative aircraft (`friendlyCap` in `config/scoring.ts`); a
 * silent track first seen inside one gets no cap — the origin is observed, the identity is not.
 * The condition reads the picture, never the generator's launch points. A circle, like a site;
 * no tier — it protects nothing, it vouches.
 */
export interface FriendlyArea {
  id: string
  name: string
  center: [number, number]
  radiusM: number
}

/**
 * A site as the record carries it (08a, ruled on #86): the set the operator saw when a track
 * was scored, on the score and on every event's snapshot — id, kind, tier for a protected site,
 * centre, radius, and the name, so a site removed later is still named where the record prints
 * it. Operator-typed configuration, never a person.
 */
export interface SiteRecord {
  id: string
  name: string
  kind: SiteKind
  /** Protected sites only; a friendly area carries none. */
  tier?: SiteTier
  center: [number, number]
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
  /**
   * The IANA zone the AO keeps its clock in (#84). A recording whose clock opens at its capture
   * wall time reads `capturedAt` in this zone, so relocating the AO relocates its clock.
   */
  timeZone: string
  /** MapLibre style document. Keyless and dark; see the PR 01 basemap decision. */
  basemapStyleUrl: string
  protectedSites: ProtectedSite[]
  /** The default friendly launch areas — none: a department declares its own, per session (08b). */
  friendlyAreas: FriendlyArea[]
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
  timeZone: 'America/New_York',
  basemapStyleUrl: DARK_MATTER,
  protectedSites: [
    {
      id: 'phl-airfield',
      name: 'PHL Airfield',
      center: [-75.2411, 39.8721],
      // Demonstration value, not a published boundary — tuned when scoring lands in PR 04.
      radiusM: 5000,
      tier: 1,
    },
  ],
  friendlyAreas: [],
}

/** The AO Vigil currently watches. */
export const AO: AreaOfOperations = PHL
