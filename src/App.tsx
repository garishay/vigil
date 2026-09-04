import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { MapView } from './components/MapView'
import { Playback } from './components/Playback'
import { Queue } from './components/Queue'
import { ReviewDrawer } from './components/ReviewDrawer'
import { SitesPanel, type Placing } from './components/SitesPanel'
import { AO } from './config/ao'
import { CONTACTS, type ContactId } from './config/contacts'
import { DISPOSITIONS, type DispositionId } from './config/dispositions'
import { REPLAY } from './config/replay'
import { SCENARIO } from './config/scenario'
import { SCORING } from './config/scoring'
import { lookupPhoto as defaultLookupPhoto, type PhotoLookup } from './data/photos'
import { useCapture } from './data/useCapture'
import { intervalSchedule, usePlayback, type Schedule } from './data/usePlayback'
import { simClock } from './lib/display'
import { injectTracksAt, planScenario, timelineOf } from './lib/injects'
import {
  STATUSES,
  STATUS_LABEL,
  appendEvent,
  bandCrossing,
  canLose,
  canRegain,
  firstSeen,
  isTerminal,
  lastBand,
  lastPattern,
  lost,
  observedSnapshot,
  patternChange,
  regained,
  resurfaced,
  statusOf,
  type LifecycleAction,
  type Status,
  type TrackEvent,
} from './lib/lifecycle'
import { rankTracks, type RankedTrack } from './lib/ranking'
import {
  historiesAt,
  indexCapture,
  lastHeardBefore,
  memoryAt,
  pictureAt,
  trailAt,
} from './lib/replay'
import { minuteOfDay } from './lib/scoring'
import {
  addSite,
  fromConfig,
  removeSite,
  resetSites,
  updateSite,
  type SitePatch,
  type SiteSet,
} from './lib/sites'
import type { Track } from './lib/tracks'

type SurfaceId = 'home' | 'queue' | 'review' | 'sites'
type LayerFilter = 'all' | 'adsb' | 'inject'

const SURFACES: { id: SurfaceId; label: string; title: string; body: string }[] = [
  {
    id: 'home',
    label: 'Home',
    title: 'Picture summary',
    body: 'Both layers are counted in the strip above and ranked in the Queue by score. The sim clock starts at the scenario’s configured hour and ticks with playback.',
  },
  {
    id: 'queue',
    label: 'Queue',
    title: 'Ranked queue',
    body: 'Ranked by score; every score opens to its factors in Review.',
  },
  {
    id: 'review',
    label: 'Review',
    title: 'Track review',
    body: 'Everything known about the selected track. Every lifecycle action lands in its event log.',
  },
  {
    id: 'sites',
    label: 'Sites',
    title: 'Sites',
    body: 'Protected sites the picture is scored against — this session only; reload returns to config.',
  },
]

const FILTERS: { id: LayerFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'adsb', label: 'ADS-B' },
  { id: 'inject', label: 'INJECT' },
]

type StateFilter = Status | 'all' | 'active'
const STATE_FILTERS: { id: StateFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  ...STATUSES.map((status) => ({ id: status, label: STATUS_LABEL[status] })),
]

/** Active is the non-terminal set — New, Assessing, Escalated — read off the table (03e). */
const matchesState = (status: Status, filter: StateFilter): boolean =>
  filter === 'all' || (filter === 'active' ? !isTerminal(status) : status === filter)

/**
 * `now` is the wall-clock seam: lifecycle events take `at` as an input, App supplies it, and
 * tests fix it. `schedule` is the replay clock's seam (06a): the tick is scheduled through it,
 * so a test drives the clock by hand and never waits on real time. `lookupPhoto` is the network
 * seam (03d): the one runtime third-party call, injected the way the capture's fetcher is, so no
 * test reaches the network.
 */
export default function App({
  now = () => new Date().toISOString(),
  schedule = intervalSchedule,
  lookupPhoto = defaultLookupPhoto,
}: { now?: () => string; schedule?: Schedule; lookupPhoto?: PhotoLookup } = {}) {
  const [surfaceId, setSurfaceId] = useState<SurfaceId>('home')
  const surface = SURFACES.find((s) => s.id === surfaceId) ?? SURFACES[0]
  const capture = useCapture()

  // Selection and filters persist across surface switches — client state only (§7.1 ruling, #3).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [layerFilter, setLayerFilter] = useState<LayerFilter>('all')
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')

  // The §7.1 record: one event log per track, client-side only, never persisted or transmitted.
  // A log opens the first time this session renders its track (ruled on #6, note 3) — see the
  // sighting fold below — and is kept if the track leaves the picture and returns.
  const [eventLogs, setEventLogs] = useState<Record<string, TrackEvent[]>>({})

  // The session's site set (08a, ruled on #86): the operator's protected sites, seeded from
  // config and scored against on every tick. Session state only — a reload returns to config;
  // the golden and every pinned test run on the config set.
  const [siteSet, setSiteSet] = useState<SiteSet>(() => fromConfig(AO.protectedSites))
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  // What the next map click does while the Sites editor has the map armed, and the reason the
  // last placement was refused, if it was.
  const [placing, setPlacing] = useState<Placing>(null)
  const [siteNotice, setSiteNotice] = useState<string | null>(null)

  // The recording, re-keyed by aircraft for the interpolator; the clock runs to its last frame.
  const index = useMemo(
    () => (capture.status === 'ready' ? indexCapture(capture.capture) : null),
    [capture],
  )
  const playback = usePlayback(index?.durationS ?? null, schedule)
  const tSec = playback.tSec

  // The real picture at the clock: bracketed samples read linearly, held then dropped (06a).
  const adsb = useMemo(() => (index ? pictureAt(index, tSec) : []), [index, tSec])

  /**
   * The app holds the inject *plan* — every random decision, made once — and samples it at the
   * instant the clock names. The plan is drawn on the recording's own frame grid rather than one
   * of its own, so one clock drives `injectTracksAt` and the ADS-B interpolator together. The
   * generator is pure and synchronous; it never reads the capture itself.
   */
  const plan = useMemo(
    () => (capture.status === 'ready' ? planScenario(timelineOf(capture.capture)) : null),
    [capture],
  )
  const injects = useMemo(() => (plan ? injectTracksAt(plan, tSec) : []), [plan, tSec])

  // One list for the Queue and the scorer: neither knows which layer a track came from.
  const tracks = useMemo<Track[]>(() => [...adsb, ...injects], [adsb, injects])
  // The identity memory — when each inject's ident was last heard — is a pure fold over the
  // frame grid up to the clock, so play and seek agree on it (06a). The hour is the scenario's
  // configured clock start plus the clock (ruled D2 on #4), and the strip shows the same number
  // the breakdown scores against.
  const memory = useMemo(
    () => (plan ? memoryAt((t) => injectTracksAt(plan, t), plan.intervalS, tSec) : {}),
    [plan, tSec],
  )
  const clockMinute = minuteOfDay(SCENARIO.clock.startLocal, tSec)
  // Each track's position history over the pattern window (05a), sampled at the clock as the
  // trail is — pure in t, so a seek reads the same history play would, and scores the same.
  const history = useMemo(
    () => (index ? historiesAt(index, plan, tracks, tSec, SCORING.pattern.windowS) : {}),
    [index, plan, tracks, tSec],
  )
  const sites = siteSet.sites
  const ranked = useMemo(
    () => rankTracks(tracks, sites, { tSec, minuteOfDay: clockMinute, memory, history }),
    [tracks, sites, tSec, clockMinute, memory, history],
  )
  // The picture as last committed, by track, with the tick it was drawn at — what a Lost line
  // snapshots (#71), since the track it records is no longer in `ranked` to be read. Written
  // after commit, read on the render that finds the track gone.
  const lastDrawn = useRef(new Map<string, { entry: RankedTrack; tSec: number }>())
  useEffect(() => {
    lastDrawn.current = new Map(ranked.map((entry) => [entry.track.id, { entry, tSec }]))
  }, [ranked, tSec])

  // Filtered for display; ranks stay global, so a filtered list shows what it hid. The two chip
  // rows compose: a row must pass both. An unstored log is an untouched track — statusOf reads
  // it as New. The selection is independent of the filters — a selected track keeps its drawer
  // even when filtered out.
  const visible = useMemo(
    () =>
      ranked.filter(
        (entry) =>
          (layerFilter === 'all' || entry.track.source === layerFilter) &&
          matchesState(statusOf(eventLogs[entry.track.id]), stateFilter),
      ),
    [ranked, layerFilter, stateFilter, eventLogs],
  )
  // The terminal set for the map's dim (#61). Two steps on purpose: the map pushes this into
  // MapLibre from an effect, so a new array identity is a re-push of the whole source.
  //
  // What that is worth, precisely (#81 review): while the clock runs, `adsb` and `injects` are
  // memoised on `tSec`, so both source effects already re-push once a second whatever this
  // array does — a fresh identity here buys nothing back on the per-tick path. What it buys is
  // every *other* render: paused, or a selection, a filter chip, a band crossing on some
  // unrelated track. Those are renders where the picture has not moved and the source should
  // not be rebuilt, and they are the common case once the operator stops the clock to work.
  //
  // Hence the shape: folding to a sorted string first means the array below keeps its identity
  // until the *set* changes, not merely until some other track's log gains an entry. Ids carry
  // no spaces, so the join is unambiguous. A re-surfaced track leaves the set, so the map and
  // the Queue agree about what is handled (#82 review); that needs each track's source, which
  // is read off the picture — the key is recomputed per tick, but its string, and so the array's
  // identity, still changes only with the set.
  const sourceOf = useMemo(() => new Map(tracks.map((track) => [track.id, track.source])), [tracks])
  const terminalKey = useMemo(
    () =>
      Object.keys(eventLogs)
        .filter(
          (id) =>
            isTerminal(statusOf(eventLogs[id])) &&
            !resurfaced(eventLogs[id], sourceOf.get(id) ?? 'adsb'),
        )
        .sort()
        .join(' '),
    [eventLogs, sourceOf],
  )
  const terminalIds = useMemo(
    () => (terminalKey === '' ? [] : terminalKey.split(' ')),
    [terminalKey],
  )

  const selected = selectedId
    ? (ranked.find((entry) => entry.track.id === selectedId) ?? null)
    : null

  // The picture can take the selection away: a selected track coasts out and the drawer unmounts
  // with nobody pressing Close (#73 review). Clear the selection, so the Queue's own return-to-
  // list effect runs where the Queue is mounted, and remember it for the Review surface, where
  // focus would otherwise fall to document.body — the failure #46 and #54 were built against.
  // Guarded set-during-render, as the sighting fold below; only once the recording is in, since
  // a loading picture has taken nothing away.
  const orphaned = selectedId !== null && selected === null && capture.status === 'ready'
  const [orphanCount, setOrphanCount] = useState(0)
  if (orphaned) {
    setOrphanCount((count) => count + 1)
    setSelectedId(null)
  }

  // The record's fold over the picture, once per render that changes it. Every track without a
  // log gets one opened now — its `at` from the wall clock, its `tSec` from the replay clock,
  // its `observed` from this render — rather than back-stamped to app start (ruled on #6, note
  // 3); every track whose band differs from the band its record last saw gets a crossing
  // appended at sim time, in either direction, terminal or not (06b, ruled on #6). Guarded
  // set-during-render is the documented derived-state pattern, and the guard is what keeps it
  // to one pass: the updater re-checks its own argument, so two renders in one commit cannot
  // double-open or double-log. A memo keyed on `now` would re-stamp every render, since the
  // default prop is a fresh function each time (#47 round 1). Seek-honest: a track first shown
  // after a seek opens at the seek target, and a seek logs at most one crossing — forward only:
  // a rewound picture is the past the record already holds, so a band read earlier than the
  // last entry is not a crossing (#75 review), and the predicate settles without a write. A
  // pattern change is folded the same way, beside the crossing (05b): against the pattern the
  // record last saw, forward-only, terminal or not; a track opened with a pattern already named
  // carries it on its first-seen entry and logs no onset.
  //
  // The fold's inverse is the Lost line (ruled on #71): a track with a non-terminal record that
  // is absent from the picture — the whole picture, not the filtered Queue — logs Lost at sim
  // time, once the recording is in, since a loading picture has taken nothing away. Its
  // snapshot is the picture as the operator last saw the track, kept from the previous commit
  // the way the orphan guard remembers a selection; under play that is the last sample, held to
  // the coast's edge. A lost track back in the picture logs Regained first, and this pass's
  // crossing and pattern change are read against the record before it, so what moved across
  // the hole is written down.
  const inPicture = useMemo(() => new Set(ranked.map((entry) => entry.track.id)), [ranked])
  const settled = capture.status === 'ready'
  const recordStale =
    ranked.some((entry) => {
      const log = eventLogs[entry.track.id]
      if (log === undefined) return true
      return (
        tSec >= log[log.length - 1].tSec &&
        (canRegain(log, tSec) ||
          lastBand(log) !== entry.score.band ||
          lastPattern(log) !== entry.score.pattern)
      )
    }) ||
    (settled &&
      Object.entries(eventLogs).some(([id, log]) => !inPicture.has(id) && canLose(log, tSec)))
  if (recordStale) {
    const at = now()
    setEventLogs((logs) => {
      const next = { ...logs }
      let changed = false
      for (const entry of ranked) {
        const id = entry.track.id
        const log = next[id]
        if (log === undefined) {
          next[id] = firstSeen(id, observedSnapshot(entry), at, tSec)
          changed = true
          continue
        }
        // All three read against the log as it stands: a crossing's snapshot already carries
        // the pattern named now, so an onset detected after it would find nothing to log, and a
        // Regained line carries the return picture, so a crossing read after it would find the
        // band already there. Regained lands first, the crossing after it, the pattern entry
        // last, numbered on.
        const back = regained(log, entry, at, tSec)
        const crossed = bandCrossing(log, entry, at, tSec)
        const patterned = patternChange(log, entry, at, tSec)
        if (back || crossed || patterned) {
          let out = back ?? log
          for (const step of [crossed, patterned])
            if (step) out = [...out, { ...step[step.length - 1], seq: out.length + 1 }]
          next[id] = out
          changed = true
        }
      }
      if (settled)
        for (const [id, log] of Object.entries(next)) {
          if (inPicture.has(id)) continue
          // Last heard as the recording has it — the last sample before the clock, less the
          // age it carried — so the line is true under a seek across the loss too (#36 [11]);
          // failing a recording sample, the drawn picture's own claim.
          const drawn = lastDrawn.current.get(id)
          const heard =
            (index && lastHeardBefore(index, id, tSec)) ??
            (drawn ? drawn.tSec - drawn.entry.track.lastSeenSec : log[log.length - 1].tSec)
          const gone = lost(
            log,
            drawn ? observedSnapshot(drawn.entry) : log[log.length - 1].observed,
            at,
            tSec,
            heard,
          )
          if (gone) {
            next[id] = gone
            changed = true
          }
        }
      return changed ? next : logs
    })
  }
  // Sim time as the record prints it — the event log and the handoff timeline (06b).
  const clock = (t: number) => simClock(SCENARIO.clock.startLocal, t)
  // The selected track's history trail: pure in the clock, drawn behind its dot (06b).
  const trail = useMemo(
    () => (index && selected ? trailAt(index, plan, selected.track, tSec) : []),
    [index, plan, selected, tSec],
  )
  const logFor = (entry: RankedTrack): TrackEvent[] =>
    eventLogs[entry.track.id] ?? firstSeen(entry.track.id, observedSnapshot(entry), now(), tSec)

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
          firstSeen(selected.track.id, observedSnapshot(selected), at, tSec),
        action,
        { at, tSec, observed: observedSnapshot(selected), ...detail },
      ),
    }))
  }

  // A site edit is a workflow action (#77): refused while the clock is behind the record's
  // frontier — the latest sim time any track's record holds, Lost lines included, or the last
  // edit's — so an edit's crossings always land at or past every track's own frontier. An edit
  // the module refuses is not applied; its reason goes to the panel's live line.
  const recordFrontier = Math.max(
    siteSet.lastEditTSec ?? 0,
    ...Object.values(eventLogs).map((log) => log[log.length - 1].tSec),
  )
  const sitesRewound = tSec < recordFrontier
  // Seeking behind the frontier disarms the map (#87 review): an armed click that no-ops with
  // the crosshair on and the hint still inviting it explains nothing; the rewound line does.
  // Guarded set-during-render, the derived-state pattern the record fold uses below.
  if (sitesRewound && placing !== null) setPlacing(null)
  const editSites = (change: (set: SiteSet) => SiteSet): boolean => {
    if (sitesRewound) return false
    try {
      setSiteSet(change(siteSet))
      setSiteNotice(null)
      return true
    } catch (error) {
      setSiteNotice(error instanceof Error ? error.message : String(error))
      return false
    }
  }
  const place = (center: [number, number]) => {
    if (!placing) return
    const target = placing
    const applied = editSites((set) =>
      target.kind === 'add'
        ? addSite(set, center, tSec, AO)
        : updateSite(set, target.id, { center }, tSec, AO),
    )
    // A refused placement keeps the map armed for another try; a landed one disarms it and
    // selects the site just placed, so its fields are open to refine.
    if (!applied) return
    setPlacing(null)
    if (target.kind === 'add') setSelectedSiteId(`site-${siteSet.nextId}`)
  }
  const changeSurface = (id: SurfaceId) => {
    setSurfaceId(id)
    // Leaving the Sites surface disarms the map: a click on Home must not place a site.
    if (id !== 'sites') setPlacing(null)
  }

  const pending = capture.status === 'loading' ? '…' : '—'
  const count = (n: number) => (capture.status === 'ready' ? String(n) : pending)

  const statusFields = [
    { label: 'Cooperative', value: count(adsb.length) },
    { label: 'Injects', value: count(injects.length) },
    { label: 'Seed', value: SCENARIO.seed },
    { label: 'Sim clock', value: simClock(SCENARIO.clock.startLocal, tSec) },
  ]

  // On Review the Queue is unmounted, so its row-focus return has nothing to land on: the close
  // button a keyboard operator just pressed unmounts under them and focus falls to document.body.
  // Land it on the surface's own nav item instead — named, visible, and the anchor of where they
  // already are (#46). Keyboard activations only, the drawer's own modality gate: a keyboard
  // click carries detail 0, a mouse click a positive count, and a mouse user parked on the nav
  // button would have Space activate it instead of scrolling (#53 review, after 03b round 6).
  // Queue-surface closes keep 03a's row return; this never runs there.
  const reviewNavRef = useRef<HTMLButtonElement>(null)
  // The Queue's row return is an effect on the cleared selection and cannot see the click, so
  // the close handler records the modality beside the clear — state, so it commits with it —
  // and the Queue skips the return for a pointer-driven close (#54).
  const [keyboardClose, setKeyboardClose] = useState(true)
  // The Review half of the orphan case above: after the commit that dropped the drawer, land
  // focus on the Review nav item exactly as a keyboard close does — and only if it actually fell
  // to body, so a pointer user's focus is left where it is.
  const orphanHandledRef = useRef(0)
  useEffect(() => {
    // Once per orphaning, never again on a later surface switch.
    if (orphanCount === orphanHandledRef.current) return
    orphanHandledRef.current = orphanCount
    if (surfaceId === 'review' && document.activeElement === document.body) {
      reviewNavRef.current?.focus()
    }
  }, [orphanCount, surfaceId])
  const drawer = selected && (
    <ReviewDrawer
      // Keyed by track, so picker and copied state never leak from one track to the next.
      key={selected.track.id}
      entry={selected}
      sites={sites}
      log={logFor(selected)}
      contacts={CONTACTS}
      dispositions={DISPOSITIONS}
      onAction={act}
      lookupPhoto={lookupPhoto}
      clock={clock}
      tSec={tSec}
      trail={{ count: trail.length, windowS: REPLAY.trailS }}
      onClose={(event) => {
        const keyboard = event.detail === 0
        setKeyboardClose(keyboard)
        setSelectedId(null)
        if (surfaceId === 'review' && keyboard) reviewNavRef.current?.focus()
      }}
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
              ref={s.id === 'review' ? reviewNavRef : undefined}
              type="button"
              className="nav__item"
              aria-current={s.id === surfaceId ? 'page' : undefined}
              onClick={() => changeSurface(s.id)}
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
        <Playback playback={playback} />
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
            {surfaceId === 'sites' && (
              <span className="rail__count" aria-label="Sites in the set">
                {sites.length}
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
              <Queue
                ranked={visible}
                selectedId={selectedId}
                restoreFocus={keyboardClose}
                statusFor={(id) => statusOf(eventLogs[id])}
                resurfacedFor={(entry) => resurfaced(eventLogs[entry.track.id], entry.track.source)}
                sites={sites}
                onSelect={setSelectedId}
              />
            </>
          )}
          {/* A zero count over blank space reads as a broken picture; say the filters did it.
              Only once the recording is in — a loading or errored picture is empty for its own
              reason, and already says so (#36 [7], ruled A). A polite live region, so the
              operator who just pressed the chip hears why the count fell to 0 — the rail__error
              line above is its assertive sibling. Mounted on every surface with only the text
              toggling, because a region inserted in the same commit as its text is one some
              screen readers never announce — and the filters persist across surfaces, so a
              return to the Queue would otherwise remount it already filled (#51 review). */}
          <p className="rail__empty" role="status">
            {surfaceId === 'queue' && capture.status === 'ready' && visible.length === 0
              ? 'No tracks match the filters.'
              : null}
          </p>
          {surfaceId === 'review' &&
            (drawer ?? <p className="rail__empty">Select a track from the Queue.</p>)}
          {surfaceId === 'sites' && (
            <SitesPanel
              set={siteSet}
              config={AO.protectedSites}
              ao={AO}
              selectedId={selectedSiteId}
              placing={placing}
              notice={siteNotice}
              rewound={sitesRewound}
              clock={clock}
              tSec={tSec}
              frontier={recordFrontier}
              onSelect={setSelectedSiteId}
              onPlacing={(next) => {
                setPlacing(next)
                setSiteNotice(null)
              }}
              onUpdate={(id, patch: SitePatch) =>
                editSites((set) => updateSite(set, id, patch, tSec, AO))
              }
              // A move armed on a site that is then removed or reset away must not outlive it
              // (#87 review): both clear the selection and disarm the map.
              onRemove={(id) => {
                if (editSites((set) => removeSite(set, id, tSec))) {
                  setSelectedSiteId(null)
                  setPlacing(null)
                }
              }}
              onReset={() => {
                if (editSites((set) => resetSites(set, AO.protectedSites, tSec))) {
                  setSelectedSiteId(null)
                  setPlacing(null)
                }
              }}
            />
          )}
        </section>
        {drawerColumn}
        <MapView
          ao={AO}
          sites={sites}
          selectedSiteId={surfaceId === 'sites' ? selectedSiteId : null}
          placing={placing !== null}
          onPlace={place}
          tracks={adsb}
          injects={injects}
          // Ruled A2 on #3: the selection persists across surface switches, but Home's map is
          // unannotated context — it never shows the ring, so no surface carries selection
          // state it cannot explain. The suppression is presentation-only (`selectionShown`),
          // so a Home round trip cannot reset the ease stamp and re-fly the camera (#47).
          selectedId={selectedId}
          selectionShown={surfaceId !== 'home'}
          trail={trail}
          terminalIds={terminalIds}
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
