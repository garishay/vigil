import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Playback } from './Playback'
import type { Playback as PlaybackState } from '../data/usePlayback'

const state = (overrides: Partial<PlaybackState> = {}): PlaybackState => ({
  tSec: 187,
  playing: true,
  lastMove: 'tick',
  durationS: 1185,
  play: vi.fn(),
  pause: vi.fn(),
  seek: vi.fn(),
  ...overrides,
})

describe('Playback', () => {
  it('shows the position over the recording’s length and pauses from the toggle', () => {
    const playback = state()
    render(<Playback playback={playback} />)
    expect(screen.getByText('03:07 / 19:45')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(playback.pause).toHaveBeenCalledTimes(1)
    expect(playback.play).not.toHaveBeenCalled()
  })

  it('reads Play while paused, and plays from the toggle', () => {
    const playback = state({ playing: false })
    render(<Playback playback={playback} />)
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(playback.play).toHaveBeenCalledTimes(1)
  })

  it('seeks through a native range input that reflects the clock', () => {
    const playback = state()
    render(<Playback playback={playback} />)
    const seek = screen.getByRole('slider', { name: 'Seek' }) as HTMLInputElement
    expect(seek).toHaveValue('187')
    expect(seek).toHaveAttribute('max', '1185')
    expect(seek).toHaveAttribute('aria-valuetext', '03:07')
    fireEvent.change(seek, { target: { value: '600' } })
    expect(playback.seek).toHaveBeenCalledWith(600)
  })

  it('is disabled until the recording is in', () => {
    // The hook reports a clock with nothing to run on as not playing (#73 review).
    render(<Playback playback={state({ durationS: null, tSec: 0, playing: false })} />)
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
    expect(screen.getByRole('slider', { name: 'Seek' })).toBeDisabled()
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

describe('Playback in raw mode (S4a, #136, ruled A3)', () => {
  it('shows the elapsed time only — no seek, no Pause, no length — and a dash before the recording is in', () => {
    const { unmount } = render(<Playback playback={state()} raw />)
    expect(screen.getByText('03:07')).toBeInTheDocument()
    expect(screen.queryByText('03:07 / 19:45')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('slider')).toBeNull()
    unmount()
    render(<Playback playback={state({ durationS: null })} raw />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

describe('Playback in a study run (S4b, #137, ruled A3)', () => {
  it('shows the run’s elapsed time from Begin as +mm:ss — no seek, no Pause — in either mode, and a dash before the recording is in', () => {
    const { unmount } = render(<Playback playback={state({ tSec: 710 })} runFromS={480} />)
    expect(screen.getByText('+03:50')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('slider')).toBeNull()
    unmount()
    render(<Playback playback={state({ tSec: 480 })} raw runFromS={480} />)
    expect(screen.getByText('+00:00')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    cleanup()
    render(<Playback playback={state({ tSec: 480, durationS: null })} runFromS={480} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
