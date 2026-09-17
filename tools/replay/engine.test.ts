import { describe, expect, it } from 'vitest'
import { THREAT_ID } from '../../scripts/study.ts'
import { STUDY } from '../../src/config/study.ts'
import { AO } from '../../src/config/ao.ts'
import { reasonTag } from '../../src/lib/display.ts'
import { candidatesAt, rankedAtSecond } from './engine.ts'
import { loadStudy, planFor } from './load.ts'

const study = loadStudy()
const FREEZE = STUDY.beginS + 58

describe('the engine at a scenario second (S5b, #138, ruled B1)', () => {
  it('ranks the picture as Vigil does: the threat rank 1 in warning at the fixtures’ freeze on 02a', () => {
    const ranked = rankedAtSecond(study, planFor('02a', study.timeline), FREEZE)
    expect(ranked).toHaveLength(99)
    expect(ranked.map((entry) => entry.rank)).toEqual(ranked.map((_, i) => i + 1))
    expect(ranked[0]).toMatchObject({ rank: 1, composite: 72, band: 'warning' })
    expect(ranked[0].track.id).toBe(THREAT_ID)
    expect(Math.round(ranked[0].rangeM)).toBe(6174)
  })

  it('reads the above-calm set at 538 s as the bench does — five injects in rank order, the same on 02a and 02b', () => {
    const read = (scenario: '02a' | '02b') =>
      candidatesAt(rankedAtSecond(study, planFor(scenario, study.timeline), FREEZE)).map(
        (entry) => `${entry.rank}:${entry.track.id}:${entry.composite}:${entry.band}`,
      )
    const expected = [
      `1:${THREAT_ID}:72:warning`,
      '2:inject-12:64:caution',
      '3:inject-13:58:caution',
      '4:inject-17:49:caution',
      '5:inject-37:45:caution',
    ]
    expect(read('02a')).toEqual(expected)
    expect(read('02b')).toEqual(expected)
  })

  it('takes no mode: one set for both conditions, since the score reads the broadcast and never the word', () => {
    expect(rankedAtSecond.length).toBe(3)
    const plan = planFor('02b', study.timeline)
    // At Begin + 1 on 02b the threat is heard and consistent; the candidates are the same set
    // whatever a screen labelled them.
    const early = candidatesAt(rankedAtSecond(study, plan, STUDY.beginS + 1)).map(
      (entry) => entry.track.id,
    )
    expect(early).toContain(THREAT_ID)
    expect(early.every((id) => id.startsWith('inject-'))).toBe(true)
  })
})

describe('the engine carries the score (S5c-ii, #138, ruled C1)', () => {
  it('puts the app’s score and its site on each entry, so the reason tag and the mismatch line read it as the Queue does', () => {
    const [first] = rankedAtSecond(study, planFor('02a', study.timeline), FREEZE)
    expect(Math.round(first.score.composite)).toBe(first.composite)
    expect(first.score.band).toBe(first.band)
    expect(first.siteId).toBe(first.score.siteId)
    expect(first.score.mismatch).toMatchObject({ label: 'UAS-8F21' })
    expect(Math.round(first.score.mismatch!.distanceM)).toBe(1100)
    expect(reasonTag(first, AO.protectedSites)).toBe(
      'Remote ID mismatch, closing, near PHL Airfield',
    )
  })

  it('reads twenty-six above calm at the 03a Vigil fixture’s freeze, 551 s, with the Queue’s own tags (S7c, #163)', () => {
    const tags = candidatesAt(
      rankedAtSecond(study, planFor('03a', study.timeline), STUDY.beginS + 71),
    ).map(
      (entry) =>
        `${entry.rank} ${entry.track.id} ${entry.composite} · ${reasonTag(entry, AO.protectedSites)}`,
    )
    expect(tags).toEqual([
      '1 inject-11 73 · Non-cooperative, closing, near PHL Airfield',
      '2 inject-12 73 · Non-cooperative, closing, near PHL Airfield',
      '3 inject-42 68 · Non-cooperative, closing, near PHL Airfield',
      '4 inject-49 68 · Non-cooperative, closing, near PHL Airfield',
      '5 inject-13 68 · Loitering, non-cooperative, near PHL Airfield',
      '6 inject-41 67 · Non-cooperative, closing, near PHL Airfield',
      '7 inject-48 67 · Non-cooperative, closing, near PHL Airfield',
      '8 inject-52 66 · Loitering, non-cooperative, near PHL Airfield',
      '9 inject-53 65 · Loitering, non-cooperative, near PHL Airfield',
      '10 inject-16 63 · Non-cooperative, closing, near PHL Airfield',
      '11 inject-54 63 · Loitering, non-cooperative, low and slow',
      '12 inject-51 62 · Non-cooperative, closing, low and slow',
      '13 inject-55 61 · Loitering, non-cooperative, low and slow',
      '14 inject-15 61 · Orbiting, non-cooperative, low and slow',
      '15 inject-50 60 · Non-cooperative, closing, low and slow',
      '16 inject-43 59 · Non-cooperative, closing, low and slow',
      '17 inject-45 57 · Non-cooperative, closing, low and slow',
      '18 inject-44 54 · Non-cooperative, closing, low and slow',
      '19 inject-14 51 · Non-cooperative, near PHL Airfield, low and slow',
      '20 inject-56 51 · Non-cooperative, near PHL Airfield, low and slow',
      '21 inject-46 50 · Non-cooperative, near PHL Airfield, low and slow',
      '22 inject-57 49 · Non-cooperative, near PHL Airfield, low and slow',
      '23 inject-47 48 · Non-cooperative, near PHL Airfield, low and slow',
      '24 inject-58 47 · Non-cooperative, low and slow, near PHL Airfield',
      '25 inject-37 45 · Closing, near PHL Airfield, low and slow',
      '26 inject-59 45 · Non-cooperative, low and slow, near PHL Airfield',
    ])
  })
})
