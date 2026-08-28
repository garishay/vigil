import { useState } from 'react'
import './App.css'
import { MapView } from './components/MapView'
import { AO } from './config/ao'

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
    body: 'The ranked track list arrives with the scenario data (PR 02) and gains its scores in PR 04.',
  },
  {
    id: 'review',
    label: 'Review',
    title: 'Track review',
    body: 'Selecting a track opens its factor breakdown, history, and workflow actions here (PR 03).',
  },
]

/** Placeholder until the replay clock and track layers exist. */
const STATUS_FIELDS = [
  { label: 'Cooperative', value: '—' },
  { label: 'Injects', value: '—' },
  { label: 'Seed', value: '—' },
  { label: 'Sim clock', value: '—' },
]

export default function App() {
  const [surfaceId, setSurfaceId] = useState<SurfaceId>('home')
  const surface = SURFACES.find((s) => s.id === surfaceId) ?? SURFACES[0]

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
        {STATUS_FIELDS.map((field) => (
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
        </section>
        <MapView ao={AO} />
      </main>
    </div>
  )
}
