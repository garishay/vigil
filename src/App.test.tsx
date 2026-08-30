import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { AO } from './config/ao'
import type { CaptureState } from './data/useCapture'

// The map itself is covered by MapView.test.tsx; here it is stubbed so these tests stay about
// layout, navigation, and what the picture status strip reports.
vi.mock('./components/MapView', () => ({
  MapView: ({ tracks }: { tracks?: unknown[] }) => (
    <div data-testid="map" data-tracks={tracks?.length ?? 0} />
  ),
}))

const { useCapture } = vi.hoisted(() => ({ useCapture: vi.fn() }))
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
