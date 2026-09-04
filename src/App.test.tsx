import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { AO } from './config/ao'
import { DEFAULT_RECORDING, recordingNamed } from './config/recordings'
import { SCENARIO } from './config/scenario'
import type { CaptureState } from './data/useCapture'
import type { Schedule } from './data/usePlayback'
import { trackIdent } from './lib/display'
import { gridTimeline, injectTracksAt, planScenario as planInjects } from './lib/injects'
import { addSite, fromConfig, sitePlanText } from './lib/sites'

// Every `terminalIds` the map was handed, in order — the array *identities*, not their contents,
// because the map re-pushes its whole source when that prop changes and the ruling on #61 is that
// it may only change when the set does.
const { terminalIdsSeen } = vi.hoisted(() => ({
  terminalIdsSeen: [] as (readonly string[])[],
}))

// The map itself is covered by MapView.test.tsx; here it is stubbed so these tests stay about
// layout, navigation, and what the picture status strip reports.
// Where the stub map's placement click lands (08a); a test sets it before pressing map-place.
const { placeTarget } = vi.hoisted(() => ({
  placeTarget: { center: [-75.3, 39.85] as [number, number] },
}))

vi.mock('./components/MapView', () => ({
  MapView: ({
    sites = [],
    selectedSiteId = null,
    placing = false,
    onPlace,
    tracks,
    injects,
    selectedId,
    selectionShown = true,
    trail = [],
    terminalIds = [],
    onSelect,
  }: {
    sites?: readonly { id: string }[]
    selectedSiteId?: string | null
    placing?: boolean
    onPlace?: (center: [number, number]) => void
    tracks?: { id: string }[]
    injects?: { id: string }[]
    selectedId?: string | null
    selectionShown?: boolean
    trail?: unknown[]
    terminalIds?: readonly string[]
    onSelect?: (id: string) => void
  }) => {
    terminalIdsSeen.push(terminalIds as readonly string[])
    return (
      <div
        data-testid="map"
        data-tracks={tracks?.length ?? 0}
        data-injects={injects?.length ?? 0}
        data-selected={selectedId ?? ''}
        data-selection-shown={String(selectionShown)}
        data-trail={trail.length}
        data-terminal={[...terminalIds].join(',')}
        data-sites={sites.map((site) => site.id).join(',')}
        data-selected-site={selectedSiteId ?? ''}
        data-placing={String(placing)}
      >
        {/* Stands in for a dot click: selects the first inject, like the real map would. */}
        <button
          type="button"
          data-testid="map-select"
          onClick={() => injects?.[0] && onSelect?.(injects[0].id)}
        />
        {/* Stands in for the placement click (08a): reports the test's target position. */}
        <button
          type="button"
          data-testid="map-place"
          onClick={() => onPlace?.(placeTarget.center)}
        />
      </div>
    )
  },
}))

const { useCapture, planScenario, lookupPhoto } = vi.hoisted(() => ({
  useCapture: vi.fn(),
  planScenario: vi.fn(),
  lookupPhoto: vi.fn(),
}))

// The photo lookup is the one runtime network call; stubbed at the module App defaults to, so no
// test here — whichever row it opens — can reach Planespotters. photos.test.ts covers the real one.
vi.mock('./data/photos', () => ({ lookupPhoto }))

// The generator runs for real; the spy is only here to check what timeline App hands it.
vi.mock('./lib/injects', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/injects')>()
  planScenario.mockImplementation(actual.planScenario)
  return { ...actual, planScenario }
})
vi.mock('./data/useCapture', () => ({ useCapture }))

const READY: CaptureState = {
  status: 'ready',
  recording: DEFAULT_RECORDING,
  capture: {
    ao: 'phl',
    source: 'adsb.lol v2',
    capturedAt: '2026-08-29T23:09:25.373Z',
    intervalMs: 15000,
    bbox: AO.bbox,
    frames: [
      {
        tMs: 0,
        records: [
          { hex: 'a06461', callsign: 'AAL423', position: [-75.1, 39.7], groundSpeedKt: 275 },
          { hex: '501267', position: [-75.9, 39.8], groundSpeedKt: 60 },
        ],
      },
    ],
  },
}

// The replay clock never ticks here unless a test drives it: frame 0 stays frame 0 whatever
// the test's wall duration, which is the flake the acceptance on #6 names.
const never: Schedule = () => () => {}

beforeEach(() => {
  useCapture.mockReturnValue(READY)
  lookupPhoto.mockReset()
  lookupPhoto.mockResolvedValue(null)
})

describe('App shell', () => {
  it('renders the product name, the AO, and the status strip', () => {
    render(<App schedule={never} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Vigil' })).toBeInTheDocument()
    expect(screen.getByLabelText('Picture status')).toBeInTheDocument()
    expect(screen.getByText(AO.name)).toBeInTheDocument()
    expect(screen.getByTestId('map')).toBeInTheDocument()
  })

  it('states that it is not an operational system', () => {
    render(<App schedule={never} />)
    expect(screen.getByText(/not for operational use/i)).toBeInTheDocument()
  })

  it('opens on Home', () => {
    render(<App schedule={never} />)
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: 'Picture summary' })).toBeInTheDocument()
  })

  it('reports the cooperative track count once the recording loads', async () => {
    render(<App schedule={never} />)
    await waitFor(() => expect(screen.getByText('Cooperative').nextSibling).toHaveTextContent('2'))
    expect(screen.getByTestId('map')).toHaveAttribute('data-tracks', '2')
  })

  it('puts injects on the map alongside the cooperative layer', async () => {
    render(<App schedule={never} />)
    const map = screen.getByTestId('map')
    await waitFor(() => expect(Number(map.getAttribute('data-injects'))).toBeGreaterThan(0))
    expect(screen.getByText('Injects').nextSibling).toHaveTextContent(
      map.getAttribute('data-injects') as string,
    )
  })

  it('names the seed, so the picture on screen can be reproduced', () => {
    render(<App schedule={never} />)
    expect(screen.getByText('Seed').nextSibling).toHaveTextContent(SCENARIO.seed)
  })

  it('shows the sim clock at the recording’s configured start — the hour the picture is scored at (04a)', () => {
    // Ruled with D2 on #4: the breakdown names a time the strip must not deny. PR 06 makes it tick.
    // From #84 the hour is the recording's; 001 keeps 02:30 by config, for §13.
    render(<App schedule={never} />)
    expect(screen.getByText('Sim clock').nextSibling).toHaveTextContent('02:30:00')
  })

  it('names the loaded recording and its capture date beside the seed (#84)', () => {
    render(<App schedule={never} />)
    // 001's own date, in the AO's zone, beside its configured clock — the date is provenance.
    expect(screen.getByText('Recording').nextSibling).toHaveTextContent(
      'vigil-phl-001 · 2026-08-29',
    )
    expect(screen.getByText('Seed').nextSibling).toHaveTextContent(SCENARIO.seed)
  })

  // R4 on #84: a recording whose clock is 'captured' opens at its capture wall time in the AO's
  // zone, and the off-hours factor reads it — 22:02Z on 4 September is 18:02 in Philadelphia,
  // inside operating hours, where 001's 02:30 is not.
  it('opens a captured-clock recording at its wall time, inside operating hours (#84)', () => {
    useCapture.mockReturnValue({
      ...READY,
      recording: recordingNamed('vigil-phl-002'),
      capture: { ...READY.capture, capturedAt: '2026-09-04T22:02:11.000Z' },
    } as CaptureState)
    render(<App schedule={never} />)
    expect(screen.getByText('Recording').nextSibling).toHaveTextContent(
      'vigil-phl-002 · 2026-09-04',
    )
    expect(screen.getByText('Sim clock').nextSibling).toHaveTextContent('18:02:00')
    expect(screen.getByText('Seed').nextSibling).toHaveTextContent(SCENARIO.seed)
    // And the scorer agrees with the strip (#98 review): no inject row is tagged off-hours, and
    // the breakdown's Off-hours row reads the same hour, inside the window, at 0.
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'INJECT' }))
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    const rows = within(queue).getAllByRole('listitem')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows)
      expect(row.querySelector('.queue__reason')).not.toHaveTextContent('off-hours')
    fireEvent.click(within(rows[0]).getByRole('button'))
    expect(screen.getByText('18:02 local — within 06:00–22:00')).toBeInTheDocument()
  })

  it('holds the Recording field back with the counts until the recording is in (#84)', () => {
    useCapture.mockReturnValue({ status: 'loading' })
    render(<App schedule={never} />)
    expect(screen.getByText('Recording').nextSibling).toHaveTextContent('…')
    expect(screen.getByText('Sim clock').nextSibling).toHaveTextContent('…')
  })

  it('scores every row, with the ADS-B block held under the ceiling (04a)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const rows = within(screen.getByRole('list', { name: 'Ranked queue' })).getAllByRole('listitem')
    const chips = rows.map((row) => Number(row.querySelector('.queue__score')?.textContent))
    expect(chips.every((chip) => Number.isInteger(chip) && chip >= 0 && chip <= 100)).toBe(true)
    // Ranked by score: the chips never climb down the list.
    expect(chips).toEqual([...chips].sort((a, b) => b - a))
    for (const row of rows) {
      if (within(row).queryByText('ADS-B')) {
        expect(Number(row.querySelector('.queue__score')?.textContent)).toBeLessThanOrEqual(30)
        // The warm bands are a score's to earn, and no real aircraft can (§2, 04b).
        expect(row.querySelector('.queue__score')).toHaveAttribute('data-band', 'calm')
      }
    }
  })

  it('opens a row to its breakdown in the drawer, header and bars agreeing with the chip (04b)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    const firstRow = within(queue).getAllByRole('listitem')[0]
    const chip = firstRow.querySelector('.queue__score') as HTMLElement
    fireEvent.click(within(firstRow).getByRole('button'))
    const breakdown = screen.getByLabelText('Score breakdown')
    expect(within(breakdown).getByText(`Score ${chip.textContent}`)).toBeInTheDocument()
    expect(breakdown).toHaveAttribute('data-band', chip.getAttribute('data-band'))
    expect(within(breakdown).getAllByRole('meter')).toHaveLength(6)
  })

  it("plans the injects on the recording's own frame grid", () => {
    // The two layers share one timeline, which is what lets PR 06 advance a single clock. App
    // holds the plan and samples it, so that clock will drive `injectTracksAt` with no rewiring.
    render(<App schedule={never} />)
    expect(planScenario).toHaveBeenCalledWith({
      intervalMs: 15000,
      frameTimesMs: READY.status === 'ready' ? READY.capture.frames.map((frame) => frame.tMs) : [],
    })
  })

  it('ranks both layers into one queue on the Queue surface', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    const rows = within(queue).getAllByRole('listitem')
    const injectCount = Number(screen.getByTestId('map').getAttribute('data-injects'))
    expect(rows).toHaveLength(2 + injectCount)
    expect(screen.getByLabelText('Tracks in queue')).toHaveTextContent(String(2 + injectCount))
    // Identity leads: every non-cooperative inject sits above every ADS-B track.
    const badges = rows.map((row) => within(row).getByText(/^(INJECT|ADS-B)$/).textContent)
    const lastNonCoop = rows.findLastIndex((row) => row.textContent?.includes('Non-cooperative'))
    expect(lastNonCoop).toBeGreaterThan(0)
    expect(badges.slice(0, lastNonCoop + 1).every((badge) => badge === 'INJECT')).toBe(true)
    expect(within(rows[0]).getByText(/^TRK-\d\d$/)).toBeInTheDocument()
  })

  it('shows the Queue only on the Queue surface', () => {
    render(<App schedule={never} />)
    expect(screen.queryByRole('list', { name: 'Ranked queue' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    expect(screen.getByRole('list', { name: 'Ranked queue' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Home' }))
    expect(screen.queryByRole('list', { name: 'Ranked queue' })).not.toBeInTheDocument()
  })

  it('holds the count back while the recording is still loading', () => {
    useCapture.mockReturnValue({ status: 'loading' })
    render(<App schedule={never} />)
    expect(screen.getByText('Cooperative').nextSibling).toHaveTextContent('…')
    expect(screen.getByTestId('map')).toHaveAttribute('data-tracks', '0')
  })

  // An airspace picture that cannot load its traffic has to say so, not show a plausible empty map.
  it('surfaces a load failure instead of rendering an empty picture silently', () => {
    useCapture.mockReturnValue({ status: 'error', message: 'could not load the ADS-B recording' })
    render(<App schedule={never} />)
    expect(screen.getByRole('alert')).toHaveTextContent('could not load the ADS-B recording')
    expect(screen.getByText('Cooperative').nextSibling).toHaveTextContent('—')
  })

  it('opens the drawer beside the list from a row click, and closes it (03a)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    const firstRow = within(queue).getAllByRole('listitem')[0]
    fireEvent.click(within(firstRow).getByRole('button'))

    const drawer = screen.getByLabelText(/^Track review: /)
    expect(drawer).toBeInTheDocument()
    // The list stays on screen while reviewing (§4.2) — three columns, not a swap.
    expect(screen.getByRole('list', { name: 'Ranked queue' })).toBeInTheDocument()
    expect(document.querySelector('.shell__body--drawer')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Close review' }))
    expect(screen.queryByLabelText(/^Track review: /)).not.toBeInTheDocument()
    expect(document.querySelector('.shell__body--drawer')).toBeNull()
  })

  it('shows the drawer alone on Review, and an empty state without a selection (03a)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByText('Select a track from the Queue.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    fireEvent.click(within(within(queue).getAllByRole('listitem')[0]).getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByLabelText(/^Track review: /)).toBeInTheDocument()
    expect(screen.queryByText('Select a track from the Queue.')).not.toBeInTheDocument()
    // Selection persisted across the surface switch — client state only.
    expect(screen.queryByRole('list', { name: 'Ranked queue' })).not.toBeInTheDocument()
  })

  it('lands focus on the Review nav item when the drawer closes on Review, not on body (#46)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    fireEvent.click(within(within(queue).getAllByRole('listitem')[0]).getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))

    // A keyboard operator has the close button focused when they activate it; the Queue's
    // row-focus return is unmounted here, so without #46 the unmount drops them on body.
    const close = screen.getByRole('button', { name: 'Close review' })
    close.focus()
    fireEvent.click(close)
    expect(screen.queryByLabelText(/^Track review: /)).not.toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Review' }))
    expect(document.activeElement).not.toBe(document.body)
  })

  it('leaves a mouse-driven close on Review alone — no focus jump to the header (#53 review)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    fireEvent.click(within(within(queue).getAllByRole('listitem')[0]).getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    // A mouse click carries a positive detail; the drawer's own recovery skips it for the same
    // reason (03b round 6) — a pointer user parked on the nav button would Space-activate it.
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }), { detail: 1 })
    expect(screen.queryByLabelText(/^Track review: /)).not.toBeInTheDocument()
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Review' }))
  })

  it('sends a mouse-driven close on the Queue surface to the list, not the row (#54)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    const row = within(within(queue).getAllByRole('listitem')[0]).getByRole('button')
    fireEvent.click(row, { detail: 1 })
    // Same gate as Review and the drawer: a positive detail is a pointer, and a pointer user
    // parked on the row would have Space re-select the track instead of scrolling the list.
    // The list itself is safe to land on, and keeps the operator's place (#56 review).
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }), { detail: 1 })
    expect(screen.queryByLabelText(/^Track review: /)).not.toBeInTheDocument()
    expect(document.activeElement).not.toBe(row)
    expect(document.activeElement).toBe(queue)
  })

  it('keeps the Queue-surface close returning focus to the row, as 03a built it (#46)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    const row = within(within(queue).getAllByRole('listitem')[0]).getByRole('button')
    fireEvent.click(row)
    const close = screen.getByRole('button', { name: 'Close review' })
    close.focus()
    fireEvent.click(close)
    expect(document.activeElement).toBe(row)
  })

  it('selects from the map side and syncs the row (03a)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByTestId('map-select'))
    expect(screen.getByLabelText(/^Track review: /)).toBeInTheDocument()
    const selected = document.querySelector('.queue__row--selected')
    expect(selected).not.toBeNull()
    expect(screen.getByTestId('map').getAttribute('data-selected')).toBe(
      selected?.getAttribute('data-id'),
    )
  })

  it('lands a Home-surface map selection on the Queue, where it can be reviewed and cleared (03a)', () => {
    render(<App schedule={never} />)
    // Home has no drawer and no close button; a selection made there must not strand the user.
    fireEvent.click(screen.getByTestId('map-select'))
    expect(screen.getByRole('button', { name: 'Queue' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByLabelText(/^Track review: /)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }))
    expect(screen.queryByLabelText(/^Track review: /)).not.toBeInTheDocument()
  })

  it('filters by layer without renumbering the ranks (03a)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const injectCount = Number(screen.getByTestId('map').getAttribute('data-injects'))

    // On this picture every inject outranks the two distant ADS-B tracks, so the ADS-B filter is
    // the one that exposes renumbering: global ranks read 7 and 8, renumbered ones would read 1
    // and 2.
    fireEvent.click(screen.getByRole('button', { name: 'ADS-B' }))
    let rows = within(screen.getByRole('list', { name: 'Ranked queue' })).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(screen.getByLabelText('Tracks in queue')).toHaveTextContent('2')
    for (const row of rows) expect(within(row).queryByText('INJECT')).not.toBeInTheDocument()
    const ranks = rows.map((row) => Number(row.querySelector('.queue__rank')?.textContent))
    expect(ranks.every((rank) => rank > injectCount)).toBe(true)

    // Two chip rows both carry an "All" — scope to the layer group (03b added the state row).
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Filter by layer' })).getByRole('button', {
        name: 'All',
      }),
    )
    rows = within(screen.getByRole('list', { name: 'Ranked queue' })).getAllByRole('listitem')
    expect(rows).toHaveLength(2 + injectCount)
  })

  it('walks the full lifecycle New → Assessing → Escalated → Resolved in the drawer (03b)', () => {
    render(<App schedule={never} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    fireEvent.click(within(within(queue).getAllByRole('listitem')[0]).getByRole('button'))
    const drawer = () => screen.getByLabelText(/^Track review: /)
    const status = () => within(drawer()).getByText('Status').parentElement as HTMLElement

    // Every track opened its log as New, with the injected clock in the first-seen entry.
    expect(within(status()).getByText('New')).toBeInTheDocument()
    expect(within(drawer()).getByText('New — first seen')).toBeInTheDocument()
    expect(within(drawer()).getByText('02:30:00')).toBeInTheDocument()

    fireEvent.click(within(drawer()).getByRole('button', { name: 'Assess' }))
    expect(within(status()).getByText('Assessing')).toBeInTheDocument()

    fireEvent.click(within(drawer()).getByRole('button', { name: 'Escalate' }))
    fireEvent.click(within(drawer()).getByRole('radio', { name: 'PHL Tower' }))
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Confirm escalation' }))
    expect(within(status()).getByText('Escalated')).toBeInTheDocument()
    const handoff = within(drawer()).getByLabelText('Handoff text') as HTMLTextAreaElement
    expect(handoff.value).toContain('To: PHL Tower')

    fireEvent.click(within(drawer()).getByRole('button', { name: 'Resolve' }))
    fireEvent.click(within(drawer()).getByRole('radio', { name: 'Benign' }))
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Confirm resolution' }))
    expect(within(status()).getByText('Resolved')).toBeInTheDocument()
    // Terminal: the vocabulary stays visible, nothing stays legal.
    for (const name of ['Assess', 'Escalate', 'Dismiss', 'Resolve'])
      expect(within(drawer()).getByRole('button', { name })).toBeDisabled()
    // The record kept every step, oldest first.
    const lines = within(within(drawer()).getByLabelText('Event log')).getAllByRole('listitem')
    expect(lines.map((line) => line.textContent?.slice(8))).toEqual([
      'New — first seen',
      'Assessing — claimed',
      'Escalated — to PHL Tower',
      'Resolved — Benign',
    ])
  })

  it('stamps first sight once, not per render or per tick (03b review fix, 06a)', () => {
    // The default `now` prop is a fresh function identity each render, so first-seen must not
    // ride a memo keyed on it — and the replay clock must not restamp it either: a track first
    // seen at 02:30:00 keeps that mark after the clock has moved.
    useCapture.mockReturnValue(MOVING)
    const replay = manualClock()
    const { rerender } = render(
      <App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    replay.tick(10)
    rerender(<App schedule={replay.schedule} now={() => '2026-09-01T13:00:00.000Z'} />)
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    fireEvent.click(within(within(queue).getAllByRole('listitem')[0]).getByRole('button'))
    const log = within(screen.getByLabelText('Event log'))
    expect(log.getByText('02:30:00')).toBeInTheDocument()
    expect(log.queryByText('02:30:10')).not.toBeInTheDocument()
  })

  it('filters by state with global ranks kept, composing with the layer filter (03b)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const queue = () => screen.getByRole('list', { name: 'Ranked queue' })
    const total = within(queue()).getAllByRole('listitem').length

    // Dismiss the top-ranked track, then filter to Dismissed: one row, still wearing rank 1.
    fireEvent.click(within(within(queue()).getAllByRole('listitem')[0]).getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    const stateChips = screen.getByRole('group', { name: 'Filter by state' })
    fireEvent.click(within(stateChips).getByRole('button', { name: 'Dismissed' }))
    let rows = within(queue()).getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(rows[0].querySelector('.queue__rank')?.textContent).toBe('1')
    expect(screen.getByLabelText('Tracks in queue')).toHaveTextContent('1')

    // The rest read New; the two rows compose — New ∧ ADS-B leaves only the recorded layer.
    fireEvent.click(within(stateChips).getByRole('button', { name: 'New' }))
    expect(within(queue()).getAllByRole('listitem')).toHaveLength(total - 1)
    const layerChips = screen.getByRole('group', { name: 'Filter by layer' })
    fireEvent.click(within(layerChips).getByRole('button', { name: 'ADS-B' }))
    rows = within(queue()).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(within(row).queryByText('INJECT')).not.toBeInTheDocument()
  })

  it('shows lifecycle state on the row, and Active as the non-terminal set with global ranks (03e)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const queue = () => screen.getByRole('list', { name: 'Ranked queue' })
    const rows = () => within(queue()).getAllByRole('listitem')
    const total = rows().length
    const stateChips = screen.getByRole('group', { name: 'Filter by state' })
    const rank = (row: HTMLElement) => row.querySelector('.queue__rank')?.textContent

    // A fresh picture is all New: no tag anywhere, nothing dimmed, and Active shows everything.
    expect(queue().querySelector('.queue__badge--state')).toBeNull()
    expect(queue().querySelector('.queue__row--terminal')).toBeNull()
    fireEvent.click(within(stateChips).getByRole('button', { name: 'Active' }))
    expect(rows()).toHaveLength(total)

    // Claim the second-ranked track and dismiss the first. Under All both keep their places:
    // the claimed one tagged, the dismissed one tagged and dimmed, rank 1 still on it.
    fireEvent.click(within(rows()[1]).getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: 'Assess' }))
    fireEvent.click(within(rows()[0]).getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    fireEvent.click(within(stateChips).getByRole('button', { name: 'All' }))
    expect(rows()).toHaveLength(total)
    expect(rows()[0]).toHaveClass('queue__row--terminal')
    expect(within(rows()[0]).getByText('Dismissed')).toHaveClass('queue__badge--state')
    expect(rank(rows()[0])).toBe('1')
    expect(rows()[1]).not.toHaveClass('queue__row--terminal')
    expect(within(rows()[1]).getByText('Assessing')).toHaveClass('queue__badge--state')

    // Active drops the dismissed row and nothing else; the list now starts at rank 2, and the
    // count follows. It composes with the layer row like every other state chip.
    fireEvent.click(within(stateChips).getByRole('button', { name: 'Active' }))
    expect(rows()).toHaveLength(total - 1)
    expect(rank(rows()[0])).toBe('2')
    expect(screen.getByLabelText('Tracks in queue')).toHaveTextContent(String(total - 1))
    const layerChips = screen.getByRole('group', { name: 'Filter by layer' })
    fireEvent.click(within(layerChips).getByRole('button', { name: 'ADS-B' }))
    expect(rows()).toHaveLength(2)
    for (const row of rows()) expect(within(row).queryByText('INJECT')).not.toBeInTheDocument()
  })

  it('says when no track matches the filters, but not while the picture is loading (#49)', () => {
    const { rerender } = render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    // The live region is there from the moment the Queue is, empty: a region that appears in the
    // same commit as its text is one some screen readers never announce (#51 review).
    const region = () => screen.getByRole('status')
    expect(region()).toBeEmptyDOMElement()

    // Nothing is escalated on a fresh picture, so the Escalated chip is the first legitimately
    // empty list: the count reads 0, and the line says why — to the operator who pressed it.
    const stateChips = screen.getByRole('group', { name: 'Filter by state' })
    fireEvent.click(within(stateChips).getByRole('button', { name: 'Escalated' }))
    expect(
      within(screen.getByRole('list', { name: 'Ranked queue' })).queryAllByRole('listitem'),
    ).toHaveLength(0)
    expect(screen.getByLabelText('Tracks in queue')).toHaveTextContent('0')
    expect(region()).toHaveTextContent('No tracks match the filters.')

    // The filters persist across surfaces, so a round trip through Home must land back on the
    // *same* region, refilled — not a fresh one born with its text (#51 review, round 3).
    const node = region()
    fireEvent.click(screen.getByRole('button', { name: 'Home' }))
    expect(region()).toBe(node)
    expect(region()).toBeEmptyDOMElement()
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    expect(region()).toBe(node)
    expect(region()).toHaveTextContent('No tracks match the filters.')

    // The chip row did remount on that trip; the region is the only thing that must not have.
    const chipsAgain = screen.getByRole('group', { name: 'Filter by state' })
    fireEvent.click(within(chipsAgain).getByRole('button', { name: 'All' }))
    expect(region()).toBeEmptyDOMElement()

    // An empty list with no recording behind it is not a filter result: nothing while loading,
    // nothing on a load failure — the error already says what happened.
    useCapture.mockReturnValue({ status: 'loading' })
    rerender(<App schedule={never} />)
    expect(region()).toBeEmptyDOMElement()
    useCapture.mockReturnValue({ status: 'error', message: 'Could not load the recording.' })
    rerender(<App schedule={never} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(region()).toBeEmptyDOMElement()
  })

  it('keeps the selection but not the ring on Home (03b, ruled A2 on #3)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByTestId('map-select'))
    const selected = screen.getByTestId('map').getAttribute('data-selected')
    expect(selected).not.toBe('')
    expect(screen.getByTestId('map').getAttribute('data-selection-shown')).toBe('true')

    // Home: the ring is suppressed as presentation, but the selection itself still reaches the
    // map — nulling it instead would reset the ease stamp and re-fly the camera (#47 review).
    fireEvent.click(screen.getByRole('button', { name: 'Home' }))
    expect(screen.getByTestId('map').getAttribute('data-selected')).toBe(selected)
    expect(screen.getByTestId('map').getAttribute('data-selection-shown')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    expect(screen.getByTestId('map').getAttribute('data-selection-shown')).toBe('true')
    expect(screen.getByLabelText(/^Track review: /)).toBeInTheDocument()
  })

  it('chains actions batched into one commit instead of overwriting (03b review fix)', () => {
    render(<App schedule={never} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    fireEvent.click(within(within(queue).getAllByRole('listitem')[0]).getByRole('button'))
    const drawer = screen.getByLabelText(/^Track review: /)
    const assess = within(drawer).getByRole('button', { name: 'Assess' })
    const dismiss = within(drawer).getByRole('button', { name: 'Dismiss' })
    // Both clicks land in one React commit: the second updater must see the first's event, so
    // the log chains New → Assessing → Dismissed rather than losing the claim (#47 review).
    act(() => {
      assess.click()
      dismiss.click()
    })
    const lines = within(within(drawer).getByLabelText('Event log')).getAllByRole('listitem')
    expect(lines.map((line) => line.textContent?.slice(8))).toEqual([
      'New — first seen',
      'Assessing — claimed',
      'Dismissed',
    ])
  })

  it('renders the Review surface at the drawer column width (03b, ruled B1 on #3)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(document.querySelector('.shell__body--review')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Home' }))
    expect(document.querySelector('.shell__body--review')).toBeNull()
  })

  it('switches surfaces without unmounting the map', () => {
    render(<App schedule={never} />)
    const map = screen.getByTestId('map')

    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    expect(screen.getByRole('heading', { name: 'Ranked queue' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Queue' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current')

    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByRole('heading', { name: 'Track review' })).toBeInTheDocument()

    expect(screen.getByTestId('map')).toBe(map)
  })

  it('looks up the photo for the opened ADS-B track, and shows it credited in the drawer (03d)', async () => {
    lookupPhoto.mockResolvedValue({
      src: 'https://t.plnspttrs.net/1/1_t.jpg',
      width: 200,
      height: 133,
      link: 'https://www.planespotters.net/photo/1/n123?utm_source=api',
      photographer: 'Tester',
    })
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'ADS-B' }))
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    fireEvent.click(within(within(queue).getAllByRole('listitem')[0]).getByRole('button'))
    // The nearer of the two ADS-B tracks ranks first; the lookup gets that track, once.
    expect(lookupPhoto).toHaveBeenCalledTimes(1)
    expect(lookupPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'adsb', icaoHex: 'a06461' }),
    )
    const link = await screen.findByRole('link', { name: '© Tester · Planespotters.net' })
    expect(link).toHaveAttribute(
      'href',
      'https://www.planespotters.net/photo/1/n123?utm_source=api',
    )
    // Nowhere else: the Queue row never shows a photo, a credit, or a link (§2).
    expect(within(queue).queryByRole('link')).not.toBeInTheDocument()
  })

  it('never looks up a photo for an inject (03d)', async () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByTestId('map-select'))
    expect(screen.getByLabelText(/^Track review: /)).toBeInTheDocument()
    await act(async () => {})
    expect(lookupPhoto).not.toHaveBeenCalled()
  })
})

/**
 * A scheduler the test drives by hand: `tick()` is the replay clock. Nothing here waits on real
 * time, which is the flake the acceptance on #6 names.
 */
function manualClock() {
  let pending: (() => void) | null = null
  const schedule: Schedule = (tick) => {
    pending = tick
    return () => {
      pending = null
    }
  }
  return { schedule, tick: (n = 1) => act(() => void [...Array(n)].forEach(() => pending?.())) }
}

/**
 * Eight frames at 15 s. `a06461` starts inside the site's ring and flies east at 250 kt, so its
 * range — and its uncapped score, which orders the ADS-B block under the ceiling — changes every
 * tick; `501267` sits parked at 1.5 radii. `bbbbbb` is heard only at frame 0 and coasts out;
 * `cccccc` appears at frame 2 (30 s); `dddddd` is heard at frames 0 and 7 (105 s) — a hole wider
 * than the coast, so it leaves the picture at 91 s and is back at 105 s, further out and slower.
 */
const MOVING: CaptureState = {
  status: 'ready',
  recording: DEFAULT_RECORDING,
  capture: {
    ao: 'phl',
    source: 'adsb.lol v2',
    capturedAt: '2026-08-29T23:09:25.373Z',
    intervalMs: 15000,
    bbox: AO.bbox,
    frames: [...Array(8)].map((_, i) => ({
      tMs: i * 15000,
      records: [
        {
          hex: 'a06461',
          callsign: 'AAL423',
          position: [-75.23 + i * 0.03, 39.88] as [number, number],
          altitudeFt: 3000,
          groundSpeedKt: 250,
          headingDeg: 90,
        },
        { hex: '501267', position: [-75.2411, 39.9396] as [number, number], groundSpeedKt: 60 },
        ...(i === 0
          ? [{ hex: 'bbbbbb', position: [-75.3, 39.85] as [number, number], groundSpeedKt: 90 }]
          : []),
        ...(i >= 2
          ? [{ hex: 'cccccc', position: [-75.4, 39.95] as [number, number], groundSpeedKt: 120 }]
          : []),
        ...(i === 0
          ? [{ hex: 'dddddd', position: [-75.25, 39.87] as [number, number], groundSpeedKt: 100 }]
          : i === 7
            ? [{ hex: 'dddddd', position: [-75.5, 40.0] as [number, number], groundSpeedKt: 40 }]
            : []),
      ],
    })),
  },
}

describe('App replay clock (06a)', () => {
  const clock = () => screen.getByText('Sim clock').nextSibling as HTMLElement
  const rows = () =>
    within(screen.getByRole('list', { name: 'Ranked queue' })).getAllByRole('listitem')
  const idents = () => rows().map((row) => row.querySelector('.queue__ident')?.textContent)

  it('ticks the sim clock one second at a time from the scenario start, and shows the position', () => {
    useCapture.mockReturnValue(MOVING)
    const replay = manualClock()
    render(<App schedule={replay.schedule} />)
    expect(clock()).toHaveTextContent('02:30:00')
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled()
    replay.tick(67)
    expect(clock()).toHaveTextContent('02:31:07')
    expect(screen.getByText('01:07 / 01:45')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Seek' })).toHaveValue('67')
  })

  it('re-ranks the Queue live as the picture plays', () => {
    useCapture.mockReturnValue(MOVING)
    const replay = manualClock()
    render(<App schedule={replay.schedule} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'ADS-B' }))
    // AAL423 starts inside the ring and ranks above the parked track.
    const before = idents()
    expect(before.indexOf('AAL423')).toBeLessThan(before.indexOf('501267'))
    replay.tick(105)
    // Seven samples later it is 18 km out, past the proximity roll-off; the parked track leads.
    const after = idents()
    expect(after.indexOf('501267')).toBeLessThan(after.indexOf('AAL423'))
    expect(after).not.toEqual(before)
  })

  it('freezes the picture on Pause and moves it on Seek', () => {
    useCapture.mockReturnValue(MOVING)
    const replay = manualClock()
    render(<App schedule={replay.schedule} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    replay.tick(10)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    const frozen = document.querySelector('.queue')?.textContent
    replay.tick(10)
    expect(clock()).toHaveTextContent('02:30:10')
    expect(document.querySelector('.queue')?.textContent).toBe(frozen)
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '90' } })
    expect(clock()).toHaveTextContent('02:31:30')
    expect(document.querySelector('.queue')?.textContent).not.toBe(frozen)
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
  })

  it('opens a track’s log when it first appears on the clock, not back-stamped to app start', () => {
    useCapture.mockReturnValue(MOVING)
    const replay = manualClock()
    let wall = '2026-09-01T12:04:31.000Z'
    render(<App schedule={replay.schedule} now={() => wall} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'ADS-B' }))
    expect(idents()).not.toContain('cccccc')
    wall = '2026-09-01T12:05:01.000Z'
    replay.tick(30)
    const row = rows().find((r) => within(r).queryByText('cccccc'))
    expect(row).toBeDefined()
    fireEvent.click(within(row as HTMLElement).getByRole('button'))
    // The record reads in sim time (06b): opened at the tick it appeared, not at the start.
    const log = within(screen.getByLabelText('Event log'))
    expect(log.getByText('02:30:30')).toBeInTheDocument()
    expect(log.queryByText('02:30:00')).not.toBeInTheDocument()
  })

  it('drops a coasted track from the Queue and closes its drawer, keeping its log', () => {
    useCapture.mockReturnValue(MOVING)
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'ADS-B' }))
    const row = rows().find((r) => within(r).queryByText('bbbbbb')) as HTMLElement
    fireEvent.click(within(row).getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: 'Assess' }))
    expect(screen.getByLabelText('Track review: bbbbbb')).toBeInTheDocument()
    // Heard only at frame 0: held through the 90 s coast, gone after it.
    replay.tick(90)
    expect(idents()).toContain('bbbbbb')
    expect(screen.getByText('Seen').nextSibling).toHaveTextContent('90 s ago')
    replay.tick(1)
    expect(idents()).not.toContain('bbbbbb')
    expect(screen.queryByLabelText(/^Track review: /)).not.toBeInTheDocument()
    // The operator's focus was on the drawer; the picture took it away, and it must land on the
    // list, not on document.body (#73 review).
    expect(document.activeElement).toBe(screen.getByRole('list', { name: 'Ranked queue' }))
    // The record survives the picture: seek back and the claim is still on it.
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '0' } })
    fireEvent.click(
      within(rows().find((r) => within(r).queryByText('bbbbbb')) as HTMLElement).getByRole(
        'button',
      ),
    )
    expect(
      within(screen.getByText('Status').parentElement as HTMLElement).getByText('Assessing'),
    ).toBeInTheDocument()
  })

  it('logs Lost at the tick a claimed track coasts out, status carried (ruled on #71)', () => {
    useCapture.mockReturnValue(MOVING)
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'ADS-B' }))
    const open = (ident: string) =>
      fireEvent.click(
        within(rows().find((r) => within(r).queryByText(ident)) as HTMLElement).getByRole('button'),
      )
    open('bbbbbb')
    fireEvent.click(screen.getByRole('button', { name: 'Assess' }))
    // Two commits, as play makes them: held at the coast's edge, then gone. The held snapshot
    // the Lost line carries has no reader on screen — the handoff freezes at escalation — so
    // what it holds is pinned in lifecycle.test; here the line, its tick, and the status are.
    replay.tick(90)
    expect(idents()).toContain('bbbbbb')
    replay.tick(1)
    expect(idents()).not.toContain('bbbbbb')
    // Rewound to before the loss, the record still holds it: Lost at the tick it left, the
    // status carried, and no Regained — the clock is behind the frontier.
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '0' } })
    open('bbbbbb')
    const log = within(screen.getByLabelText('Event log'))
    const lines = log.getAllByRole('listitem').map((li) => li.textContent)
    expect(lines).toEqual([
      '02:30:00New — first seen',
      '02:30:00Assessing — claimed',
      '02:31:31Lost — last heard 02:30:00',
    ])
    expect(
      within(screen.getByText('Status').parentElement as HTMLElement).getByText('Assessing'),
    ).toBeInTheDocument()
  })

  it('logs Regained when a lost track is heard again; a rewind before first sight logs nothing (ruled on #71)', () => {
    useCapture.mockReturnValue(MOVING)
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'ADS-B' }))
    const open = (ident: string) =>
      fireEvent.click(
        within(rows().find((r) => within(r).queryByText(ident)) as HTMLElement).getByRole('button'),
      )
    const lines = () =>
      within(screen.getByLabelText('Event log'))
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    // `cccccc` opens at 30 s; seek to 0 and it is absent, but its record is ahead of the clock.
    replay.tick(30)
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '0' } })
    expect(idents()).not.toContain('cccccc')
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '30' } })
    open('cccccc')
    expect(lines()).toEqual(['02:30:30New — first seen'])
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }))
    // `dddddd` leaves at 91 s and is back at 105 s. A real aircraft sits under the ceiling, so
    // no band moves across the hole here; the chain behind Regained is pinned in lifecycle.test.
    // Ticks inside one act() batch to a single render, so the clock is stepped to the tick it
    // leaves on, then to the one it returns on.
    replay.tick(61)
    expect(idents()).not.toContain('dddddd')
    replay.tick(14)
    open('dddddd')
    expect(lines()).toEqual([
      '02:30:00New — first seen',
      '02:31:31Lost — last heard 02:30:00',
      '02:31:45Regained',
    ])
  })

  it('lands focus on the Review nav item when the picture takes the reviewed track away (#73 review)', () => {
    useCapture.mockReturnValue(MOVING)
    const replay = manualClock()
    render(<App schedule={replay.schedule} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'ADS-B' }))
    fireEvent.click(
      within(rows().find((r) => within(r).queryByText('bbbbbb')) as HTMLElement).getByRole(
        'button',
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    // A keyboard operator mid-walk: focus is on a drawer button when the track coasts out.
    screen.getByRole('button', { name: 'Assess' }).focus()
    replay.tick(91)
    expect(screen.queryByLabelText(/^Track review: /)).not.toBeInTheDocument()
    expect(screen.getByText('Select a track from the Queue.')).toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Review' }))
  })
})

/** The full recording's length with one parked aircraft, so the injects run their whole script. */
const LONG: CaptureState = {
  status: 'ready',
  recording: DEFAULT_RECORDING,
  capture: {
    ao: 'phl',
    source: 'adsb.lol v2',
    capturedAt: '2026-08-29T23:09:25.373Z',
    intervalMs: 15000,
    bbox: AO.bbox,
    frames: [...Array(80)].map((_, i) => ({
      tMs: i * 15000,
      records: [
        { hex: '501267', position: [-75.2411, 39.9396] as [number, number], groundSpeedKt: 60 },
      ],
    })),
  },
}

describe('App record under the clock (06b)', () => {
  const rows = () =>
    within(screen.getByRole('list', { name: 'Ranked queue' })).getAllByRole('listitem')
  const logLines = () =>
    within(screen.getByLabelText('Event log'))
      .getAllByRole('listitem')
      .map((line) => line.textContent ?? '')
  const handoff = () => (screen.getByLabelText('Handoff text') as HTMLTextAreaElement).value

  it('logs band crossings at sim time as the picture plays — in the log and the handoff timeline', () => {
    useCapture.mockReturnValue(LONG)
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'INJECT' }))
    // Twenty minutes in one seek: at most one crossing per band change the record last saw.
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '1185' } })
    let crossed: string[] | null = null
    for (const row of rows()) {
      fireEvent.click(within(row).getByRole('button'))
      const lines = logLines()
      if (lines.some((line) => / — (up|down) from /.test(line))) {
        crossed = lines
        break
      }
    }
    expect(crossed).not.toBeNull()
    const crossing = crossed!.find((line) => / — (up|down) from /.test(line))!
    // Sim time, then the band entered and the one left, in the one table's words (#66).
    expect(crossing).toMatch(
      /^02:[3-5]\d:\d\d(Caution|Warning|Calm) — (up|down) from (calm|caution|warning)$/,
    )
    expect(crossed![0]).toMatch(/^02:30:00New — first seen$/)
    // Never a lifecycle change: the track still reads New, and Assess is still the legal move.
    expect(
      within(screen.getByText('Status').parentElement as HTMLElement).getByText('New'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Assess' }))
    fireEvent.click(screen.getByRole('button', { name: 'Escalate' }))
    fireEvent.click(screen.getByRole('radio', { name: 'PHL Tower' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm escalation' }))
    // The handoff timeline carries the crossing, two spaces between the mark and the line.
    expect(handoff()).toContain(`  ${crossing.slice(0, 8)}  ${crossing.slice(8)}`)
    expect(handoff()).toContain('  02:49:45  Escalated — to PHL Tower')
  })

  it('writes nothing on a rewind — re-watching never runs the record backwards (#75 review)', () => {
    useCapture.mockReturnValue(LONG)
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'INJECT' }))
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '1185' } })
    const crossedRow = rows().find((row) => {
      fireEvent.click(within(row).getByRole('button'))
      return logLines().some((line) => / — (up|down) from /.test(line))
    })
    expect(crossedRow).toBeDefined()
    const before = logLines()
    // Play again from the start, and seek about in the past: the record holds.
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    replay.tick(30)
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '600' } })
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '0' } })
    expect(logLines()).toEqual(before)
    const marks = before.map((line) => line.slice(0, 8))
    expect(marks).toEqual([...marks].sort())
  })

  it('freezes the handoff evidence block at escalation while the timeline stays live', () => {
    useCapture.mockReturnValue(MOVING)
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'ADS-B' }))
    fireEvent.click(
      within(rows().find((r) => within(r).queryByText('AAL423')) as HTMLElement).getByRole(
        'button',
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Assess' }))
    fireEvent.click(screen.getByRole('button', { name: 'Escalate' }))
    fireEvent.click(screen.getByRole('radio', { name: 'PHL Tower' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm escalation' }))
    const frozen = handoff().split('\n')
    expect(frozen[4]).toMatch(/^Range \d+\.\d km to PHL Airfield at 02:30:00$/)
    const rangeRow = () => screen.getByText('Range').parentElement as HTMLElement
    expect(rangeRow()).toHaveTextContent(frozen[4].slice(6, frozen[4].indexOf(' to')))
    // A minute on, the aircraft has flown: the drawer's Range row moved, the record's did not.
    replay.tick(60)
    const later = handoff().split('\n')
    expect(later[4]).toBe(frozen[4])
    expect(later[5]).toBe(frozen[5])
    expect(later[6]).toBe(frozen[6])
    expect(rangeRow()).not.toHaveTextContent(frozen[4].slice(6, frozen[4].indexOf(' to')))
    // The timeline stays live: a later Resolve appends at its own sim time.
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Benign' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm resolution' }))
    expect(handoff()).toContain(
      '  02:30:00  Escalated — to PHL Tower\n  02:31:00  Resolved — Benign',
    )
  })

  it('draws the selected track’s trail and counts it in the drawer', () => {
    useCapture.mockReturnValue(MOVING)
    const replay = manualClock()
    render(<App schedule={replay.schedule} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    replay.tick(67)
    fireEvent.click(screen.getByTestId('map-select'))
    // An inject at 67 s: the frame-grid instants 0, 15, 30, 45, 60 and now.
    expect(screen.getByText('History: 6 known positions over the last 2 min')).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-trail', '6')
    // Home suppresses the ring, and the trail with it — presentation only (A2 on #3).
    fireEvent.click(screen.getByRole('button', { name: 'Home' }))
    expect(screen.getByTestId('map')).toHaveAttribute('data-trail', '6')
    expect(screen.getByTestId('map')).toHaveAttribute('data-selection-shown', 'false')
  })
})

describe('App pattern row under the clock (05a)', () => {
  it('fills the pattern row from the history at the clock, and the hero climbs back to the top', () => {
    useCapture.mockReturnValue(LONG)
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'INJECT' }))
    const rows = () =>
      within(screen.getByRole('list', { name: 'Ranked queue' })).getAllByRole('listitem')
    // At frame 0 nothing has a history: the row reads so, and the hero opens at rank 1 by a point.
    expect(within(rows()[0]).getByText('TRK-05')).toBeInTheDocument()
    fireEvent.click(within(rows()[0]).getByRole('button'))
    const breakdownRows = () =>
      within(screen.getByLabelText('Score breakdown')).getAllByRole('listitem')
    expect(within(breakdownRows()[3]).getByText('Pattern of life')).toBeInTheDocument()
    expect(within(breakdownRows()[3]).getByText('no history yet')).toBeInTheDocument()
    // 02:46:30, one seek: the hero has held position inside the ring for 4 min 15 s — the row
    // reads its evidence and fills to 11 of 15, the chip reads 95, and it is back at rank 1 above
    // the two grid sweeps that tied it at 84 (ruled on #5, note 3).
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '990' } })
    expect(within(rows()[0]).getByText('TRK-05')).toBeInTheDocument()
    expect(rows()[0].querySelector('.queue__score')).toHaveTextContent('95')
    expect(within(breakdownRows()[3]).getByText('11 / 15')).toBeInTheDocument()
    expect(within(breakdownRows()[3]).getByText('within 450 m for 4 min 15 s')).toBeInTheDocument()
    expect(screen.getByLabelText('Score breakdown').textContent).not.toMatch(/loiter/i)
    // Play one more tick: the same history, one second on — no jump.
    replay.tick()
    expect(rows()[0].querySelector('.queue__score')).toHaveTextContent('95')
  })
})

/**
 * #77, ruled: while the clock is behind the record's frontier the workflow refuses. Not clamped
 * to the frontier, not stamped at wall time — the action and the picture it acted on carry one
 * sim time, and only the frontier has both.
 */
describe('App rewound actions (#77)', () => {
  const rows = () =>
    within(screen.getByRole('list', { name: 'Ranked queue' })).getAllByRole('listitem')
  const logLines = () =>
    within(screen.getByLabelText('Event log'))
      .getAllByRole('listitem')
      .map((line) => line.textContent ?? '')
  const seek = (value: string) =>
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value } })
  const action = (name: string) => screen.getByRole('button', { name })

  /** Selects AAL423 and claims it at 02:31:00, which puts the record's frontier at 60 s. */
  const claimedAtSixty = () => {
    useCapture.mockReturnValue(MOVING)
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(action('Queue'))
    fireEvent.click(action('ADS-B'))
    fireEvent.click(
      within(rows().find((r) => within(r).queryByText('AAL423')) as HTMLElement).getByRole(
        'button',
      ),
    )
    seek('60')
    fireEvent.click(action('Assess'))
    expect(logLines().at(-1)).toMatch(/^02:31:00Assessing/)
    return replay
  }

  it('disables the workflow behind the frontier, says why, and logs nothing', () => {
    claimedAtSixty()
    // Escalated too, so the handoff exists and its Copy button can be checked below.
    fireEvent.click(action('Escalate'))
    fireEvent.click(screen.getByRole('radio', { name: 'PHL Tower' }))
    fireEvent.click(action('Confirm escalation'))
    const before = logLines()

    seek('30')
    // Every workflow button, legal or not: the record is ahead of the picture.
    for (const name of ['Assess', 'Escalate', 'Dismiss', 'Resolve']) {
      expect(action(name)).toBeDisabled()
    }
    // Grey buttons without a reason read as a bug. The live region carries the state; the two
    // times sit beside it, outside it (ruled on #79).
    expect(
      screen.getByText('Rewound — the workflow acts at the record’s frontier'),
    ).toBeInTheDocument()
    expect(screen.getByText('Clock 02:30:30 · record 02:31:00')).toBeInTheDocument()
    // `disabled` takes all four out of the tab order, so the reason has to reach an operator who
    // cannot see them grey out: the group points at both halves (#79 review).
    expect(screen.getByRole('group', { name: 'Lifecycle actions' })).toHaveAttribute(
      'aria-describedby',
      'drawer-rewound-state drawer-rewound-times',
    )

    // Pressing them anyway writes nothing — jsdom fires the handler on a disabled button only
    // if one is attached, so this is the real "nothing is logged" check, not a repeat of the
    // assertion above.
    for (const name of ['Assess', 'Escalate', 'Dismiss', 'Resolve']) {
      fireEvent.click(action(name))
    }
    expect(logLines()).toEqual(before)

    // Copy stamps nothing, so it stays enabled while the workflow is refused (ruled on #77).
    expect(action('Copy')).toBeEnabled()
  })

  it('re-enables at the frontier, and the action stamps at the frontier’s sim time', () => {
    claimedAtSixty()
    seek('30')
    expect(action('Escalate')).toBeDisabled()

    // Back to where the record is: the same action is legal again.
    seek('60')
    expect(screen.queryByText(/^Rewound — /)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Clock /)).not.toBeInTheDocument()
    // The live region stays mounted and goes empty rather than unmounting — a region inserted in
    // the same commit as its text is one some screen readers never announce (#51, #79 review).
    const region = document.querySelector('.drawer__rewound')
    expect(region).toBeInTheDocument()
    expect(region).toBeEmptyDOMElement()
    expect(screen.getByRole('group', { name: 'Lifecycle actions' })).not.toHaveAttribute(
      'aria-describedby',
    )
    expect(action('Escalate')).toBeEnabled()
    fireEvent.click(action('Escalate'))
    fireEvent.click(screen.getByRole('radio', { name: 'PHL Tower' }))
    fireEvent.click(action('Confirm escalation'))

    // Stamped at 02:31:00 — the frontier — because that is where the clock is, not because it
    // was clamped there from somewhere else.
    expect(logLines().at(-1)).toBe('02:31:00Escalated — to PHL Tower')
  })

  it('hands the map one terminalIds identity until the set itself changes (#61)', () => {
    useCapture.mockReturnValue(MOVING)
    const replay = manualClock()
    terminalIdsSeen.length = 0
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(action('Queue'))
    fireEvent.click(action('ADS-B'))

    // Ten ticks of the clock. `ranked` is a new array on every one of them (#76) and new tracks
    // open logs as they appear, so anything memoised on either would hand the map a new array
    // each tick — and the map re-pushes its whole source when this prop changes.
    replay.tick(10)
    const distinct = new Set(terminalIdsSeen)
    expect(distinct.size).toBe(1)
    expect([...distinct][0]).toEqual([])

    // Resolving one track is a change of the set, and must come through.
    const row = rows().find((r) => within(r).queryByText('AAL423')) as HTMLElement
    fireEvent.click(within(row).getByRole('button'))
    fireEvent.click(action('Dismiss'))
    const latest = terminalIdsSeen.at(-1) as readonly string[]
    expect(latest).toEqual(['adsb-a06461'])

    // And then holds still again while the clock runs on.
    replay.tick(5)
    expect(terminalIdsSeen.at(-1)).toBe(latest)
    expect(screen.getByTestId('map')).toHaveAttribute('data-terminal', 'adsb-a06461')
  })

  it('announces the state once, not the clock — scrubbing while rewound says nothing more', () => {
    claimedAtSixty()
    const region = () => document.querySelector('.drawer__rewound') as HTMLElement
    const times = () => document.querySelector('.drawer__rewound-times')?.textContent

    seek('30')
    const announced = region().textContent
    expect(announced).toBe('Rewound — the workflow acts at the record’s frontier')
    expect(times()).toBe('Clock 02:30:30 · record 02:31:00')

    // Two more seeks, still behind the frontier. The live region's text is what a screen reader
    // re-announces, so it must not move; the times are outside it and do move (ruled on #79).
    seek('15')
    expect(region().textContent).toBe(announced)
    expect(times()).toBe('Clock 02:30:15 · record 02:31:00')
    seek('5')
    expect(region().textContent).toBe(announced)
    expect(times()).toBe('Clock 02:30:05 · record 02:31:00')

    // The toggle still empties and refills it, which is the announcement that has to survive.
    seek('60')
    expect(region()).toBeEmptyDOMElement()
    seek('30')
    expect(region().textContent).toBe(announced)
  })

  it('leaves the record monotonic across a rewind and return', () => {
    claimedAtSixty()

    // Rewind, try to act, come back, act for real — the walk #77 describes.
    seek('15')
    fireEvent.click(action('Escalate'))
    seek('0')
    fireEvent.click(action('Dismiss'))
    seek('75')
    fireEvent.click(action('Escalate'))
    fireEvent.click(screen.getByRole('radio', { name: 'PHL Tower' }))
    fireEvent.click(action('Confirm escalation'))

    const marks = logLines().map((line) => line.slice(0, 8))
    expect(marks).toEqual([...marks].sort())
    expect(marks.at(-1)).toBe('02:31:15')
    // The two rewound presses left nothing behind: Dismiss from Assessing is a legal transition
    // and would have terminated the track had the frontier not refused it.
    expect(
      within(screen.getByText('Status').parentElement as HTMLElement).getByText('Escalated'),
    ).toBeInTheDocument()
  })
})

describe('App pattern entries, the tag, and the re-surface (05b, ruled on #5)', () => {
  const rows = () =>
    within(screen.getByRole('list', { name: 'Ranked queue' })).getAllByRole('listitem')
  const rowOf = (ident: string) =>
    rows().find((row) => within(row).queryByText(ident)) as HTMLElement
  const logLines = () =>
    within(screen.getByLabelText('Event log'))
      .getAllByRole('listitem')
      .map((line) => line.textContent ?? '')
  const seek = (value: string) =>
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value } })
  const start = () => {
    useCapture.mockReturnValue(LONG)
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'INJECT' }))
    return replay
  }

  it('logs the onset at sim time, one per seek, and the handoff timeline carries the word', () => {
    start()
    // Frame 0, 10 km out: identity, the envelope, and the hour lead; proximity at 50 trails.
    expect(rowOf('TRK-05').querySelector('.queue__reason')).toHaveTextContent(
      'Non-cooperative, low and slow, off-hours',
    )
    seek('990')
    fireEvent.click(within(rowOf('TRK-05')).getByRole('button'))
    expect(logLines()).toEqual([
      '02:30:00New — first seen',
      '02:46:30Warning — up from caution',
      '02:46:30Loitering — began',
    ])
    expect(rowOf('TRK-05').querySelector('.queue__reason')).toHaveTextContent(
      'Loitering, non-cooperative, inside the ring',
    )
    // Escalated at 02:46:30: the handoff hands off with the word, in its timeline.
    fireEvent.click(screen.getByRole('button', { name: 'Assess' }))
    fireEvent.click(screen.getByRole('button', { name: 'Escalate' }))
    fireEvent.click(screen.getByRole('radio', { name: 'PHL Tower' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm escalation' }))
    const handoff = (screen.getByLabelText('Handoff text') as HTMLTextAreaElement).value
    expect(handoff).toContain('  02:46:30  Loitering — began\n  02:46:30  Assessing — claimed')
    expect(handoff).toContain('Proximity 15/15 · Pattern of life 11/15')
    // A rewind writes nothing.
    seek('600')
    expect(logLines()).toHaveLength(5)
  })

  it('re-surfaces a dismissed track on a later crossing or onset, keeps it Dismissed, out of Active', () => {
    start()
    // TRK-06 dismissed at 02:36:00 in caution; it crosses to warning at 02:38:15.
    seek('360')
    fireEvent.click(within(rowOf('TRK-06')).getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(rowOf('TRK-06')).toHaveClass('queue__row--terminal')
    expect(screen.getByTestId('map').getAttribute('data-terminal')).toContain('inject-06')
    seek('495')
    expect(rowOf('TRK-06')).not.toHaveClass('queue__row--terminal')
    expect(within(rowOf('TRK-06')).getByText('Re-surfaced')).toBeInTheDocument()
    // The map's dim set agrees with the row (#61's invariant, #82 review).
    expect(screen.getByTestId('map').getAttribute('data-terminal')).not.toContain('inject-06')
    expect(screen.getByText('Status').nextElementSibling).toHaveTextContent('Dismissed')
    // TRK-03 dismissed at 02:40:00 in warning; it names Revisiting at 02:47:30 with no crossing.
    seek('600')
    fireEvent.click(within(rowOf('TRK-03')).getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    seek('1050')
    expect(logLines().at(-1)).toBe('02:47:30Revisiting — began')
    expect(rowOf('TRK-03')).not.toHaveClass('queue__row--terminal')
    expect(within(rowOf('TRK-03')).getByText('Re-surfaced')).toBeInTheDocument()
    // Terminal by the table: neither is Active.
    fireEvent.click(screen.getByRole('button', { name: 'Active' }))
    expect(rows().some((row) => within(row).queryByText('TRK-06'))).toBe(false)
    expect(rows().some((row) => within(row).queryByText('TRK-03'))).toBe(false)
  })
})

describe('App Sites surface (08a, ruled on #86)', () => {
  const action = (name: string) => screen.getByRole('button', { name })
  const rows = () =>
    within(screen.getByRole('list', { name: 'Ranked queue' })).getAllByRole('listitem')
  const siteRows = () =>
    within(screen.getByRole('list', { name: 'Site set' })).getAllByRole('listitem')
  const logLines = () =>
    within(screen.getByLabelText('Event log'))
      .getAllByRole('listitem')
      .map((line) => line.textContent ?? '')
  /** Each row's ident and chip, in queue order — the picture as the operator reads it. */
  const chips = () =>
    rows().map(
      (row) =>
        `${row.querySelector('.queue__ident')?.textContent}:${row.querySelector('.queue__score')?.textContent}`,
    )
  const seek = (value: string) =>
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value } })

  /** A silent inject at its first-seen position, from the plan App holds for the stub recording. */
  const silentInject = () =>
    injectTracksAt(planInjects(gridTimeline(1, 15000)), 0).find(
      (inject) => inject.identity === 'non-cooperative',
    )!

  it('opens on the config set, and a placed site re-scores the queue and logs the crossing at sim time', () => {
    render(<App schedule={never} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(action('Queue'))
    const before = chips()
    fireEvent.click(action('Sites'))
    expect(screen.getByRole('heading', { name: 'Sites' })).toBeInTheDocument()
    expect(screen.getByLabelText('Sites in the set')).toHaveTextContent('1')
    expect(siteRows()).toHaveLength(1)
    expect(siteRows()[0]).toHaveTextContent('PHL Airfield')
    expect(screen.getByText('1 site · config')).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-sites', 'phl-airfield')

    // Place a ring on a silent inject's first-seen position: it is inside the ring at once.
    const target = silentInject()
    placeTarget.center = target.position
    fireEvent.click(action('+ Protected site'))
    expect(screen.getByText('Click the map to place the centre')).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-placing', 'true')
    fireEvent.click(screen.getByTestId('map-place'))
    expect(screen.getByTestId('map')).toHaveAttribute('data-placing', 'false')
    expect(siteRows()).toHaveLength(2)
    expect(siteRows()[1]).toHaveTextContent('Site 2')
    expect(siteRows()[1]).toHaveTextContent('1.0 km ring · 02:30:00')
    // Selected for editing, and the map draws it heavier.
    expect(screen.getByRole('group', { name: 'Edit Site 2' })).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected-site', 'site-2')
    expect(screen.getByTestId('map')).toHaveAttribute('data-sites', 'phl-airfield,site-2')
    expect(screen.getByText('2 sites · edited from config')).toBeInTheDocument()

    // The queue re-scored against the session set: the inject sits inside the new ring and
    // reads warning; its record logs the crossing at sim time, after its first-seen line.
    fireEvent.click(action('Queue'))
    expect(chips()).not.toEqual(before)
    const row = rows().find((r) => within(r).queryByText(trackIdent(target))) as HTMLElement
    expect(row.querySelector('.queue__score')).toHaveAttribute('data-band', 'warning')
    fireEvent.click(within(row).getByRole('button'))
    expect(logLines()).toEqual([
      expect.stringMatching(/^02:30:00New — first seen/),
      '02:30:00Warning — up from caution',
    ])
    // Every ADS-B row is still capped and cooperative: a site never makes a real aircraft the threat.
    for (const r of rows()) {
      if (within(r).queryByText('ADS-B')) {
        expect(r.querySelector('.queue__score')).toHaveAttribute('data-band', 'calm')
        expect(r).toHaveTextContent('Cooperative aircraft')
      }
    }

    // Reset returns the config picture exactly.
    fireEvent.click(action('Sites'))
    fireEvent.click(action('Reset to config'))
    expect(screen.getByText('1 site · config')).toBeInTheDocument()
    fireEvent.click(action('Queue'))
    expect(chips()).toEqual(before)
  })

  it('disarms a move when its site is removed or the set is reset (#87 review)', () => {
    render(<App schedule={never} />)
    fireEvent.click(action('Sites'))
    placeTarget.center = silentInject().position
    fireEvent.click(action('+ Protected site'))
    fireEvent.click(screen.getByTestId('map-place'))
    fireEvent.click(action('Move on map'))
    expect(screen.getByTestId('map')).toHaveAttribute('data-placing', 'true')
    fireEvent.click(action('Remove'))
    expect(siteRows()).toHaveLength(1)
    expect(screen.getByTestId('map')).toHaveAttribute('data-placing', 'false')
    expect(screen.queryByText(/Click the map/)).not.toBeInTheDocument()
    // The same through Reset.
    fireEvent.click(action('+ Protected site'))
    fireEvent.click(screen.getByTestId('map-place'))
    fireEvent.click(action('Move on map'))
    fireEvent.click(action('Reset to config'))
    expect(screen.getByTestId('map')).toHaveAttribute('data-placing', 'false')
  })

  it('refuses a placement the rules refuse, saying why, and keeps the map armed', () => {
    render(<App schedule={never} />)
    fireEvent.click(action('Sites'))
    placeTarget.center = [0, 0]
    fireEvent.click(action('+ Protected site'))
    fireEvent.click(screen.getByTestId('map-place'))
    expect(screen.getByText('Centre is outside the AO')).toBeInTheDocument()
    expect(siteRows()).toHaveLength(1)
    expect(screen.getByTestId('map')).toHaveAttribute('data-placing', 'true')
    // A plan loaded while the refusal stands is an edit like the others: the refusal goes with
    // it (#95 review).
    fireEvent.change(screen.getByLabelText('Load site plan'), {
      target: {
        value: sitePlanText(addSite(fromConfig(AO.protectedSites), [-75.3, 39.85], 0, AO), AO),
      },
    })
    fireEvent.click(action('Load'))
    expect(siteRows()).toHaveLength(2)
    expect(screen.queryByText('Centre is outside the AO')).not.toBeInTheDocument()
    fireEvent.click(action('+ Protected site'))
    // Leaving the surface disarms the map: a click on Home must not place a site.
    fireEvent.click(action('Home'))
    expect(screen.getByTestId('map')).toHaveAttribute('data-placing', 'false')
  })

  it('refuses site edits behind the record’s frontier — its own last edit included — and re-enables at it', () => {
    useCapture.mockReturnValue(MOVING)
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(action('Sites'))
    seek('60')
    placeTarget.center = silentInject().position
    fireEvent.click(action('+ Protected site'))
    fireEvent.click(screen.getByTestId('map-place'))
    expect(siteRows()[1]).toHaveTextContent('1.0 km ring · 02:31:00')
    // Armed, then rewound: the map disarms with the editor, so no click no-ops unexplained.
    fireEvent.click(action('+ Protected site'))
    expect(screen.getByTestId('map')).toHaveAttribute('data-placing', 'true')

    seek('30')
    expect(screen.getByTestId('map')).toHaveAttribute('data-placing', 'false')
    expect(screen.queryByText(/Click the map/)).not.toBeInTheDocument()
    expect(
      screen.getByText('Rewound — the workflow acts at the record’s frontier'),
    ).toBeInTheDocument()
    expect(screen.getByText('Clock 02:30:30 · record 02:31:00')).toBeInTheDocument()
    expect(action('+ Protected site')).toBeDisabled()
    expect(action('Reset to config')).toBeDisabled()
    expect(screen.getByLabelText('Radius')).toBeDisabled()
    expect(screen.getByRole('group', { name: 'Add a site' })).toHaveAttribute(
      'aria-describedby',
      'sites-rewound-state sites-rewound-times',
    )

    seek('60')
    expect(screen.queryByText(/^Rewound — /)).not.toBeInTheDocument()
    expect(action('+ Protected site')).toBeEnabled()
    expect(action('Reset to config')).toBeEnabled()
  })
})

describe('App friendly launch areas and the site plan (08b, ruled on #86)', () => {
  const action = (name: string) => screen.getByRole('button', { name })
  const rows = () =>
    within(screen.getByRole('list', { name: 'Ranked queue' })).getAllByRole('listitem')
  const siteRows = () =>
    within(screen.getByRole('list', { name: 'Site set' })).getAllByRole('listitem')
  const chips = () =>
    rows().map(
      (row) =>
        `${row.querySelector('.queue__ident')?.textContent}:${row.querySelector('.queue__score')?.textContent}`,
    )
  const injectsAtOpen = () => injectTracksAt(planInjects(gridTimeline(1, 15000)), 0)
  const rowFor = (ident: string) => rows().find((r) => within(r).queryByText(ident)) as HTMLElement
  const seek = (value: string) =>
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value } })

  it('caps a heard inject first seen inside a friendly area, and leaves a silent one alone — the demo moment', () => {
    render(<App schedule={never} now={() => '2026-09-01T12:04:31.000Z'} />)
    const heard = injectsAtOpen().find((inject) => inject.identity === 'cooperative')!
    const silent = injectsAtOpen().find((inject) => inject.identity === 'non-cooperative')!
    fireEvent.click(action('Queue'))
    const before = chips()
    expect(rowFor(trackIdent(heard))).not.toHaveTextContent('Friendly launch')

    // A friendly area over the heard inject's first-seen position: its row drops with the line.
    fireEvent.click(action('Sites'))
    placeTarget.center = heard.position
    fireEvent.click(action('+ Friendly launch area'))
    fireEvent.click(screen.getByTestId('map-place'))
    expect(siteRows()[1]).toHaveTextContent('Launch area 2')
    expect(siteRows()[1]).toHaveTextContent('Friendly launch area')
    fireEvent.click(action('Queue'))
    const row = rowFor(trackIdent(heard))
    expect(Number(row.querySelector('.queue__score')?.textContent)).toBeLessThanOrEqual(30)
    expect(row.querySelector('.queue__score')).toHaveAttribute('data-band', 'calm')
    expect(row.querySelector('.queue__reason')).toHaveTextContent(/^Friendly launch/)
    fireEvent.click(within(row).getByRole('button'))
    expect(screen.getByLabelText('Score breakdown')).toHaveTextContent(
      /Friendly launch — capped at \d+ \(uncapped \d+\)/,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }))

    // A friendly area over the silent inject's first-seen position: no cap, nothing moves.
    const withHeardCapped = chips()
    fireEvent.click(action('Sites'))
    placeTarget.center = silent.position
    fireEvent.click(action('+ Friendly launch area'))
    fireEvent.click(screen.getByTestId('map-place'))
    fireEvent.click(action('Queue'))
    expect(chips()).toEqual(withHeardCapped)
    expect(rowFor(trackIdent(silent))).not.toHaveTextContent('Friendly launch')

    // Every ADS-B row is untouched by either area.
    for (const r of rows()) {
      if (within(r).queryByText('ADS-B')) expect(r).toHaveTextContent('Cooperative aircraft')
    }
    // Reset returns the config picture.
    fireEvent.click(action('Sites'))
    fireEvent.click(action('Reset to config'))
    fireEvent.click(action('Queue'))
    expect(chips()).toEqual(before)
  })

  it('loads a pasted plan as one edit, and refuses one behind the frontier with the rewound reason', () => {
    useCapture.mockReturnValue(MOVING)
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    const heard = injectsAtOpen().find((inject) => inject.identity === 'cooperative')!
    const plan = sitePlanText(
      addSite(
        addSite(fromConfig(AO.protectedSites), heard.position, 0, AO, 'friendly'),
        [-75.3, 39.85],
        0,
        AO,
      ),
      AO,
    )
    fireEvent.click(action('Sites'))
    fireEvent.change(screen.getByLabelText('Load site plan'), { target: { value: plan } })
    fireEvent.click(action('Load'))
    expect(siteRows()).toHaveLength(3)
    expect(siteRows().map((r) => r.textContent)).toEqual([
      expect.stringContaining('PHL Airfield'),
      expect.stringContaining('Site 3'),
      expect.stringContaining('Launch area 2'),
    ])
    expect(screen.getByText('3 sites · edited from config')).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-sites', 'phl-airfield,site-3')
    // The load was an edit: the frontier is where it landed, and a rewind refuses the next one.
    seek('60')
    fireEvent.change(screen.getByLabelText('Load site plan'), { target: { value: plan } })
    fireEvent.click(action('Load'))
    seek('30')
    expect(screen.getByLabelText('Load site plan')).toBeDisabled()
    expect(action('Load')).toBeDisabled()
    expect(
      screen.getByText('Rewound — the workflow acts at the record’s frontier'),
    ).toBeInTheDocument()
  })
})
