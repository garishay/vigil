import { useMemo, useState } from 'react'
import './App.css'
import { MapView } from './components/MapView'
import { AO } from './config/ao'
import { SCENARIO } from './config/scenario'
import { frameTracks } from './data/capture'
import { useCapture } from './data/useCapture'
import { generateScenario } from './lib/injects'

type SurfaceId = 'home' | 'queue' | 'review'

const SURFACES: { id: SurfaceId; label: string; title: string; body: string }[] = [
  {
    id: 'home',
    label: 'Home',
    title: 'Picture summary',
    body: 'Layer counts and the scenario clock fill in once the picture has tracks to report (PR 02).',
  },
  {
    id: 'queue',
    label: 'Queue',
    title: 'Ranked queue',
    body: 'The ranked track list arrives in PR 02c and gains its scores in PR 04.',
  },
  {
    id: 'review',
    label: 'Review',
    title: 'Track review',
    body: 'Selecting a track opens its factor breakdown, history, and workflow actions here (PR 03).',
  },
]

export default function App() {
  const [surfaceId, setSurfaceId] = useState<SurfaceId>('home')
  const surface = SURFACES.find((s) => s.id === surfaceId) ?? SURFACES[0]
  const capture = useCapture()

  // The replay clock lands in PR 06; until then the picture holds the recording's first frame.
  const tracks = useMemo(
    () => (capture.status === 'ready' ? frameTracks(capture.capture.frames[0]) : []),
    [capture],
  )

  /**
   * The injects share the recording's frame grid rather than inventing one, so PR 06 advances a
   * single clock across both layers. The generator is pure and synchronous — it takes the
   * timeline as an argument and never reads the capture itself.
   */
  const injects = useMemo(() => {
    if (capture.status !== 'ready') return []
    const { frames, intervalMs } = capture.capture
    return generateScenario({ frameCount: frames.length, intervalMs }).frames[0].tracks
  }, [capture])

  const pending = capture.status === 'loading' ? '…' : '—'
  const count = (n: number) => (capture.status === 'ready' ? String(n) : pending)

  const statusFields = [
    { label: 'Cooperative', value: count(tracks.length) },
    { label: 'Injects', value: count(injects.length) },
    { label: 'Seed', value: SCENARIO.seed },
    { label: 'Sim clock', value: '—' },
  ]

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

      <main className="shell__body">
        <section className="rail" aria-labelledby="rail-title">
          <h2 className="rail__title" id="rail-title">
            {surface.title}
          </h2>
          <p className="rail__body">{surface.body}</p>
          {/* A picture that cannot load its traffic says so, rather than showing an empty map. */}
          {capture.status === 'error' && (
            <p className="rail__error" role="alert">
              {capture.message}
            </p>
          )}
        </section>
        <MapView ao={AO} tracks={tracks} injects={injects} />
      </main>
    </div>
  )
}
