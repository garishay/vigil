import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Queue } from './Queue'
import { AO } from '../config/ao'
import { IDENTITY_COLOR } from '../lib/identity'
import type { RankedTrack } from '../lib/ranking'
import { scoreTrack } from '../lib/scoring'
import type { AdsbTrack, InjectTrack } from '../lib/tracks'

const SILENT: InjectTrack = {
  id: 'inject-03',
  source: 'inject',
  behavior: 'lawnmower',
  remoteId: 'silent',
  uaType: null,
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
  uaType: null,
  identity: 'unknown',
}

const HEARD: InjectTrack = {
  ...SILENT,
  id: 'inject-04',
  behavior: 'approach-retreat',
  remoteId: 'broadcasting',
  uaType: null,
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

/** Scored for real at the scenario's 02:30, nothing yet heard — the row shows what the engine says. */
const entry = (track: InjectTrack | AdsbTrack, rank: number, rangeM: number): RankedTrack => ({
  track,
  rank,
  rangeM,
  siteId: 'phl-airfield',
  score: scoreTrack(track, AO.protectedSites, { tSec: 0, minuteOfDay: 150, memory: {} }),
})

const RANKED: RankedTrack[] = [
  entry(SILENT, 1, 9200.3),
  entry(UNHEARD, 2, 6499.4),
  entry(AIRLINER, 3, 1124.5),
  entry(HEARD, 4, 8800.4),
  entry(PARKED, 5, 2122.9),
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

  it('shows plain-English identity with the shared dot, and the score on the chip (04a)', () => {
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
    // The chip is the whole-number composite; its hover names the three largest contributions,
    // so a row explains itself before the drawer opens.
    const chip = silent.querySelector('.queue__score') as HTMLElement
    expect(chip).toHaveTextContent(String(Math.round(RANKED[0].score.composite)))
    expect(chip.title).toMatch(/^Identity 25 · /)
    // The ceiling on the arrival, and never a dash anywhere.
    expect(airliner.querySelector('.queue__score')).toHaveTextContent('30')
    for (const row of rows()) expect(row.querySelector('.queue__score')).not.toHaveTextContent('—')
  })

  it('wears the band on the chip — the one warm colour on the row, and never on ADS-B (04b)', () => {
    render(<Queue ranked={RANKED} />)
    const band = (row: HTMLElement) => row.querySelector('.queue__score')?.getAttribute('data-band')
    expect(rows().map(band)).toEqual(RANKED.map((entry) => entry.score.band))
    const [silent, , airliner, , parked] = rows()
    expect(band(silent)).not.toBe('calm')
    expect(band(airliner)).toBe('calm')
    expect(band(parked)).toBe('calm')
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

  it('tags a row with its lifecycle state beside the layer badge, and omits the tag when New (03e)', () => {
    const status: Record<string, 'assessing' | 'escalated'> = {
      'inject-03': 'escalated',
      'inject-01': 'assessing',
    }
    render(<Queue ranked={RANKED} statusFor={(id) => status[id] ?? 'new'} />)
    const [silent, unheard, airliner] = rows()
    const tag = within(silent).getByText('Escalated')
    expect(tag).toHaveClass('queue__badge', 'queue__badge--state')
    expect(tag.previousElementSibling).toHaveTextContent('INJECT')
    expect(within(unheard).getByText('Assessing')).toHaveClass('queue__badge--state')
    expect(airliner.querySelector('.queue__badge--state')).toBeNull()
  })

  it('reads every row as New without a status supplier, and tags nothing (03e)', () => {
    render(<Queue ranked={RANKED} />)
    for (const row of rows()) expect(row.querySelector('.queue__badge--state')).toBeNull()
  })

  it('dims Resolved and Dismissed rows in place — rank kept, still selectable (03e)', () => {
    const status: Record<string, 'dismissed' | 'resolved' | 'assessing'> = {
      'inject-03': 'dismissed',
      'inject-01': 'assessing',
      'adsb-a46ab9': 'resolved',
    }
    const onSelect = vi.fn()
    render(<Queue ranked={RANKED} statusFor={(id) => status[id] ?? 'new'} onSelect={onSelect} />)
    const all = rows()
    expect(all).toHaveLength(RANKED.length)
    const [silent, unheard, airliner, heard] = all
    expect(silent).toHaveClass('queue__row--terminal')
    expect(silent.querySelector('.queue__rank')?.textContent).toBe('1')
    expect(within(silent).getByText('Dismissed')).toBeInTheDocument()
    expect(airliner).toHaveClass('queue__row--terminal')
    expect(airliner.querySelector('.queue__rank')?.textContent).toBe('3')
    expect(unheard).not.toHaveClass('queue__row--terminal')
    expect(heard).not.toHaveClass('queue__row--terminal')
    fireEvent.click(within(silent).getByRole('button'))
    expect(onSelect).toHaveBeenCalledWith('inject-03')
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

  it('falls back to the list when the anchoring row is filtered out (03a)', () => {
    const injectsOnly = RANKED.filter((entry) => entry.track.source === 'inject')
    const { rerender } = render(
      <Queue ranked={injectsOnly} selectedId="adsb-a3303d" onSelect={vi.fn()} />,
    )
    rerender(<Queue ranked={injectsOnly} selectedId={null} onSelect={vi.fn()} />)
    expect(document.activeElement).toBe(screen.getByRole('list', { name: 'Ranked queue' }))
  })

  it('takes the list, not the row, when the caller says the close was pointer-driven (#54)', () => {
    const { rerender } = render(<Queue ranked={RANKED} selectedId="inject-01" onSelect={vi.fn()} />)
    rerender(<Queue ranked={RANKED} selectedId={null} restoreFocus={false} onSelect={vi.fn()} />)
    // A mouse user parked on the row would have Space re-select it instead of scrolling; the
    // list has no activation to misfire and keeps their place — not body (#56 review).
    const [, unheard] = rows()
    expect(document.activeElement).not.toBe(within(unheard).getByRole('button'))
    expect(document.activeElement).toBe(screen.getByRole('list', { name: 'Ranked queue' }))
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
    withScrollStub((scroll) => {
      const filtered = RANKED.filter((entry) => entry.track.source === 'inject')
      const { rerender } = render(<Queue ranked={filtered} selectedId={null} onSelect={vi.fn()} />)
      expect(scroll).not.toHaveBeenCalled()
      // Selection lands while the row is filtered out: nothing to scroll to yet.
      rerender(<Queue ranked={filtered} selectedId="adsb-a3303d" onSelect={vi.fn()} />)
      expect(scroll).not.toHaveBeenCalled()
      // The filter clears and the selected row renders on this later commit — it still scrolls.
      rerender(<Queue ranked={RANKED} selectedId="adsb-a3303d" onSelect={vi.fn()} />)
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
    })
  })

  it('holds its place while the clock runs: a re-ranked list never re-scrolls a held selection (#76)', () => {
    withScrollStub((scroll) => {
      // What playback does: `ranked` is rebuilt every tick, so every entry is a new object and
      // the array identity changes even when the picture has not moved a pixel. Before the fix
      // this snapped the list back to the selected row once a second.
      const tick = () => RANKED.map((entry) => ({ ...entry }))
      const { rerender } = render(
        <Queue ranked={tick()} selectedId="inject-01" onSelect={vi.fn()} />,
      )
      expect(scroll).toHaveBeenCalledTimes(1)
      scroll.mockClear()

      for (let t = 0; t < 5; t++) {
        rerender(<Queue ranked={tick()} selectedId="inject-01" onSelect={vi.fn()} />)
      }
      expect(scroll).not.toHaveBeenCalled()
    })
  })

  it('scrolls once when the selection actually changes, mid-playback (#76)', () => {
    withScrollStub((scroll) => {
      const tick = () => RANKED.map((entry) => ({ ...entry }))
      const { rerender } = render(
        <Queue ranked={tick()} selectedId="inject-01" onSelect={vi.fn()} />,
      )
      scroll.mockClear()

      // The operator picks a different track while the clock is running: one scroll, then quiet
      // again however many ticks follow. The suppression is per selection, not permanent.
      rerender(<Queue ranked={tick()} selectedId="inject-03" onSelect={vi.fn()} />)
      expect(scroll).toHaveBeenCalledTimes(1)
      rerender(<Queue ranked={tick()} selectedId="inject-03" onSelect={vi.fn()} />)
      expect(scroll).toHaveBeenCalledTimes(1)

      // And a cleared selection forgets, so re-picking the same track scrolls to it again —
      // otherwise closing the drawer and reopening the same row would leave it off-screen.
      rerender(<Queue ranked={tick()} selectedId={null} onSelect={vi.fn()} />)
      rerender(<Queue ranked={tick()} selectedId="inject-03" onSelect={vi.fn()} />)
      expect(scroll).toHaveBeenCalledTimes(2)
    })
  })

  it('scrolls a late-arriving row once on arrival, not again on the ticks after it (#76)', () => {
    withScrollStub((scroll) => {
      const injects = () => RANKED.filter((entry) => entry.track.source === 'inject')
      const all = () => RANKED.map((entry) => ({ ...entry }))

      // Selected while filtered out: nothing to scroll to, and nothing recorded either — so the
      // arrival below is still owed its one scroll.
      const { rerender } = render(
        <Queue ranked={injects()} selectedId="adsb-a3303d" onSelect={vi.fn()} />,
      )
      expect(scroll).not.toHaveBeenCalled()

      rerender(<Queue ranked={all()} selectedId="adsb-a3303d" onSelect={vi.fn()} />)
      expect(scroll).toHaveBeenCalledTimes(1)

      // The clock keeps running past the arrival. One scroll, total.
      for (let t = 0; t < 3; t++) {
        rerender(<Queue ranked={all()} selectedId="adsb-a3303d" onSelect={vi.fn()} />)
      }
      expect(scroll).toHaveBeenCalledTimes(1)
    })
  })

  it('scrolls a served row again when it leaves the list and comes back (#78 round 1)', () => {
    withScrollStub((scroll) => {
      // The selection outlives a filter that hides its row (App keeps the drawer open), so a
      // row can be scrolled to, dropped by a filter, and re-rendered off-screen in a longer
      // list. Suppressing on "already served" alone strands it there — the ref has to forget a
      // row that leaves, or the arriving-row case only ever works for a selection never served.
      const injects = () => RANKED.filter((entry) => entry.track.source === 'inject')
      const all = () => RANKED.map((entry) => ({ ...entry }))

      const { rerender } = render(
        <Queue ranked={all()} selectedId="adsb-a3303d" onSelect={vi.fn()} />,
      )
      expect(scroll).toHaveBeenCalledTimes(1)

      // The Injects chip hides the row; the selection and its drawer stay.
      rerender(<Queue ranked={injects()} selectedId="adsb-a3303d" onSelect={vi.fn()} />)
      expect(scroll).toHaveBeenCalledTimes(1)

      // Back to All: the row returns, off-screen, and is owed a scroll.
      rerender(<Queue ranked={all()} selectedId="adsb-a3303d" onSelect={vi.fn()} />)
      expect(scroll).toHaveBeenCalledTimes(2)

      // Still quiet under the ticks that follow: forgetting on absence did not undo the fix.
      for (let t = 0; t < 3; t++) {
        rerender(<Queue ranked={all()} selectedId="adsb-a3303d" onSelect={vi.fn()} />)
      }
      expect(scroll).toHaveBeenCalledTimes(2)
    })
  })
})

/**
 * jsdom has no `scrollIntoView`, which is why the component's call is optional. The stub must
 * not outlive the test that installs it.
 */
function withScrollStub(run: (scroll: ReturnType<typeof vi.fn>) => void) {
  const original = Element.prototype.scrollIntoView
  const scroll = vi.fn()
  Element.prototype.scrollIntoView = scroll
  try {
    run(scroll)
  } finally {
    if (original) Element.prototype.scrollIntoView = original
    else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  }
}

/** jsdom normalises inline colours to `rgb(r, g, b)`. */
function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}
