import { useMemo, useState } from 'react'
import './App.css'
import { MapView } from './components/MapView'
import { Queue } from './components/Queue'
import { ReviewDrawer } from './components/ReviewDrawer'
import { AO } from './config/ao'
import { CONTACTS, type ContactId } from './config/contacts'
import { DISPOSITIONS, type DispositionId } from './config/dispositions'
import { SCENARIO } from './config/scenario'
import { frameTracks } from './data/capture'
import { useCapture } from './data/useCapture'
import { injectTracksAt, planScenario } from './lib/injects'
import {
  STATUSES,
  STATUS_LABEL,
  appendEvent,
  firstSeen,
  observedSnapshot,
  statusOf,
  type LifecycleAction,
  type Status,
  type TrackEvent,
} from './lib/lifecycle'
import { rankTracks, type RankedTrack } from './lib/ranking'
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
    body: 'Everything known about the selected track. Every lifecycle action lands in its event log.',
  },
]

const FILTERS: { id: LayerFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'adsb', label: 'ADS-B' },
  { id: 'inject', label: 'INJECT' },
]

type StateFilter = Status | 'all'
const STATE_FILTERS: { id: StateFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  ...STATUSES.map((status) => ({ id: status, label: STATUS_LABEL[status] })),
]

/**
 * `now` is the clock seam: lifecycle events take `at` and `tSec` as inputs, App supplies them,
 * and tests fix them. PR 06 swaps this wall-clock supplier for playback time with no rewiring.
 */
export default function App({ now = () => new Date().toISOString() }: { now?: () => string } = {}) {
  const [surfaceId, setSurfaceId] = useState<SurfaceId>('home')
  const surface = SURFACES.find((s) => s.id === surfaceId) ?? SURFACES[0]
  const capture = useCapture()

  // Selection and filters persist across surface switches — client state only (§7.1 ruling, #3).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [layerFilter, setLayerFilter] = useState<LayerFilter>('all')
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')

  // The §7.1 record: one event log per track, client-side only, never persisted or transmitted.
  // Only acted-on tracks are stored; an untouched track's log is derived on demand by `logFor`,
  // so every track reads New with a first-seen entry from the moment the picture loads.
  const [eventLogs, setEventLogs] = useState<Record<string, TrackEvent[]>>({})

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

  // Filtered for display; ranks stay global, so a filtered list shows what it hid. The two chip
  // rows compose: a row must pass both. An unstored log is an untouched track — statusOf reads
  // it as New. The selection is independent of the filters — a selected track keeps its drawer
  // even when filtered out.
  const visible = useMemo(
    () =>
      ranked.filter(
        (entry) =>
          (layerFilter === 'all' || entry.track.source === layerFilter) &&
          (stateFilter === 'all' || statusOf(eventLogs[entry.track.id]) === stateFilter),
      ),
    [ranked, layerFilter, stateFilter, eventLogs],
  )
  const selected = selectedId
    ? (ranked.find((entry) => entry.track.id === selectedId) ?? null)
    : null

  // Every track's log opens with a synthetic first-seen entry, stamped once at startup. Lazy
  // useState, not useMemo: the default `now` prop is a fresh function each render, so a memo
  // keyed on it would re-stamp first sight with every render (review finding on #47).
  const [openedAt] = useState(now)
  const logFor = (entry: RankedTrack): TrackEvent[] =>
    eventLogs[entry.track.id] ?? firstSeen(entry.track.id, observedSnapshot(entry), openedAt)

  // tSec stays 0 until PR 06 runs the replay clock; `now` is the seam it takes over through.
  const act = (
    action: LifecycleAction,
    detail?: { recipient?: ContactId; disposition?: DispositionId },
  ) => {
    if (!selected) return
    const at = now()
    setEventLogs((logs) => ({
      ...logs,
      // Read the log from the updater's own argument, never the render closure: two actions
      // batched into one commit must chain, not overwrite each other (#47 review).
      [selected.track.id]: appendEvent(
        logs[selected.track.id] ??
          firstSeen(selected.track.id, observedSnapshot(selected), openedAt),
        action,
        { at, tSec: 0, observed: observedSnapshot(selected), ...detail },
      ),
    }))
  }

  const pending = capture.status === 'loading' ? '…' : '—'
  const count = (n: number) => (capture.status === 'ready' ? String(n) : pending)

  const statusFields = [
    { label: 'Cooperative', value: count(adsb.length) },
    { label: 'Injects', value: count(injects.length) },
    { label: 'Seed', value: SCENARIO.seed },
    { label: 'Sim clock', value: '—' },
  ]

  const drawer = selected && (
    <ReviewDrawer
      // Keyed by track, so picker and copied state never leak from one track to the next.
      key={selected.track.id}
      entry={selected}
      sites={AO.protectedSites}
      log={logFor(selected)}
      contacts={CONTACTS}
      dispositions={DISPOSITIONS}
      onAction={act}
      onClose={() => setSelectedId(null)}
    />
  )
  // The drawer is its own column beside the Queue (§4.2 — the operator keeps the list while
  // reviewing); the Review surface shows the same drawer alone, at the same 26 rem (ruled B1, #3).
  const drawerColumn = surfaceId === 'queue' && drawer
  const bodyClasses = ['shell__body']
  if (drawerColumn) bodyClasses.push('shell__body--drawer')
  if (surfaceId === 'review') bodyClasses.push('shell__body--review')

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

      <main className={bodyClasses.join(' ')}>
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
              <div className="chips" role="group" aria-label="Filter by state">
                {STATE_FILTERS.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    className="chip"
                    aria-pressed={stateFilter === filter.id}
                    onClick={() => setStateFilter(filter.id)}
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
          // Ruled A2 on #3: the selection persists across surface switches, but Home's map is
          // unannotated context — it never shows the ring, so no surface carries selection
          // state it cannot explain. The suppression is presentation-only (`selectionShown`),
          // so a Home round trip cannot reset the ease stamp and re-fly the camera (#47).
          selectedId={selectedId}
          selectionShown={surfaceId !== 'home'}
          onSelect={(id) => {
            setSelectedId(id)
            // The other direction of the same ruling: a selection is an intent to review, so one
            // *made* on Home lands the operator on the Queue, where the drawer and its close
            // button are.
            setSurfaceId((current) => (current === 'home' ? 'queue' : current))
          }}
        />
      </main>
    </div>
  )
}
