import { describe, expect, it } from 'vitest'
import { detectPattern, formatSpan, heldTurn, loiterDwell, revisit } from './patterns'
import type { TrackHistory } from './patterns'
import { AO } from '../config/ao'
import { SCORING } from '../config/scoring'
import { destinationPoint } from './geo'
import { gridTimeline, injectTracksAt, planScenario } from './injects'
import { historyAt, type ReplayIndex } from './replay'

const CONFIG = SCORING.pattern
const SITE = AO.protectedSites[0]
const at = (rangeM: number, bearingDeg = 0) => destinationPoint(SITE.center, bearingDeg, rangeM)

/** A history from positions sampled every 15 s, the frame grid, oldest first. */
const every15 = (positions: [number, number][]): TrackHistory =>
  positions.map((position, i) => ({ tSec: i * 15, position }))

/** `count` positions along a bearing from `origin`, `stepM` apart — a straight line. */
function line(origin: [number, number], bearingDeg: number, stepM: number, count: number) {
  return [...Array(count)].map((_, i) => destinationPoint(origin, bearingDeg, i * stepM))
}

/** `count` positions round a circle of `radiusM` about `center`, `stepDeg` apart. */
function arc(center: [number, number], radiusM: number, stepDeg: number, count: number) {
  return [...Array(count)].map((_, i) => destinationPoint(center, (i * stepDeg) % 360, radiusM))
}

// Twenty-nine samples is the 420 s window at the frame grid — what the scorer sees.
const HOVER = every15(Array<[number, number]>(29).fill(at(3000)))
// A 12 kt straight line: 92.6 m per sample, the slowest inject the scenario can deal.
const SLOW_TRANSIT = every15(line(at(8000), 180, 92.6, 29))
// The golden orbit's numbers: 863 m radius at 20.5 kt is 10.5° per sample, 294° in the window.
const ORBIT = every15(arc(at(3000), 863, 10.5, 29))
// A grid sweep: out 1,560 m east, a 300 m lane north, back west along the new lane.
const GRID = every15([
  ...line(at(3000), 90, 120, 14),
  destinationPoint(destinationPoint(at(3000), 90, 1560), 0, 150),
  destinationPoint(destinationPoint(at(3000), 90, 1560), 0, 300),
  ...line(destinationPoint(destinationPoint(at(3000), 90, 1560), 0, 300), 270, 120, 14),
])
// Out 1,200 m and straight back to the start.
const OUT_AND_BACK = every15([
  ...line(at(3000), 90, 120, 11),
  ...line(at(3000), 90, 120, 10).reverse(),
])

describe('loiter dwell', () => {
  it('is the trailing time the track has spent inside one small circle', () => {
    expect(loiterDwell(HOVER, CONFIG.loiter)).toBe(420)
    // A 12 kt straight line fits a 450 m circle for ten samples — 135 s — and no longer.
    expect(loiterDwell(SLOW_TRANSIT, CONFIG.loiter)).toBe(135)
  })

  it('ramps from nothing at the floor to full at the ceiling, so a slow transit reads 0', () => {
    expect(detectPattern(SLOW_TRANSIT, CONFIG).loiter).toBe(0)
    expect(detectPattern(HOVER.slice(-11), CONFIG).loiter).toBe(0) // 150 s: the floor
    expect(detectPattern(HOVER.slice(-16), CONFIG).loiter).toBe(50) // 225 s: halfway
    expect(detectPattern(HOVER.slice(-21), CONFIG).loiter).toBe(100) // 300 s: full
  })

  it('names a hover past the onset and reads its evidence, never the word', () => {
    const reading = detectPattern(HOVER, CONFIG)
    expect(reading).toMatchObject({ kind: 'loiter', value: 100, loiter: 100, orbit: 0, revisit: 0 })
    expect(reading.detail).toBe('within 450 m for 7 min 0 s')
    expect(reading.detail).not.toMatch(/loiter/i)
  })
})

describe('orbit', () => {
  it('measures the turn held in one direction and how long the turning lasted', () => {
    expect(heldTurn(ORBIT, CONFIG.orbit)).toMatchObject({ heldS: 405 })
    expect(heldTurn(ORBIT, CONFIG.orbit).turnDeg).toBeCloseTo(283.5, 0)
    expect(heldTurn(SLOW_TRANSIT, CONFIG.orbit)).toEqual({ turnDeg: 0, heldS: 0 })
  })

  it('reads a circle held for minutes as an orbit, with its evidence', () => {
    const reading = detectPattern(ORBIT, CONFIG)
    expect(reading).toMatchObject({ kind: 'orbit', value: 100, loiter: 0, revisit: 0 })
    expect(reading.detail).toBe('turned 283° one way over 6 min 45 s')
  })

  it('does not read a U-turn as an orbit — the turn is 180° but it lasts 45 s', () => {
    const start = at(3000)
    const turn = every15([
      ...line(start, 90, 120, 8),
      destinationPoint(destinationPoint(start, 90, 840), 150, 120),
      destinationPoint(destinationPoint(destinationPoint(start, 90, 840), 150, 120), 210, 120),
      destinationPoint(
        destinationPoint(destinationPoint(destinationPoint(start, 90, 840), 150, 120), 210, 120),
        270,
        120,
      ),
    ])
    expect(heldTurn(turn, CONFIG.orbit)).toMatchObject({ heldS: 45 })
    expect(heldTurn(turn, CONFIG.orbit).turnDeg).toBeCloseTo(180, 0)
    expect(detectPattern(turn, CONFIG).orbit).toBe(0)
  })

  it('names an orbit only past a half circle held — a departure turn is a turn (ruled on #5)', () => {
    // 18 legs of 10.5° is 178.5° held: two thirds of the way to full, and not named.
    const half = detectPattern(ORBIT.slice(0, 19), CONFIG)
    expect(half.orbit).toBeCloseTo((100 * 178.5) / 270, 0)
    expect(half.kind).toBeNull()
    // One more leg crosses 180°, and the pattern is named.
    expect(detectPattern(ORBIT.slice(0, 20), CONFIG).kind).toBe('orbit')
  })
})

describe('revisit', () => {
  it('fires when the track is back near a point it left, and reads the return', () => {
    const reading = detectPattern(GRID, CONFIG)
    expect(revisit(GRID, CONFIG.revisit)).toMatchObject({ gapS: 435 })
    expect(revisit(GRID, CONFIG.revisit)!.distanceM).toBeCloseTo(300, 0)
    expect(reading).toMatchObject({ kind: 'revisit', value: 100, loiter: 0, orbit: 0 })
    expect(reading.detail).toBe('back within 300 m of a point left 7 min 15 s ago')
    expect(detectPattern(OUT_AND_BACK, CONFIG)).toMatchObject({ kind: 'revisit', value: 100 })
  })

  it('needs the track to have left: a hover is a dwell, not a return', () => {
    expect(revisit(HOVER, CONFIG.revisit)).toBeNull()
    expect(detectPattern(HOVER, CONFIG).revisit).toBe(0)
    // Nor is a straight line a return, and a circle in the window never closes.
    expect(detectPattern(SLOW_TRANSIT, CONFIG).revisit).toBe(0)
    expect(detectPattern(ORBIT, CONFIG).revisit).toBe(0)
  })
})

describe('detectPattern', () => {
  it('reads no pattern from a straight line, and says over what span', () => {
    expect(detectPattern(SLOW_TRANSIT, CONFIG)).toEqual({
      kind: null,
      value: 0,
      detail: 'no dwell, held turn, or return over 7 min 0 s',
      loiter: 0,
      orbit: 0,
      revisit: 0,
    })
  })

  it('names the strongest *named* reading, not a stronger unnamed one (#80 review)', () => {
    // Twelve samples straight east, then 163° of a 380 m arc: the dwell is 240 s (loiter 60,
    // named) while the turn is held for the same 240 s (orbit 60.3, short of the half circle).
    const end = destinationPoint(at(3000), 90, 11 * 150)
    const center = destinationPoint(end, 180, 380)
    const history = every15([
      ...line(at(3000), 90, 150, 12),
      ...arc(center, 380, 10.5, 17).slice(1),
    ])
    const reading = detectPattern(history, CONFIG)
    expect(reading.loiter).toBe(60)
    expect(reading.orbit).toBeGreaterThan(reading.loiter)
    expect(heldTurn(history, CONFIG.orbit).turnDeg).toBeLessThan(CONFIG.orbit.nameDeg)
    // The factor is the turn's value; the kind, and the evidence, are the dwell's.
    expect(reading.value).toBe(reading.orbit)
    expect(reading.kind).toBe('loiter')
    expect(reading.detail).toBe('within 450 m for 4 min 0 s')
  })

  it('has nothing to read from fewer than two samples', () => {
    expect(detectPattern([], CONFIG)).toMatchObject({
      kind: null,
      value: 0,
      detail: 'no history yet',
    })
    expect(detectPattern(HOVER.slice(0, 1), CONFIG).detail).toBe('no history yet')
  })

  it('prints spans the way the detail line does', () => {
    expect(formatSpan(45)).toBe('45 s')
    expect(formatSpan(255)).toBe('4 min 15 s')
    expect(formatSpan(420)).toBe('7 min 0 s')
  })
})

describe('the golden scenario as the answer key (ruled on #5, note 1)', () => {
  // The generator's `behavior` is the oracle these expectations are derived from; the detector
  // is fed positions and nothing else, sampled as the app samples them.
  const plan = planScenario(gridTimeline(80, 15000))
  const noRecording: ReplayIndex = { startS: 0, durationS: 0, samples: new Map() }
  const EXPECTED = {
    loiter: 'loiter',
    orbit: 'orbit',
    lawnmower: 'revisit',
    // An out-and-back retraces its own approach; revisit catching it is the honest reading
    // (assumption 9 on #5).
    'approach-retreat': 'revisit',
    transit: null,
  } as const

  it('names every scripted behavior by the last frame, from positions alone', () => {
    const t = 1185
    for (const track of injectTracksAt(plan, t)) {
      const history = historyAt(noRecording, plan, track, t, CONFIG.windowS)
      expect(history).toHaveLength(29)
      expect(Object.keys(history[0])).toEqual(['tSec', 'position'])
      // The committed plan deals only the five behaviors above; the cast behaviors (S2a) are
      // never dealt, so the lookup's key is the dealt pool's.
      const behavior = plan.specs.find((spec) => spec.id === track.id)!.behavior
      expect(detectPattern(history, CONFIG).kind, track.id).toBe(
        EXPECTED[behavior as keyof typeof EXPECTED],
      )
    }
  })

  it('never puts a verdict word in a detail line, on any inject at any frame', () => {
    for (let frame = 0; frame < 80; frame++) {
      const t = frame * 15
      for (const track of injectTracksAt(plan, t)) {
        const { detail } = detectPattern(
          historyAt(noRecording, plan, track, t, CONFIG.windowS),
          CONFIG,
        )
        expect(detail).not.toMatch(/loiter|orbit|revisit|lawnmower|transit|approach/i)
      }
    }
  })

  it('reads the loiter as a dwell and the orbit as a turn, not the other way round', () => {
    const t = 990
    const [loiter, orbit] = ['inject-05', 'inject-02'].map((id) => {
      const track = injectTracksAt(plan, t).find((inject) => inject.id === id)!
      return detectPattern(historyAt(noRecording, plan, track, t, CONFIG.windowS), CONFIG)
    })
    expect(loiter).toMatchObject({ kind: 'loiter', detail: 'within 450 m for 4 min 15 s' })
    expect(loiter.loiter).toBeGreaterThan(loiter.orbit)
    expect(orbit).toMatchObject({ kind: 'orbit', detail: 'turned 266° one way over 6 min 30 s' })
    expect(orbit.loiter).toBe(0)
  })
})

describe('the last-leg floor (#155, R2 on #152)', () => {
  // A 500 m circle sampled every 15 s at 8 kt: 61.7 m legs, 7.07° a turn, 28 samples — 26 turns,
  // 183.8° held over 390 s, an orbit by a small margin, the shape of 03a's bait.
  const circle = arc(at(9000), 500, 7.07, 28)
  const grid = every15(circle)
  const tangent = (i: number) => (i * 7.07 + 90) % 360
  /** The circle plus the current position, `legM` along a course `bentDeg` off the tangent, 2 s after the last grid sample. */
  const withLastLeg = (legM: number, bentDeg: number): TrackHistory => [
    ...grid,
    {
      tSec: 27 * 15 + 2,
      position: destinationPoint(circle[27], (tangent(27) + bentDeg + 360) % 360, legM),
    },
  ]

  it('drops a last leg shorter than the floor, so a metre of noise on a 10 m leg no longer breaks the run', () => {
    // Before the floor this read turn 0 and no kind: the 10 m leg's bearing, bent 20° the wrong
    // way, flipped the sign at the run's start (shown failing on the pre-fix code).
    const bent = withLastLeg(10, -20)
    expect(heldTurn(bent, CONFIG.orbit).turnDeg).toBeCloseTo(183.8, 0)
    expect(heldTurn(bent, CONFIG.orbit).heldS).toBe(390)
    expect(detectPattern(bent, CONFIG).kind).toBe('orbit')
    // The circle alone reads the same: the dropped leg was the only difference.
    expect(heldTurn(grid, CONFIG.orbit).turnDeg).toBeCloseTo(183.8, 0)
  })

  it('keeps a last leg at or past the floor — a real turn the wrong way on a full leg still ends the run there', () => {
    // The run now starts at the wrong-way leg and stops at once: one leg's 16.5° over its 2 s,
    // under `minS`, so the orbit reads 0 and the dwell the arc still holds names loiter instead.
    const turned = withLastLeg(62, -20)
    expect(heldTurn(turned, CONFIG.orbit).turnDeg).toBeCloseTo(16.5, 0)
    expect(heldTurn(turned, CONFIG.orbit).heldS).toBe(2)
    expect(detectPattern(turned, CONFIG).orbit).toBe(0)
    expect(detectPattern(turned, CONFIG).kind).not.toBe('orbit')
    // A full leg that continues the arc extends it by one chord's turn.
    const continued = withLastLeg(62, 7.07)
    expect(heldTurn(continued, CONFIG.orbit).turnDeg).toBeCloseTo(194.4, 0)
    // Just under the floor is dropped; the boundary itself is a metre nobody stands on.
    expect(heldTurn(withLastLeg(29, -20), CONFIG.orbit).turnDeg).toBeCloseTo(183.8, 0)
  })

  it('is 30 m, above the 5 m degenerate-leg skip and under a grid leg at the slowest dealt speed', () => {
    expect(CONFIG.orbit.lastLegM).toBe(30)
    expect(CONFIG.orbit.lastLegM).toBeGreaterThan(5)
    // 16 kt, the slowest a dealt orbit flies, covers 123 m in a 15 s grid step.
    expect(CONFIG.orbit.lastLegM).toBeLessThan(16 * 0.514444 * 15)
  })
})
