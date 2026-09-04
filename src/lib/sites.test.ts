import { describe, expect, it } from 'vitest'
import { AO } from '../config/ao'
import {
  SITE_LIMITS,
  addSite,
  canAdd,
  canRemove,
  edited,
  fromConfig,
  removeSite,
  resetSites,
  siteProblem,
  updateSite,
  kindOf,
  parseSitePlan,
  sitePlanText,
  siteRecords,
} from './sites'

const CONFIG = AO.protectedSites
const [west, south, east, north] = AO.bbox
/** A centre well inside the AO, away from the configured site. */
const INSIDE: [number, number] = [(west + east) / 2 + 0.1, (south + north) / 2 + 0.1]

describe('the session site set (08a)', () => {
  it('opens as the config set, unedited, with nothing yet added', () => {
    const set = fromConfig(CONFIG)
    expect(set.sites.map((site) => site.id)).toEqual(CONFIG.map((site) => site.id))
    expect(set.sites.every((site) => site.addedTSec === null)).toBe(true)
    expect(set.nextId).toBe(CONFIG.length + 1)
    expect(set.lastEditTSec).toBeNull()
    expect(edited(set, CONFIG)).toBe(false)
    // The config set is untouched by construction: the session holds copies.
    expect(set.sites[0]).not.toBe(CONFIG[0])
    expect(set.sites[0]).toMatchObject(CONFIG[0])
  })

  it('adds a whole site from one placement — dealt id, default name, tier 1, the default ring, stamped at sim time', () => {
    const set = addSite(fromConfig(CONFIG), INSIDE, 600, AO)
    expect(set.sites).toHaveLength(CONFIG.length + 1)
    expect(set.sites.at(-1)).toEqual({
      id: `site-${CONFIG.length + 1}`,
      name: `Site ${CONFIG.length + 1}`,
      center: INSIDE,
      radiusM: SITE_LIMITS.defaultRadiusM,
      tier: 1,
      addedTSec: 600,
    })
    expect(set.nextId).toBe(CONFIG.length + 2)
    expect(set.lastEditTSec).toBe(600)
    expect(edited(set, CONFIG)).toBe(true)
  })

  it('refuses a placement outside the AO, and a set at its limit', () => {
    expect(() => addSite(fromConfig(CONFIG), [west - 1, south], 0, AO)).toThrow(/outside the AO/)
    let set = fromConfig(CONFIG)
    while (canAdd(set)) set = addSite(set, INSIDE, 0, AO)
    expect(set.sites).toHaveLength(SITE_LIMITS.maxSites)
    expect(() => addSite(set, INSIDE, 0, AO)).toThrow(/at most 20 sites/)
  })

  it('updates name, tier, radius, and centre — never the id — and stamps the edit', () => {
    const base = addSite(fromConfig(CONFIG), INSIDE, 0, AO)
    const id = base.sites.at(-1)!.id
    const moved: [number, number] = [INSIDE[0] + 0.05, INSIDE[1]]
    const set = updateSite(
      base,
      id,
      { name: 'Approach fence', tier: 2, radiusM: 1500, center: moved },
      45,
      AO,
    )
    expect(set.sites.at(-1)).toMatchObject({
      id,
      name: 'Approach fence',
      tier: 2,
      radiusM: 1500,
      center: moved,
      addedTSec: 0,
    })
    expect(set.lastEditTSec).toBe(45)
    // The other site is the same object: an update is one site's, not a rebuild.
    expect(set.sites[0]).toBe(base.sites[0])
    expect(() => updateSite(base, 'site-99', { tier: 2 }, 0, AO)).toThrow(/no site/)
  })

  it('refuses what the rules refuse, in the words the panel prints', () => {
    const base = fromConfig(CONFIG)
    const id = CONFIG[0].id
    expect(() => updateSite(base, id, { name: '' }, 0, AO)).toThrow('Name is required')
    expect(() => updateSite(base, id, { name: '   ' }, 0, AO)).toThrow('Name is required')
    expect(() => updateSite(base, id, { name: 'x'.repeat(21) }, 0, AO)).toThrow(
      'Name is at most 20 characters',
    )
    expect(() => updateSite(base, id, { radiusM: 99 }, 0, AO)).toThrow('Radius is 100–20,000 m')
    expect(() => updateSite(base, id, { radiusM: 20_001 }, 0, AO)).toThrow('Radius is 100–20,000 m')
    expect(() => updateSite(base, id, { radiusM: Number.NaN }, 0, AO)).toThrow(/Radius/)
    expect(() => updateSite(base, id, { center: [east + 1, north] }, 0, AO)).toThrow(
      'Centre is outside the AO',
    )
    // A name of exactly the cap is allowed: the handoff's site line fits at 20.
    expect(updateSite(base, id, { name: 'x'.repeat(20) }, 0, AO).sites[0].name).toHaveLength(20)
    expect(siteProblem({ name: 'Stadium', radiusM: 500, center: INSIDE }, AO)).toBeNull()
  })

  it('removes a site, but never the last protected site', () => {
    const two = addSite(fromConfig(CONFIG), INSIDE, 0, AO)
    expect(canRemove(two, two.sites.at(-1)!.id)).toBe(true)
    const one = removeSite(two, two.sites.at(-1)!.id, 90)
    expect(one.sites.map((site) => site.id)).toEqual(CONFIG.map((site) => site.id))
    expect(one.lastEditTSec).toBe(90)
    expect(canRemove(one, CONFIG[0].id)).toBe(false)
    expect(() => removeSite(one, CONFIG[0].id, 0)).toThrow('The last protected site stays')
    expect(() => removeSite(two, 'site-99', 0)).toThrow(/no site/)
  })

  it('resets to config as an edit: the sites are config’s again, the counter and frontier carry on', () => {
    const grown = addSite(addSite(fromConfig(CONFIG), INSIDE, 0, AO), INSIDE, 30, AO)
    const reset = resetSites(grown, CONFIG, 120)
    expect(reset.sites.map((site) => site.id)).toEqual(CONFIG.map((site) => site.id))
    expect(edited(reset, CONFIG)).toBe(false)
    // Ids are never reused within a session: a site added after a reset gets a fresh one.
    expect(reset.nextId).toBe(grown.nextId)
    expect(reset.lastEditTSec).toBe(120)
  })

  it('reads edited off any field, not only the count', () => {
    const base = fromConfig(CONFIG)
    const id = CONFIG[0].id
    expect(edited(updateSite(base, id, { tier: 2 }, 0, AO), CONFIG)).toBe(true)
    expect(edited(updateSite(base, id, { radiusM: CONFIG[0].radiusM + 100 }, 0, AO), CONFIG)).toBe(
      true,
    )
    expect(edited(updateSite(base, id, { name: 'Renamed' }, 0, AO), CONFIG)).toBe(true)
    // Edited back to the config values reads unedited again — the set, not the history, decides.
    const roundTrip = updateSite(
      updateSite(base, id, { tier: 2 }, 0, AO),
      id,
      { tier: CONFIG[0].tier },
      0,
      AO,
    )
    expect(edited(roundTrip, CONFIG)).toBe(false)
  })
})

describe('friendly launch areas and the site plan (08b, ruled on #86)', () => {
  it('adds a friendly area from a placement — its own id and name, no tier, removable always', () => {
    const set = addSite(fromConfig(CONFIG), INSIDE, 600, AO, 'friendly')
    expect(set.areas).toEqual([
      { id: 'area-2', name: 'Launch area 2', center: INSIDE, radiusM: 1000, addedTSec: 600 },
    ])
    expect(set.sites).toHaveLength(CONFIG.length)
    expect(set.nextId).toBe(3)
    expect(kindOf(set, 'area-2')).toBe('friendly')
    expect(kindOf(set, 'site-9')).toBeNull()
    expect(canRemove(set, 'area-2')).toBe(true)
    expect(canRemove(set, CONFIG[0].id)).toBe(false)
    expect(edited(set, CONFIG)).toBe(true)
    // A tier in an area's patch is dropped; the other fields apply.
    const renamed = updateSite(
      set,
      'area-2',
      { name: 'Drone unit pad', radiusM: 500, tier: 2 },
      610,
      AO,
    )
    expect(renamed.areas[0]).toEqual({
      id: 'area-2',
      name: 'Drone unit pad',
      center: INSIDE,
      radiusM: 500,
      addedTSec: 600,
    })
    expect(() => updateSite(set, 'area-2', { radiusM: 5 }, 0, AO)).toThrow(/Radius/)
    expect(removeSite(renamed, 'area-2', 620).areas).toEqual([])
    expect(resetSites(renamed, CONFIG, 630).areas).toEqual([])
    expect(edited(fromConfig(CONFIG, []), CONFIG, [])).toBe(false)
  })

  it('counts both kinds against the limit', () => {
    let set = fromConfig(CONFIG)
    while (canAdd(set)) set = addSite(set, INSIDE, 0, AO, 'friendly')
    expect(set.sites.length + set.areas.length).toBe(SITE_LIMITS.maxSites)
    expect(() => addSite(set, INSIDE, 0, AO)).toThrow(/at most 20 sites/)
  })

  it('copies the set as a plan and loads it back as one edit', () => {
    const set = updateSite(
      addSite(addSite(fromConfig(CONFIG), INSIDE, 0, AO), INSIDE, 30, AO, 'friendly'),
      'site-2',
      { tier: 2, name: 'Stadium' },
      40,
      AO,
    )
    const text = sitePlanText(set, AO)
    const plan = JSON.parse(text) as {
      ao: string
      sites: { id: string; kind: string; tier?: number }[]
    }
    expect(plan.ao).toBe(AO.id)
    expect(plan.sites.map((site) => [site.id, site.kind, site.tier])).toEqual([
      [CONFIG[0].id, 'protected', 1],
      ['site-2', 'protected', 2],
      ['area-3', 'friendly', undefined],
    ])
    const loaded = parseSitePlan(text, AO, fromConfig(CONFIG), 900)
    expect(siteRecords(loaded)).toEqual(siteRecords(set))
    expect(loaded.areas[0].addedTSec).toBe(900)
    expect(loaded.lastEditTSec).toBe(900)
    // The counter runs on past every id the plan carried.
    expect(loaded.nextId).toBe(4)
  })

  it('refuses a plan that is not one, in its own words, applying nothing', () => {
    const base = fromConfig(CONFIG)
    const load = (text: string) => () => parseSitePlan(text, AO, base, 0)
    const good = {
      id: 'site-9',
      kind: 'protected',
      name: 'Ok',
      tier: 1,
      center: INSIDE,
      radiusM: 500,
    }
    const plan = (sites: unknown[]) => JSON.stringify({ ao: AO.id, sites })
    expect(load('nope')).toThrow('Plan is not JSON')
    expect(load('[]')).toThrow('Plan is not a site plan')
    expect(load('{"ao":"dfw","sites":[]}')).toThrow('Plan is for AO "dfw", not "phl"')
    expect(load('{"ao":"phl"}')).toThrow('Plan has no sites list')
    expect(load(plan([]))).toThrow('Plan needs at least one protected site')
    expect(load(plan([{ ...good, kind: 'friendly' }]))).toThrow('at least one protected site')
    expect(load(plan([good, { ...good }]))).toThrow('Site 2 repeats id "site-9"')
    expect(load(plan([{ ...good, tier: 3 }]))).toThrow('Site 1 needs tier 1 or 2')
    expect(load(plan([{ ...good, kind: 'corridor' }]))).toThrow('Site 1 has an unknown kind')
    expect(load(plan([{ ...good, radiusM: 5 }]))).toThrow('Site 1: Radius is 100–20,000 m')
    expect(load(plan([{ ...good, center: [0] }]))).toThrow('Site 1 has no centre')
    expect(load(plan([{ ...good, name: 7 }]))).toThrow('Site 1 has no name')
    expect(load(plan(['x']))).toThrow('Site 1 is not a site')
    expect(
      load(plan(Array.from({ length: 21 }, (_, i) => ({ ...good, id: `site-${i}` })))),
    ).toThrow('at most 20 sites')
    // A loaded plan whose ids sit above the counter moves the counter past them.
    expect(parseSitePlan(plan([{ ...good, id: 'site-40' }]), AO, base, 0).nextId).toBe(41)
  })
})
