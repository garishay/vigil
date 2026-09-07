import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSession } from './useSession'
import { PHL } from '../config/ao'
import { SCENARIO } from '../config/scenario'
import type { AdsbCapture } from '../lib/adsb'
import { planScenario, timelineOf } from '../lib/injects'

const CAPTURE: AdsbCapture = {
  ao: 'phl',
  source: 'adsb.lol v2',
  capturedAt: '2026-09-04T22:02:11.000Z',
  intervalMs: 15000,
  bbox: PHL.bbox,
  frames: [
    { tMs: 0, records: [] },
    { tMs: 15000, records: [] },
  ],
}

const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => CAPTURE }))

describe('useSession (#115)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    fetcher.mockClear()
  })

  it('opens the demo with no query and no env: the default recording, the scenario on', async () => {
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useSession('', {}))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('/adsb-phl.json')
    expect(result.current).toMatchObject({
      session: { feeds: [{ kind: 'recording', id: 'vigil-phl-001' }], scenario: { on: true } },
      feeds: [{ ref: { kind: 'recording', id: 'vigil-phl-001' }, capture: CAPTURE }],
    })
  })

  it('plans the scenario on the recording’s own frame grid, the seed the session’s (ruling 5)', async () => {
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useSession('', {}))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    if (result.current.status !== 'ready') throw new Error('not ready')
    expect(result.current.feeds[0].timeline).toEqual(timelineOf(CAPTURE))
    expect(result.current.scenario?.plan).toEqual(planScenario(timelineOf(CAPTURE)))
    expect(result.current.scenario?.seed).toBe(SCENARIO.seed)
  })

  it('loads the recording ?recording= names, and carries its entry on the feed', async () => {
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useSession('?recording=vigil-phl-002', {}))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(fetcher).toHaveBeenCalledWith('/adsb-phl-002.json')
    expect(result.current).toMatchObject({
      feeds: [{ entry: { id: 'vigil-phl-002', clock: 'captured' }, capture: CAPTURE }],
    })
  })

  it('builds no scenario with ?scenario=off, and says so on the session', async () => {
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() =>
      useSession('?feed=recording:vigil-phl-002&scenario=off', {}),
    )
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current).toMatchObject({ session: { scenario: { on: false } }, scenario: null })
  })

  it('reads the build’s env as the default under an empty query', async () => {
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() =>
      useSession('', {
        VITE_DEFAULT_FEEDS: 'recording:vigil-phl-002',
        VITE_DEFAULT_SCENARIO: 'off',
      }),
    )
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(fetcher).toHaveBeenCalledWith('/adsb-phl-002.json')
    expect(result.current).toMatchObject({ scenario: null })
  })

  it('reports a refused session in the resolver’s words, and fetches nothing', async () => {
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useSession('?feed=sonar:1', {}))
    await waitFor(() => expect(result.current.status).toBe('refused'))
    expect(result.current).toEqual({
      status: 'refused',
      reason: 'Feed "sonar:1" — unknown feed kind "sonar"',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('reports an unknown recording as a refusal too — the same words as before the seam', async () => {
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useSession('?recording=vigil-phl-003', {}))
    await waitFor(() => expect(result.current.status).toBe('refused'))
    expect(result.current).toEqual({
      status: 'refused',
      reason: 'No recording named "vigil-phl-003"',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps a recording that would not load as an error, apart from a refusal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    )
    const { result } = renderHook(() => useSession('', {}))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current).toEqual({
      status: 'error',
      message: 'could not load the ADS-B recording: HTTP 404',
    })
  })
})
