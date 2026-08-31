import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { AO } from './config/ao'
import { SCENARIO } from './config/scenario'
import type { CaptureState } from './data/useCapture'

// The map itself is covered by MapView.test.tsx; here it is stubbed so these tests stay about
// layout, navigation, and what the picture status strip reports.
vi.mock('./components/MapView', () => ({
  MapView: ({ tracks, injects }: { tracks?: unknown[]; injects?: unknown[] }) => (
    <div data-testid="map" data-tracks={tracks?.length ?? 0} data-injects={injects?.length ?? 0} />
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
