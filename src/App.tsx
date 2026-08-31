import { useMemo, useState } from 'react'
import './App.css'
import { MapView } from './components/MapView'
import { Queue } from './components/Queue'
import { ReviewDrawer } from './components/ReviewDrawer'
import { AO } from './config/ao'
import { SCENARIO } from './config/scenario'
import { frameTracks } from './data/capture'
import { useCapture } from './data/useCapture'
import { injectTracksAt, planScenario } from './lib/injects'
import { rankTracks } from './lib/ranking'
import type { Track } from './lib/tracks'

type SurfaceId = 'home' | 'queue' | 'review'
type LayerFilter = 'all' | 'adsb' | 'inject'

const SURFACES: { id: SurfaceId; label: string; title: string; body: string }[] = [
  {
    id: 'home',
    label: 'Home',
    title: 'Picture summary',
    body: 'Both layers are counted in the strip above and ranked in the Queue. The scenario clock and time-of-day arrive with playback (PR 06).',
  },
  {
    id: 'queue',
    label: 'Queue',
    title: 'Ranked queue',
    body: 'Placeholder ranking: identity, then range to the protected site. Scores arrive in PR 04.',
  },
  {
    id: 'review',
    label: 'Review',
    title: 'Track review',
    body: 'Everything known about the selected track. Lifecycle, event log, and handoff arrive in 03b.',
  },
]

const FILTERS: { id: LayerFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'adsb', label: 'ADS-B' },
  { id: 'inject', label: 'INJECT' },
]

export default function App() {
  const [surfaceId, setSurfaceId] = useState<SurfaceId>('home')
  const surface = SURFACES.find((s) => s.id === surfaceId) ?? SURFACES[0]
  const capture = useCapture()

  // Selection and filter persist across surface switches — client state only (§7.1 comes in 03b).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [layerFilter, setLayerFilter] = useState<LayerFilter>('all')

  // The replay clock lands in PR 06; until then the picture holds the recording's first frame.
  const adsb = useMemo(
    () => (capture.status === 'ready' ? frameTracks(capture.capture.frames[0]) : []),
    [capture],
  )

  /**
   * The app holds the inject *plan* — every random decision, made once — and samples it at the
   * instant it needs. The plan is drawn on the recording's own frame grid rather than one of its
   * own, so PR 06 drives a single clock through `injectTracksAt` and the ADS-B interpolator with
   * no rewiring. The generator is pure and synchronous; it never reads the capture itself.
   */
  const plan = useMemo(() => {
    if (capture.status !== 'ready') return null
    const { frames, intervalMs } = capture.capture
    return planScenario({ frameCount: frames.length, intervalMs })
  }, [capture])
  const injects = useMemo(() => (plan ? injectTracksAt(plan, 0) : []), [plan])

  // One list for the Queue and, later, the scorer: neither knows which layer a track came from.
  const tracks = useMemo<Track[]>(() => [...adsb, ...injects], [adsb, injects])
  const ranked = useMemo(() => rankTracks(tracks, AO.protectedSites), [tracks])

  // Filtered for display; ranks stay global, so a filtered list shows what it hid. The selection
  // is independent of the filter — a selected track keeps its drawer even when filtered out.
  const visible = useMemo(
    () =>
      layerFilter === 'all' ? ranked : ranked.filter((entry) => entry.track.source === layerFilter),
    [ranked, layerFilter],
  )
  const selected = selectedId
    ? (ranked.find((entry) => entry.track.id === selectedId) ?? null)
    : null

  const pending = capture.status === 'loading' ? '…' : '—'
  const count = (n: number) => (capture.status === 'ready' ? String(n) : pending)

  const statusFields = [
    { label: 'Cooperative', value: count(adsb.length) },
    { label: 'Injects', value: count(injects.length) },
    { label: 'Seed', value: SCENARIO.seed },
    { label: 'Sim clock', value: '—' },
  ]

  const drawer = selected && (
    <ReviewDrawer entry={selected} sites={AO.protectedSites} onClose={() => setSelectedId(null)} />
  )
  // The drawer is its own column beside the Queue (§4.2 — the operator keeps the list while
  // reviewing); the Review surface shows the same drawer alone in the rail.
  const drawerColumn = surfaceId === 'queue' && drawer

  return (
    <div className="shell">
      <header className="shell__header">
        <h1 className="shell__wordmark">Vigil</h1>
        <nav className="nav" aria-label="Surfaces">
          {SURFACES.map((s) => (
            <button
              key={s.id}
              type="button"
              className="nav__item"
              aria-current={s.id === surfaceId ? 'page' : undefined}
              onClick={() => setSurfaceId(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <p className="shell__notice">Demonstration only — not for operational use</p>
      </header>

      <dl className="strip" aria-label="Picture status">
        {statusFields.map((field) => (
          <div className="strip__field" key={field.label}>
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
        <div className="strip__field strip__field--ao">
          <dt>AO</dt>
          <dd>{AO.name}</dd>
        </div>
      </dl>

      <main className={drawerColumn ? 'shell__body shell__body--drawer' : 'shell__body'}>
        <section className="rail" aria-labelledby="rail-title">
          <div className="rail__head">
            <h2 className="rail__title" id="rail-title">
              {surface.title}
            </h2>
            {surfaceId === 'queue' && (
              <span className="rail__count" aria-label="Tracks in queue">
                {count(visible.length)}
              </span>
            )}
          </div>
          <p className="rail__body">{surface.body}</p>
          {/* A picture that cannot load its traffic says so, rather than showing an empty map. */}
          {capture.status === 'error' && (
            <p className="rail__error" role="alert">
              {capture.message}
            </p>
          )}
          {surfaceId === 'queue' && (
            <>
              <div className="chips" role="group" aria-label="Filter by layer">
                {FILTERS.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    className="chip"
                    aria-pressed={layerFilter === filter.id}
                    onClick={() => setLayerFilter(filter.id)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
              <Queue ranked={visible} selectedId={selectedId} onSelect={setSelectedId} />
            </>
          )}
          {surfaceId === 'review' &&
            (drawer ?? <p className="rail__empty">Select a track from the Queue.</p>)}
        </section>
        {drawerColumn}
        <MapView
          ao={AO}
          tracks={adsb}
          injects={injects}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id)
            // A selection is an intent to review; Home has no drawer and no way to clear one,
            // so a map selection made there lands the operator on the Queue.
            setSurfaceId((current) => (current === 'home' ? 'queue' : current))
          }}
        />
      </main>
    </div>
  )
}
