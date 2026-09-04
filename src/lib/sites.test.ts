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
    expect(canRemove(two)).toBe(true)
    const one = removeSite(two, two.sites.at(-1)!.id, 90)
    expect(one.sites.map((site) => site.id)).toEqual(CONFIG.map((site) => site.id))
    expect(one.lastEditTSec).toBe(90)
    expect(canRemove(one)).toBe(false)
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
