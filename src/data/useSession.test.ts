import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSession } from './useSession'
import { PHL } from '../config/ao'
import { SCENARIO_02A } from '../config/scenarios/02a'
import { SCENARIO_02B } from '../config/scenarios/02b'
import { SCENARIO_03D } from '../config/scenarios/03d'
import { scenarioFeed } from '../lib/feeds'
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

  it('opens the demo with no query and no env: the demo’s recording, 002, with the scenario on (S11, #213)', async () => {
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useSession('', {}))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('/adsb-phl-002.json')
    expect(result.current).toMatchObject({
      session: { feeds: [{ kind: 'recording', id: 'vigil-phl-002' }], scenario: { on: true } },
      feeds: [{ ref: { kind: 'recording', id: 'vigil-phl-002' }, capture: CAPTURE }],
    })
  })

  it('plans the scenario on the recording’s own frame grid, the seed the session’s (ruling 5)', async () => {
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useSession('', {}))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    if (result.current.status !== 'ready') throw new Error('not ready')
    expect(result.current.feeds[0].timeline).toEqual(timelineOf(CAPTURE))
    // The demo's scenario is 03d (S11, #213), so the plan is its cast on the grid, its seed the session's.
    expect(result.current.scenario?.plan).toEqual(planScenario(timelineOf(CAPTURE), SCENARIO_03D))
    expect(result.current.scenario?.seed).toBe(SCENARIO_03D.seed)
  })

  it('builds the feed from the scenario the session names — ?scenario=02a is the study file, its seed the session’s (S3b, #135)', async () => {
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() =>
      useSession('?feed=recording:vigil-phl-002&scenario=02a', {}),
    )
    await waitFor(() => expect(result.current.status).toBe('ready'))
    if (result.current.status !== 'ready') throw new Error('not ready')
    expect(result.current.session.scenario).toEqual({
      on: true,
      name: '02a',
      seed: 'study-02a',
      runS: 360,
    })
    expect(result.current.scenario?.seed).toBe('study-02a')
    expect(result.current.scenario?.plan).toEqual(planScenario(timelineOf(CAPTURE), SCENARIO_02A))
    expect(result.current.scenario?.plan.specs).toHaveLength(30)
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

describe('raw mode’s feed (S4a, #136, ruled A2)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('runs the same picture through the rule at the study’s distance in raw, and at the scorer’s in vigil', async () => {
    const long: AdsbCapture = {
      ...CAPTURE,
      frames: Array.from({ length: 80 }, (_, i) => ({ tMs: i * 15000, records: [] })),
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => long })),
    )
    const { result } = renderHook(() =>
      useSession('?feed=recording:vigil-phl-002&scenario=02b&mode=raw', {}),
    )
    await waitFor(() => expect(result.current.status).toBe('ready'))
    if (result.current.status !== 'ready') throw new Error('not ready')
    expect(result.current.session.mode).toBe('raw')
    // 02b's threat lies by 1.1 km from 510 s — inside raw's 1 500 m, so raw keeps its label…
    const raw = result.current.scenario!.pictureAt(600).find((track) => track.id === 'inject-11')
    expect(raw).toMatchObject({ callsign: 'UAS-8F21', identity: 'cooperative' })
    // …and past the scorer's 1 000 m, so Vigil withholds it — the study's discriminator.
    const vigil = scenarioFeed(timelineOf(long), SCENARIO_02B)
      .pictureAt(600)
      .find((track) => track.id === 'inject-11')
    expect(vigil).toMatchObject({ callsign: null, identity: 'non-cooperative' })
  })
})

describe('the mode before the recording is in (#148 round 1)', () => {
  it('carries the resolved session on the loading state synchronously, so the first render knows it is raw', () => {
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() =>
      useSession('?feed=recording:vigil-phl-002&scenario=02a&mode=raw', {}),
    )
    // Before any await: the recording is still loading, the mode is already known.
    expect(result.current).toMatchObject({ status: 'loading', session: { mode: 'raw' } })
    vi.unstubAllGlobals()
  })

  it('carries the study run the link names on the same first state (S4b, #137)', () => {
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() =>
      useSession('?feed=recording:vigil-phl-002&scenario=02a&mode=vigil&subject=S03&run=2', {}),
    )
    expect(result.current).toMatchObject({
      status: 'loading',
      session: { mode: 'vigil', study: { subject: 'S03', run: 2 } },
    })
    vi.unstubAllGlobals()
  })

  it('refuses synchronously too — a bad link never reaches a loading shell', () => {
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useSession('?mode=fast', {}))
    expect(result.current).toEqual({
      status: 'refused',
      reason: '?mode= reads raw or vigil, not "fast"',
    })
    expect(fetcher).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
