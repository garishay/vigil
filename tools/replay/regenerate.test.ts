import { describe, expect, it } from 'vitest'
import { REVISIT_ID, THREAT_ID } from '../../scripts/study.ts'
import { SCORING } from '../../src/config/scoring.ts'
import { STUDY } from '../../src/config/study.ts'
import { trackIdent } from '../../src/lib/display.ts'
import { planFor } from './load.ts'
import { loadStudy } from './files.ts'
import {
  associationFor,
  entrySecond,
  pictureAtSecond,
  rangeM,
  SITE,
  trackAtSecond,
} from './regenerate.ts'

const study = loadStudy()
const plan02a = planFor('02a', study.timeline)
const plan02b = planFor('02b', study.timeline)

describe('the regeneration (S5a, #138, ruled A3)', () => {
  it('uses each condition’s association distance — raw’s 1 500 m, the scorer’s threshold for Vigil', () => {
    expect(associationFor('raw')).toBe(1500)
    expect(associationFor('vigil')).toBe(SCORING.cooperativity.mismatchM)
    // The study's lie is 1.1 km: within raw's distance, past Vigil's.
    expect(associationFor('raw')).toBeGreaterThan(1100)
    expect(associationFor('vigil')).toBeLessThan(1100)
  })

  it('rebuilds the picture at a scenario second: the real layer and the injects, 96 tracks at Begin + 1 on 02a', () => {
    const picture = pictureAtSecond(study.index, plan02a, STUDY.beginS + 1, 'raw')
    expect(picture.filter((track) => track.source === 'adsb')).toHaveLength(69)
    expect(picture.filter((track) => track.source === 'inject')).toHaveLength(27)
    expect(pictureAtSecond(study.index, plan02a, STUDY.beginS, 'raw')).toHaveLength(95)
  })

  it('reads the threat’s ident as the run’s screen showed it — by mode on 02a', () => {
    const at538 = (mode: 'raw' | 'vigil') =>
      trackAtSecond(study.index, plan02a, THREAT_ID, STUDY.beginS + 58, mode)
    expect(trackIdent(at538('raw')!)).toBe('UAS-8F21')
    expect(trackIdent(at538('vigil')!)).toBe('TRK-11')
    expect(Math.round(rangeM(at538('raw')!))).toBe(6174)
    expect(Math.round(rangeM(at538('vigil')!))).toBe(6174)
    // Not in the picture before its first frame.
    expect(trackAtSecond(study.index, plan02a, THREAT_ID, STUDY.beginS, 'raw')).toBeNull()
  })

  it('reads the ident by mode and by time on 02b, where the lie begins at T0 + 30 (ruled A9)', () => {
    const ident = (tSec: number, mode: 'raw' | 'vigil') =>
      trackIdent(trackAtSecond(study.index, plan02b, THREAT_ID, tSec, mode)!)
    // Heard and consistent before the lie: both conditions read the Remote ID.
    expect(ident(STUDY.beginS + 1, 'raw')).toBe('UAS-8F21')
    expect(ident(STUDY.beginS + 1, 'vigil')).toBe('UAS-8F21')
    expect(ident(STUDY.beginS + 29, 'vigil')).toBe('UAS-8F21')
    // From the lie on: raw's rule at 1 500 m still associates a 1.1 km lie; Vigil's withholds it.
    expect(ident(STUDY.beginS + 30, 'raw')).toBe('UAS-8F21')
    expect(ident(STUDY.beginS + 30, 'vigil')).toBe('TRK-11')
    expect(ident(STUDY.beginS + 58, 'vigil')).toBe('TRK-11')
  })

  it('finds the ring entry from the plan — 604 s on 02a, 603 s on 02b — and none for a track that never enters', () => {
    expect(SITE.radiusM).toBe(5000)
    expect(entrySecond(plan02a, THREAT_ID, STUDY.beginS, study.index.durationS)).toBe(604)
    expect(entrySecond(plan02b, THREAT_ID, STUDY.beginS, study.index.durationS)).toBe(603)
    // Over the whole recording, as the metrics read it: the same seconds, nothing earlier.
    expect(entrySecond(plan02a, THREAT_ID, 0, study.index.durationS)).toBe(604)
    expect(entrySecond(plan02b, THREAT_ID, 0, study.index.durationS)).toBe(603)
    expect(entrySecond(plan02a, REVISIT_ID, 0, study.index.durationS)).toBeNull()
    // The span is inclusive at both ends and empty past it.
    expect(entrySecond(plan02a, THREAT_ID, 604, 604)).toBe(604)
    expect(entrySecond(plan02a, THREAT_ID, 0, 603)).toBeNull()
  })
})
