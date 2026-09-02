import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { intervalSchedule, usePlayback, type Schedule } from './usePlayback'

/** A scheduler the test drives by hand: `tick()` is the clock, nothing here waits on time. */
function manual() {
  let pending: (() => void) | null = null
  const schedule: Schedule = (tick) => {
    pending = tick
    return () => {
      pending = null
    }
  }
  return { schedule, tick: () => act(() => pending?.()), scheduled: () => pending !== null }
}

describe('usePlayback', () => {
  it('plays from load, one second per tick, and stops at the end of the recording', () => {
    const clock = manual()
    const { result } = renderHook(() => usePlayback(3, clock.schedule))
    expect(result.current).toMatchObject({ tSec: 0, playing: true, durationS: 3 })
    clock.tick()
    clock.tick()
    expect(result.current.tSec).toBe(2)
    clock.tick()
    expect(result.current.tSec).toBe(3)
    expect(result.current.playing).toBe(false)
    expect(clock.scheduled()).toBe(false)
  })

  it('pauses — the clock holds and no tick is scheduled — and resumes on play', () => {
    const clock = manual()
    const { result } = renderHook(() => usePlayback(100, clock.schedule))
    clock.tick()
    act(() => result.current.pause())
    expect(result.current.playing).toBe(false)
    expect(clock.scheduled()).toBe(false)
    clock.tick()
    expect(result.current.tSec).toBe(1)
    act(() => result.current.play())
    clock.tick()
    expect(result.current.tSec).toBe(2)
  })

  it('seeks within the recording, whole seconds, keeping the play state it finds', () => {
    const clock = manual()
    const { result } = renderHook(() => usePlayback(100, clock.schedule))
    act(() => result.current.seek(42.7))
    expect(result.current.tSec).toBe(42)
    expect(result.current.playing).toBe(true)
    clock.tick()
    expect(result.current.tSec).toBe(43)
    act(() => result.current.seek(500))
    expect(result.current.tSec).toBe(100)
    expect(result.current.playing).toBe(false)
    act(() => result.current.seek(-5))
    expect(result.current.tSec).toBe(0)
  })

  it('starts over when Play is pressed at the end', () => {
    const clock = manual()
    const { result } = renderHook(() => usePlayback(1, clock.schedule))
    clock.tick()
    expect(result.current.playing).toBe(false)
    act(() => result.current.play())
    expect(result.current).toMatchObject({ tSec: 0, playing: true })
  })

  it('waits for the recording — nothing is scheduled while the duration is unknown', () => {
    const clock = manual()
    const { result, rerender } = renderHook(({ d }) => usePlayback(d, clock.schedule), {
      initialProps: { d: null as number | null },
    })
    expect(result.current.durationS).toBeNull()
    expect(clock.scheduled()).toBe(false)
    rerender({ d: 10 })
    expect(clock.scheduled()).toBe(true)
  })

  it('cancels the scheduled tick on unmount', () => {
    const clock = manual()
    const { unmount } = renderHook(() => usePlayback(10, clock.schedule))
    expect(clock.scheduled()).toBe(true)
    unmount()
    expect(clock.scheduled()).toBe(false)
  })
})

describe('intervalSchedule', () => {
  afterEach(() => vi.useRealTimers())

  it('wires the default clock to setInterval at the configured period', () => {
    vi.useFakeTimers()
    const tick = vi.fn()
    const cancel = intervalSchedule(tick, 1000)
    vi.advanceTimersByTime(2500)
    expect(tick).toHaveBeenCalledTimes(2)
    cancel()
    vi.advanceTimersByTime(5000)
    expect(tick).toHaveBeenCalledTimes(2)
  })
})
