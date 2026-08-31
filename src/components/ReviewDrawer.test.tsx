import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReviewDrawer } from './ReviewDrawer'
import type { ProtectedSite } from '../config/ao'
import type { RankedTrack } from '../lib/ranking'
import type { AdsbTrack, InjectTrack } from '../lib/tracks'

const SILENT: InjectTrack = {
  id: 'inject-05',
  source: 'inject',
  behavior: 'loiter',
  remoteId: 'silent',
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

const PARKED: AdsbTrack = {
  id: 'adsb-a3303d',
  source: 'adsb',
  icaoHex: 'a3303d',
  identity: 'cooperative',
  callsign: null,
  position: [-75.26544, 39.86816],
  altitudeFt: 0,
  onGround: true,
  groundSpeedKt: 0,
  headingDeg: null,
  verticalRateFpm: null,
  lastSeenSec: 38,
  category: null,
  registry: null,
}

// Two sites, decoy first: the drawer must name the site the range was measured to, not `[0]`.
const SITES: ProtectedSite[] = [
  { id: 'decoy', name: 'Decoy Stadium', center: [-75.17, 39.9], radiusM: 1000 },
  { id: 'phl-airfield', name: 'PHL Airfield', center: [-75.2411, 39.8721], radiusM: 5000 },
]

const entry = (track: InjectTrack | AdsbTrack, rank: number, rangeM: number): RankedTrack => ({
  track,
  rank,
  rangeM,
  siteId: 'phl-airfield',
})

describe('ReviewDrawer', () => {
  it('names the track by the observed-or-derived rule, never the inject id', () => {
    render(<ReviewDrawer entry={entry(SILENT, 1, 7200.2)} sites={SITES} onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'TRK-05' })).toBeInTheDocument()
    expect(screen.getByLabelText('Track review: TRK-05')).toBeInTheDocument()
    expect(screen.queryByText(/inject-\d/)).not.toBeInTheDocument()
  })

  it('shows identity, the layer badge, rank, and range to the named site', () => {
    render(<ReviewDrawer entry={entry(SILENT, 1, 7200.2)} sites={SITES} onClose={vi.fn()} />)
    expect(screen.getByText('Non-cooperative')).toBeInTheDocument()
    expect(screen.getByText('INJECT')).toBeInTheDocument()
    // Named from entry.siteId, not sites[0]: the decoy site sits first in SITES on purpose.
    expect(screen.getByText('7.2 km to PHL Airfield')).toBeInTheDocument()
    expect(screen.queryByText(/Decoy Stadium/)).not.toBeInTheDocument()
    const rank = screen.getByText('Rank').parentElement as HTMLElement
    expect(within(rank).getByText('1')).toBeInTheDocument()
  })

  it('displays observed and derived fields only — never the ground truth', () => {
    render(<ReviewDrawer entry={entry(SILENT, 1, 7200.2)} sites={SITES} onClose={vi.fn()} />)
    const drawer = screen.getByLabelText('Track review: TRK-05')
    expect(drawer.textContent).not.toMatch(/loiter|silent|intermittent|broadcasting/i)
  })

  it('renders an unbroadcast value as an em dash, never a zero', () => {
    render(<ReviewDrawer entry={entry(PARKED, 57, 2122.9)} sites={SITES} onClose={vi.fn()} />)
    const heading = screen.getByText('Heading').parentElement as HTMLElement
    expect(within(heading).getByText('—')).toBeInTheDocument()
    const vs = screen.getByText('Vertical rate').parentElement as HTMLElement
    expect(within(vs).getByText('—')).toBeInTheDocument()
    // A real zero stays a zero: the parked aircraft's ground level is a reading, not a gap.
    const alt = screen.getByText('Altitude').parentElement as HTMLElement
    expect(within(alt).getByText('0 ft')).toBeInTheDocument()
    // Same for ground speed: the parked aircraft's broadcast 0 kt is a reading, not a gap (#35).
    const gs = screen.getByText('Ground speed').parentElement as HTMLElement
    expect(within(gs).getByText('0 kt')).toBeInTheDocument()
    expect(screen.getByText('on ground')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'a3303d' })).toBeInTheDocument()
  })

  it('dashes an unreported ground speed instead of asserting a hover (#35)', () => {
    // The shape from the recording that motivated #35: positive altitude, no speed broadcast.
    const positionOnly: AdsbTrack = {
      ...PARKED,
      id: 'adsb-ae2683',
      icaoHex: 'ae2683',
      altitudeFt: 525,
      onGround: false,
      groundSpeedKt: null,
    }
    render(<ReviewDrawer entry={entry(positionOnly, 3, 4100.0)} sites={SITES} onClose={vi.fn()} />)
    const gs = screen.getByText('Ground speed').parentElement as HTMLElement
    expect(within(gs).getByText('—')).toBeInTheDocument()
  })

  it('reserves the Track Visuals slot and the score, and says what fills them', () => {
    render(<ReviewDrawer entry={entry(SILENT, 1, 7200.2)} sites={SITES} onClose={vi.fn()} />)
    expect(screen.getByText(/Track Visuals — 03c/)).toBeInTheDocument()
    expect(screen.getByText(/factors arrive with PR 04/)).toBeInTheDocument()
    expect(screen.getByText(/1 known position/)).toBeInTheDocument()
  })

  it('closes through its close button', () => {
    const onClose = vi.fn()
    render(<ReviewDrawer entry={entry(SILENT, 1, 7200.2)} sites={SITES} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
