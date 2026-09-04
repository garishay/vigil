/**
 * The session's site set (08a, 08b, ruled on #86), pure: the operator's protected sites and
 * friendly launch areas as state, the operations the Sites surface performs on it, the rules a
 * site has to meet, and the site plan — the set as copyable JSON, and a pasted plan back into a
 * set. No React, no DOM, no I/O, no clock — `tSec` is an input, the seam the replay clock
 * drives, exactly as the lifecycle takes it.
 *
 * Config's site set is the default and the golden: the set opens as `fromConfig(...)`, every
 * recording and every test plays against it unless a session edits it, and edits are session
 * state — a reload returns to config. A site edit is a workflow action (#77): the set keeps the
 * sim time of its last edit as the editor's own frontier, so a later edit cannot land behind an
 * earlier one any more than an action can land behind the record.
 *
 * The operations throw on what the rules refuse — a full set, a name too long, a ring outside
 * the AO, the last protected site, a plan that is not one — as `appendEvent` refuses an illegal
 * transition: the panel asks `siteProblem` first and disables or explains, and the module
 * refuses anyway. A plan is copied and pasted by the operator; nothing is transmitted (§2).
 */

import type {
  AreaOfOperations,
  FriendlyArea,
  ProtectedSite,
  SiteKind,
  SiteRecord,
} from '../config/ao.ts'

/** A protected site in the session's set: the config shape plus when the operator added it. */
export interface SessionSite extends ProtectedSite {
  /** The sim time the operator added the site, or null for one that came from config. */
  addedTSec: number | null
}

/** A friendly launch area in the session's set (08b), stamped the same way. */
export interface SessionArea extends FriendlyArea {
  addedTSec: number | null
}

export interface SiteSet {
  sites: readonly SessionSite[]
  areas: readonly SessionArea[]
  /** The next id the set deals — `site-N` or `area-N`, one counter for both kinds. */
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
  /** Protected sites and friendly areas together. */
  maxSites: 20,
  /** What a placed site opens with; the fields refine it. */
  defaultRadiusM: 1000,
} as const

/** The set a session opens on: the configured sites and areas, unedited. */
export const fromConfig = (
  sites: readonly ProtectedSite[],
  areas: readonly FriendlyArea[] = [],
): SiteSet => ({
  sites: sites.map((site) => ({ ...site, addedTSec: null })),
  areas: areas.map((area) => ({ ...area, addedTSec: null })),
  nextId: sites.length + areas.length + 1,
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

const count = (set: SiteSet) => set.sites.length + set.areas.length

/** Whether one more site or area fits. */
export const canAdd = (set: SiteSet): boolean => count(set) < SITE_LIMITS.maxSites

/**
 * Whether a site may be removed: a friendly area always; a protected site only while another
 * remains, since the scorer needs one to measure range against.
 */
export const canRemove = (set: SiteSet, id: string): boolean =>
  set.areas.some((area) => area.id === id) || set.sites.length > 1

/** The kind of the site with this id, or null when the set holds no such site. */
export const kindOf = (set: SiteSet, id: string): SiteKind | null =>
  set.sites.some((site) => site.id === id)
    ? 'protected'
    : set.areas.some((area) => area.id === id)
      ? 'friendly'
      : null

/**
 * The set with a site placed at `center` — a whole site from one click: a dealt id, a default
 * name, tier 1 for a protected site, the default ring — stamped with the sim time it was added.
 */
export function addSite(
  set: SiteSet,
  center: [number, number],
  tSec: number,
  ao: AreaOfOperations,
  kind: SiteKind = 'protected',
): SiteSet {
  if (!canAdd(set)) throw new Error(`The set holds at most ${SITE_LIMITS.maxSites} sites`)
  const base = { center, radiusM: SITE_LIMITS.defaultRadiusM, addedTSec: tSec }
  const next = { nextId: set.nextId + 1, lastEditTSec: tSec }
  if (kind === 'friendly') {
    const area: SessionArea = {
      ...base,
      id: `area-${set.nextId}`,
      name: `Launch area ${set.nextId}`,
    }
    refuse(siteProblem(area, ao))
    return { ...set, ...next, areas: [...set.areas, area] }
  }
  const site: SessionSite = {
    ...base,
    id: `site-${set.nextId}`,
    name: `Site ${set.nextId}`,
    tier: 1,
  }
  refuse(siteProblem(site, ao))
  return { ...set, ...next, sites: [...set.sites, site] }
}

/**
 * The set with one site's name, tier, radius, or centre changed — never its id or its kind; a
 * friendly area has no tier and a tier in its patch is dropped.
 */
export function updateSite(
  set: SiteSet,
  id: string,
  patch: SitePatch,
  tSec: number,
  ao: AreaOfOperations,
): SiteSet {
  const siteIndex = set.sites.findIndex((site) => site.id === id)
  if (siteIndex >= 0) {
    const next: SessionSite = { ...set.sites[siteIndex], ...patch }
    refuse(siteProblem(next, ao))
    return {
      ...set,
      sites: set.sites.map((site, at) => (at === siteIndex ? next : site)),
      lastEditTSec: tSec,
    }
  }
  const areaIndex = set.areas.findIndex((area) => area.id === id)
  if (areaIndex < 0) throw new Error(`no site "${id}"`)
  const { name, radiusM, center } = { ...set.areas[areaIndex], ...patch }
  const next: SessionArea = { ...set.areas[areaIndex], name, radiusM, center }
  refuse(siteProblem(next, ao))
  return {
    ...set,
    areas: set.areas.map((area, at) => (at === areaIndex ? next : area)),
    lastEditTSec: tSec,
  }
}

/** The set without one site or area; the last protected site stays. */
export function removeSite(set: SiteSet, id: string, tSec: number): SiteSet {
  if (kindOf(set, id) === null) throw new Error(`no site "${id}"`)
  if (!canRemove(set, id)) throw new Error('The last protected site stays')
  return {
    ...set,
    sites: set.sites.filter((site) => site.id !== id),
    areas: set.areas.filter((area) => area.id !== id),
    lastEditTSec: tSec,
  }
}

/** The config set back, as an edit: the counter and the frontier carry on. */
export const resetSites = (
  set: SiteSet,
  config: readonly ProtectedSite[],
  tSec: number,
  areas: readonly FriendlyArea[] = [],
): SiteSet => ({
  ...fromConfig(config, areas),
  nextId: set.nextId,
  lastEditTSec: tSec,
})

const sameRing = (a: FriendlyArea, b: FriendlyArea) =>
  a.id === b.id &&
  a.name === b.name &&
  a.radiusM === b.radiusM &&
  a.center[0] === b.center[0] &&
  a.center[1] === b.center[1]

/** Whether the set differs from config in any site, area, or field — what "edited" means. */
export function edited(
  set: SiteSet,
  config: readonly ProtectedSite[],
  areas: readonly FriendlyArea[] = [],
): boolean {
  if (set.sites.length !== config.length || set.areas.length !== areas.length) return true
  return (
    set.sites.some(
      (site, index) => !sameRing(site, config[index]) || site.tier !== config[index].tier,
    ) || set.areas.some((area, index) => !sameRing(area, areas[index]))
  )
}

/** The set as the plan carries it: one list, each entry with its kind (08b). */
export const siteRecords = (set: SiteSet): SiteRecord[] => [
  ...set.sites.map(({ id, name, tier, center, radiusM }): SiteRecord => ({
    id,
    name,
    kind: 'protected',
    tier,
    center,
    radiusM,
  })),
  ...set.areas.map(({ id, name, center, radiusM }): SiteRecord => ({
    id,
    name,
    kind: 'friendly',
    center,
    radiusM,
  })),
]

/**
 * The site plan (08b, ruled on #86): the session's set as JSON, copyable — the AO it belongs to
 * and one entry per site with its kind. Copy only; nothing is transmitted.
 */
export const sitePlanText = (set: SiteSet, ao: AreaOfOperations): string =>
  JSON.stringify({ ao: ao.id, sites: siteRecords(set) }, null, 2)

const isPair = (value: unknown): value is [number, number] =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((n) => typeof n === 'number' && Number.isFinite(n))

/**
 * A pasted plan back into a set, or a throw saying why not — the panel prints the reason and
 * applies nothing. Checked in order: JSON, the AO, the list and its size, each entry's fields
 * and kind, unique ids, the rules every site meets, at least one protected site. A load is an
 * edit: every entry is stamped at `tSec`, and the counter runs on past every id it dealt or read.
 */
export function parseSitePlan(
  text: string,
  ao: AreaOfOperations,
  set: SiteSet,
  tSec: number,
): SiteSet {
  let plan: unknown
  try {
    plan = JSON.parse(text)
  } catch {
    throw new Error('Plan is not JSON')
  }
  if (typeof plan !== 'object' || plan === null || Array.isArray(plan)) {
    throw new Error('Plan is not a site plan')
  }
  const { ao: planAo, sites } = plan as { ao?: unknown; sites?: unknown }
  if (planAo !== ao.id) throw new Error(`Plan is for AO "${String(planAo)}", not "${ao.id}"`)
  if (!Array.isArray(sites)) throw new Error('Plan has no sites list')
  if (sites.length > SITE_LIMITS.maxSites) {
    throw new Error(`The set holds at most ${SITE_LIMITS.maxSites} sites`)
  }
  const nextSites: SessionSite[] = []
  const nextAreas: SessionArea[] = []
  const ids = new Set<string>()
  let maxN = set.nextId - 1
  sites.forEach((entry: unknown, index) => {
    const where = `Site ${index + 1}`
    if (typeof entry !== 'object' || entry === null) throw new Error(`${where} is not a site`)
    const { id, kind, name, tier, center, radiusM } = entry as Record<string, unknown>
    if (typeof id !== 'string' || id.length === 0) throw new Error(`${where} has no id`)
    if (ids.has(id)) throw new Error(`${where} repeats id "${id}"`)
    ids.add(id)
    if (typeof name !== 'string') throw new Error(`${where} has no name`)
    if (!isPair(center)) throw new Error(`${where} has no centre`)
    if (typeof radiusM !== 'number') throw new Error(`${where} has no radius`)
    const problem = siteProblem({ name, radiusM, center }, ao)
    if (problem) throw new Error(`${where}: ${problem}`)
    const n = Number(/-(\d+)$/.exec(id)?.[1])
    if (Number.isFinite(n)) maxN = Math.max(maxN, n)
    const base = { id, name, center, radiusM, addedTSec: tSec }
    if (kind === 'protected') {
      if (tier !== 1 && tier !== 2) throw new Error(`${where} needs tier 1 or 2`)
      nextSites.push({ ...base, tier })
    } else if (kind === 'friendly') {
      nextAreas.push(base)
    } else {
      throw new Error(`${where} has an unknown kind`)
    }
  })
  if (nextSites.length === 0) throw new Error('Plan needs at least one protected site')
  return { sites: nextSites, areas: nextAreas, nextId: maxN + 1, lastEditTSec: tSec }
}
