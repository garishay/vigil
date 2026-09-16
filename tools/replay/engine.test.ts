import { describe, expect, it } from 'vitest'
import { THREAT_ID } from '../../scripts/study.ts'
import { STUDY } from '../../src/config/study.ts'
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
