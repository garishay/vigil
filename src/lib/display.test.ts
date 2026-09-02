import { describe, expect, it } from 'vitest'
import {
  describeEvent,
  formatElapsed,
  formatScore,
  roundHeading,
  scoreSummary,
  scoreTotal,
  simClock,
} from './display'
import type { Score } from './scoring'

const SCORE: Score = {
  composite: 82,
  weighted: 65.58,
  total: 65.6,
  totalWeight: 80,
  uncapped: 82,
  capped: false,
  band: 'warning',
  rangeM: 7200.2,
  siteId: 'phl-airfield',
  factors: [
    {
      id: 'cooperativity',
      label: 'Identity',
      value: 100,
      weight: 25,
      contribution: 25,
      detail: '',
    },
    { id: 'closing', label: 'Closing', value: 44.4, weight: 20, contribution: 8.9, detail: '' },
    { id: 'proximity', label: 'Proximity', value: 78, weight: 15, contribution: 11.7, detail: '' },
    {
      id: 'kinematic',
      label: 'Flight profile',
      value: 100,
      weight: 10,
      contribution: 10,
      detail: '',
    },
    { id: 'time', label: 'Off-hours', value: 100, weight: 10, contribution: 10, detail: '' },
  ],
}

describe('formatScore', () => {
  it('prints the composite as a whole number', () => {
    expect(formatScore(SCORE)).toBe('82')
    expect(formatScore({ ...SCORE, composite: 30 })).toBe('30')
  })
})

/** The arrival from the handoff tests: uncapped 57.8, capped to 30. */
const CAPPED: Score = {
  ...SCORE,
  composite: 30,
  weighted: 46.25,
  total: 46.3,
  uncapped: 57.875,
  capped: true,
  band: 'calm',
  factors: [
    { ...SCORE.factors[0], value: 5, contribution: 1.25 },
    { ...SCORE.factors[1], value: 100, contribution: 20 },
    { ...SCORE.factors[2], value: 100, contribution: 15 },
    { ...SCORE.factors[3], value: 0, contribution: 0 },
    { ...SCORE.factors[4], value: 100, contribution: 10 },
  ],
}

describe('scoreTotal', () => {
  it('prints the one-decimal total the score is made from, over the configured weights (#63, round 2)', () => {
    // 65.6 / 80 = 82.0 %, the printed score; a sum of rounded parts (66) would read 82.5 %.
    expect(scoreTotal(SCORE)).toBe('65.6/80')
  })

  it('carries the uncapped composite the total makes when the ceiling bound', () => {
    expect(scoreTotal(CAPPED)).toBe('46.3/80 → 58')
  })
})

describe('scoreSummary', () => {
  it('names the three largest contributions, largest first, and their total, for the chip’s hover', () => {
    expect(scoreSummary(SCORE)).toBe('Identity 25 · Proximity 12 · Flight profile 10 (65.6/80)')
  })

  it('leads a capped row with the cap line, so the hover never contradicts the chip (#63)', () => {
    expect(scoreSummary(CAPPED)).toBe(
      'Capped at 30 — cooperative aircraft · Closing 20 · Proximity 15 · Off-hours 10 (46.3/80 → 58)',
    )
  })
})

describe('roundHeading', () => {
  it('rounds to the whole degree both the drawer and the handoff print (#49)', () => {
    expect(roundHeading(345.6)).toBe(346)
    expect(roundHeading(0.3)).toBe(0)
  })

  it('wraps a heading that rounds up to north — 0, never an off-the-compass 360 (#51 review)', () => {
    expect(roundHeading(359.7)).toBe(0)
    expect(roundHeading(359.5)).toBe(0)
    expect(roundHeading(359.4)).toBe(359)
  })
})

describe('simClock', () => {
  it('is the scenario’s time of day at the clock, to the second, wrapping at midnight (06a)', () => {
    expect(simClock('02:30', 0)).toBe('02:30:00')
    expect(simClock('02:30', 187)).toBe('02:33:07')
    expect(simClock('23:59', 61)).toBe('00:00:01')
    // A fractional tick never prints a fraction.
    expect(simClock('02:30', 7.9)).toBe('02:30:07')
  })
})

describe('formatElapsed', () => {
  it('prints the replay position as MM:SS with minutes unbounded', () => {
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(187)).toBe('03:07')
    expect(formatElapsed(1185)).toBe('19:45')
    expect(formatElapsed(3725)).toBe('62:05')
  })
})

describe('describeEvent — band crossings (06b)', () => {
  const crossing = (from: 'calm' | 'caution' | 'warning', to: typeof from) =>
    ({
      trackId: 'inject-05',
      seq: 2,
      at: '2026-09-01T12:06:02.000Z',
      tSec: 187,
      action: 'band',
      from: 'new',
      to: 'new',
      band: { from, to },
      observed: {
        identity: 'non-cooperative',
        rangeM: 7200.2,
        altitudeFt: 63,
        groundSpeedKt: 19.1,
        headingDeg: 345.6,
        score: 72,
        uncapped: 72,
        factors: { cooperativity: 100, closing: 44.4, proximity: 78, kinematic: 100, time: 100 },
        weights: { cooperativity: 25, closing: 20, proximity: 15, kinematic: 10, time: 10 },
      },
    }) as const

  it('names the band entered and the one left, up or down, in the one table’s words (#66)', () => {
    expect(describeEvent(crossing('calm', 'caution'), [], [])).toBe('Caution — up from calm')
    expect(describeEvent(crossing('caution', 'warning'), [], [])).toBe('Warning — up from caution')
    expect(describeEvent(crossing('warning', 'calm'), [], [])).toBe('Calm — down from warning')
  })
})
