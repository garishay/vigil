import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCapture } from './useCapture'
import { PHL } from '../config/ao'
import type { AdsbCapture } from '../lib/adsb'

const CAPTURE: AdsbCapture = {
  ao: 'phl',
  source: 'adsb.lol v2',
  capturedAt: '2026-09-04T22:02:11.000Z',
  intervalMs: 15000,
  bbox: PHL.bbox,
  frames: [{ tMs: 0, records: [] }],
}

const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => CAPTURE }))

describe('useCapture (#84)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    fetcher.mockClear()
  })

  it('loads the default recording without a query parameter', async () => {
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useCapture(''))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(fetcher).toHaveBeenCalledWith('/adsb-phl.json')
    expect(result.current).toMatchObject({ recording: { id: 'vigil-phl-001' }, capture: CAPTURE })
  })

  it('loads the recording ?recording= names, and carries its entry beside the capture', async () => {
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useCapture('?recording=vigil-phl-002'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(fetcher).toHaveBeenCalledWith('/adsb-phl-002.json')
    expect(result.current).toMatchObject({
      recording: { id: 'vigil-phl-002', clock: 'captured' },
      capture: CAPTURE,
    })
  })

  it('reports an unknown name as a load error in its own words, and fetches nothing', async () => {
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useCapture('?recording=vigil-phl-003'))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current).toEqual({
      status: 'error',
      message: 'No recording named "vigil-phl-003"',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
