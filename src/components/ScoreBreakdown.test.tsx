import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ScoreBreakdown } from './ScoreBreakdown'
import { AO } from '../config/ao'
import { SCORING } from '../config/scoring'
import { destinationPoint } from '../lib/geo'
import { FACTORS, scoreTrack, type ScoringContext } from '../lib/scoring'
import type { AdsbTrack, InjectTrack } from '../lib/tracks'

const SITE = AO.protectedSites[0]
const north = (rangeM: number) => destinationPoint(SITE.center, 0, rangeM)
const NIGHT: ScoringContext = { tSec: 0, minuteOfDay: 150, memory: {} }

/** The handoff tests' silent drone: 7.2 km out, straight-ish in — scores 82, warning. */
const SILENT: InjectTrack = {
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
}

/** An arrival inside the ring, straight in: uncapped 58, capped to 30. */
const ARRIVAL: AdsbTrack = {
  id: 'adsb-a06461',
  source: 'adsb',
  icaoHex: 'a06461',
  identity: 'cooperative',
  callsign: 'AAL423',
  position: north(2000),
  altitudeFt: 1000,
  onGround: false,
  groundSpeedKt: 174,
  headingDeg: 180,
  verticalRateFpm: -640,
  lastSeenSec: 0,
  category: null,
  registry: null,
}

const PARKED: AdsbTrack = {
  ...ARRIVAL,
  id: 'adsb-a3303d',
  icaoHex: 'a3303d',
  callsign: null,
  position: SITE.center,
  altitudeFt: 0,
  onGround: true,
  groundSpeedKt: 0,
  headingDeg: null,
}

const score = (track: InjectTrack | AdsbTrack) => scoreTrack(track, AO.protectedSites, NIGHT)
/** The factor rows of the last-rendered breakdown. */
const rows = () =>
  within(screen.getAllByLabelText('Score breakdown').at(-1) as HTMLElement).getAllByRole('listitem')

describe('ScoreBreakdown', () => {
  it('heads with the score, its band, and the one-decimal total it is made from (#63)', () => {
    render(<ScoreBreakdown score={score(SILENT)} />)
    const section = screen.getByLabelText('Score breakdown')
    expect(section).toHaveAttribute('data-band', 'warning')
    expect(within(section).getByText('Score 82')).toBeInTheDocument()
    expect(within(section).getByText('warning')).toBeInTheDocument()
    expect(within(section).getByText(/^— 65\.6\/80$/)).toBeInTheDocument()
    expect(within(section).queryByText(/Capped at/)).not.toBeInTheDocument()
  })

  it('lists the five §6 factors in order with their labels, numbers, bars, and detail lines', () => {
    const scored = score(SILENT)
    render(<ScoreBreakdown score={scored} />)
    const items = rows()
    expect(items).toHaveLength(5)
    expect(items.map((row) => row.querySelector('.breakdown__label')?.textContent)).toEqual(
      FACTORS.map((f) => f.label),
    )
    expect(items.map((row) => row.querySelector('.breakdown__numbers')?.textContent)).toEqual([
      '25 / 25',
      '9 / 20',
      '12 / 15',
      '10 / 10',
      '10 / 10',
    ])
    // The bar is the contribution over the weight, and says so to assistive tech.
    const closing = within(items[1]).getByRole('meter', { name: 'Closing contribution' })
    // The meter carries the contribution unrounded (to two decimals), never above its max.
    expect(Number(closing.getAttribute('aria-valuenow'))).toBeCloseTo(
      scored.factors[1].contribution,
      2,
    )
    expect(closing).toHaveAttribute('aria-valuemax', '20')
    const fill = closing.querySelector('.breakdown__fill') as HTMLElement
    expect(parseFloat(fill.style.width)).toBeCloseTo(
      (scored.factors[1].contribution / scored.factors[1].weight) * 100,
      3,
    )
    expect(within(items[0]).getByText('no ident heard')).toBeInTheDocument()
    expect(within(items[4]).getByText('02:30 local — outside 06:00–22:00')).toBeInTheDocument()
  })

  it('carries the §6 intent text as each row’s hover', () => {
    render(<ScoreBreakdown score={score(SILENT)} />)
    expect(rows().map((row) => row.title)).toEqual(FACTORS.map((f) => f.intent))
  })

  it('shows a capped track’s cap as its own line, with the arithmetic that was capped (A3)', () => {
    render(<ScoreBreakdown score={score(ARRIVAL)} />)
    const section = screen.getByLabelText('Score breakdown')
    expect(section).toHaveAttribute('data-band', 'calm')
    expect(within(section).getByText('Score 30')).toBeInTheDocument()
    expect(within(section).getByText(/^— capped, 46\.3\/80 → 58$/)).toBeInTheDocument()
    expect(within(section).getByText('Capped at 30 — cooperative aircraft')).toBeInTheDocument()
    // The bars are honest about the uncapped geometry.
    expect(within(rows()[1]).getByText('20 / 20')).toBeInTheDocument()
  })

  it('reads the on-ground rule on every geometry row of a parked aircraft (C3)', () => {
    render(<ScoreBreakdown score={score(PARKED)} />)
    const details = rows().map((row) => row.querySelector('.breakdown__detail')?.textContent)
    expect(details.slice(1, 4)).toEqual(Array(3).fill('on ground — not in the airspace'))
  })

  it('labels the cooperativity row Identity, so it never contradicts its own detail (#65)', () => {
    render(<ScoreBreakdown score={score(ARRIVAL)} />)
    const [identity] = rows()
    expect(within(identity).getByText('Identity')).toBeInTheDocument()
    expect(within(identity).getByText('ADS-B, cooperative by construction')).toBeInTheDocument()
    expect(screen.queryByText('Non-cooperative')).not.toBeInTheDocument()
  })

  it('fills nothing and prints 0 / 0 at a weight of 0 — no NaN reaches the DOM (#65)', () => {
    // Doctrine is configuration: the slider panel can zero a weight.
    const config = { ...SCORING, weights: { ...SCORING.weights, time: 0 } }
    const scored = scoreTrack(SILENT, AO.protectedSites, { ...NIGHT, config })
    render(<ScoreBreakdown score={scored} />)
    const offHours = rows()[4]
    expect(within(offHours).getByText('0 / 0')).toBeInTheDocument()
    const meter = within(offHours).getByRole('meter')
    expect(meter).toHaveAttribute('aria-valuemin', '0')
    expect(meter).toHaveAttribute('aria-valuemax', '1')
    expect(meter).toHaveAttribute('aria-valuenow', '0')
    const fill = meter.querySelector('.breakdown__fill') as HTMLElement
    expect(fill.style.width).toBe('0%')
    expect(offHours.innerHTML).not.toMatch(/NaN/)
  })

  it('keeps the meter within its range at a non-integer weight (#65)', () => {
    const config = { ...SCORING, weights: { ...SCORING.weights, kinematic: 12.5 } }
    const scored = scoreTrack(SILENT, AO.protectedSites, { ...NIGHT, config })
    render(<ScoreBreakdown score={scored} />)
    const profile = rows()[3]
    const meter = within(profile).getByRole('meter')
    expect(meter).toHaveAttribute('aria-valuemax', '12.5')
    expect(Number(meter.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(12.5)
    expect(within(profile).getByText('12.5 / 12.5')).toBeInTheDocument()
    expect((meter.querySelector('.breakdown__fill') as HTMLElement).style.width).toBe('100%')
  })

  it('never wears a warm band on an ADS-B track, whatever it does', () => {
    for (const track of [ARRIVAL, PARKED]) {
      const scored = score(track)
      expect(scored.composite).toBeLessThan(SCORING.bands.caution)
      render(<ScoreBreakdown score={scored} />)
      expect(screen.getAllByLabelText('Score breakdown').at(-1)).toHaveAttribute(
        'data-band',
        'calm',
      )
    }
  })
})
