import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { AlertStack } from './components/AlertStack'
import { useAlertTone } from './components/useAlertTone'
import { MapView } from './components/MapView'
import { Playback } from './components/Playback'
import { Queue } from './components/Queue'
import { ReviewDrawer } from './components/ReviewDrawer'
import { RunBrief } from './components/RunBrief'
import { RunEnd } from './components/RunEnd'
import type { RunResults as RunResultsView } from './components/RunResults'
import { SitesPanel, type Placing } from './components/SitesPanel'
import { AO } from './config/ao'
import { CONTACTS, type ContactId } from './config/contacts'
import { DISPOSITIONS, type DispositionId } from './config/dispositions'
import { DEFAULT_RECORDING } from './config/recordings'
import { REPLAY } from './config/replay'
import { SCORING } from './config/scoring'
import {
  BRIEF_GOAL,
  QUESTIONS,
  STUDY,
  WORKLOAD_SCALE,
  briefBlocks,
  runOfSession,
  type QuestionId,
} from './config/study'
import { lookupPhoto as defaultLookupPhoto, type PhotoLookup } from './data/photos'
import { useSession } from './data/useSession'
import { RUNS_PER_SUBJECT, nextRunSearch } from './lib/session'
import { intervalSchedule, usePlayback, type Schedule } from './data/usePlayback'
import { clearFor, foldAlerts, type Alert } from './lib/alerts'
import { formatElapsed, recordingLabel, simClock, trackIdent, type WarmBand } from './lib/display'
import { mergePicture } from './lib/feeds'
import { projectedPath, timeToEntry } from './lib/projection'
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
  mark,
  statusOf,
  type LifecycleAction,
  type Mark,
  type Status,
  type TrackEvent,
} from './lib/lifecycle'
import { rankTracks, type RankedTrack } from './lib/ranking'
import { historiesAt, lastHeardBefore, memoryAt, originsOf, trailAt } from './lib/replay'
import { runJson, runText, type RunAnswers, type RunRecord, type Selection } from './lib/run'
import { downloadRun } from './lib/download'
import { firstUnsaved, runsOf, writeRun } from './lib/runs'
import { clockStartOf, minuteOfDay } from './lib/scoring'
import {
  addSite,
  edited,
  fromStore,
  parseSitePlan,
  removeSite,
  resetSites,
  sitePlanText,
  updateSite,
  type SitePatch,
  type SiteSet,
} from './lib/sites'
import type { AdsbTrack, InjectTrack } from './lib/tracks'

type SurfaceId = 'queue' | 'sites'
type LayerFilter = 'all' | 'adsb' | 'inject'

/**
 * The list is the app (#183, from the shakedown; S8, #180 item 1): the app opens on the ranked
 * list, and the two tabs that cost a click and explained nothing — Home and Review — are gone.
 * "Queue" names a waiting line rather than a ranking, so the rendered text says **Priority
 * list** — the tab, the rail's header, the body — while the code, the CSS classes, the CSV
 * columns and the URL parameters keep "queue", as "unaided" stands beside "raw". The header and
 * the body are the study run's own words, so a run reads exactly what it read before.
 */
const SURFACES: { id: SurfaceId; label: string; title: string; body: string }[] = [
  {
    id: 'queue',
    label: 'Priority',
    title: 'Priority list — highest first',
    body: 'The top row needs you first. Click a row or a track on the map to read it.',
  },
  {
    id: 'sites',
    label: 'Sites',
    title: 'Sites',
    body: 'Protected sites and friendly launch areas the picture is scored against — kept in this browser between sessions; Reset to config forgets them.',
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

/** Raw mode's empty inputs to the map, one identity each, so nothing re-pushes a source per render. */
const NO_LINE: readonly [number, number][] = []
const NO_IDS: readonly string[] = []
const NO_BANDS: ReadonlyMap<string, WarmBand> = new Map()

/** Where this browser keeps an edited site plan between sessions (#90) — the plan's own text. */
const SITE_PLAN_KEY = 'vigil.site-plan'

/**
 * The build a run JSON names (S4b, ruled A6): the package version and the commit, defined by
 * `vite.config.ts` for the build and for the tests; a bare typecheck has none.
 */
const BUILD = import.meta.env.VITE_BUILD ?? 'unknown'

/** The stored plan, or null when none is held or the browser refuses storage — never a throw. */
/**
 * Where a study run sends the subject next (S6a-iii): module scope, so the default is one
 * function rather than a new one each render — an unstable default would re-fire the effect
 * that depends on it on every render, and doubly under StrictMode (round 1, finding 4).
 */
const goTo = (search: string) => {
  window.location.search = search
}

/**
 * The results view's chunk, fetched here and nowhere else (ruled R1): a subject who never presses
 * *See your results* never downloads the replay tool, nor the roles table it reads.
 * `tools/replay/imports.test.ts` pins that this is a dynamic `import()` and not a static edge.
 * Module scope for the same reason `goTo` is.
 */
const fetchResultsView = () =>
  import('./components/RunResults.tsx').then((module) => module.RunResults)

const readStoredPlan = (): string | null => {
  try {
    return localStorage.getItem(SITE_PLAN_KEY)
  } catch {
    return null
  }
}

/**
 * `now` is the wall-clock seam: lifecycle events take `at` as an input, App supplies it, and
 * tests fix it. `schedule` is the replay clock's seam (06a): the tick is scheduled through it,
 * so a test drives the clock by hand and never waits on real time. `lookupPhoto` is the network
 * seam (03d): the one runtime third-party call, injected the way the capture's fetcher is, so no
 * test reaches the network. `navigate` is the session seam (S6a-iii): a study run opens the next
 * run of its session by the URL, and a test reads where it was sent instead of moving.
 * `loadResults` is the results view's door — the one place its chunk is fetched (ruled R1) — so a
 * test can hand back a chunk that never arrives and read what the screen says (round 1).
 */
export default function App({
  now = () => new Date().toISOString(),
  schedule = intervalSchedule,
  lookupPhoto = defaultLookupPhoto,
  navigate = goTo,
  loadResults = fetchResultsView,
}: {
  now?: () => string
  schedule?: Schedule
  lookupPhoto?: PhotoLookup
  navigate?: (search: string) => void
  loadResults?: () => Promise<typeof RunResultsView>
} = {}) {
  const [surfaceId, setSurfaceId] = useState<SurfaceId>('queue')
  // The session the URL and the build name (#115): its feeds and, when on, its scenario. One
  // recording per session in this build, the resolver's rule, so the recording feed is the first.
  const session = useSession()
  const ready = session.status === 'ready' ? session : null
  const feed = ready?.feeds[0] ?? null
  const scenario = ready?.scenario ?? null
  // The study's condition (S4a, #136): resolved once with the session, never switched in a run.
  // Raw hides everything derived and raises nothing; the engine runs underneath as it does in
  // Vigil, so the record — and S4b's run JSON — keep one shape in both modes (ruled A2, A7).
  // Read while loading too — the URL resolves synchronously (#148 round 1) — so a raw link never
  // shows Vigil's shell before the recording is in.
  const resolved =
    session.status === 'ready' || session.status === 'loading' ? (session.session ?? null) : null
  const mode = resolved?.mode ?? 'vigil'
  const raw = mode === 'raw'
  // A study run (S4b, #137, ruled; #131): the link named a subject and a run, in either mode.
  // The session opens on the brief with the clock held at Begin's tick, runs from Begin to the
  // window's end, and closes on the end screen; nothing of it mounts in the demo (ruled A8).
  const study = resolved?.study ?? null
  const inStudy = study !== null
  // A study run is the list and the map, and nothing else is reachable (S8, item 1): Sites is
  // withheld there. The demo opens on the list too (#183) and keeps Sites beside it.
  const activeSurface: SurfaceId = inStudy ? 'queue' : surfaceId
  const surface = SURFACES.find((s) => s.id === activeSurface) ?? SURFACES[0]
  // The run's window (S4b, ruled A2, A4): Begin's tick to the run's end — the scenario's own
  // length when its registry entry carries one (S7, #152, ruled D3), the study's default
  // otherwise, resolved with the session so the link fixes it.
  const runS = resolved?.scenario.on ? resolved.scenario.runS : STUDY.runS
  const runWindow = useMemo(() => ({ fromS: STUDY.beginS, toS: STUDY.beginS + runS }), [runS])

  // Selection and filters persist across surface switches — client state only (§7.1 ruling, #3).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [layerFilter, setLayerFilter] = useState<LayerFilter>('all')
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')

  // The §7.1 record: one event log per track, client-side only, never persisted or transmitted.
  // A log opens the first time this session renders its track (ruled on #6, note 3) — see the
  // sighting fold below — and is kept if the track leaves the picture and returns.
  const [eventLogs, setEventLogs] = useState<Record<string, TrackEvent[]>>({})
  // The alert stack (#101, 101a): a surface over the record, newest first, and how far into
  // each track's log the alert fold has read — so every entry is folded exactly once.
  const [alerts, setAlerts] = useState<Alert[]>([])
  // The tone (101b): a count of raise batches, bumped by the alert fold and played by the effect
  // below — once per batch, never on a seek's replay, never muted. The mute is the strip's.
  const [raises, setRaises] = useState(0)
  const [muted, setMuted] = useState(false)
  const playTone = useAlertTone(muted)
  useEffect(() => {
    if (raises > 0) playTone()
  }, [raises, playTone])
  const [alertsRead, setAlertsRead] = useState<Record<string, number>>({})
  // Where a card's control lands focus (S8b, #202): counted, so each request lands once.
  const [landing, setLanding] = useState({ n: 0, row: false })

  // The session's site set (08a, ruled on #86): the operator's protected sites, seeded from
  // config and scored against on every tick. An edited set is kept in this browser as its plan
  // (#90) and restored here, before the first frame, unstamped — the frontier rule never sees
  // it; a plan the parser refuses leaves config in place with one line said. A held plan that
  // equals config records no difference, so it is forgotten here rather than kept unclearable
  // (#108 review). The golden and every pinned test run on the config set.
  // Raw ignores the stored plan and draws the config's sites (#36 [34], ruled A): a subject can
  // neither see nor reset a plan a Vigil run left in this browser, and the study's baselines are
  // computed against the config set. So does a study run in Vigil (S4b, ruled A13), which
  // withholds the Sites surface too. The demo in Vigil keeps its plan, shown on its own panel.
  const [siteSet, setSiteSet] = useState<SiteSet>(() => {
    const text = raw || inStudy ? null : readStoredPlan()
    const { set, problem } = fromStore(text, AO.protectedSites, AO.friendlyAreas, AO)
    if (problem !== null) console.warn(`Stored site plan ignored — ${problem}; using config`)
    else if (text !== null && !set.stored) localStorage.removeItem(SITE_PLAN_KEY)
    return set
  })
  // Whether the browser's refusal to store the plan has been said — once, not per edit.
  const storageWarned = useRef(false)
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  // What the next map click does while the Sites editor has the map armed, and the reason the
  // last placement was refused, if it was.
  const [placing, setPlacing] = useState<Placing>(null)
  const [siteNotice, setSiteNotice] = useState<string | null>(null)

  // The recording feed carries its index — the recording re-keyed by aircraft for the
  // interpolator — and its plan-bearing scenario rides beside it; the clock runs to the last frame.
  const index = feed?.index ?? null
  const plan = scenario?.plan ?? null
  // In a study run the clock is the window's: held at Begin until the button, ended at Begin +
  // the run's length, never restarted (ruled A2–A4).
  const playback = usePlayback(
    index?.durationS ?? null,
    schedule,
    REPLAY.tickMs,
    inStudy ? runWindow : null,
  )
  const tSec = playback.tSec
  // The run's three states (S4b): the brief up until Begin; running; ended at the window's end
  // — or the recording's, if it is shorter — with the picture frozen under the end screen.
  // `began_at` is the wall clock at Begin, the stamp the run JSON carries. A run ends only after
  // it began: a recording that ends at or before Begin holds the brief with Begin withheld,
  // rather than opening on an end screen no run can fill (#149 round 1).
  const [beganAt, setBeganAt] = useState<string | null>(null)
  const canBegin = index !== null && index.durationS > runWindow.fromS
  const runEnded =
    inStudy &&
    beganAt !== null &&
    index !== null &&
    tSec >= Math.min(runWindow.toS, index.durationS)
  const runActive = inStudy && beganAt !== null && !runEnded
  // Every selection between Begin and the end, in order — the run JSON's `select` events
  // (ruled A5): which track, at which tick. The record holds the actions; this holds the looks.
  const [selections, setSelections] = useState<Selection[]>([])
  const [answers, setAnswers] = useState<Partial<RunAnswers>>({})
  // A run saves itself once the three questions are answered (S6a-iii, #165, item 2), under the
  // subject's code and this run's index. Fail-soft: a browser that will not keep it says so on
  // the end screen, and the run is still there to copy or download.
  const [savedRuns, setSavedRuns] = useState<readonly RunRecord[]>(() =>
    study === null ? [] : runsOf(study.subject, RUNS_PER_SUBJECT),
  )
  const [saveRefused, setSaveRefused] = useState(false)
  // The results view is a chunk of its own, fetched on the See your results click and nowhere
  // else (S6a-ii, ruled R1): never at load, never at Begin, never on run 1’s end screen.
  const [Results, setResults] = useState<typeof RunResultsView | null>(null)
  // What the browser said when that chunk did not arrive, so the screen can say it too.
  const [resultsRefusal, setResultsRefusal] = useState<string | null>(null)

  /**
   * The picture at the clock, through the seam (#115): the feeds in session order, then the
   * scenario when on — the recording's bracketed samples read linearly, held then dropped (06a),
   * and the injects sampled from the plan every random decision of which was made once, on the
   * recording's own frame grid, so one clock drives both. One list for the Queue and the scorer:
   * neither knows which feed a track came from. The map still draws the two layers apart.
   */
  const tracks = useMemo(
    () => (ready ? mergePicture(ready.feeds, ready.scenario, tSec) : []),
    [ready, tSec],
  )
  const adsb = useMemo(
    () => tracks.filter((track): track is AdsbTrack => track.source === 'adsb'),
    [tracks],
  )
  const injects = useMemo(
    () => tracks.filter((track): track is InjectTrack => track.source === 'inject'),
    [tracks],
  )
  // The identity memory — when each inject's ident was last heard — is a pure fold over the
  // frame grid up to the clock, so play and seek agree on it (06a). The hour is the recording's
  // clock start plus the clock (#84, after D2 on #4): 001's configured 02:30, 002's capture wall
  // time in the AO's zone — and the strip shows the same number the breakdown scores against.
  // Until the recording is in nothing is scored, so the default's hour stands in. The fold hears
  // a broadcast at the threshold the rows are scored with (#141) — the committed config here.
  const memory = useMemo(
    () =>
      scenario
        ? memoryAt(scenario.pictureAt, scenario.plan.intervalS, tSec, SCORING.cooperativity)
        : {},
    [scenario, tSec],
  )
  const startLocal = useMemo(
    () => (feed ? clockStartOf(feed.entry, feed.capture, AO) : DEFAULT_RECORDING.clock.startLocal),
    [feed],
  )
  const clockMinute = minuteOfDay(startLocal, tSec)
  // Each track's position history over the pattern window (05a), sampled at the clock as the
  // trail is — pure in t, so a seek reads the same history play would, and scores the same.
  const history = useMemo(
    () => (index ? historiesAt(index, plan, tracks, tSec, SCORING.pattern.windowS) : {}),
    [index, plan, tracks, tSec],
  )
  const sites = siteSet.sites
  const areas = siteSet.areas
  // Every track's observed first-seen position (08b): the recording's first sample, the inject's
  // first frame — once per recording, seek-independent, the friendly condition's first half.
  const origins = useMemo(() => (index ? originsOf(index, plan) : {}), [index, plan])
  const ranked = useMemo(
    () =>
      rankTracks(tracks, sites, {
        tSec,
        minuteOfDay: clockMinute,
        memory,
        history,
        friendly: areas,
        origins,
      }),
    [tracks, sites, areas, tSec, clockMinute, memory, history, origins],
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
  // The friendly condition per track, read off the picture as the source is (08b).
  const friendlyOf = useMemo(
    () => new Map(ranked.map((entry) => [entry.track.id, entry.score.friendly])),
    [ranked],
  )
  const terminalKey = useMemo(
    () =>
      Object.keys(eventLogs)
        .filter(
          (id) =>
            isTerminal(statusOf(eventLogs[id])) &&
            !resurfaced(eventLogs[id], sourceOf.get(id) ?? 'adsb', friendlyOf.get(id) ?? false),
        )
        .sort()
        .join(' '),
    [eventLogs, sourceOf, friendlyOf],
  )
  const terminalIds = useMemo(
    () => (terminalKey === '' ? [] : terminalKey.split(' ')),
    [terminalKey],
  )
  /**
   * The subject's own bookkeeping (S8, #180 item 3; ruled 2026-09-19): every track they have
   * assessed, escalated or dismissed, with which. Folded to a key first, for the same reason the
   * bands are — a new Map identity re-pushes both sources, so this is rebuilt only when some
   * track's mark actually moves, never on a tick that changed nothing.
   *
   * Identical in both conditions: the mark is what the subject did, not what Vigil derived, so
   * nothing about it is withheld from the unaided picture. It is not the dim, which stays
   * Vigil's, and ranking never reads it.
   */
  const markKey = Object.entries(eventLogs)
    .map(([id, log]) => `${id}:${mark(statusOf(log)) ?? ''}`)
    .filter((pair) => !pair.endsWith(':'))
    .sort()
    .join(' ')
  const marks = useMemo(
    () =>
      new Map(
        markKey === ''
          ? []
          : markKey.split(' ').map((pair) => {
              const cut = pair.lastIndexOf(':')
              return [pair.slice(0, cut), pair.slice(cut + 1) as Mark] as const
            }),
      ),
    [markKey],
  )
  // The warm bands for the map's fill (#96), in the same two-step shape and for the same reason:
  // a new identity here re-pushes the inject source, so the key folds first and the Map is
  // rebuilt only when some inject's band moved — a site edit with the clock paused (the band
  // moves, the picture does not), never a tick with no crossing. The band is the score's own
  // word, the one the chip prints; nothing is computed here. Calm is absent, so the map reads it
  // as the default, and only injects are keyed: both caps hold a real aircraft below caution.
  const bandKey = useMemo(
    () =>
      ranked
        .filter((entry) => entry.track.source === 'inject' && entry.score.band !== 'calm')
        .map((entry) => `${entry.track.id}:${entry.score.band}`)
        .sort()
        .join(' '),
    [ranked],
  )
  const bands = useMemo(
    () =>
      new Map<string, WarmBand>(
        bandKey === ''
          ? []
          : bandKey.split(' ').map((pair) => pair.split(':') as [string, WarmBand]),
      ),
    [bandKey],
  )

  const selected = selectedId
    ? (ranked.find((entry) => entry.track.id === selectedId) ?? null)
    : null

  // The picture can take the selection away: a selected track coasts out and the drawer unmounts
  // with nobody pressing Close (#73 review). Clear the selection, so the Queue's own return-to-
  // list effect runs — the list is mounted under every close now (#183). Guarded
  // set-during-render, as the sighting fold below; only once the recording is in, since a
  // loading picture has taken nothing away.
  const orphaned = selectedId !== null && selected === null && ready !== null
  if (orphaned) setSelectedId(null)

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
  const settled = ready !== null
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
  // The alert fold (#101, 101a), one render behind the record fold above by construction: it
  // reads the logs as committed and folds each track's entries past the count it last read.
  // Whether those entries interrupt is the clock's word — a tick raises, a seek (load included)
  // replays the record and only clears (ruled A1, A2 on #101). The same guarded
  // set-during-render pattern: the state it writes is what the re-render checks, so one commit
  // folds an entry once.
  // In raw nothing raises (ruled A6): the fold still clears, and no card or tone is ever made.
  const raising = !raw && playback.lastMove === 'tick'
  const alertsStale = Object.entries(eventLogs).some(
    ([id, log]) => log.length > (alertsRead[id] ?? 0),
  )
  if (alertsStale) {
    let next = alerts
    const read = { ...alertsRead }
    for (const [id, log] of Object.entries(eventLogs)) {
      const from = read[id] ?? 0
      if (log.length <= from) continue
      next = foldAlerts(next, log, from, sourceOf.get(id) ?? 'adsb', raising)
      read[id] = log.length
    }
    if (next !== alerts) setAlerts(next)
    // A raise or a re-stamp makes a new card object; a clear only drops. One batch, one tone.
    if (next.some((card) => !alerts.includes(card))) setRaises((count) => count + 1)
    setAlertsRead(read)
  }
  // Sim time as the record prints it — the event log and the handoff timeline (06b).
  const clock = (t: number) => simClock(startLocal, t)
  // The selected track's history trail: pure in the clock, drawn behind its dot (06b).
  const trail = useMemo(
    () => (index && selected ? trailAt(index, plan, selected.track, tSec) : []),
    [index, plan, selected, tSec],
  )
  // Time to entry for the selected track (#102): one pure call over the picture and the session's
  // protected set — the drawer prints it, the map draws the path to the ring. App reads the
  // estimate and computes nothing else, as it reads the bands and the terminal set.
  const entryEstimate = useMemo(
    () => (selected ? timeToEntry(selected.track, sites) : null),
    [selected, sites],
  )
  // The path the map draws (S10, #182): to the ring where the course meets it, else the course
  // run out to the horizon the row reads under — one pure call, as the estimate is. The reading
  // at its end is the row's own seconds; null where it misses.
  const projection = useMemo<readonly [number, number][]>(
    () => (selected ? projectedPath(selected.track, entryEstimate) : []),
    [selected, entryEstimate],
  )
  const projectionEntryS = entryEstimate?.kind === 'entry' ? entryEstimate.tSec : null
  const logFor = (entry: RankedTrack): TrackEvent[] =>
    eventLogs[entry.track.id] ?? firstSeen(entry.track.id, observedSnapshot(entry), now(), tSec)

  // Acknowledge (#101): answers a card — what both of the card's controls write (S8b, #202). A
  // workflow action under #77, refused behind the track's own frontier — the card's controls are
  // disabled there, and this refuses anyway. The line is written through the table, so a New
  // track becomes Assessing by the existing transition and an Assessing or Escalated one keeps
  // its status with the line still written; a Dismissed track — a Re-surfaced card — has no
  // transition to write and its cards simply clear, since the table keeps Dismissed terminal.
  // The fold above clears the cards when the line lands. True when the card was answered.
  const acknowledge = (trackId: string): boolean => {
    const log = eventLogs[trackId]
    if (!log || tSec < log[log.length - 1].tSec) return false
    // A study run takes actions only while it runs (ruled A4): none before Begin, none after.
    if (inStudy && !runActive) return false
    if (isTerminal(statusOf(log))) {
      setAlerts((current) => clearFor(current, trackId))
      return true
    }
    const at = now()
    const entry = ranked.find((candidate) => candidate.track.id === trackId)
    const observed = entry ? observedSnapshot(entry) : log[log.length - 1].observed
    // Through the study run's table where this is a run (S8-ii): a card answered from the stack
    // carries a New track rather than claiming it, so the ring stays the open's alone.
    setEventLogs((logs) => ({
      ...logs,
      [trackId]: appendEvent(logs[trackId] ?? log, 'acknowledge', {
        at,
        tSec,
        observed,
        run: inStudy,
      }),
    }))
    return true
  }
  // The card's two controls (S8b, #202). Open answers the card and opens its track: the
  // acknowledge line first, the select after it at the same second, so the run JSON carries the
  // pair and in a run the open marks the track as any open does; the demo's lifecycle reads the
  // line as #101 ruled. Focus lands where a selection from the list lands it — the row under
  // the keyboard, the list under a pointer (#54). The quiet clear writes the line alone and
  // moves nothing; the one that empties the stack lands focus on the list rather than body.
  const openCard = (trackId: string, keyboard: boolean) => {
    if (!acknowledge(trackId)) return
    select(trackId)
    setLanding((current) => ({ n: current.n + 1, row: keyboard }))
  }
  const clearCard = (trackId: string) => {
    if (!acknowledge(trackId)) return
    if (clearFor(alerts, trackId).length === 0) {
      setLanding((current) => ({ n: current.n + 1, row: false }))
    }
  }
  // A selection — a Queue row, a map dot, an alert card's Open — is logged in a study run at the
  // clock it was made (ruled A5); the same track opened again is a new line, since the replay
  // draws the hops. Before Begin the overlay takes every click; after the end the shell is inert
  // and the selection refused anyway, so a click selects nothing new (ruled A4).
  //
  // Opening a track marks it (S8-ii, #180, the owner's amendment of 2026-09-19, item 1): the
  // first open of an untouched track moves it to Assessing at the click, so the faint ring, the
  // Status row and the list row all read the one status off the log; a re-open changes nothing.
  // The select is the record (item 4): `runEvents` maps no `open`, so the run JSON carries the
  // selection and nothing else. The demo's select marks nothing (item 8).
  const select = (id: string) => {
    if (inStudy && !runActive) return
    if (inStudy) {
      setSelections((current) => [...current, { tSec, trackId: id }])
      const at = now()
      setEventLogs((logs) => {
        const entry = ranked.find((candidate) => candidate.track.id === id)
        const log = logs[id] ?? (entry && firstSeen(id, observedSnapshot(entry), at, tSec))
        if (!log || statusOf(log) !== 'new') return logs
        const observed = entry ? observedSnapshot(entry) : log[log.length - 1].observed
        return { ...logs, [id]: appendEvent(log, 'open', { at, tSec, observed, run: true }) }
      })
    }
    setSelectedId(id)
  }

  const act = (
    action: LifecycleAction,
    detail?: { recipient?: ContactId; disposition?: DispositionId },
  ) => {
    if (!selected) return
    if (inStudy && !runActive) return
    const at = now()
    setEventLogs((logs) => ({
      ...logs,
      // Read the log from the updater's own argument, never the render closure: two actions
      // batched into one commit must chain, not overwrite each other (#47 review).
      [selected.track.id]: appendEvent(
        logs[selected.track.id] ??
          firstSeen(selected.track.id, observedSnapshot(selected), at, tSec),
        action,
        // The study run's table and its recipient-free escalation (ruled): one flag, read by
        // the guard and by the transition, so the module refuses in the demo what it allows here.
        { at, tSec, observed: observedSnapshot(selected), ...detail, run: inStudy },
      ),
    }))
    // The detail closes on the action in a study run (S8, #180 item 3): the subject is done with
    // this track and the next one is on the map behind it. Its mark says what they did, so the
    // panel has nothing left to tell them. The demo leaves the panel open, as it does today.
    if (inStudy && action !== 'acknowledge') setSelectedId(null)
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
  // Storage holds the plan only while the set differs from config (ruled on #90): an accepted
  // edit writes the plan's text, and one whose set equals config — Reset to config included —
  // removes the key and clears `stored`, so the rows read config again. A write the browser
  // refuses is said once for the session — the name field commits per keystroke (#108 review) —
  // and the session continues on the set.
  const commitSites = (next: SiteSet): void => {
    const kept = edited(next, AO.protectedSites, AO.friendlyAreas)
    setSiteSet(kept ? next : { ...next, stored: false })
    try {
      if (kept) localStorage.setItem(SITE_PLAN_KEY, sitePlanText(next, AO))
      else localStorage.removeItem(SITE_PLAN_KEY)
    } catch (error) {
      if (storageWarned.current) return
      storageWarned.current = true
      console.warn(`Site plan not stored — ${error instanceof Error ? error.message : error}`)
    }
  }
  const editSites = (change: (set: SiteSet) => SiteSet): boolean => {
    if (sitesRewound) return false
    try {
      commitSites(change(siteSet))
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
        ? addSite(set, center, tSec, AO, target.site)
        : updateSite(set, target.id, { center }, tSec, AO),
    )
    // A refused placement keeps the map armed for another try; a landed one disarms it and
    // selects the site just placed, so its fields are open to refine.
    if (!applied) return
    setPlacing(null)
    if (target.kind === 'add') {
      setSelectedSiteId(`${target.site === 'friendly' ? 'area' : 'site'}-${siteSet.nextId}`)
    }
  }
  const changeSurface = (id: SurfaceId) => {
    setSurfaceId(id)
    // Leaving the Sites surface disarms the map: a click on the list's map must not place a site.
    if (id !== 'sites') setPlacing(null)
  }

  const pending = session.status === 'loading' ? '…' : '—'
  const count = (n: number) => (ready ? String(n) : pending)

  const statusFields = [
    // A study run counts its tracks as one number in both modes (S4b, ruled A13): an Injects
    // field that ticks up when the threat appears is a cue no real display has. The demo keeps
    // the split.
    ...(inStudy
      ? [{ label: 'Tracks', value: count(tracks.length) }]
      : [
          { label: 'Cooperative', value: count(adsb.length) },
          { label: 'Injects', value: count(injects.length) },
        ]),
    // Raw hides the seed: it names the scenario a subject must not know (ruled A3).
    // A study run hides it in both modes (S4b, #36 [37], ruled A): the seed is the scenario's name.
    ...(raw || inStudy
      ? []
      : [{ label: 'Seed', value: ready ? (scenario?.seed ?? '—') : pending }]),
    // The recording and the day it was flown (#84, ruled), and the clock it opens: held back with
    // the counts until the recording is in, since all three are read off the loaded file.
    {
      label: 'Recording',
      value: feed ? recordingLabel(feed.entry, feed.capture, AO) : pending,
    },
    {
      label: 'Sim clock',
      value: feed ? simClock(startLocal, tSec) : pending,
    },
  ]
  // A session that could not be made (refused: the URL's ask) or could not load (error: the
  // recording's fetch) says so on the rail, in its own words, rather than showing an empty map.
  const problem =
    session.status === 'refused'
      ? session.reason
      : session.status === 'error'
        ? session.message
        : null

  // The Queue's row return is an effect on the cleared selection and cannot see the click, so
  // the close handler records the modality beside the clear — state, so it commits with it —
  // and the Queue skips the return for a pointer-driven close (#54). With the Review tab gone
  // (#183) the list is mounted under every close, so the row return is the only one left, and
  // an orphaned selection (#73) lands on the list the same way.
  const [keyboardClose, setKeyboardClose] = useState(true)
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
      entryEstimate={entryEstimate}
      mode={mode}
      run={inStudy}
      onClose={(event) => {
        setKeyboardClose(event.detail === 0)
        setSelectedId(null)
      }}
    />
  )
  // The drawer is its own column beside the list (§4.2 — the operator keeps the list while
  // reviewing), at 26 rem (ruled B1, #3); on Sites the selection is kept and the drawer waits.
  const drawerColumn = activeSurface === 'queue' && drawer
  const bodyClasses = ['shell__body']
  if (drawerColumn || (raw && drawer)) bodyClasses.push('shell__body--drawer')
  // Raw (S4a, ruled A3): no rail — the map fills the body, the drawer opens beside it on a click.
  if (raw) bodyClasses.push('shell__body--raw')

  // The run's overlays (S4b): the brief until Begin, the end screen from the window's end. The
  // shell under either is inert — no click, no Tab reaches it — so the picture is neither read
  // nor acted on through the overlay; the handlers above refuse anyway.
  // The run's name on the brief and the end screen: the subject and the run only (#36 [37],
  // ruled A) — the scenario and the mode are the researcher's, carried by the JSON.
  // The run a link opens at (item 8): the first this browser has not saved. A subject who
  // reloads their link after run 1 lands on run 2 rather than running run 1 again, and with the
  // session finished there is no run left to open — the results stand in its place.
  const resume = useMemo(
    () => (study === null ? null : firstUnsaved(study.subject, RUNS_PER_SUBJECT)),
    [study],
  )
  const runName = study ? `subject ${study.subject} · run ${study.run}` : null
  /** The run's text under a set of answers, or null while any of the three is unanswered. */
  const runTextFor = useCallback(
    (given: Partial<RunAnswers>): string | null => {
      if (!study || !runEnded || beganAt === null || !ready) return null
      if (QUESTIONS.some((question) => given[question.id] === undefined)) return null
      return runJson({
        session: ready.session,
        build: BUILD,
        beganAt,
        beginS: runWindow.fromS,
        endS: runWindow.toS,
        logs: eventLogs,
        selections,
        answers: given as RunAnswers,
      })
    },
    [study, runEnded, beganAt, ready, eventLogs, selections, runWindow],
  )
  const json = useMemo(() => runTextFor(answers), [runTextFor, answers])

  /**
   * A run saves itself the moment its last question is answered (S6a-iii, #165, item 2), under
   * the subject's code and this run's index — in the handler rather than in an effect, so the
   * write happens once, on the subject's own action, and what is stored is the run's own text:
   * what a subject hands over is byte for byte what they copied.
   *
   * Fail-soft, as the site plan's store is: a browser that will not keep it says so on the end
   * screen and the run is still there to copy or download.
   */
  const answer = useCallback(
    (id: QuestionId, value: number) => {
      const given = { ...answers, [id]: value }
      setAnswers(given)
      const text = runTextFor(given)
      if (text === null || study === null) return
      setSaveRefused(!writeRun(JSON.parse(text) as RunRecord, text))
      setSavedRuns(runsOf(study.subject, RUNS_PER_SUBJECT))
    },
    [answers, runTextFor, study],
  )
  const nextSearch = useMemo(
    () => (resolved === null ? null : nextRunSearch(resolved, window.location.search)),
    [resolved],
  )
  /**
   * Nothing to run here (item 8): every run of the session is saved, or this link's run is saved
   * and there is no link to the next one — a scenario with no pair, say. Either way the brief is
   * withheld, because offering it would re-run a run already given (round 1, finding 3).
   */
  const sessionDone =
    study !== null &&
    beganAt === null &&
    (resume === null || (resume > study.run && nextSearch === null))
  useEffect(() => {
    // Forward only. A link that asks for a run this browser has not reached yet is run as
    // asked — its end screen carries the words for the run that is missing (item 4) — and a
    // link whose run is already saved moves on by the turned-over link, so the scenario and
    // the mode move with it rather than run 1 being replayed under run 2’s condition.
    if (study === null || resume === null || resume <= study.run || beganAt !== null) return
    // No link to the next run — the card stands in its place rather than the brief (finding 3).
    if (nextSearch !== null && nextSearch !== window.location.search) navigate(nextSearch)
  }, [study, resume, beganAt, nextSearch, navigate])

  /**
   * The results view's door (ruled R1): its chunk is fetched here and nowhere else, so a subject
   * who never presses the button never downloads the replay tool, nor the roles table.
   *
   * A chunk that does not arrive — a stale deploy, a network that dropped — says so on the screen
   * with the one thing to do, as `main.tsx` does for the sheet page's door, rather than leaving
   * the button doing nothing at all (round 1, finding 2). Pressing again retries.
   */
  const showResults = useCallback(() => {
    setResultsRefusal(null)
    void loadResults().then(
      (view) => setResults(() => view),
      (error: Error) => setResultsRefusal(error.message),
    )
  }, [loadResults])

  const overlay = study !== null && beganAt === null && !sessionDone
  const covered = overlay || runEnded || sessionDone

  // The results stand in the shell’s place rather than after it: the run is over, and the
  // picture is not what the subject is reading any more (ruled E8).
  if (Results !== null && savedRuns.length === RUNS_PER_SUBJECT) {
    return <Results runs={savedRuns} />
  }

  return (
    <div className="shell">
      <header className="shell__header" inert={covered}>
        <h1 className="shell__wordmark">Vigil</h1>
        {/* No tab bar in a study run (S8, #180 item 1): the run opens on the map and the
            ranked list, and the detail opens in place on selection; Sites is not reachable. The
            demo's two tabs are the list and Sites (#183). Raw has never had the nav. */}
        {!raw && !inStudy && (
          <nav className="nav" aria-label="Surfaces">
            {SURFACES.map((s) => (
              <button
                key={s.id}
                type="button"
                className="nav__item"
                aria-current={s.id === surfaceId ? 'page' : undefined}
                onClick={() => changeSurface(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>
        )}
        <p className="shell__notice">Demonstration only — not for operational use</p>
      </header>

      <dl className="strip" aria-label="Picture status" inert={covered}>
        {statusFields.map((field) => (
          <div className="strip__field" key={field.label}>
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
        <Playback playback={playback} raw={raw} runFromS={inStudy ? runWindow.fromS : null} />
        {!raw && (
          <div className="strip__field strip__field--alerts">
            <dt>Alerts</dt>
            <dd>
              {/* The flipping label alone, Play/Pause's shape: a label and aria-pressed that both
                flip announce the state inverted (ruled A on #36 [18]). */}
              <button
                type="button"
                className="playback__toggle"
                onClick={() => setMuted((current) => !current)}
              >
                {muted ? 'Unmute' : 'Mute'}
              </button>
            </dd>
          </div>
        )}
        <div className="strip__field strip__field--ao">
          <dt>AO</dt>
          <dd>{AO.name}</dd>
        </div>
      </dl>

      <main className={bodyClasses.join(' ')} inert={covered}>
        {!raw && (
          <section className="rail" aria-labelledby="rail-title">
            <div className="rail__head">
              <h2 className="rail__title" id="rail-title">
                {surface.title}
              </h2>
              {activeSurface === 'queue' && (
                <span className="rail__count" aria-label="Tracks in queue">
                  {count(visible.length)}
                </span>
              )}
              {activeSurface === 'sites' && (
                <span className="rail__count" aria-label="Sites in the set">
                  {sites.length}
                </span>
              )}
            </div>
            <p className="rail__body">{surface.body}</p>
            {problem !== null && (
              <p className="rail__error" role="alert">
                {problem}
              </p>
            )}
            {activeSurface === 'queue' && (
              <>
                {/* The layer chips are withheld in a study run (#36 [38], ruled A): a filter named
                  INJECT is the cue the single count removed. The demo keeps them. */}
                {!inStudy && (
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
                )}
                {/* The state chips are withheld in a study run too (S8-ii, #198 round 1): the
                  brief says the list ranks every track, and a held chip makes that false — with
                  opening moving a track to Opened, a subject holding New watched rows leave the
                  list under the cursor. The demo keeps them. */}
                {!inStudy && (
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
                )}
                <Queue
                  ranked={visible}
                  selectedId={selectedId}
                  restoreFocus={keyboardClose}
                  landing={landing}
                  statusFor={(id) => statusOf(eventLogs[id])}
                  resurfacedFor={(entry) =>
                    resurfaced(eventLogs[entry.track.id], entry.track.source, entry.score.friendly)
                  }
                  sites={sites}
                  run={inStudy}
                  onSelect={select}
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
              return to the list would otherwise remount it already filled (#51 review). */}
            <p className="rail__empty" role="status">
              {activeSurface === 'queue' && ready !== null && visible.length === 0
                ? 'No tracks match the filters.'
                : null}
            </p>
            {activeSurface === 'sites' && (
              <SitesPanel
                set={siteSet}
                config={AO.protectedSites}
                configAreas={AO.friendlyAreas}
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
                onLoad={(text) => {
                  // A load the module refuses is not applied; its reason goes back to the panel's
                  // load line rather than the placement hint.
                  if (sitesRewound) return 'Rewound — the workflow acts at the record’s frontier'
                  try {
                    commitSites(parseSitePlan(text, AO, siteSet, tSec))
                    setSelectedSiteId(null)
                    setPlacing(null)
                    // A load is an edit like the others: a placement's stale refusal clears with it.
                    setSiteNotice(null)
                    return null
                  } catch (error) {
                    return error instanceof Error ? error.message : String(error)
                  }
                }}
                onReset={() => {
                  if (
                    editSites((set) => resetSites(set, AO.protectedSites, tSec, AO.friendlyAreas))
                  ) {
                    setSelectedSiteId(null)
                    setPlacing(null)
                  }
                }}
              />
            )}
          </section>
        )}
        {raw ? drawer : drawerColumn}
        <MapView
          ao={AO}
          sites={sites}
          areas={areas}
          selectedSiteId={activeSurface === 'sites' ? selectedSiteId : null}
          placing={placing !== null}
          onPlace={place}
          tracks={adsb}
          injects={injects}
          // The selection persists across the two surfaces and the ring and trail with it: the
          // one surface that withheld them, Home, is gone (#183; A2 on #3 is moot).
          selectedId={selectedId}
          trail={trail}
          // Raw (ruled A4): no projected path, no dim, no band fill — the derived readings the
          // fairness spec hides; the trail and the ring stay.
          projection={raw ? NO_LINE : projection}
          projectionEntryS={raw ? null : projectionEntryS}
          terminalIds={raw ? NO_IDS : terminalIds}
          marks={marks}
          bands={raw ? NO_BANDS : bands}
          mode={mode}
          // A study run's paint (S9b, #199): warning alone in Vigil, the opened mark on the marker,
          // no legend on the map. The demo keeps its paint.
          run={inStudy}
          onSelect={select}
        >
          {!raw && (
            <AlertStack
              alerts={alerts}
              identOf={(id) => {
                const entry = ranked.find((candidate) => candidate.track.id === id)
                return entry ? trackIdent(entry.track) : id
              }}
              clock={clock}
              tSec={tSec}
              frontierOf={(id) => eventLogs[id]?.at(-1)?.tSec ?? tSec}
              onOpen={openCard}
              onClear={clearCard}
            />
          )}
        </MapView>
      </main>
      {overlay && runName !== null && (
        <RunBrief
          title={`Vigil · study run — ${runName}`}
          place={runOfSession(study.run, RUNS_PER_SUBJECT)}
          goal={BRIEF_GOAL}
          blocks={briefBlocks(runS)}
          raw={raw}
          ready={canBegin}
          onBegin={() => {
            setBeganAt(now())
            playback.play()
          }}
        />
      )}
      {/* Both runs saved and the link opened again: there is no run left to do, and offering
          the brief would re-run one (item 8). The session's own files are the way out. */}
      {sessionDone && runName !== null && (
        <div className="run" role="dialog" aria-modal="true" aria-labelledby="run-title">
          <div className="run__card">
            <h2 className="run__title" id="run-title">
              {savedRuns.length === RUNS_PER_SUBJECT ? 'Session complete' : 'Already run'} —{' '}
              {runName.replace(/ · run \d+$/, '')}
            </h2>
            <p className="run__brief">
              {savedRuns.length === RUNS_PER_SUBJECT
                ? 'Both of your runs are saved in this browser. There is nothing left to run.'
                : 'This run is already saved in this browser, and there is no next run to open from here.'}
            </p>
            {/* The same order the end screen reads in (ruled R1): the way on first, as the card's
                one primary, then the files as a quiet row that says it is optional. */}
            {resultsRefusal !== null && (
              <p className="run__warn" role="alert">
                Your results did not load — {resultsRefusal}. Reload the page and press it again.
              </p>
            )}
            {savedRuns.length === RUNS_PER_SUBJECT && (
              <button type="button" className="run__button run__next" onClick={showResults}>
                See your results
              </button>
            )}
            <div className="run__optional">
              {savedRuns.length === RUNS_PER_SUBJECT && (
                <span className="run__optional-label">Optional backup:</span>
              )}
              {savedRuns.map((record) => (
                <button
                  key={record.run}
                  type="button"
                  className="run__quiet"
                  onClick={() => downloadRun(record.subject, record.run, runText(record))}
                >
                  Download run {record.run}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {inStudy && runEnded && runName !== null && (
        <RunEnd
          title={`Run complete — ${runName} · +${formatElapsed(tSec - runWindow.fromS)}`}
          run={study.run}
          questions={QUESTIONS}
          scale={WORKLOAD_SCALE}
          answers={answers}
          onAnswer={answer}
          json={json}
          saved={json !== null && !saveRefused}
          onDownload={() => json !== null && downloadRun(study.subject, study.run, json)}
          // The way on reads what this browser holds now, not what it held at mount: a
          // subject who ran run 2 first and then run 1 has both, and offering Start run 2
          // there would name a run already given (Codex, round 1).
          onNext={
            nextSearch === null || savedRuns.some((saved) => saved.run === study.run + 1)
              ? undefined
              : () => navigate(nextSearch)
          }
          // The way on follows what is saved, not the run number (ruled, round 1): every run
          // of this session in this browser means the results, whatever order they were run in —
          // a subject who took run 2 first and then run 1 finishes on *See your results*, where
          // reading `study.run` left run 1's screen with no way on at all.
          onResults={savedRuns.length === RUNS_PER_SUBJECT ? showResults : undefined}
          // This run saved and no run left to offer, short of the whole session: the screen takes
          // the session-complete card's treatment — the words for what is missing, and the file
          // as the way out. No end screen is ever left with neither a primary nor words.
          resultsMissing={
            savedRuns.length < RUNS_PER_SUBJECT &&
            (nextSearch === null || savedRuns.some((saved) => saved.run === study.run + 1))
          }
          resultsRefusal={resultsRefusal}
        />
      )}
    </div>
  )
}
