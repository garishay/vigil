/**
 * The session's site set (08a, ruled on #86), pure: the operator's protected sites as state, the
 * operations the Sites surface performs on it, and the rules a site has to meet. No React, no
 * DOM, no I/O, no clock — `tSec` is an input, the seam the replay clock drives, exactly as the
 * lifecycle takes it.
 *
 * Config's site set is the default and the golden: the set opens as `fromConfig(AO.protectedSites)`,
 * every recording and every test plays against it unless a session edits it, and edits are
 * session state — a reload returns to config. A site edit is a workflow action (#77): the set
 * keeps the sim time of its last edit as the editor's own frontier, so a later edit cannot land
 * behind an earlier one any more than an action can land behind the record.
 *
 * The operations throw on what the rules refuse — a full set, a name too long, a ring outside
 * the AO, the last protected site — as `appendEvent` refuses an illegal transition: the panel
 * asks `siteProblem` first and disables or explains, and the module refuses anyway.
 */

import type { AreaOfOperations, ProtectedSite } from '../config/ao.ts'

/** A protected site in the session's set: the config shape plus when the operator added it. */
export interface SessionSite extends ProtectedSite {
  /** The sim time the operator added the site, or null for one that came from config. */
  addedTSec: number | null
}

export interface SiteSet {
  sites: readonly SessionSite[]
  /** The next id the set deals — `site-N`, counted on from the config set's length. */
  nextId: number
  /** The sim time of the last edit — the editor's frontier (#77) — or null before any edit. */
  lastEditTSec: number | null
}

/** The rules a site has to meet, in one place so the panel and the module agree. */
export const SITE_LIMITS = {
  /** Keeps the handoff's site line inside the drawer's 53-character fit (#36 [5]). */
  nameMax: 20,
  radiusMinM: 100,
  radiusMaxM: 20_000,
  maxSites: 20,
  /** What a placed site opens with; the fields refine it. */
  defaultRadiusM: 1000,
} as const

/** The set a session opens on: the configured sites, unedited. */
export const fromConfig = (sites: readonly ProtectedSite[]): SiteSet => ({
  sites: sites.map((site) => ({ ...site, addedTSec: null })),
  nextId: sites.length + 1,
  lastEditTSec: null,
})

export type SitePatch = Partial<Pick<SessionSite, 'name' | 'tier' | 'radiusM' | 'center'>>

/** Why a site is not allowed, in the panel's words, or null when it is. */
export function siteProblem(
  site: Pick<ProtectedSite, 'name' | 'radiusM' | 'center'>,
  ao: AreaOfOperations,
): string | null {
  const name = site.name.trim()
  if (name.length === 0) return 'Name is required'
  if (name.length > SITE_LIMITS.nameMax) return `Name is at most ${SITE_LIMITS.nameMax} characters`
  if (
    !Number.isFinite(site.radiusM) ||
    site.radiusM < SITE_LIMITS.radiusMinM ||
    site.radiusM > SITE_LIMITS.radiusMaxM
  ) {
    return `Radius is ${SITE_LIMITS.radiusMinM}–${SITE_LIMITS.radiusMaxM.toLocaleString('en-US')} m`
  }
  const [west, south, east, north] = ao.bbox
  const [lon, lat] = site.center
  if (lon < west || lon > east || lat < south || lat > north) return 'Centre is outside the AO'
  return null
}

const refuse = (problem: string | null): void => {
  if (problem !== null) throw new Error(problem)
}

/** Whether one more site fits. */
export const canAdd = (set: SiteSet): boolean => set.sites.length < SITE_LIMITS.maxSites

/** Whether a site may be removed: the scorer needs one protected site to measure range against. */
export const canRemove = (set: SiteSet): boolean => set.sites.length > 1

/**
 * The set with a site placed at `center` — a whole site from one click: a dealt id, a default
 * name, tier 1, the default ring — stamped with the sim time it was added.
 */
export function addSite(
  set: SiteSet,
  center: [number, number],
  tSec: number,
  ao: AreaOfOperations,
): SiteSet {
  if (!canAdd(set)) throw new Error(`The set holds at most ${SITE_LIMITS.maxSites} sites`)
  const site: SessionSite = {
    id: `site-${set.nextId}`,
    name: `Site ${set.nextId}`,
    center,
    radiusM: SITE_LIMITS.defaultRadiusM,
    tier: 1,
    addedTSec: tSec,
  }
  refuse(siteProblem(site, ao))
  return { sites: [...set.sites, site], nextId: set.nextId + 1, lastEditTSec: tSec }
}

/** The set with one site's name, tier, radius, or centre changed — never its id or its kind. */
export function updateSite(
  set: SiteSet,
  id: string,
  patch: SitePatch,
  tSec: number,
  ao: AreaOfOperations,
): SiteSet {
  const index = set.sites.findIndex((site) => site.id === id)
  if (index < 0) throw new Error(`no site "${id}"`)
  const next: SessionSite = { ...set.sites[index], ...patch }
  refuse(siteProblem(next, ao))
  return {
    ...set,
    sites: set.sites.map((site, at) => (at === index ? next : site)),
    lastEditTSec: tSec,
  }
}

/** The set without one site; the last protected site stays. */
export function removeSite(set: SiteSet, id: string, tSec: number): SiteSet {
  if (!set.sites.some((site) => site.id === id)) throw new Error(`no site "${id}"`)
  if (!canRemove(set)) throw new Error('The last protected site stays')
  return { ...set, sites: set.sites.filter((site) => site.id !== id), lastEditTSec: tSec }
}

/** The config set back, as an edit: the counter and the frontier carry on. */
export const resetSites = (
  set: SiteSet,
  config: readonly ProtectedSite[],
  tSec: number,
): SiteSet => ({
  ...fromConfig(config),
  nextId: set.nextId,
  lastEditTSec: tSec,
})

/** Whether the set differs from config in any site or field — what "edited" on the panel means. */
export function edited(set: SiteSet, config: readonly ProtectedSite[]): boolean {
  if (set.sites.length !== config.length) return true
  return set.sites.some((site, index) => {
    const base = config[index]
    return (
      site.id !== base.id ||
      site.name !== base.name ||
      site.tier !== base.tier ||
      site.radiusM !== base.radiusM ||
      site.center[0] !== base.center[0] ||
      site.center[1] !== base.center[1]
    )
  })
}
