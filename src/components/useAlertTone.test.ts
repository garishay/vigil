import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAlertTone } from './useAlertTone'

/** A stand-in element: jsdom's own `play` is not implemented and says so on the console. */
function fakeAudio(play = vi.fn(() => Promise.resolve())) {
  const audio = { currentTime: 5, play } as unknown as HTMLAudioElement
  return { audio, play }
}

describe('useAlertTone (#101, 101b)', () => {
  it('creates one element on the first raise, restarts it, and plays once per call', () => {
    const { audio, play } = fakeAudio()
    const create = vi.fn(() => audio)
    const { result } = renderHook(() => useAlertTone(false, create))
    expect(create).not.toHaveBeenCalled()
    act(() => result.current())
    act(() => result.current())
    expect(create).toHaveBeenCalledTimes(1)
    expect(play).toHaveBeenCalledTimes(2)
    expect(audio.currentTime).toBe(0)
  })

  it('plays nothing while muted, and resumes when unmuted — with one callback identity throughout', () => {
    const { audio, play } = fakeAudio()
    const { result, rerender } = renderHook(({ muted }) => useAlertTone(muted, () => audio), {
      initialProps: { muted: true },
    })
    const callback = result.current
    act(() => result.current())
    expect(play).not.toHaveBeenCalled()
    rerender({ muted: false })
    expect(result.current).toBe(callback)
    act(() => result.current())
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('swallows a refused play — the gesture gate before the first click — with no throw', async () => {
    const { audio } = fakeAudio(
      vi.fn(() => Promise.reject(new DOMException('gesture', 'NotAllowedError'))),
    )
    const { result } = renderHook(() => useAlertTone(false, () => audio))
    expect(() => result.current()).not.toThrow()
    await act(async () => {})
  })

  it('points the default element at the tone under the deploy base', () => {
    const created: string[] = []
    const audioSpy = vi.spyOn(globalThis, 'Audio').mockImplementation(function (src?: string) {
      created.push(src ?? '')
      return fakeAudio().audio
    } as unknown as typeof Audio)
    const { result } = renderHook(() => useAlertTone(false))
    act(() => result.current())
    expect(created).toEqual([`${import.meta.env.BASE_URL}alert-tone.wav`])
    audioSpy.mockRestore()
  })
})
