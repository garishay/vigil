import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Queue } from './Queue'
import { IDENTITY_COLOR } from '../lib/identity'
import type { RankedTrack } from '../lib/ranking'
import type { AdsbTrack, InjectTrack } from '../lib/tracks'

const SILENT: InjectTrack = {
  id: 'inject-03',
  source: 'inject',
  behavior: 'lawnmower',
  remoteId: 'silent',
  identity: 'non-cooperative',
  callsign: null,
  position: [-75.28671, 39.94708],
  altitudeFt: 89,
  onGround: false,
  groundSpeedKt: 16,
  headingDeg: 151.9,
  verticalRateFpm: 34,
  lastSeenSec: 0,
}

const UNHEARD: InjectTrack = {
  ...SILENT,
  id: 'inject-01',
  behavior: 'transit',
  remoteId: 'intermittent',
  identity: 'unknown',
}

const HEARD: InjectTrack = {
  ...SILENT,
  id: 'inject-04',
  behavior: 'approach-retreat',
  remoteId: 'broadcasting',
  identity: 'cooperative',
  callsign: 'UAS-CD84',
}

const AIRLINER: AdsbTrack = {
  id: 'adsb-a46ab9',
  source: 'adsb',
  icaoHex: 'a46ab9',
  identity: 'cooperative',
  callsign: 'LXJ384',
  position: [-75.25, 39.88],
  altitudeFt: 1200,
  onGround: false,
  groundSpeedKt: 140,
  headingDeg: 270,
  verticalRateFpm: -500,
  lastSeenSec: 0,
  category: null,
  registry: null,
}

const PARKED: AdsbTrack = {
  ...AIRLINER,
  id: 'adsb-a3303d',
  icaoHex: 'a3303d',
  callsign: null,
  altitudeFt: 0,
  onGround: true,
  groundSpeedKt: 0,
}

const RANKED: RankedTrack[] = [
  { track: SILENT, rank: 1, rangeM: 9200.3, siteId: 'phl-airfield' },
  { track: UNHEARD, rank: 2, rangeM: 6499.4, siteId: 'phl-airfield' },
  { track: AIRLINER, rank: 3, rangeM: 1124.5, siteId: 'phl-airfield' },
  { track: HEARD, rank: 4, rangeM: 8800.4, siteId: 'phl-airfield' },
  { track: PARKED, rank: 5, rangeM: 2122.9, siteId: 'phl-airfield' },
]

const rows = () =>
  within(screen.getByRole('list', { name: 'Ranked queue' })).getAllByRole('listitem')

describe('Queue', () => {
  it('renders one row per ranked track, in rank order', () => {
    render(<Queue ranked={RANKED} />)
    const items = rows()
    expect(items).toHaveLength(5)
    expect(items.map((row) => row.textContent)).toEqual(
      RANKED.map((entry) => expect.stringMatching(new RegExp(`^${entry.rank}`))),
    )
  })

  it('shows plain-English identity with the shared dot, and a score chip placeholder', () => {
    render(<Queue ranked={RANKED} />)
    const [silent, unheard, airliner] = rows()
    expect(silent).toHaveTextContent('Non-cooperative')
    expect(unheard).toHaveTextContent('Unknown')
    expect(airliner).toHaveTextContent('Cooperative')
    // The dot is the same component the legend uses, coloured from the one palette.
    const dot = silent.querySelector('.identity-dot') as HTMLElement
    expect(dot).toHaveAttribute('data-identity', 'non-cooperative')
    expect(dot.style.background).toBe(hexToRgb(IDENTITY_COLOR['non-cooperative']))
    expect(silent.querySelectorAll('.queue__score')).toHaveLength(1)
    expect(silent.querySelector('.queue__score')).toHaveTextContent('—')
  })

  it('discloses the layer in the badge, and nowhere else', () => {
    render(<Queue ranked={RANKED} />)
    const [silent, , airliner] = rows()
    expect(within(silent).getByText('INJECT')).toBeInTheDocument()
    expect(within(airliner).getByText('ADS-B')).toBeInTheDocument()
  })

  it('names a track by what it broadcast: callsign, or the ICAO address an aircraft sends without one', () => {
    render(<Queue ranked={RANKED} />)
    const [, , airliner, heard, parked] = rows()
    expect(within(airliner).getByText('LXJ384')).toBeInTheDocument()
    expect(within(heard).getByText('UAS-CD84')).toBeInTheDocument()
    expect(within(parked).getByText('a3303d')).toBeInTheDocument()
  })

  it('gives a track with no broadcast identity a neutral track number, never its inject id', () => {
    render(<Queue ranked={RANKED} />)
    const [silent, unheard] = rows()
    expect(within(silent).getByText('TRK-03')).toBeInTheDocument()
    expect(within(unheard).getByText('TRK-01')).toBeInTheDocument()
    expect(screen.queryByText(/inject-\d/)).not.toBeInTheDocument()
  })

  it('displays observed and derived fields only — never the generator’s ground truth', () => {
    // Behavior and Remote ID status are the answer key. They live in fixtures and tests until
    // PR 05 earns the right to display a *detected* pattern.
    render(<Queue ranked={RANKED} />)
    const list = screen.getByRole('list', { name: 'Ranked queue' })
    expect(list.textContent).not.toMatch(
      /lawnmower|transit|approach|silent|intermittent|broadcasting/i,
    )
  })

  it('shows range to the protected site in km to one decimal', () => {
    render(<Queue ranked={RANKED} />)
    const [silent, , airliner] = rows()
    expect(within(silent).getByText('9.2 km')).toBeInTheDocument()
    expect(within(airliner).getByText('1.1 km')).toBeInTheDocument()
  })

  it('marks ground traffic on the row and dims it, rather than dropping it', () => {
    render(<Queue ranked={RANKED} />)
    const [silent, , , , parked] = rows()
    expect(within(parked).getByText('on ground')).toBeInTheDocument()
    expect(parked).toHaveClass('queue__row--ground')
    expect(silent).not.toHaveClass('queue__row--ground')
    expect(within(silent).queryByText('on ground')).not.toBeInTheDocument()
  })

  it('renders an empty list before the picture has loaded', () => {
    render(<Queue ranked={[]} />)
    expect(screen.getByRole('list', { name: 'Ranked queue' })).toBeEmptyDOMElement()
  })

  it('returns focus to the anchoring row when the selection clears (03a)', () => {
    const { rerender } = render(<Queue ranked={RANKED} selectedId="inject-01" onSelect={vi.fn()} />)
    rerender(<Queue ranked={RANKED} selectedId={null} onSelect={vi.fn()} />)
    const [, unheard] = rows()
    expect(document.activeElement).toBe(within(unheard).getByRole('button'))
  })

  it('selects a track through its row button (03a)', () => {
    const onSelect = vi.fn()
    render(<Queue ranked={RANKED} selectedId={null} onSelect={onSelect} />)
    const [silent] = rows()
    fireEvent.click(within(silent).getByRole('button'))
    expect(onSelect).toHaveBeenCalledWith('inject-03')
  })

  it('marks the selected row, in class and in aria (03a)', () => {
    render(<Queue ranked={RANKED} selectedId="inject-01" onSelect={vi.fn()} />)
    const [silent, unheard] = rows()
    expect(unheard).toHaveClass('queue__row--selected')
    expect(within(unheard).getByRole('button')).toHaveAttribute('aria-current', 'true')
    expect(silent).not.toHaveClass('queue__row--selected')
    expect(within(silent).getByRole('button')).not.toHaveAttribute('aria-current')
  })

  it('scrolls the selected row into view, including a row that arrives after the selection (03a)', () => {
    // Patched and restored: jsdom has no scrollIntoView — which is why the component's call is
    // optional — so the stub must not outlive this test.
    const original = Element.prototype.scrollIntoView
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    try {
      const filtered = RANKED.filter((entry) => entry.track.source === 'inject')
      const { rerender } = render(<Queue ranked={filtered} selectedId={null} onSelect={vi.fn()} />)
      expect(scroll).not.toHaveBeenCalled()
      // Selection lands while the row is filtered out: nothing to scroll to yet.
      rerender(<Queue ranked={filtered} selectedId="adsb-a3303d" onSelect={vi.fn()} />)
      expect(scroll).not.toHaveBeenCalled()
      // The filter clears and the selected row renders on this later commit — it still scrolls.
      rerender(<Queue ranked={RANKED} selectedId="adsb-a3303d" onSelect={vi.fn()} />)
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
    } finally {
      if (original) Element.prototype.scrollIntoView = original
      else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })
})

/** jsdom normalises inline colours to `rgb(r, g, b)`. */
function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}
