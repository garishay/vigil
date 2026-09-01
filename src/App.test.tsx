import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { AO } from './config/ao'
import { SCENARIO } from './config/scenario'
import type { CaptureState } from './data/useCapture'

// The map itself is covered by MapView.test.tsx; here it is stubbed so these tests stay about
// layout, navigation, and what the picture status strip reports.
vi.mock('./components/MapView', () => ({
  MapView: ({
    tracks,
    injects,
    selectedId,
    selectionShown = true,
    onSelect,
  }: {
    tracks?: { id: string }[]
    injects?: { id: string }[]
    selectedId?: string | null
    selectionShown?: boolean
    onSelect?: (id: string) => void
  }) => (
    <div
      data-testid="map"
      data-tracks={tracks?.length ?? 0}
      data-injects={injects?.length ?? 0}
      data-selected={selectedId ?? ''}
      data-selection-shown={String(selectionShown)}
    >
      {/* Stands in for a dot click: selects the first inject, like the real map would. */}
      <button
        type="button"
        data-testid="map-select"
        onClick={() => injects?.[0] && onSelect?.(injects[0].id)}
      />
    </div>
  ),
}))

const { useCapture, planScenario } = vi.hoisted(() => ({
  useCapture: vi.fn(),
  planScenario: vi.fn(),
}))

// The generator runs for real; the spy is only here to check what timeline App hands it.
vi.mock('./lib/injects', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/injects')>()
  planScenario.mockImplementation(actual.planScenario)
  return { ...actual, planScenario }
})
vi.mock('./data/useCapture', () => ({ useCapture }))

const READY: CaptureState = {
  status: 'ready',
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

beforeEach(() => {
  useCapture.mockReturnValue(READY)
})

describe('App shell', () => {
  it('renders the product name, the AO, and the status strip', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'Vigil' })).toBeInTheDocument()
    expect(screen.getByLabelText('Picture status')).toBeInTheDocument()
    expect(screen.getByText(AO.name)).toBeInTheDocument()
    expect(screen.getByTestId('map')).toBeInTheDocument()
  })

  it('states that it is not an operational system', () => {
    render(<App />)
    expect(screen.getByText(/not for operational use/i)).toBeInTheDocument()
  })

  it('opens on Home', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: 'Picture summary' })).toBeInTheDocument()
  })

  it('reports the cooperative track count once the recording loads', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('Cooperative').nextSibling).toHaveTextContent('2'))
    expect(screen.getByTestId('map')).toHaveAttribute('data-tracks', '2')
  })

  it('puts injects on the map alongside the cooperative layer', async () => {
    render(<App />)
    const map = screen.getByTestId('map')
    await waitFor(() => expect(Number(map.getAttribute('data-injects'))).toBeGreaterThan(0))
    expect(screen.getByText('Injects').nextSibling).toHaveTextContent(
      map.getAttribute('data-injects') as string,
    )
  })

  it('names the seed, so the picture on screen can be reproduced', () => {
    render(<App />)
    expect(screen.getByText('Seed').nextSibling).toHaveTextContent(SCENARIO.seed)
  })

  it("plans the injects on the recording's own frame grid", () => {
    // The two layers share one timeline, which is what lets PR 06 advance a single clock. App
    // holds the plan and samples it, so that clock will drive `injectTracksAt` with no rewiring.
    render(<App />)
    expect(planScenario).toHaveBeenCalledWith({
      frameCount: READY.status === 'ready' ? READY.capture.frames.length : 0,
      intervalMs: 15000,
    })
  })

  it('ranks both layers into one queue on the Queue surface', () => {
    render(<App />)
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
    render(<App />)
    expect(screen.queryByRole('list', { name: 'Ranked queue' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    expect(screen.getByRole('list', { name: 'Ranked queue' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Home' }))
    expect(screen.queryByRole('list', { name: 'Ranked queue' })).not.toBeInTheDocument()
  })

  it('holds the count back while the recording is still loading', () => {
    useCapture.mockReturnValue({ status: 'loading' })
    render(<App />)
    expect(screen.getByText('Cooperative').nextSibling).toHaveTextContent('…')
    expect(screen.getByTestId('map')).toHaveAttribute('data-tracks', '0')
  })

  // An airspace picture that cannot load its traffic has to say so, not show a plausible empty map.
  it('surfaces a load failure instead of rendering an empty picture silently', () => {
    useCapture.mockReturnValue({ status: 'error', message: 'could not load the ADS-B recording' })
    render(<App />)
    expect(screen.getByRole('alert')).toHaveTextContent('could not load the ADS-B recording')
    expect(screen.getByText('Cooperative').nextSibling).toHaveTextContent('—')
  })

  it('opens the drawer beside the list from a row click, and closes it (03a)', () => {
    render(<App />)
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
    render(<App />)
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
    render(<App />)
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
    render(<App />)
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

  it('keeps the Queue-surface close returning focus to the row, as 03a built it (#46)', () => {
    render(<App />)
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
    render(<App />)
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
    render(<App />)
    // Home has no drawer and no close button; a selection made there must not strand the user.
    fireEvent.click(screen.getByTestId('map-select'))
    expect(screen.getByRole('button', { name: 'Queue' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByLabelText(/^Track review: /)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }))
    expect(screen.queryByLabelText(/^Track review: /)).not.toBeInTheDocument()
  })

  it('filters by layer without renumbering the ranks (03a)', () => {
    render(<App />)
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
    render(<App now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    fireEvent.click(within(within(queue).getAllByRole('listitem')[0]).getByRole('button'))
    const drawer = () => screen.getByLabelText(/^Track review: /)
    const status = () => within(drawer()).getByText('Status').parentElement as HTMLElement

    // Every track opened its log as New, with the injected clock in the first-seen entry.
    expect(within(status()).getByText('New')).toBeInTheDocument()
    expect(within(drawer()).getByText('New — first seen')).toBeInTheDocument()
    expect(within(drawer()).getByText('12:04:31Z')).toBeInTheDocument()

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
    expect(lines.map((line) => line.textContent?.slice(9))).toEqual([
      'New — first seen',
      'Assessing — claimed',
      'Escalated — to PHL Tower',
      'Resolved — Benign',
    ])
  })

  it('stamps first sight once, not per render (03b review fix)', () => {
    // The default `now` prop is a fresh function identity each render, so first-seen must not
    // ride a memo keyed on it: even a *replaced* clock may not restamp the opening entry.
    const { rerender } = render(<App now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    rerender(<App now={() => '2026-09-01T13:00:00.000Z'} />)
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    fireEvent.click(within(within(queue).getAllByRole('listitem')[0]).getByRole('button'))
    const drawer = screen.getByLabelText(/^Track review: /)
    expect(within(drawer).getByText('12:04:31Z')).toBeInTheDocument()
    expect(within(drawer).queryByText('13:00:00Z')).not.toBeInTheDocument()
  })

  it('filters by state with global ranks kept, composing with the layer filter (03b)', () => {
    render(<App />)
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

  it('says when no track matches the filters, but not while the picture is loading (#49)', () => {
    const { rerender } = render(<App />)
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
    rerender(<App />)
    expect(region()).toBeEmptyDOMElement()
    useCapture.mockReturnValue({ status: 'error', message: 'Could not load the recording.' })
    rerender(<App />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(region()).toBeEmptyDOMElement()
  })

  it('keeps the selection but not the ring on Home (03b, ruled A2 on #3)', () => {
    render(<App />)
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
    render(<App now={() => '2026-09-01T12:04:31.000Z'} />)
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
    expect(lines.map((line) => line.textContent?.slice(9))).toEqual([
      'New — first seen',
      'Assessing — claimed',
      'Dismissed',
    ])
  })

  it('renders the Review surface at the drawer column width (03b, ruled B1 on #3)', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(document.querySelector('.shell__body--review')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Home' }))
    expect(document.querySelector('.shell__body--review')).toBeNull()
  })

  it('switches surfaces without unmounting the map', () => {
    render(<App />)
    const map = screen.getByTestId('map')

    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    expect(screen.getByRole('heading', { name: 'Ranked queue' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Queue' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current')

    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByRole('heading', { name: 'Track review' })).toBeInTheDocument()

    expect(screen.getByTestId('map')).toBe(map)
  })
})
