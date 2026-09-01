import { describe, expect, it } from 'vitest'
import { classify, describeCategory } from './airframe'
import {
  AIRFRAME_LABEL,
  EMITTER_CATEGORIES,
  KINEMATIC_CLASS,
  TYPE_CODE_AIRFRAME,
} from '../config/airframes'
import type { AdsbTrack, InjectTrack } from './tracks'

const adsb = (extra: Partial<AdsbTrack> = {}): AdsbTrack => ({
  id: 'adsb-a0540a',
  source: 'adsb',
  icaoHex: 'a0540a',
  identity: 'cooperative',
  callsign: 'DAL989',
  position: [-75.2, 39.9],
  altitudeFt: 2175,
  onGround: false,
  groundSpeedKt: 180,
  headingDeg: 90,
  verticalRateFpm: 0,
  lastSeenSec: 0,
  category: 'A3',
  registry: { typeCode: 'A321', registration: 'N120DN' },
  ...extra,
})

// Ground truth on purpose (loiter, silent): the classifier must read none of it.
const inject = (extra: Partial<InjectTrack> = {}): InjectTrack => ({
  id: 'inject-05',
  source: 'inject',
  behavior: 'loiter',
  remoteId: 'silent',
  uaType: null,
  identity: 'non-cooperative',
  callsign: null,
  position: [-75.20547, 39.81341],
  altitudeFt: 63,
  onGround: false,
  groundSpeedKt: 19.1,
  headingDeg: 345.6,
  verticalRateFpm: 85,
  lastSeenSec: 0,
  ...extra,
})

describe('classify — ADS-B', () => {
  it('rests on the type code where one is known, and says so', () => {
    expect(classify(adsb())).toEqual({
      airframe: 'narrowbody',
      label: 'Narrowbody',
      basis: 'type-code',
      caption: 'from type code A321 (registry lookup)',
    })
  })

  it('lets the type code refine the category — the Cessna that broadcasts A2', () => {
    // A2 "small" alone implies a business jet; the registry says C172. The lookup wins the
    // silhouette, the caption names it, and the broadcast code still shows in its own row.
    const cessna = classify(adsb({ category: 'A2', registry: { typeCode: 'C172' } }))
    expect(cessna.airframe).toBe('light-piston')
    expect(cessna.basis).toBe('type-code')
    expect(classify(adsb({ category: 'A2', registry: null })).airframe).toBe('business-jet')
  })

  it('falls back to the broadcast category, named, when there is no type code', () => {
    expect(classify(adsb({ registry: null }))).toEqual({
      airframe: 'narrowbody',
      label: 'Narrowbody',
      basis: 'emitter-category',
      caption: 'from emitter category A3 — large (broadcast)',
    })
    // And when the type code is one the table does not know.
    expect(classify(adsb({ registry: { typeCode: 'ZZZZ' } })).basis).toBe('emitter-category')
  })

  it('maps every category in the table to its class, and labels each class', () => {
    for (const [code, { airframe }] of Object.entries(EMITTER_CATEGORIES)) {
      const result = classify(adsb({ category: code, registry: null }))
      expect(result.airframe).toBe(airframe)
      expect(result.label).toBe(AIRFRAME_LABEL[airframe])
      expect(result.caption).toContain(`category ${code} —`)
    }
  })

  it('keeps an unlisted category as the basis, uncaptioned by a name it cannot vouch for', () => {
    expect(classify(adsb({ category: 'C1', registry: null }))).toMatchObject({
      airframe: 'unknown',
      basis: 'emitter-category',
      caption: 'from emitter category C1 (broadcast)',
    })
    expect(describeCategory('C1')).toBe('C1 (broadcast)')
    expect(describeCategory('A7')).toBe('A7 — rotorcraft (broadcast)')
  })

  it('reads unknown with nothing broadcast or looked up — never the kinematic class', () => {
    // Low and slow, and a real aircraft: an ADS-B track is broadcasting its position, so it
    // never wears a small-UAS label it did not earn (ruled on #22, assumption 1).
    const bare = classify(
      adsb({ category: null, registry: null, altitudeFt: 300, groundSpeedKt: 20 }),
    )
    expect(bare).toEqual({
      airframe: 'unknown',
      label: 'Unknown airframe',
      basis: 'none',
      caption: 'no emitter category broadcast, no registry type',
    })
    const unlisted = classify(adsb({ category: null, registry: { typeCode: 'ZZZZ' } }))
    expect(unlisted.basis).toBe('none')
    expect(unlisted.caption).toContain('ZZZZ not in the class table')
  })

  it('knows every type code the recording carries as a class the drawer can draw', () => {
    for (const code of ['C172', 'P28A', 'E75L', 'A321', 'B38M', 'CRJ9', 'PC12', 'SF50', 'H60']) {
      expect(TYPE_CODE_AIRFRAME.has(code)).toBe(true)
    }
    for (const airframe of TYPE_CODE_AIRFRAME.values())
      expect(AIRFRAME_LABEL[airframe]).toBeTruthy()
  })
})

describe('classify — injects', () => {
  it('rests on the UA type on a frame it is heard', () => {
    expect(classify(inject({ uaType: 'multirotor', callsign: 'UAS-7CD5' }))).toEqual({
      airframe: 'small-multirotor',
      label: 'Small multirotor',
      basis: 'ua-type',
      caption: 'from Remote ID UA type — helicopter or multirotor (heard this frame)',
    })
    expect(classify(inject({ uaType: 'aeroplane' })).airframe).toBe('fixed-wing-uas')
    // Hybrid lift draws the fixed-wing glyph; the caption still names what was heard.
    const hybrid = classify(inject({ uaType: 'hybrid-lift' }))
    expect(hybrid.airframe).toBe('fixed-wing-uas')
    expect(hybrid.caption).toContain('hybrid lift')
  })

  it('labels the kinematic class from the observed envelope when nothing is heard', () => {
    expect(classify(inject())).toEqual({
      airframe: 'unknown',
      label: 'Small UAS (kinematic class)',
      basis: 'kinematic',
      caption: 'from the observed envelope — 63 ft, 19.1 kt; no ident heard',
    })
  })

  it('never lets a null reading qualify — a gap is not a low number (#35)', () => {
    expect(classify(inject({ groundSpeedKt: null })).basis).toBe('none')
    expect(classify(inject({ altitudeFt: null })).basis).toBe('none')
  })

  it('reads unknown outside the envelope, with the envelope from config', () => {
    const fast = classify(inject({ groundSpeedKt: KINEMATIC_CLASS.maxGroundSpeedKt + 1 }))
    expect(fast).toMatchObject({ airframe: 'unknown', label: 'Unknown airframe', basis: 'none' })
    const high = classify(inject({ altitudeFt: KINEMATIC_CLASS.maxAltitudeFt + 1 }))
    expect(high.basis).toBe('none')
    // The edge is inclusive: at the ceiling is inside it.
    expect(classify(inject({ altitudeFt: KINEMATIC_CLASS.maxAltitudeFt })).basis).toBe('kinematic')
  })

  it('reads nothing from the answer key', () => {
    // Same observation, different ground truth: identical result (#4's rule, applied here).
    const a = classify(inject({ behavior: 'orbit', remoteId: 'silent' }))
    const b = classify(inject({ behavior: 'transit', remoteId: 'intermittent' }))
    expect(a).toEqual(b)
    expect(JSON.stringify(a)).not.toMatch(/loiter|orbit|transit|silent|intermittent/)
  })
})
