import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import App from './App'
import { AO } from './config/ao'
import { DEFAULT_RECORDING, recordingNamed, type RecordingEntry } from './config/recordings'
import { SCENARIO } from './config/scenario'
import { BRIEF, briefFor } from './config/study'
import { SCENARIO_02A } from './config/scenarios/02a'
import type { SessionState } from './data/useSession'
import type { StudyRun } from './lib/session'
import type { Schedule } from './data/usePlayback'
import type { AdsbCapture } from './lib/adsb'
import { trackIdent } from './lib/display'
import { recordingFeed, scenarioFeed } from './lib/feeds'
import {
  gridTimeline,
  injectTracksAt,
  planScenario as planInjects,
  timelineOf,
} from './lib/injects'
import { addSite, fromConfig, sitePlanText } from './lib/sites'

// Every `terminalIds` the map was handed, in order — the array *identities*, not their contents,
// because the map re-pushes its whole source when that prop changes and the ruling on #61 is that
// it may only change when the set does.
const { terminalIdsSeen } = vi.hoisted(() => ({
  terminalIdsSeen: [] as (readonly string[])[],
}))
// The same for `bands` (#96): the map identities, so a tick with no crossing can be shown to hand
// the map the same map.
const { bandsSeen } = vi.hoisted(() => ({
  bandsSeen: [] as ReadonlyMap<string, string>[],
}))

// The map itself is covered by MapView.test.tsx; here it is stubbed so these tests stay about
// layout, navigation, and what the picture status strip reports.
// Where the stub map's placement click lands (08a); a test sets it before pressing map-place.
const { placeTarget } = vi.hoisted(() => ({
  placeTarget: { center: [-75.3, 39.85] as [number, number] },
}))

vi.mock('./components/MapView', () => ({
  MapView: ({
    sites = [],
    selectedSiteId = null,
    placing = false,
    onPlace,
    tracks,
    injects,
    selectedId,
    selectionShown = true,
    trail = [],
    projection = [],
    projectionEntryS = null,
    terminalIds = [],
    marks = new Map<string, string>(),
    bands = new Map<string, string>(),
    mode = 'vigil',
    onSelect,
    children,
  }: {
    sites?: readonly { id: string }[]
    selectedSiteId?: string | null
    placing?: boolean
    onPlace?: (center: [number, number]) => void
    tracks?: { id: string }[]
    injects?: { id: string }[]
    selectedId?: string | null
    selectionShown?: boolean
    trail?: unknown[]
    projection?: readonly unknown[]
    projectionEntryS?: number | null
    terminalIds?: readonly string[]
    marks?: ReadonlyMap<string, string>
    bands?: ReadonlyMap<string, string>
    mode?: string
    onSelect?: (id: string) => void
    children?: React.ReactNode
  }) => {
    terminalIdsSeen.push(terminalIds as readonly string[])
    bandsSeen.push(bands)
    return (
      <div
        data-testid="map"
        data-tracks={tracks?.length ?? 0}
        data-injects={injects?.length ?? 0}
        data-selected={selectedId ?? ''}
        data-selection-shown={String(selectionShown)}
        data-trail={trail.length}
        data-projection={projection.length}
        data-entry={projectionEntryS ?? ''}
        data-terminal={[...terminalIds].join(',')}
        data-marks={[...marks].map(([id, mark]) => `${id}:${mark}`).join(',')}
        data-bands={[...bands].map(([id, band]) => `${id}:${band}`).join(',')}
        data-sites={sites.map((site) => site.id).join(',')}
        data-selected-site={selectedSiteId ?? ''}
        data-placing={String(placing)}
        data-mode={mode}
      >
        {/* Stands in for a dot click: selects the first inject, like the real map would. */}
        <button
          type="button"
          data-testid="map-select"
          onClick={() => injects?.[0] && onSelect?.(injects[0].id)}
        />
        {/* Stands in for the placement click (08a): reports the test's target position. */}
        <button
          type="button"
          data-testid="map-place"
          onClick={() => onPlace?.(placeTarget.center)}
        />
        {/* The overlays the frame carries — the alert stack (#101) — render as the real map does. */}
        {children}
      </div>
    )
  },
}))

const { useSession, lookupPhoto } = vi.hoisted(() => ({
  useSession: vi.fn(),
  lookupPhoto: vi.fn(),
}))

// The photo lookup is the one runtime network call; stubbed at the module App defaults to, so no
// test here — whichever row it opens — can reach Planespotters. photos.test.ts covers the real one.
vi.mock('./data/photos', () => ({ lookupPhoto }))

// The session is the hook's to build (useSession.test.ts); here it is handed in ready-made, so
// the generator runs for real on the fixture's own frame grid and nothing is fetched.
vi.mock('./data/useSession', () => ({ useSession }))

/** A ready session over one recording feed, the scenario on unless a test says off (#115). */
const ready = (
  capture: AdsbCapture,
  entry: RecordingEntry = DEFAULT_RECORDING,
  scenarioOn = true,
  mode: 'raw' | 'vigil' = 'vigil',
  study: StudyRun | null = null,
): SessionState => ({
  status: 'ready',
  session: {
    feeds: [{ kind: 'recording', id: entry.id }],
    scenario: scenarioOn
      ? { on: true, name: 'default', seed: SCENARIO.seed, runS: 360 }
      : { on: false },
    mode,
    study,
  },
  feeds: [recordingFeed(entry, capture)],
  // Raw's feed runs the rule at raw's distance (S4a); the default deal carries no offset, so
  // the picture is the same one here — the mode is what the shell reads.
  scenario: scenarioOn ? scenarioFeed(timelineOf(capture)) : null,
})

const CAPTURE: AdsbCapture = {
  ao: 'phl',
  source: 'adsb.lol v2',
  capturedAt: '2026-08-29T23:09:25.373Z',
  intervalMs: 15000,
  bbox: AO.bbox,
  frames: [
    {
      tMs: 0,
      records: [
        { hex: 'a06461', callsign: 'AAL423', position: [-75.1, 39.7], groundSpeedKt: 275 },
        { hex: '501267', position: [-75.9, 39.8], groundSpeedKt: 60 },
      ],
    },
  ],
}
const READY = ready(CAPTURE)

// The replay clock never ticks here unless a test drives it: frame 0 stays frame 0 whatever
// the test's wall duration, which is the flake the acceptance on #6 names.
const never: Schedule = () => () => {}

beforeEach(() => {
  useSession.mockReturnValue(READY)
  lookupPhoto.mockReset()
  lookupPhoto.mockResolvedValue(null)
})

describe('App shell', () => {
  it('renders the product name, the AO, and the status strip', () => {
    render(<App schedule={never} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Vigil' })).toBeInTheDocument()
    expect(screen.getByLabelText('Picture status')).toBeInTheDocument()
    expect(screen.getByText(AO.name)).toBeInTheDocument()
    expect(screen.getByTestId('map')).toBeInTheDocument()
  })

  it('states that it is not an operational system', () => {
    render(<App schedule={never} />)
    expect(screen.getByText(/not for operational use/i)).toBeInTheDocument()
  })

  it('opens on Home', () => {
    render(<App schedule={never} />)
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: 'Picture summary' })).toBeInTheDocument()
  })

  it('says the sim clock opens at the recording’s clock start — true under every recording (#36 [14])', () => {
    // From #84 the hour is the recording's, not the scenario's; the body copy says so.
    render(<App schedule={never} />)
    expect(
      screen.getByText(
        /The sim clock opens at the recording’s clock start and ticks with playback\./,
      ),
    ).toBeInTheDocument()
  })

  it('reports the cooperative track count once the recording loads', async () => {
    render(<App schedule={never} />)
    await waitFor(() => expect(screen.getByText('Cooperative').nextSibling).toHaveTextContent('2'))
    expect(screen.getByTestId('map')).toHaveAttribute('data-tracks', '2')
  })

  it('puts injects on the map alongside the cooperative layer', async () => {
    render(<App schedule={never} />)
    const map = screen.getByTestId('map')
    await waitFor(() => expect(Number(map.getAttribute('data-injects'))).toBeGreaterThan(0))
    expect(screen.getByText('Injects').nextSibling).toHaveTextContent(
      map.getAttribute('data-injects') as string,
    )
  })

  it('names the seed, so the picture on screen can be reproduced', () => {
    render(<App schedule={never} />)
    expect(screen.getByText('Seed').nextSibling).toHaveTextContent(SCENARIO.seed)
  })

  it('names the session’s seed under a named scenario, not the config’s (S3b, #135)', () => {
    // The study's link opens 02a: the strip must say study-02a, or the picture cannot be
    // reproduced from what it shows. Before S3b the two seeds were always the same one.
    useSession.mockReturnValue({
      ...ready(CAPTURE),
      session: {
        feeds: [{ kind: 'recording', id: DEFAULT_RECORDING.id }],
        scenario: { on: true, name: '02a', seed: 'study-02a', runS: 360 },
      },
      scenario: scenarioFeed(timelineOf(CAPTURE), SCENARIO_02A),
    })
    render(<App schedule={never} />)
    expect(screen.getByText('Seed').nextSibling).toHaveTextContent('study-02a')
  })

  it('shows the sim clock at the recording’s configured start — the hour the picture is scored at (04a)', () => {
    // Ruled with D2 on #4: the breakdown names a time the strip must not deny. PR 06 makes it tick.
    // From #84 the hour is the recording's; 001 keeps 02:30 by config, for §13.
    render(<App schedule={never} />)
    expect(screen.getByText('Sim clock').nextSibling).toHaveTextContent('02:30:00')
  })

  it('names the loaded recording and its capture date beside the seed (#84)', () => {
    render(<App schedule={never} />)
    // 001's own date, in the AO's zone, beside its configured clock — the date is provenance.
    expect(screen.getByText('Recording').nextSibling).toHaveTextContent(
      'vigil-phl-001 · 2026-08-29',
    )
    expect(screen.getByText('Seed').nextSibling).toHaveTextContent(SCENARIO.seed)
  })

  // R4 on #84: a recording whose clock is 'captured' opens at its capture wall time in the AO's
  // zone, and the off-hours factor reads it — 22:02Z on 4 September is 18:02 in Philadelphia,
  // inside operating hours, where 001's 02:30 is not.
  it('opens a captured-clock recording at its wall time, inside operating hours (#84)', () => {
    useSession.mockReturnValue(
      ready(
        { ...CAPTURE, capturedAt: '2026-09-04T22:02:11.000Z' },
        recordingNamed('vigil-phl-002'),
      ),
    )
    render(<App schedule={never} />)
    expect(screen.getByText('Recording').nextSibling).toHaveTextContent(
      'vigil-phl-002 · 2026-09-04',
    )
    expect(screen.getByText('Sim clock').nextSibling).toHaveTextContent('18:02:00')
    expect(screen.getByText('Seed').nextSibling).toHaveTextContent(SCENARIO.seed)
    // And the scorer agrees with the strip (#98 review): no inject row is tagged off-hours, and
    // the breakdown's Off-hours row reads the same hour, inside the window, at 0.
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'INJECT' }))
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    const rows = within(queue).getAllByRole('listitem')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows)
      expect(row.querySelector('.queue__reason')).not.toHaveTextContent('off-hours')
    fireEvent.click(within(rows[0]).getByRole('button'))
    expect(screen.getByText('18:02 local — within 06:00–22:00')).toBeInTheDocument()
  })

  it('holds the Recording field back with the counts until the recording is in (#84)', () => {
    useSession.mockReturnValue({ status: 'loading' })
    render(<App schedule={never} />)
    expect(screen.getByText('Recording').nextSibling).toHaveTextContent('…')
    expect(screen.getByText('Sim clock').nextSibling).toHaveTextContent('…')
  })

  it('scores every row, with the ADS-B block held under the ceiling (04a)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const rows = within(screen.getByRole('list', { name: 'Ranked queue' })).getAllByRole('listitem')
    const chips = rows.map((row) => Number(row.querySelector('.queue__score')?.textContent))
    expect(chips.every((chip) => Number.isInteger(chip) && chip >= 0 && chip <= 100)).toBe(true)
    // Ranked by score: the chips never climb down the list.
    expect(chips).toEqual([...chips].sort((a, b) => b - a))
    for (const row of rows) {
      if (within(row).queryByText('ADS-B')) {
        expect(Number(row.querySelector('.queue__score')?.textContent)).toBeLessThanOrEqual(30)
        // The warm bands are a score's to earn, and no real aircraft can (§2, 04b).
        expect(row.querySelector('.queue__score')).toHaveAttribute('data-band', 'calm')
      }
    }
  })

  it('opens a row to its breakdown in the drawer, header and bars agreeing with the chip (04b)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    const firstRow = within(queue).getAllByRole('listitem')[0]
    const chip = firstRow.querySelector('.queue__score') as HTMLElement
    fireEvent.click(within(firstRow).getByRole('button'))
    const breakdown = screen.getByLabelText('Score breakdown')
    expect(within(breakdown).getByText(`Score ${chip.textContent}`)).toBeInTheDocument()
    expect(breakdown).toHaveAttribute('data-band', chip.getAttribute('data-band'))
    expect(within(breakdown).getAllByRole('meter')).toHaveLength(6)
  })

  it('ranks both layers into one queue on the Queue surface', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    const rows = within(queue).getAllByRole('listitem')
    const injectCount = Number(screen.getByTestId('map').getAttribute('data-injects'))
    expect(rows).toHaveLength(2 + injectCount)
    expect(screen.getByLabelText('Tracks in queue')).toHaveTextContent(String(2 + injectCount))
    // Identity leads: every non-cooperative inject sits above every ADS-B track.
    const badges = rows.map((row) => within(row).getByText(/^(INJECT|ADS-B)$/).textContent)
    const lastNonCoop = rows.findLastIndex((row) => row.textContent?.includes('Non-cooperative'))
    expect(lastNonCoop).toBeGreaterThan(0)
    expect(badges.slice(0, lastNonCoop + 1).every((badge) => badge === 'INJECT')).toBe(true)
    expect(within(rows[0]).getByText(/^TRK-\d\d$/)).toBeInTheDocument()
  })

  it('shows the Queue only on the Queue surface', () => {
    render(<App schedule={never} />)
    expect(screen.queryByRole('list', { name: 'Ranked queue' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    expect(screen.getByRole('list', { name: 'Ranked queue' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Home' }))
    expect(screen.queryByRole('list', { name: 'Ranked queue' })).not.toBeInTheDocument()
  })

  it('holds the count back while the recording is still loading', () => {
    useSession.mockReturnValue({ status: 'loading' })
    render(<App schedule={never} />)
    expect(screen.getByText('Cooperative').nextSibling).toHaveTextContent('…')
    // The seed too: no scenario is in force until the session is (#145 round 2).
    expect(screen.getByText('Seed').nextSibling).toHaveTextContent('…')
    expect(screen.getByTestId('map')).toHaveAttribute('data-tracks', '0')
  })

  // An airspace picture that cannot load its traffic has to say so, not show a plausible empty map.
  it('surfaces a load failure instead of rendering an empty picture silently', () => {
    useSession.mockReturnValue({ status: 'error', message: 'could not load the ADS-B recording' })
    render(<App schedule={never} />)
    expect(screen.getByRole('alert')).toHaveTextContent('could not load the ADS-B recording')
    expect(screen.getByText('Cooperative').nextSibling).toHaveTextContent('—')
  })

  // A session the URL could not make is refused in its own words (#115, ruling 4; A7): on the
  // rail in 09a, where a load failure prints, and nothing is fetched or scored.
  it('surfaces a refused session with its reason, and holds every count back', () => {
    useSession.mockReturnValue({
      status: 'refused',
      reason: 'Feed "sonar:1" — unknown feed kind "sonar"',
    })
    render(<App schedule={never} />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Feed "sonar:1" — unknown feed kind "sonar"',
    )
    expect(screen.getByText('Cooperative').nextSibling).toHaveTextContent('—')
    expect(screen.getByText('Injects').nextSibling).toHaveTextContent('—')
    expect(screen.getByText('Recording').nextSibling).toHaveTextContent('—')
    expect(screen.getByText('Seed').nextSibling).toHaveTextContent('—')
    expect(screen.getByTestId('map')).toHaveAttribute('data-tracks', '0')
  })

  // The scenario off (#115, ruling 1): the recording alone — no inject in the picture, on the
  // map, or in the Queue, and the Injects count reads 0 (A10). The recording is untouched.
  it('shows the recording alone with the scenario off, counting zero injects', () => {
    useSession.mockReturnValue(ready(CAPTURE, DEFAULT_RECORDING, false))
    render(<App schedule={never} />)
    expect(screen.getByText('Cooperative').nextSibling).toHaveTextContent('2')
    expect(screen.getByText('Injects').nextSibling).toHaveTextContent('0')
    // No scenario, no seed to reproduce it from: a dash, not the config's (#145 round 2).
    expect(screen.getByText('Seed').nextSibling).toHaveTextContent('—')
    expect(screen.getByTestId('map')).toHaveAttribute('data-injects', '0')
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const rows = within(screen.getByRole('list', { name: 'Ranked queue' })).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => within(row).queryByText('INJECT') === null)).toBe(true)
  })

  it('opens the drawer beside the list from a row click, and closes it (03a)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    const firstRow = within(queue).getAllByRole('listitem')[0]
    fireEvent.click(within(firstRow).getByRole('button'))

    const drawer = screen.getByLabelText(/^Track review: /)
    expect(drawer).toBeInTheDocument()
    // The list stays on screen while reviewing (§4.2) — three columns, not a swap.
    expect(screen.getByRole('list', { name: 'Ranked queue' })).toBeInTheDocument()
    expect(document.querySelector('.shell__body--drawer')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Close review' }))
    expect(screen.queryByLabelText(/^Track review: /)).not.toBeInTheDocument()
    expect(document.querySelector('.shell__body--drawer')).toBeNull()
  })

  it('shows the drawer alone on Review, and an empty state without a selection (03a)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByText('Select a track from the Queue.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    fireEvent.click(within(within(queue).getAllByRole('listitem')[0]).getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByLabelText(/^Track review: /)).toBeInTheDocument()
    expect(screen.queryByText('Select a track from the Queue.')).not.toBeInTheDocument()
    // Selection persisted across the surface switch — client state only.
    expect(screen.queryByRole('list', { name: 'Ranked queue' })).not.toBeInTheDocument()
  })

  it('lands focus on the Review nav item when the drawer closes on Review, not on body (#46)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    fireEvent.click(within(within(queue).getAllByRole('listitem')[0]).getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))

    // A keyboard operator has the close button focused when they activate it; the Queue's
    // row-focus return is unmounted here, so without #46 the unmount drops them on body.
    const close = screen.getByRole('button', { name: 'Close review' })
    close.focus()
    fireEvent.click(close)
    expect(screen.queryByLabelText(/^Track review: /)).not.toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Review' }))
    expect(document.activeElement).not.toBe(document.body)
  })

  it('leaves a mouse-driven close on Review alone — no focus jump to the header (#53 review)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    fireEvent.click(within(within(queue).getAllByRole('listitem')[0]).getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    // A mouse click carries a positive detail; the drawer's own recovery skips it for the same
    // reason (03b round 6) — a pointer user parked on the nav button would Space-activate it.
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }), { detail: 1 })
    expect(screen.queryByLabelText(/^Track review: /)).not.toBeInTheDocument()
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Review' }))
  })

  it('sends a mouse-driven close on the Queue surface to the list, not the row (#54)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    const row = within(within(queue).getAllByRole('listitem')[0]).getByRole('button')
    fireEvent.click(row, { detail: 1 })
    // Same gate as Review and the drawer: a positive detail is a pointer, and a pointer user
    // parked on the row would have Space re-select the track instead of scrolling the list.
    // The list itself is safe to land on, and keeps the operator's place (#56 review).
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }), { detail: 1 })
    expect(screen.queryByLabelText(/^Track review: /)).not.toBeInTheDocument()
    expect(document.activeElement).not.toBe(row)
    expect(document.activeElement).toBe(queue)
  })

  it('keeps the Queue-surface close returning focus to the row, as 03a built it (#46)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    const row = within(within(queue).getAllByRole('listitem')[0]).getByRole('button')
    fireEvent.click(row)
    const close = screen.getByRole('button', { name: 'Close review' })
    close.focus()
    fireEvent.click(close)
    expect(document.activeElement).toBe(row)
  })

  it('selects from the map side and syncs the row (03a)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByTestId('map-select'))
    expect(screen.getByLabelText(/^Track review: /)).toBeInTheDocument()
    const selected = document.querySelector('.queue__row--selected')
    expect(selected).not.toBeNull()
    expect(screen.getByTestId('map').getAttribute('data-selected')).toBe(
      selected?.getAttribute('data-id'),
    )
  })

  it('lands a Home-surface map selection on the Queue, where it can be reviewed and cleared (03a)', () => {
    render(<App schedule={never} />)
    // Home has no drawer and no close button; a selection made there must not strand the user.
    fireEvent.click(screen.getByTestId('map-select'))
    expect(screen.getByRole('button', { name: 'Queue' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByLabelText(/^Track review: /)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }))
    expect(screen.queryByLabelText(/^Track review: /)).not.toBeInTheDocument()
  })

  it('filters by layer without renumbering the ranks (03a)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const injectCount = Number(screen.getByTestId('map').getAttribute('data-injects'))

    // On this picture every inject outranks the two distant ADS-B tracks, so the ADS-B filter is
    // the one that exposes renumbering: global ranks read 7 and 8, renumbered ones would read 1
    // and 2.
    fireEvent.click(screen.getByRole('button', { name: 'ADS-B' }))
    let rows = within(screen.getByRole('list', { name: 'Ranked queue' })).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(screen.getByLabelText('Tracks in queue')).toHaveTextContent('2')
    for (const row of rows) expect(within(row).queryByText('INJECT')).not.toBeInTheDocument()
    const ranks = rows.map((row) => Number(row.querySelector('.queue__rank')?.textContent))
    expect(ranks.every((rank) => rank > injectCount)).toBe(true)

    // Two chip rows both carry an "All" — scope to the layer group (03b added the state row).
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Filter by layer' })).getByRole('button', {
        name: 'All',
      }),
    )
    rows = within(screen.getByRole('list', { name: 'Ranked queue' })).getAllByRole('listitem')
    expect(rows).toHaveLength(2 + injectCount)
  })

  it('walks the full lifecycle New → Assessing → Escalated → Resolved in the drawer (03b)', () => {
    render(<App schedule={never} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    fireEvent.click(within(within(queue).getAllByRole('listitem')[0]).getByRole('button'))
    const drawer = () => screen.getByLabelText(/^Track review: /)
    const status = () => within(drawer()).getByText('Status').parentElement as HTMLElement

    // Every track opened its log as New, with the injected clock in the first-seen entry.
    expect(within(status()).getByText('New')).toBeInTheDocument()
    expect(within(drawer()).getByText('New — first seen')).toBeInTheDocument()
    expect(within(drawer()).getByText('02:30:00')).toBeInTheDocument()

    fireEvent.click(within(drawer()).getByRole('button', { name: 'Assess' }))
    expect(within(status()).getByText('Assessing')).toBeInTheDocument()

    fireEvent.click(within(drawer()).getByRole('button', { name: 'Escalate' }))
    fireEvent.click(within(drawer()).getByRole('radio', { name: 'PHL Tower' }))
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Confirm escalation' }))
    expect(within(status()).getByText('Escalated')).toBeInTheDocument()
    const handoff = within(drawer()).getByLabelText('Handoff text') as HTMLTextAreaElement
    expect(handoff.value).toContain('To: PHL Tower')

    fireEvent.click(within(drawer()).getByRole('button', { name: 'Resolve' }))
    fireEvent.click(within(drawer()).getByRole('radio', { name: 'Benign' }))
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Confirm resolution' }))
    expect(within(status()).getByText('Resolved')).toBeInTheDocument()
    // Terminal: the vocabulary stays visible, nothing stays legal.
    for (const name of ['Assess', 'Escalate', 'Dismiss', 'Resolve'])
      expect(within(drawer()).getByRole('button', { name })).toBeDisabled()
    // The record kept every step, oldest first.
    const lines = within(within(drawer()).getByLabelText('Event log')).getAllByRole('listitem')
    expect(lines.map((line) => line.textContent?.slice(8))).toEqual([
      'New — first seen',
      'Assessing — claimed',
      'Escalated — to PHL Tower',
      'Resolved — Benign',
    ])
  })

  it('stamps first sight once, not per render or per tick (03b review fix, 06a)', () => {
    // The default `now` prop is a fresh function identity each render, so first-seen must not
    // ride a memo keyed on it — and the replay clock must not restamp it either: a track first
    // seen at 02:30:00 keeps that mark after the clock has moved.
    useSession.mockReturnValue(MOVING)
    const replay = manualClock()
    const { rerender } = render(
      <App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    replay.tick(10)
    rerender(<App schedule={replay.schedule} now={() => '2026-09-01T13:00:00.000Z'} />)
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    fireEvent.click(within(within(queue).getAllByRole('listitem')[0]).getByRole('button'))
    const log = within(screen.getByLabelText('Event log'))
    expect(log.getByText('02:30:00')).toBeInTheDocument()
    expect(log.queryByText('02:30:10')).not.toBeInTheDocument()
  })

  it('filters by state with global ranks kept, composing with the layer filter (03b)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const queue = () => screen.getByRole('list', { name: 'Ranked queue' })
    const total = within(queue()).getAllByRole('listitem').length

    // Dismiss the top-ranked track, then filter to Dismissed: one row, still wearing rank 1.
    fireEvent.click(within(within(queue()).getAllByRole('listitem')[0]).getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    const stateChips = screen.getByRole('group', { name: 'Filter by state' })
    fireEvent.click(within(stateChips).getByRole('button', { name: 'Dismissed' }))
    let rows = within(queue()).getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(rows[0].querySelector('.queue__rank')?.textContent).toBe('1')
    expect(screen.getByLabelText('Tracks in queue')).toHaveTextContent('1')

    // The rest read New; the two rows compose — New ∧ ADS-B leaves only the recorded layer.
    fireEvent.click(within(stateChips).getByRole('button', { name: 'New' }))
    expect(within(queue()).getAllByRole('listitem')).toHaveLength(total - 1)
    const layerChips = screen.getByRole('group', { name: 'Filter by layer' })
    fireEvent.click(within(layerChips).getByRole('button', { name: 'ADS-B' }))
    rows = within(queue()).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(within(row).queryByText('INJECT')).not.toBeInTheDocument()
  })

  it('shows lifecycle state on the row, and Active as the non-terminal set with global ranks (03e)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const queue = () => screen.getByRole('list', { name: 'Ranked queue' })
    const rows = () => within(queue()).getAllByRole('listitem')
    const total = rows().length
    const stateChips = screen.getByRole('group', { name: 'Filter by state' })
    const rank = (row: HTMLElement) => row.querySelector('.queue__rank')?.textContent

    // A fresh picture is all New: no tag anywhere, nothing dimmed, and Active shows everything.
    expect(queue().querySelector('.queue__badge--state')).toBeNull()
    expect(queue().querySelector('.queue__row--terminal')).toBeNull()
    fireEvent.click(within(stateChips).getByRole('button', { name: 'Active' }))
    expect(rows()).toHaveLength(total)

    // Claim the second-ranked track and dismiss the first. Under All both keep their places:
    // the claimed one tagged, the dismissed one tagged and dimmed, rank 1 still on it.
    fireEvent.click(within(rows()[1]).getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: 'Assess' }))
    fireEvent.click(within(rows()[0]).getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    fireEvent.click(within(stateChips).getByRole('button', { name: 'All' }))
    expect(rows()).toHaveLength(total)
    expect(rows()[0]).toHaveClass('queue__row--terminal')
    expect(within(rows()[0]).getByText('Dismissed')).toHaveClass('queue__badge--state')
    expect(rank(rows()[0])).toBe('1')
    expect(rows()[1]).not.toHaveClass('queue__row--terminal')
    expect(within(rows()[1]).getByText('Assessing')).toHaveClass('queue__badge--state')

    // Active drops the dismissed row and nothing else; the list now starts at rank 2, and the
    // count follows. It composes with the layer row like every other state chip.
    fireEvent.click(within(stateChips).getByRole('button', { name: 'Active' }))
    expect(rows()).toHaveLength(total - 1)
    expect(rank(rows()[0])).toBe('2')
    expect(screen.getByLabelText('Tracks in queue')).toHaveTextContent(String(total - 1))
    const layerChips = screen.getByRole('group', { name: 'Filter by layer' })
    fireEvent.click(within(layerChips).getByRole('button', { name: 'ADS-B' }))
    expect(rows()).toHaveLength(2)
    for (const row of rows()) expect(within(row).queryByText('INJECT')).not.toBeInTheDocument()
  })

  it('says when no track matches the filters, but not while the picture is loading (#49)', () => {
    const { rerender } = render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    // The live region is there from the moment the Queue is, empty: a region that appears in the
    // same commit as its text is one some screen readers never announce (#51 review).
    const region = () => screen.getByRole('status')
    expect(region()).toBeEmptyDOMElement()

    // Nothing is escalated on a fresh picture, so the Escalated chip is the first legitimately
    // empty list: the count reads 0, and the line says why — to the operator who pressed it.
    const stateChips = screen.getByRole('group', { name: 'Filter by state' })
    fireEvent.click(within(stateChips).getByRole('button', { name: 'Escalated' }))
    expect(
      within(screen.getByRole('list', { name: 'Ranked queue' })).queryAllByRole('listitem'),
    ).toHaveLength(0)
    expect(screen.getByLabelText('Tracks in queue')).toHaveTextContent('0')
    expect(region()).toHaveTextContent('No tracks match the filters.')

    // The filters persist across surfaces, so a round trip through Home must land back on the
    // *same* region, refilled — not a fresh one born with its text (#51 review, round 3).
    const node = region()
    fireEvent.click(screen.getByRole('button', { name: 'Home' }))
    expect(region()).toBe(node)
    expect(region()).toBeEmptyDOMElement()
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    expect(region()).toBe(node)
    expect(region()).toHaveTextContent('No tracks match the filters.')

    // The chip row did remount on that trip; the region is the only thing that must not have.
    const chipsAgain = screen.getByRole('group', { name: 'Filter by state' })
    fireEvent.click(within(chipsAgain).getByRole('button', { name: 'All' }))
    expect(region()).toBeEmptyDOMElement()

    // An empty list with no recording behind it is not a filter result: nothing while loading,
    // nothing on a load failure — the error already says what happened.
    useSession.mockReturnValue({ status: 'loading' })
    rerender(<App schedule={never} />)
    expect(region()).toBeEmptyDOMElement()
    useSession.mockReturnValue({ status: 'error', message: 'Could not load the recording.' })
    rerender(<App schedule={never} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(region()).toBeEmptyDOMElement()
  })

  it('keeps the selection but not the ring on Home (03b, ruled A2 on #3)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByTestId('map-select'))
    const selected = screen.getByTestId('map').getAttribute('data-selected')
    expect(selected).not.toBe('')
    expect(screen.getByTestId('map').getAttribute('data-selection-shown')).toBe('true')

    // Home: the ring is suppressed as presentation, but the selection itself still reaches the
    // map — nulling it instead would reset the ease stamp and re-fly the camera (#47 review).
    fireEvent.click(screen.getByRole('button', { name: 'Home' }))
    expect(screen.getByTestId('map').getAttribute('data-selected')).toBe(selected)
    expect(screen.getByTestId('map').getAttribute('data-selection-shown')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    expect(screen.getByTestId('map').getAttribute('data-selection-shown')).toBe('true')
    expect(screen.getByLabelText(/^Track review: /)).toBeInTheDocument()
  })

  it('chains actions batched into one commit instead of overwriting (03b review fix)', () => {
    render(<App schedule={never} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    fireEvent.click(within(within(queue).getAllByRole('listitem')[0]).getByRole('button'))
    const drawer = screen.getByLabelText(/^Track review: /)
    const assess = within(drawer).getByRole('button', { name: 'Assess' })
    const dismiss = within(drawer).getByRole('button', { name: 'Dismiss' })
    // Both clicks land in one React commit: the second updater must see the first's event, so
    // the log chains New → Assessing → Dismissed rather than losing the claim (#47 review).
    act(() => {
      assess.click()
      dismiss.click()
    })
    const lines = within(within(drawer).getByLabelText('Event log')).getAllByRole('listitem')
    expect(lines.map((line) => line.textContent?.slice(8))).toEqual([
      'New — first seen',
      'Assessing — claimed',
      'Dismissed',
    ])
  })

  it('renders the Review surface at the drawer column width (03b, ruled B1 on #3)', () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(document.querySelector('.shell__body--review')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Home' }))
    expect(document.querySelector('.shell__body--review')).toBeNull()
  })

  it('switches surfaces without unmounting the map', () => {
    render(<App schedule={never} />)
    const map = screen.getByTestId('map')

    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    expect(screen.getByRole('heading', { name: 'Ranked queue' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Queue' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current')

    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByRole('heading', { name: 'Track review' })).toBeInTheDocument()

    expect(screen.getByTestId('map')).toBe(map)
  })

  it('looks up the photo for the opened ADS-B track, and shows it credited in the drawer (03d)', async () => {
    lookupPhoto.mockResolvedValue({
      src: 'https://t.plnspttrs.net/1/1_t.jpg',
      width: 200,
      height: 133,
      link: 'https://www.planespotters.net/photo/1/n123?utm_source=api',
      photographer: 'Tester',
    })
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'ADS-B' }))
    const queue = screen.getByRole('list', { name: 'Ranked queue' })
    fireEvent.click(within(within(queue).getAllByRole('listitem')[0]).getByRole('button'))
    // The nearer of the two ADS-B tracks ranks first; the lookup gets that track, once.
    expect(lookupPhoto).toHaveBeenCalledTimes(1)
    expect(lookupPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'adsb', icaoHex: 'a06461' }),
    )
    const link = await screen.findByRole('link', { name: '© Tester · Planespotters.net' })
    expect(link).toHaveAttribute(
      'href',
      'https://www.planespotters.net/photo/1/n123?utm_source=api',
    )
    // Nowhere else: the Queue row never shows a photo, a credit, or a link (§2).
    expect(within(queue).queryByRole('link')).not.toBeInTheDocument()
  })

  it('never looks up a photo for an inject (03d)', async () => {
    render(<App schedule={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByTestId('map-select'))
    expect(screen.getByLabelText(/^Track review: /)).toBeInTheDocument()
    await act(async () => {})
    expect(lookupPhoto).not.toHaveBeenCalled()
  })
})

/**
 * A scheduler the test drives by hand: `tick()` is the replay clock. Nothing here waits on real
 * time, which is the flake the acceptance on #6 names.
 */
function manualClock() {
  let pending: (() => void) | null = null
  const schedule: Schedule = (tick) => {
    pending = tick
    return () => {
      pending = null
    }
  }
  return { schedule, tick: (n = 1) => act(() => void [...Array(n)].forEach(() => pending?.())) }
}

/**
 * Eight frames at 15 s. `a06461` starts inside the site's ring and flies east at 250 kt, so its
 * range — and its uncapped score, which orders the ADS-B block under the ceiling — changes every
 * tick; `501267` sits parked at 1.5 radii. `bbbbbb` is heard only at frame 0 and coasts out;
 * `cccccc` appears at frame 2 (30 s); `dddddd` is heard at frames 0 and 7 (105 s) — a hole wider
 * than the coast, so it leaves the picture at 91 s and is back at 105 s, further out and slower.
 */
const MOVING = ready({
  ao: 'phl',
  source: 'adsb.lol v2',
  capturedAt: '2026-08-29T23:09:25.373Z',
  intervalMs: 15000,
  bbox: AO.bbox,
  frames: [...Array(8)].map((_, i) => ({
    tMs: i * 15000,
    records: [
      {
        hex: 'a06461',
        callsign: 'AAL423',
        position: [-75.23 + i * 0.03, 39.88] as [number, number],
        altitudeFt: 3000,
        groundSpeedKt: 250,
        headingDeg: 90,
      },
      { hex: '501267', position: [-75.2411, 39.9396] as [number, number], groundSpeedKt: 60 },
      ...(i === 0
        ? [{ hex: 'bbbbbb', position: [-75.3, 39.85] as [number, number], groundSpeedKt: 90 }]
        : []),
      ...(i >= 2
        ? [{ hex: 'cccccc', position: [-75.4, 39.95] as [number, number], groundSpeedKt: 120 }]
        : []),
      ...(i === 0
        ? [{ hex: 'dddddd', position: [-75.25, 39.87] as [number, number], groundSpeedKt: 100 }]
        : i === 7
          ? [{ hex: 'dddddd', position: [-75.5, 40.0] as [number, number], groundSpeedKt: 40 }]
          : []),
    ],
  })),
})

describe('App replay clock (06a)', () => {
  const clock = () => screen.getByText('Sim clock').nextSibling as HTMLElement
  const rows = () =>
    within(screen.getByRole('list', { name: 'Ranked queue' })).getAllByRole('listitem')
  const idents = () => rows().map((row) => row.querySelector('.queue__ident')?.textContent)

  it('ticks the sim clock one second at a time from the scenario start, and shows the position', () => {
    useSession.mockReturnValue(MOVING)
    const replay = manualClock()
    render(<App schedule={replay.schedule} />)
    expect(clock()).toHaveTextContent('02:30:00')
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled()
    replay.tick(67)
    expect(clock()).toHaveTextContent('02:31:07')
    expect(screen.getByText('01:07 / 01:45')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Seek' })).toHaveValue('67')
  })

  it('re-ranks the Queue live as the picture plays', () => {
    useSession.mockReturnValue(MOVING)
    const replay = manualClock()
    render(<App schedule={replay.schedule} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'ADS-B' }))
    // AAL423 starts inside the ring and ranks above the parked track.
    const before = idents()
    expect(before.indexOf('AAL423')).toBeLessThan(before.indexOf('501267'))
    replay.tick(105)
    // Seven samples later it is 18 km out, past the proximity roll-off; the parked track leads.
    const after = idents()
    expect(after.indexOf('501267')).toBeLessThan(after.indexOf('AAL423'))
    expect(after).not.toEqual(before)
  })

  it('freezes the picture on Pause and moves it on Seek', () => {
    useSession.mockReturnValue(MOVING)
    const replay = manualClock()
    render(<App schedule={replay.schedule} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    replay.tick(10)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    const frozen = document.querySelector('.queue')?.textContent
    replay.tick(10)
    expect(clock()).toHaveTextContent('02:30:10')
    expect(document.querySelector('.queue')?.textContent).toBe(frozen)
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '90' } })
    expect(clock()).toHaveTextContent('02:31:30')
    expect(document.querySelector('.queue')?.textContent).not.toBe(frozen)
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
  })

  it('reads the selected track’s time to entry in the drawer and hands the map its path, following the clock (#102)', () => {
    useSession.mockReturnValue(LONG)
    const replay = manualClock()
    render(<App schedule={replay.schedule} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    // 02:37:00: TRK-05 is 6.0 km out, closing at 19.1 kt on 346° — the gate's own numbers.
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '420' } })
    fireEvent.click(document.querySelector('[data-id="inject-05"] button') as HTMLElement)
    const drawer = screen.getByLabelText('Track review: TRK-05')
    const value = () => within(drawer).getByText('Entry').nextElementSibling
    expect(value()).toHaveTextContent('108 s to PHL Airfield · tier 1')
    expect(screen.getByTestId('map')).toHaveAttribute('data-projection', '2')
    // The map's reading at the path's end is the row's own seconds (S10, #182): one function.
    expect(Number(screen.getByTestId('map').getAttribute('data-entry'))).toBeCloseTo(108, 0)
    // 02:39:00: inside the ring — the value follows the clock and the path is gone.
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '540' } })
    expect(value()).toHaveTextContent('Inside — PHL Airfield · tier 1')
    expect(screen.getByTestId('map')).toHaveAttribute('data-projection', '0')
    expect(screen.getByTestId('map')).toHaveAttribute('data-entry', '')
    // Scrubbed back, the same instant reads the same number: derived from the picture, no state.
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '420' } })
    expect(value()).toHaveTextContent('108 s to PHL Airfield · tier 1')
  })

  it('opens a track’s log when it first appears on the clock, not back-stamped to app start', () => {
    useSession.mockReturnValue(MOVING)
    const replay = manualClock()
    let wall = '2026-09-01T12:04:31.000Z'
    render(<App schedule={replay.schedule} now={() => wall} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'ADS-B' }))
    expect(idents()).not.toContain('cccccc')
    wall = '2026-09-01T12:05:01.000Z'
    replay.tick(30)
    const row = rows().find((r) => within(r).queryByText('cccccc'))
    expect(row).toBeDefined()
    fireEvent.click(within(row as HTMLElement).getByRole('button'))
    // The record reads in sim time (06b): opened at the tick it appeared, not at the start.
    const log = within(screen.getByLabelText('Event log'))
    expect(log.getByText('02:30:30')).toBeInTheDocument()
    expect(log.queryByText('02:30:00')).not.toBeInTheDocument()
  })

  it('drops a coasted track from the Queue and closes its drawer, keeping its log', () => {
    useSession.mockReturnValue(MOVING)
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'ADS-B' }))
    const row = rows().find((r) => within(r).queryByText('bbbbbb')) as HTMLElement
    fireEvent.click(within(row).getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: 'Assess' }))
    expect(screen.getByLabelText('Track review: bbbbbb')).toBeInTheDocument()
    // Heard only at frame 0: held through the 90 s coast, gone after it.
    replay.tick(90)
    expect(idents()).toContain('bbbbbb')
    expect(screen.getByText('Seen').nextSibling).toHaveTextContent('90 s ago')
    replay.tick(1)
    expect(idents()).not.toContain('bbbbbb')
    expect(screen.queryByLabelText(/^Track review: /)).not.toBeInTheDocument()
    // The operator's focus was on the drawer; the picture took it away, and it must land on the
    // list, not on document.body (#73 review).
    expect(document.activeElement).toBe(screen.getByRole('list', { name: 'Ranked queue' }))
    // The record survives the picture: seek back and the claim is still on it.
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '0' } })
    fireEvent.click(
      within(rows().find((r) => within(r).queryByText('bbbbbb')) as HTMLElement).getByRole(
        'button',
      ),
    )
    expect(
      within(screen.getByText('Status').parentElement as HTMLElement).getByText('Assessing'),
    ).toBeInTheDocument()
  })

  it('logs Lost at the tick a claimed track coasts out, status carried (ruled on #71)', () => {
    useSession.mockReturnValue(MOVING)
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'ADS-B' }))
    const open = (ident: string) =>
      fireEvent.click(
        within(rows().find((r) => within(r).queryByText(ident)) as HTMLElement).getByRole('button'),
      )
    open('bbbbbb')
    fireEvent.click(screen.getByRole('button', { name: 'Assess' }))
    // Two commits, as play makes them: held at the coast's edge, then gone. The held snapshot
    // the Lost line carries has no reader on screen — the handoff freezes at escalation — so
    // what it holds is pinned in lifecycle.test; here the line, its tick, and the status are.
    replay.tick(90)
    expect(idents()).toContain('bbbbbb')
    replay.tick(1)
    expect(idents()).not.toContain('bbbbbb')
    // Rewound to before the loss, the record still holds it: Lost at the tick it left, the
    // status carried, and no Regained — the clock is behind the frontier.
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '0' } })
    open('bbbbbb')
    const log = within(screen.getByLabelText('Event log'))
    const lines = log.getAllByRole('listitem').map((li) => li.textContent)
    expect(lines).toEqual([
      '02:30:00New — first seen',
      '02:30:00Assessing — claimed',
      '02:31:31Lost — last heard 02:30:00',
    ])
    expect(
      within(screen.getByText('Status').parentElement as HTMLElement).getByText('Assessing'),
    ).toBeInTheDocument()
  })

  it('logs Regained when a lost track is heard again; a rewind before first sight logs nothing (ruled on #71)', () => {
    useSession.mockReturnValue(MOVING)
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'ADS-B' }))
    const open = (ident: string) =>
      fireEvent.click(
        within(rows().find((r) => within(r).queryByText(ident)) as HTMLElement).getByRole('button'),
      )
    const lines = () =>
      within(screen.getByLabelText('Event log'))
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    // `cccccc` opens at 30 s; seek to 0 and it is absent, but its record is ahead of the clock.
    replay.tick(30)
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '0' } })
    expect(idents()).not.toContain('cccccc')
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '30' } })
    open('cccccc')
    expect(lines()).toEqual(['02:30:30New — first seen'])
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }))
    // `dddddd` leaves at 91 s and is back at 105 s. A real aircraft sits under the ceiling, so
    // no band moves across the hole here; the chain behind Regained is pinned in lifecycle.test.
    // Ticks inside one act() batch to a single render, so the clock is stepped to the tick it
    // leaves on, then to the one it returns on.
    replay.tick(61)
    expect(idents()).not.toContain('dddddd')
    replay.tick(14)
    open('dddddd')
    expect(lines()).toEqual([
      '02:30:00New — first seen',
      '02:31:31Lost — last heard 02:30:00',
      '02:31:45Regained',
    ])
  })

  it('lands focus on the Review nav item when the picture takes the reviewed track away (#73 review)', () => {
    useSession.mockReturnValue(MOVING)
    const replay = manualClock()
    render(<App schedule={replay.schedule} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'ADS-B' }))
    fireEvent.click(
      within(rows().find((r) => within(r).queryByText('bbbbbb')) as HTMLElement).getByRole(
        'button',
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    // A keyboard operator mid-walk: focus is on a drawer button when the track coasts out.
    screen.getByRole('button', { name: 'Assess' }).focus()
    replay.tick(91)
    expect(screen.queryByLabelText(/^Track review: /)).not.toBeInTheDocument()
    expect(screen.getByText('Select a track from the Queue.')).toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Review' }))
  })
})

/** The full recording's length with one parked aircraft, so the injects run their whole script. */
const LONG = ready({
  ao: 'phl',
  source: 'adsb.lol v2',
  capturedAt: '2026-08-29T23:09:25.373Z',
  intervalMs: 15000,
  bbox: AO.bbox,
  frames: [...Array(80)].map((_, i) => ({
    tMs: i * 15000,
    records: [
      { hex: '501267', position: [-75.2411, 39.9396] as [number, number], groundSpeedKt: 60 },
    ],
  })),
})

describe('App record under the clock (06b)', () => {
  const rows = () =>
    within(screen.getByRole('list', { name: 'Ranked queue' })).getAllByRole('listitem')
  const logLines = () =>
    within(screen.getByLabelText('Event log'))
      .getAllByRole('listitem')
      .map((line) => line.textContent ?? '')
  const handoff = () => (screen.getByLabelText('Handoff text') as HTMLTextAreaElement).value

  it('logs band crossings at sim time as the picture plays — in the log and the handoff timeline', () => {
    useSession.mockReturnValue(LONG)
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'INJECT' }))
    // Twenty minutes in one seek: at most one crossing per band change the record last saw.
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '1185' } })
    let crossed: string[] | null = null
    for (const row of rows()) {
      fireEvent.click(within(row).getByRole('button'))
      const lines = logLines()
      if (lines.some((line) => / — (up|down) from /.test(line))) {
        crossed = lines
        break
      }
    }
    expect(crossed).not.toBeNull()
    const crossing = crossed!.find((line) => / — (up|down) from /.test(line))!
    // Sim time, then the band entered and the one left, in the one table's words (#66).
    expect(crossing).toMatch(
      /^02:[3-5]\d:\d\d(Caution|Warning|Calm) — (up|down) from (calm|caution|warning)$/,
    )
    expect(crossed![0]).toMatch(/^02:30:00New — first seen$/)
    // Never a lifecycle change: the track still reads New, and Assess is still the legal move.
    expect(
      within(screen.getByText('Status').parentElement as HTMLElement).getByText('New'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Assess' }))
    fireEvent.click(screen.getByRole('button', { name: 'Escalate' }))
    fireEvent.click(screen.getByRole('radio', { name: 'PHL Tower' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm escalation' }))
    // The handoff timeline carries the crossing, two spaces between the mark and the line.
    expect(handoff()).toContain(`  ${crossing.slice(0, 8)}  ${crossing.slice(8)}`)
    expect(handoff()).toContain('  02:49:45  Escalated — to PHL Tower')
  })

  it('writes nothing on a rewind — re-watching never runs the record backwards (#75 review)', () => {
    useSession.mockReturnValue(LONG)
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'INJECT' }))
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '1185' } })
    const crossedRow = rows().find((row) => {
      fireEvent.click(within(row).getByRole('button'))
      return logLines().some((line) => / — (up|down) from /.test(line))
    })
    expect(crossedRow).toBeDefined()
    const before = logLines()
    // Play again from the start, and seek about in the past: the record holds.
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    replay.tick(30)
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '600' } })
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '0' } })
    expect(logLines()).toEqual(before)
    const marks = before.map((line) => line.slice(0, 8))
    expect(marks).toEqual([...marks].sort())
  })

  it('freezes the handoff evidence block at escalation while the timeline stays live', () => {
    useSession.mockReturnValue(MOVING)
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'ADS-B' }))
    fireEvent.click(
      within(rows().find((r) => within(r).queryByText('AAL423')) as HTMLElement).getByRole(
        'button',
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Assess' }))
    fireEvent.click(screen.getByRole('button', { name: 'Escalate' }))
    fireEvent.click(screen.getByRole('radio', { name: 'PHL Tower' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm escalation' }))
    const frozen = handoff().split('\n')
    expect(frozen[4]).toMatch(/^Range \d+\.\d km to PHL Airfield at 02:30:00$/)
    const rangeRow = () => screen.getByText('Range').parentElement as HTMLElement
    expect(rangeRow()).toHaveTextContent(frozen[4].slice(6, frozen[4].indexOf(' to')))
    // A minute on, the aircraft has flown: the drawer's Range row moved, the record's did not.
    replay.tick(60)
    const later = handoff().split('\n')
    expect(later[4]).toBe(frozen[4])
    expect(later[5]).toBe(frozen[5])
    expect(later[6]).toBe(frozen[6])
    expect(rangeRow()).not.toHaveTextContent(frozen[4].slice(6, frozen[4].indexOf(' to')))
    // The timeline stays live: a later Resolve appends at its own sim time.
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Benign' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm resolution' }))
    expect(handoff()).toContain(
      '  02:30:00  Escalated — to PHL Tower\n  02:31:00  Resolved — Benign',
    )
  })

  it('draws the selected track’s trail and counts it in the drawer', () => {
    useSession.mockReturnValue(MOVING)
    const replay = manualClock()
    render(<App schedule={replay.schedule} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    replay.tick(67)
    fireEvent.click(screen.getByTestId('map-select'))
    // An inject at 67 s: the frame-grid instants 0, 15, 30, 45, 60 and now.
    expect(screen.getByText('History: 6 known positions over the last 2 min')).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-trail', '6')
    // Home suppresses the ring, and the trail with it — presentation only (A2 on #3).
    fireEvent.click(screen.getByRole('button', { name: 'Home' }))
    expect(screen.getByTestId('map')).toHaveAttribute('data-trail', '6')
    expect(screen.getByTestId('map')).toHaveAttribute('data-selection-shown', 'false')
  })
})

describe('App pattern row under the clock (05a)', () => {
  it('fills the pattern row from the history at the clock, and the hero climbs back to the top', () => {
    useSession.mockReturnValue(LONG)
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'INJECT' }))
    const rows = () =>
      within(screen.getByRole('list', { name: 'Ranked queue' })).getAllByRole('listitem')
    // At frame 0 nothing has a history: the row reads so. Under the entry lever (S3a, #135) the
    // hero opens at rank 2, two points behind the grid sweep at 9.6 km whose course enters the
    // ring a minute sooner (it opened at rank 1 by a point under the retired curve).
    expect(within(rows()[1]).getByText('TRK-05')).toBeInTheDocument()
    fireEvent.click(within(rows()[1]).getByRole('button'))
    const breakdownRows = () =>
      within(screen.getByLabelText('Score breakdown')).getAllByRole('listitem')
    expect(within(breakdownRows()[3]).getByText('Movement')).toBeInTheDocument()
    expect(within(breakdownRows()[3]).getByText('no history yet')).toBeInTheDocument()
    // 02:46:30, one seek: the hero has held position inside the ring for 4 min 15 s — the row
    // reads its evidence and fills to 11 of 15, the chip reads 95, and it is back at rank 1 above
    // the two grid sweeps that tied it at 84 (ruled on #5, note 3).
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '990' } })
    expect(within(rows()[0]).getByText('TRK-05')).toBeInTheDocument()
    expect(rows()[0].querySelector('.queue__score')).toHaveTextContent('95')
    expect(within(breakdownRows()[3]).getByText('11 / 15')).toBeInTheDocument()
    expect(within(breakdownRows()[3]).getByText('within 450 m for 4 min 15 s')).toBeInTheDocument()
    expect(screen.getByLabelText('Score breakdown').textContent).not.toMatch(/loiter/i)
    // Play one more tick: the same history, one second on — no jump.
    replay.tick()
    expect(rows()[0].querySelector('.queue__score')).toHaveTextContent('95')
  })
})

/**
 * #77, ruled: while the clock is behind the record's frontier the workflow refuses. Not clamped
 * to the frontier, not stamped at wall time — the action and the picture it acted on carry one
 * sim time, and only the frontier has both.
 */
describe('App rewound actions (#77)', () => {
  const rows = () =>
    within(screen.getByRole('list', { name: 'Ranked queue' })).getAllByRole('listitem')
  const logLines = () =>
    within(screen.getByLabelText('Event log'))
      .getAllByRole('listitem')
      .map((line) => line.textContent ?? '')
  const seek = (value: string) =>
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value } })
  const action = (name: string) => screen.getByRole('button', { name })

  /** Selects AAL423 and claims it at 02:31:00, which puts the record's frontier at 60 s. */
  const claimedAtSixty = () => {
    useSession.mockReturnValue(MOVING)
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(action('Queue'))
    fireEvent.click(action('ADS-B'))
    fireEvent.click(
      within(rows().find((r) => within(r).queryByText('AAL423')) as HTMLElement).getByRole(
        'button',
      ),
    )
    seek('60')
    fireEvent.click(action('Assess'))
    expect(logLines().at(-1)).toMatch(/^02:31:00Assessing/)
    return replay
  }

  it('disables the workflow behind the frontier, says why, and logs nothing', () => {
    claimedAtSixty()
    // Escalated too, so the handoff exists and its Copy button can be checked below.
    fireEvent.click(action('Escalate'))
    fireEvent.click(screen.getByRole('radio', { name: 'PHL Tower' }))
    fireEvent.click(action('Confirm escalation'))
    const before = logLines()

    seek('30')
    // Every workflow button, legal or not: the record is ahead of the picture.
    for (const name of ['Assess', 'Escalate', 'Dismiss', 'Resolve']) {
      expect(action(name)).toBeDisabled()
    }
    // Grey buttons without a reason read as a bug. The live region carries the state; the two
    // times sit beside it, outside it (ruled on #79).
    expect(
      screen.getByText('Rewound — the workflow acts at the record’s frontier'),
    ).toBeInTheDocument()
    expect(screen.getByText('Clock 02:30:30 · record 02:31:00')).toBeInTheDocument()
    // `disabled` takes all four out of the tab order, so the reason has to reach an operator who
    // cannot see them grey out: the group points at both halves (#79 review).
    expect(screen.getByRole('group', { name: 'Lifecycle actions' })).toHaveAttribute(
      'aria-describedby',
      'drawer-rewound-state drawer-rewound-times',
    )

    // Pressing them anyway writes nothing — jsdom fires the handler on a disabled button only
    // if one is attached, so this is the real "nothing is logged" check, not a repeat of the
    // assertion above.
    for (const name of ['Assess', 'Escalate', 'Dismiss', 'Resolve']) {
      fireEvent.click(action(name))
    }
    expect(logLines()).toEqual(before)

    // Copy stamps nothing, so it stays enabled while the workflow is refused (ruled on #77).
    expect(action('Copy')).toBeEnabled()
  })

  it('re-enables at the frontier, and the action stamps at the frontier’s sim time', () => {
    claimedAtSixty()
    seek('30')
    expect(action('Escalate')).toBeDisabled()

    // Back to where the record is: the same action is legal again.
    seek('60')
    expect(screen.queryByText(/^Rewound — /)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Clock /)).not.toBeInTheDocument()
    // The live region stays mounted and goes empty rather than unmounting — a region inserted in
    // the same commit as its text is one some screen readers never announce (#51, #79 review).
    const region = document.querySelector('.drawer__rewound')
    expect(region).toBeInTheDocument()
    expect(region).toBeEmptyDOMElement()
    expect(screen.getByRole('group', { name: 'Lifecycle actions' })).not.toHaveAttribute(
      'aria-describedby',
    )
    expect(action('Escalate')).toBeEnabled()
    fireEvent.click(action('Escalate'))
    fireEvent.click(screen.getByRole('radio', { name: 'PHL Tower' }))
    fireEvent.click(action('Confirm escalation'))

    // Stamped at 02:31:00 — the frontier — because that is where the clock is, not because it
    // was clamped there from somewhere else.
    expect(logLines().at(-1)).toBe('02:31:00Escalated — to PHL Tower')
  })

  it('hands the map one terminalIds identity until the set itself changes (#61)', () => {
    useSession.mockReturnValue(MOVING)
    const replay = manualClock()
    terminalIdsSeen.length = 0
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(action('Queue'))
    fireEvent.click(action('ADS-B'))

    // Ten ticks of the clock. `ranked` is a new array on every one of them (#76) and new tracks
    // open logs as they appear, so anything memoised on either would hand the map a new array
    // each tick — and the map re-pushes its whole source when this prop changes.
    replay.tick(10)
    const distinct = new Set(terminalIdsSeen)
    expect(distinct.size).toBe(1)
    expect([...distinct][0]).toEqual([])

    // Resolving one track is a change of the set, and must come through.
    const row = rows().find((r) => within(r).queryByText('AAL423')) as HTMLElement
    fireEvent.click(within(row).getByRole('button'))
    fireEvent.click(action('Dismiss'))
    const latest = terminalIdsSeen.at(-1) as readonly string[]
    expect(latest).toEqual(['adsb-a06461'])

    // And then holds still again while the clock runs on.
    replay.tick(5)
    expect(terminalIdsSeen.at(-1)).toBe(latest)
    expect(screen.getByTestId('map')).toHaveAttribute('data-terminal', 'adsb-a06461')
  })

  it('hands the map one bands identity until some band moves, and never an ADS-B id (#96)', () => {
    useSession.mockReturnValue(MOVING)
    const replay = manualClock()
    bandsSeen.length = 0
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(action('Queue'))

    // Ten ticks: `ranked` is new on every one (#76), so a map memoised on it would be new too.
    // The map may only change identity when its content does — and a run of ticks with no
    // crossing must hand the same map over and over.
    replay.tick(10)
    const content = (bands: ReadonlyMap<string, string>) =>
      [...bands]
        .map(([id, band]) => `${id}:${band}`)
        .sort()
        .join(' ')
    let repeats = 0
    for (let i = 1; i < bandsSeen.length; i++) {
      if (content(bandsSeen[i]) === content(bandsSeen[i - 1])) {
        expect(bandsSeen[i]).toBe(bandsSeen[i - 1])
        repeats++
      } else {
        expect(bandsSeen[i]).not.toBe(bandsSeen[i - 1])
      }
    }
    expect(repeats).toBeGreaterThan(0)
    // The band is the score's own word for each inject; a real aircraft has none on the map.
    for (const bands of bandsSeen) {
      for (const [id, band] of bands) {
        expect(id).toMatch(/^inject-/)
        expect(['caution', 'warning']).toContain(band)
      }
    }
  })

  it('announces the state once, not the clock — scrubbing while rewound says nothing more', () => {
    claimedAtSixty()
    const region = () => document.querySelector('.drawer__rewound') as HTMLElement
    const times = () => document.querySelector('.drawer__rewound-times')?.textContent

    seek('30')
    const announced = region().textContent
    expect(announced).toBe('Rewound — the workflow acts at the record’s frontier')
    expect(times()).toBe('Clock 02:30:30 · record 02:31:00')

    // Two more seeks, still behind the frontier. The live region's text is what a screen reader
    // re-announces, so it must not move; the times are outside it and do move (ruled on #79).
    seek('15')
    expect(region().textContent).toBe(announced)
    expect(times()).toBe('Clock 02:30:15 · record 02:31:00')
    seek('5')
    expect(region().textContent).toBe(announced)
    expect(times()).toBe('Clock 02:30:05 · record 02:31:00')

    // The toggle still empties and refills it, which is the announcement that has to survive.
    seek('60')
    expect(region()).toBeEmptyDOMElement()
    seek('30')
    expect(region().textContent).toBe(announced)
  })

  it('leaves the record monotonic across a rewind and return', () => {
    claimedAtSixty()

    // Rewind, try to act, come back, act for real — the walk #77 describes.
    seek('15')
    fireEvent.click(action('Escalate'))
    seek('0')
    fireEvent.click(action('Dismiss'))
    seek('75')
    fireEvent.click(action('Escalate'))
    fireEvent.click(screen.getByRole('radio', { name: 'PHL Tower' }))
    fireEvent.click(action('Confirm escalation'))

    const marks = logLines().map((line) => line.slice(0, 8))
    expect(marks).toEqual([...marks].sort())
    expect(marks.at(-1)).toBe('02:31:15')
    // The two rewound presses left nothing behind: Dismiss from Assessing is a legal transition
    // and would have terminated the track had the frontier not refused it.
    expect(
      within(screen.getByText('Status').parentElement as HTMLElement).getByText('Escalated'),
    ).toBeInTheDocument()
  })
})

describe('App pattern entries, the tag, and the re-surface (05b, ruled on #5)', () => {
  const rows = () =>
    within(screen.getByRole('list', { name: 'Ranked queue' })).getAllByRole('listitem')
  const rowOf = (ident: string) =>
    rows().find((row) => within(row).queryByText(ident)) as HTMLElement
  const logLines = () =>
    within(screen.getByLabelText('Event log'))
      .getAllByRole('listitem')
      .map((line) => line.textContent ?? '')
  const seek = (value: string) =>
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value } })
  const start = () => {
    useSession.mockReturnValue(LONG)
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(screen.getByRole('button', { name: 'INJECT' }))
    return replay
  }

  it('logs the onset at sim time, one per seek, and the handoff timeline carries the word', () => {
    start()
    // Frame 0, 10 km out: identity, closing — the entry lever reads 62 for a course into the
    // ring in nine minutes (S3a, #135; 17 and no word under the retired curve) — and the envelope
    // lead; the hour and proximity at 50 trail.
    expect(rowOf('TRK-05').querySelector('.queue__reason')).toHaveTextContent(
      'Non-cooperative, closing, low and slow',
    )
    seek('990')
    fireEvent.click(within(rowOf('TRK-05')).getByRole('button'))
    expect(logLines()).toEqual([
      '02:30:00New — first seen',
      '02:46:30Warning — up from caution',
      '02:46:30Loitering — began',
    ])
    expect(rowOf('TRK-05').querySelector('.queue__reason')).toHaveTextContent(
      'Loitering, non-cooperative, inside the ring',
    )
    // Escalated at 02:46:30: the handoff hands off with the word, in its timeline.
    fireEvent.click(screen.getByRole('button', { name: 'Assess' }))
    fireEvent.click(screen.getByRole('button', { name: 'Escalate' }))
    fireEvent.click(screen.getByRole('radio', { name: 'PHL Tower' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm escalation' }))
    const handoff = (screen.getByLabelText('Handoff text') as HTMLTextAreaElement).value
    expect(handoff).toContain('  02:46:30  Loitering — began\n  02:46:30  Assessing — claimed')
    expect(handoff).toContain('Proximity 15/15 · Movement 11/15')
    // A rewind writes nothing.
    seek('600')
    expect(logLines()).toHaveLength(5)
  })

  it('re-surfaces a dismissed track on a later crossing or onset, keeps it Dismissed, out of Active', () => {
    start()
    // UAS-CD84 dismissed at 02:36:00 in caution; it crosses to warning at 02:38:58. (TRK-06 was
    // the track here under the retired curve, crossing at 02:38:15; under the entry lever it is
    // warning from 02:31:13 — S3a, #135.)
    seek('360')
    fireEvent.click(within(rowOf('UAS-CD84')).getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(rowOf('UAS-CD84')).toHaveClass('queue__row--terminal')
    expect(screen.getByTestId('map').getAttribute('data-terminal')).toContain('inject-04')
    seek('540')
    expect(rowOf('UAS-CD84')).not.toHaveClass('queue__row--terminal')
    expect(within(rowOf('UAS-CD84')).getByText('Re-surfaced')).toBeInTheDocument()
    // The map's dim set agrees with the row (#61's invariant, #82 review).
    expect(screen.getByTestId('map').getAttribute('data-terminal')).not.toContain('inject-04')
    expect(screen.getByText('Status').nextElementSibling).toHaveTextContent('Dismissed')
    // TRK-03 dismissed at 02:40:00 in warning; it names Revisiting at 02:47:30 with no crossing.
    seek('600')
    fireEvent.click(within(rowOf('TRK-03')).getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    seek('1050')
    expect(logLines().at(-1)).toBe('02:47:30Revisiting — began')
    expect(rowOf('TRK-03')).not.toHaveClass('queue__row--terminal')
    expect(within(rowOf('TRK-03')).getByText('Re-surfaced')).toBeInTheDocument()
    // Terminal by the table: neither is Active.
    fireEvent.click(screen.getByRole('button', { name: 'Active' }))
    expect(rows().some((row) => within(row).queryByText('UAS-CD84'))).toBe(false)
    expect(rows().some((row) => within(row).queryByText('TRK-03'))).toBe(false)
  })
})

describe('App Sites surface (08a, ruled on #86)', () => {
  const action = (name: string) => screen.getByRole('button', { name })
  const rows = () =>
    within(screen.getByRole('list', { name: 'Ranked queue' })).getAllByRole('listitem')
  const siteRows = () =>
    within(screen.getByRole('list', { name: 'Site set' })).getAllByRole('listitem')
  const logLines = () =>
    within(screen.getByLabelText('Event log'))
      .getAllByRole('listitem')
      .map((line) => line.textContent ?? '')
  /** Each row's ident and chip, in queue order — the picture as the operator reads it. */
  const chips = () =>
    rows().map(
      (row) =>
        `${row.querySelector('.queue__ident')?.textContent}:${row.querySelector('.queue__score')?.textContent}`,
    )
  const seek = (value: string) =>
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value } })

  /**
   * A silent inject at its first-seen position, from the plan App holds for the stub recording:
   * TRK-05, which opens in caution. (The first silent inject in cast order, TRK-03, opens in
   * warning under the entry lever — S3a, #135 — so a ring placed on it logs no crossing.)
   */
  const silentInject = () =>
    injectTracksAt(planInjects(gridTimeline(1, 15000)), 0).find(
      (inject) => inject.identity === 'non-cooperative' && inject.id === 'inject-05',
    )!

  it('opens on the config set, and a placed site re-scores the queue and logs the crossing at sim time', () => {
    render(<App schedule={never} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(action('Queue'))
    const before = chips()
    fireEvent.click(action('Sites'))
    expect(screen.getByRole('heading', { name: 'Sites' })).toBeInTheDocument()
    expect(screen.getByLabelText('Sites in the set')).toHaveTextContent('1')
    expect(siteRows()).toHaveLength(1)
    expect(siteRows()[0]).toHaveTextContent('PHL Airfield')
    expect(screen.getByText('1 site · config')).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-sites', 'phl-airfield')

    // Place a ring on a silent inject's first-seen position: it is inside the ring at once.
    const target = silentInject()
    placeTarget.center = target.position
    fireEvent.click(action('+ Protected site'))
    expect(screen.getByText('Click the map to place the centre')).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-placing', 'true')
    fireEvent.click(screen.getByTestId('map-place'))
    expect(screen.getByTestId('map')).toHaveAttribute('data-placing', 'false')
    expect(siteRows()).toHaveLength(2)
    expect(siteRows()[1]).toHaveTextContent('Site 2')
    expect(siteRows()[1]).toHaveTextContent('1.0 km ring · 02:30:00')
    // Selected for editing, and the map draws it heavier.
    expect(screen.getByRole('group', { name: 'Edit Site 2' })).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected-site', 'site-2')
    expect(screen.getByTestId('map')).toHaveAttribute('data-sites', 'phl-airfield,site-2')
    expect(screen.getByText('2 sites · edited from config')).toBeInTheDocument()

    // The queue re-scored against the session set: the inject sits inside the new ring and
    // reads warning; its record logs the crossing at sim time, after its first-seen line.
    fireEvent.click(action('Queue'))
    expect(chips()).not.toEqual(before)
    const row = rows().find((r) => within(r).queryByText(trackIdent(target))) as HTMLElement
    expect(row.querySelector('.queue__score')).toHaveAttribute('data-band', 'warning')
    fireEvent.click(within(row).getByRole('button'))
    expect(logLines()).toEqual([
      expect.stringMatching(/^02:30:00New — first seen/),
      '02:30:00Warning — up from caution',
    ])
    // Every ADS-B row is still capped and cooperative: a site never makes a real aircraft the threat.
    for (const r of rows()) {
      if (within(r).queryByText('ADS-B')) {
        expect(r.querySelector('.queue__score')).toHaveAttribute('data-band', 'calm')
        expect(r).toHaveTextContent('Cooperative aircraft')
      }
    }

    // Reset returns the config picture exactly.
    fireEvent.click(action('Sites'))
    fireEvent.click(action('Reset to config'))
    expect(screen.getByText('1 site · config')).toBeInTheDocument()
    fireEvent.click(action('Queue'))
    expect(chips()).toEqual(before)
  })

  const STORE_KEY = 'vigil.site-plan'

  it('opens on the stored plan before the first frame — scored against it, unstamped, rows reading stored — and forgets it once an edit returns the set to config (#90)', () => {
    const target = silentInject()
    localStorage.setItem(
      STORE_KEY,
      sitePlanText(addSite(fromConfig(AO.protectedSites), target.position, 600, AO), AO),
    )
    render(<App schedule={never} />)
    // The first picture is the restored set's: the inject inside last session's ring reads
    // warning with nothing pressed, and the map was handed both sites.
    fireEvent.click(action('Queue'))
    const row = rows().find((r) => within(r).queryByText(trackIdent(target))) as HTMLElement
    expect(row.querySelector('.queue__score')).toHaveAttribute('data-band', 'warning')
    expect(screen.getByTestId('map')).toHaveAttribute('data-sites', 'phl-airfield,site-2')
    fireEvent.click(action('Sites'))
    expect(siteRows()).toHaveLength(2)
    expect(siteRows()[0]).toHaveTextContent('5.0 km ring · stored')
    expect(siteRows()[1]).toHaveTextContent('1.0 km ring · stored')
    expect(screen.getByText('2 sites · edited from config')).toBeInTheDocument()
    // No edit was stamped: the frontier is the record's, nothing is rewound.
    expect(screen.queryByText(/^Rewound/)).not.toBeInTheDocument()
    expect(action('+ Protected site')).toBeEnabled()

    // Removing last session's site returns the set to config: the key goes, the mark clears, and
    // the airfield's row reads config again.
    fireEvent.click(within(siteRows()[1]).getByRole('button', { name: /Site 2/ }))
    fireEvent.click(action('Remove'))
    expect(localStorage.getItem(STORE_KEY)).toBeNull()
    expect(screen.getByText('1 site · config')).toBeInTheDocument()
    expect(siteRows()[0]).toHaveTextContent('5.0 km ring · config')
  })

  it('keeps the plan in storage while the set differs from config — every accepted edit writes, a refused load does not, Reset to config removes it (#90)', () => {
    render(<App schedule={never} />)
    fireEvent.click(action('Sites'))
    expect(localStorage.getItem(STORE_KEY)).toBeNull()
    placeTarget.center = silentInject().position
    fireEvent.click(action('+ Protected site'))
    fireEvent.click(screen.getByTestId('map-place'))
    const stored = localStorage.getItem(STORE_KEY)
    const plan = JSON.parse(stored ?? '') as { schema: string; ao: string; sites: { id: string }[] }
    expect(plan.schema).toBe('vigil-site-plan/1')
    expect(plan.ao).toBe('phl')
    expect(plan.sites.map((site) => site.id)).toEqual(['phl-airfield', 'site-2'])
    // A refused load applies nothing and writes nothing.
    fireEvent.change(screen.getByLabelText('Load site plan'), { target: { value: 'nope' } })
    fireEvent.click(action('Load'))
    expect(screen.getByText('Plan is not JSON')).toBeInTheDocument()
    expect(localStorage.getItem(STORE_KEY)).toBe(stored)
    // An accepted edit replaces the text — the placed site is still selected for editing.
    fireEvent.click(screen.getByRole('radio', { name: '2' }))
    expect(localStorage.getItem(STORE_KEY)).not.toBe(stored)
    expect(localStorage.getItem(STORE_KEY)).toContain('"tier": 2')
    // Reset to config is the edit that equals config: the key is removed.
    fireEvent.click(action('Reset to config'))
    expect(localStorage.getItem(STORE_KEY)).toBeNull()
    expect(screen.getByText('1 site · config')).toBeInTheDocument()
  })

  it('opens on config with one line said when the stored plan is not one, leaving it in place until an accepted edit replaces it (#90)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stale = '{"ao":"phl","sites":[]}'
    localStorage.setItem(STORE_KEY, stale)
    render(<App schedule={never} />)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      'Stored site plan ignored — Plan schema is not vigil-site-plan/1; using config',
    )
    fireEvent.click(action('Sites'))
    expect(screen.getByText('1 site · config')).toBeInTheDocument()
    expect(siteRows()[0]).toHaveTextContent('5.0 km ring · config')
    expect(localStorage.getItem(STORE_KEY)).toBe(stale)
    fireEvent.click(action('+ Protected site'))
    fireEvent.click(screen.getByTestId('map-place'))
    expect(localStorage.getItem(STORE_KEY)).toContain('"schema": "vigil-site-plan/1"')
    warn.mockRestore()
  })

  it('forgets a stored plan that equals config at load, so the key never outlives the difference it records (#108 review)', () => {
    localStorage.setItem(STORE_KEY, sitePlanText(fromConfig(AO.protectedSites), AO))
    render(<App schedule={never} />)
    fireEvent.click(action('Sites'))
    expect(screen.getByText('1 site · config')).toBeInTheDocument()
    expect(siteRows()[0]).toHaveTextContent('5.0 km ring · config')
    expect(action('Reset to config')).toBeDisabled()
    expect(localStorage.getItem(STORE_KEY)).toBeNull()
  })

  it('says once that the browser refuses to store the plan, however many edits follow (#108 review)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    render(<App schedule={never} />)
    fireEvent.click(action('Sites'))
    fireEvent.click(action('+ Protected site'))
    fireEvent.click(screen.getByTestId('map-place'))
    // The name field commits per keystroke: three accepted edits, one line.
    const name = screen.getByLabelText('Name')
    fireEvent.change(name, { target: { value: 'Fence' } })
    fireEvent.change(name, { target: { value: 'Fence A' } })
    expect(setItem).toHaveBeenCalledTimes(3)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('Site plan not stored — QuotaExceededError')
    // The set itself is kept: the session runs on, unstored.
    expect(siteRows()[1]).toHaveTextContent('Fence A')
    setItem.mockRestore()
    warn.mockRestore()
  })

  it('disarms a move when its site is removed or the set is reset (#87 review)', () => {
    render(<App schedule={never} />)
    fireEvent.click(action('Sites'))
    placeTarget.center = silentInject().position
    fireEvent.click(action('+ Protected site'))
    fireEvent.click(screen.getByTestId('map-place'))
    fireEvent.click(action('Move on map'))
    expect(screen.getByTestId('map')).toHaveAttribute('data-placing', 'true')
    fireEvent.click(action('Remove'))
    expect(siteRows()).toHaveLength(1)
    expect(screen.getByTestId('map')).toHaveAttribute('data-placing', 'false')
    expect(screen.queryByText(/Click the map/)).not.toBeInTheDocument()
    // The same through Reset.
    fireEvent.click(action('+ Protected site'))
    fireEvent.click(screen.getByTestId('map-place'))
    fireEvent.click(action('Move on map'))
    fireEvent.click(action('Reset to config'))
    expect(screen.getByTestId('map')).toHaveAttribute('data-placing', 'false')
  })

  it('refuses a placement the rules refuse, saying why, and keeps the map armed', () => {
    render(<App schedule={never} />)
    fireEvent.click(action('Sites'))
    placeTarget.center = [0, 0]
    fireEvent.click(action('+ Protected site'))
    fireEvent.click(screen.getByTestId('map-place'))
    expect(screen.getByText('Centre is outside the AO')).toBeInTheDocument()
    expect(siteRows()).toHaveLength(1)
    expect(screen.getByTestId('map')).toHaveAttribute('data-placing', 'true')
    // A plan loaded while the refusal stands is an edit like the others: the refusal goes with
    // it (#95 review).
    fireEvent.change(screen.getByLabelText('Load site plan'), {
      target: {
        value: sitePlanText(addSite(fromConfig(AO.protectedSites), [-75.3, 39.85], 0, AO), AO),
      },
    })
    fireEvent.click(action('Load'))
    expect(siteRows()).toHaveLength(2)
    expect(screen.queryByText('Centre is outside the AO')).not.toBeInTheDocument()
    fireEvent.click(action('+ Protected site'))
    // Leaving the surface disarms the map: a click on Home must not place a site.
    fireEvent.click(action('Home'))
    expect(screen.getByTestId('map')).toHaveAttribute('data-placing', 'false')
  })

  it('refuses site edits behind the record’s frontier — its own last edit included — and re-enables at it', () => {
    useSession.mockReturnValue(MOVING)
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    fireEvent.click(action('Sites'))
    seek('60')
    placeTarget.center = silentInject().position
    fireEvent.click(action('+ Protected site'))
    fireEvent.click(screen.getByTestId('map-place'))
    expect(siteRows()[1]).toHaveTextContent('1.0 km ring · 02:31:00')
    // Armed, then rewound: the map disarms with the editor, so no click no-ops unexplained.
    fireEvent.click(action('+ Protected site'))
    expect(screen.getByTestId('map')).toHaveAttribute('data-placing', 'true')

    seek('30')
    expect(screen.getByTestId('map')).toHaveAttribute('data-placing', 'false')
    expect(screen.queryByText(/Click the map/)).not.toBeInTheDocument()
    expect(
      screen.getByText('Rewound — the workflow acts at the record’s frontier'),
    ).toBeInTheDocument()
    expect(screen.getByText('Clock 02:30:30 · record 02:31:00')).toBeInTheDocument()
    expect(action('+ Protected site')).toBeDisabled()
    expect(action('Reset to config')).toBeDisabled()
    expect(screen.getByLabelText('Radius')).toBeDisabled()
    expect(screen.getByRole('group', { name: 'Add a site' })).toHaveAttribute(
      'aria-describedby',
      'sites-rewound-state sites-rewound-times',
    )

    seek('60')
    expect(screen.queryByText(/^Rewound — /)).not.toBeInTheDocument()
    expect(action('+ Protected site')).toBeEnabled()
    expect(action('Reset to config')).toBeEnabled()
  })
})

describe('App friendly launch areas and the site plan (08b, ruled on #86)', () => {
  const action = (name: string) => screen.getByRole('button', { name })
  const rows = () =>
    within(screen.getByRole('list', { name: 'Ranked queue' })).getAllByRole('listitem')
  const siteRows = () =>
    within(screen.getByRole('list', { name: 'Site set' })).getAllByRole('listitem')
  const chips = () =>
    rows().map(
      (row) =>
        `${row.querySelector('.queue__ident')?.textContent}:${row.querySelector('.queue__score')?.textContent}`,
    )
  const injectsAtOpen = () => injectTracksAt(planInjects(gridTimeline(1, 15000)), 0)
  const rowFor = (ident: string) => rows().find((r) => within(r).queryByText(ident)) as HTMLElement
  const seek = (value: string) =>
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value } })

  it('caps a heard inject first seen inside a friendly area, and leaves a silent one alone — the demo moment', () => {
    render(<App schedule={never} now={() => '2026-09-01T12:04:31.000Z'} />)
    const heard = injectsAtOpen().find((inject) => inject.identity === 'cooperative')!
    const silent = injectsAtOpen().find((inject) => inject.identity === 'non-cooperative')!
    fireEvent.click(action('Queue'))
    const before = chips()
    expect(rowFor(trackIdent(heard))).not.toHaveTextContent('Friendly launch')
    // The map's fill reads the chip's band, so the demo moment is one step there too (#96): the
    // heard inject's dot is warm before the area, and calm — absent from the map — after it.
    const mapBands = () => screen.getByTestId('map').getAttribute('data-bands') ?? ''
    expect(mapBands()).toMatch(new RegExp(`${heard.id}:(caution|warning)`))

    // A friendly area over the heard inject's first-seen position: its row drops with the line.
    fireEvent.click(action('Sites'))
    placeTarget.center = heard.position
    fireEvent.click(action('+ Friendly launch area'))
    fireEvent.click(screen.getByTestId('map-place'))
    expect(siteRows()[1]).toHaveTextContent('Launch area 2')
    expect(siteRows()[1]).toHaveTextContent('Friendly launch area')
    // The clock never ran: the picture is unmoved, and the map still got the new band.
    expect(mapBands()).not.toContain(heard.id)
    expect(mapBands()).not.toContain('adsb-')
    fireEvent.click(action('Queue'))
    const row = rowFor(trackIdent(heard))
    expect(Number(row.querySelector('.queue__score')?.textContent)).toBeLessThanOrEqual(30)
    expect(row.querySelector('.queue__score')).toHaveAttribute('data-band', 'calm')
    expect(row.querySelector('.queue__reason')).toHaveTextContent(/^Friendly launch/)
    fireEvent.click(within(row).getByRole('button'))
    expect(screen.getByLabelText('Score breakdown')).toHaveTextContent(
      /Friendly launch — capped at \d+ \(uncapped \d+\)/,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }))

    // A friendly area over the silent inject's first-seen position: no cap, nothing moves.
    const withHeardCapped = chips()
    fireEvent.click(action('Sites'))
    placeTarget.center = silent.position
    fireEvent.click(action('+ Friendly launch area'))
    fireEvent.click(screen.getByTestId('map-place'))
    fireEvent.click(action('Queue'))
    expect(chips()).toEqual(withHeardCapped)
    expect(rowFor(trackIdent(silent))).not.toHaveTextContent('Friendly launch')

    // Every ADS-B row is untouched by either area.
    for (const r of rows()) {
      if (within(r).queryByText('ADS-B')) expect(r).toHaveTextContent('Cooperative aircraft')
    }
    // Reset returns the config picture.
    fireEvent.click(action('Sites'))
    fireEvent.click(action('Reset to config'))
    fireEvent.click(action('Queue'))
    expect(chips()).toEqual(before)
  })

  it('loads a pasted plan as one edit, and refuses one behind the frontier with the rewound reason', () => {
    useSession.mockReturnValue(MOVING)
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    const heard = injectsAtOpen().find((inject) => inject.identity === 'cooperative')!
    const plan = sitePlanText(
      addSite(
        addSite(fromConfig(AO.protectedSites), heard.position, 0, AO, 'friendly'),
        [-75.3, 39.85],
        0,
        AO,
      ),
      AO,
    )
    fireEvent.click(action('Sites'))
    fireEvent.change(screen.getByLabelText('Load site plan'), { target: { value: plan } })
    fireEvent.click(action('Load'))
    expect(siteRows()).toHaveLength(3)
    expect(siteRows().map((r) => r.textContent)).toEqual([
      expect.stringContaining('PHL Airfield'),
      expect.stringContaining('Site 3'),
      expect.stringContaining('Launch area 2'),
    ])
    expect(screen.getByText('3 sites · edited from config')).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-sites', 'phl-airfield,site-3')
    // The load was an edit: the frontier is where it landed, and a rewind refuses the next one.
    seek('60')
    fireEvent.change(screen.getByLabelText('Load site plan'), { target: { value: plan } })
    fireEvent.click(action('Load'))
    seek('30')
    expect(screen.getByLabelText('Load site plan')).toBeDisabled()
    expect(action('Load')).toBeDisabled()
    expect(
      screen.getByText('Rewound — the workflow acts at the record’s frontier'),
    ).toBeInTheDocument()
  })
})

describe('App alerts — the stack over the map (#101, 101a, ruled)', () => {
  const rows = () =>
    within(screen.getByRole('list', { name: 'Ranked queue' })).getAllByRole('listitem')
  const rowOf = (ident: string) =>
    rows().find((row) => within(row).queryByText(ident)) as HTMLElement
  const logLines = () =>
    within(screen.getByLabelText('Event log'))
      .getAllByRole('listitem')
      .map((line) => line.textContent ?? '')
  const seek = (value: string) =>
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value } })
  const stack = () => screen.getByRole('region', { name: 'Alerts' })
  const cards = () =>
    within(stack())
      .queryAllByRole('listitem')
      .map((card) => card.querySelector('.alert__open')?.textContent ?? '')
  const cardOf = (ident: string) =>
    within(stack())
      .getAllByRole('listitem')
      .find((item) => item.textContent?.includes(ident)) as HTMLElement
  const start = () => {
    useSession.mockReturnValue(LONG)
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    return replay
  }
  // Every raise here reaches the tone (101b); jsdom's own `play` is not implemented and says so
  // on the console, so it is stood in for throughout and read where the tone is the subject.
  let play: MockInstance<() => Promise<void>>
  beforeEach(() => {
    play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
  })
  afterEach(() => play.mockRestore())
  /**
   * One track's crossing into warning, raised on the clock: a seek to `seekS` writes every
   * crossing before it and raises nothing; the ticks after write this one. Under the entry lever
   * (S3a, #135) TRK-06 crosses at 02:31:13 (02:38:11 under the retired time-to-centre curve),
   * UAS-CD84 at 02:38:58, UAS-A341 at 02:43:46. Returns the sim time the card carries.
   */
  const raise = (
    replay: ReturnType<typeof manualClock>,
    ident: string,
    seekS: string,
    hhmm: string,
  ) => {
    seek(seekS)
    expect(cards()).toEqual([])
    for (let i = 0; i < 40 && cards().length === 0; i++) replay.tick()
    const card = cards().find((text) => text.includes(ident))
    expect(card).toMatch(new RegExp(`^(Warning|Re-surfaced)${ident}${hhmm}:[0-5][0-9]$`))
    return card!.slice(-8)
  }

  it('raises on a tick and not on a seek — a seek replays the record, the stack stays quiet (A1)', () => {
    const replay = start()
    const at = raise(replay, 'TRK-06', '60', '02:31')
    expect(cards()).toContain(`WarningTRK-06${at}`)
    // Never a real aircraft: every card names an inject.
    for (const card of cards()) expect(card).toMatch(/(TRK|UAS)-/)
    // Seeking across the same crossing again writes nothing new and raises nothing new.
    const before = cards()
    seek('300')
    seek('600')
    expect(cards()).toEqual(before)
  })

  it('acknowledges from the card: New becomes Assessing, the line is written at sim time, the card clears, the handoff carries it', () => {
    const replay = start()
    const at = raise(replay, 'TRK-06', '60', '02:31')
    // The card's body is a selection: the Queue opens with TRK-06 in the drawer.
    fireEvent.click(within(cardOf('TRK-06')).getByRole('button', { name: /Warning/ }))
    expect(screen.getByRole('button', { name: 'Queue' })).toHaveAttribute('aria-current', 'page')
    expect(logLines().at(-1)).toBe(`${at}Warning — up from caution`)
    fireEvent.click(within(cardOf('TRK-06')).getByRole('button', { name: 'Acknowledge' }))
    expect(cards().some((card) => card.includes('TRK-06'))).toBe(false)
    expect(logLines().at(-1)).toBe(`${at}Acknowledged`)
    expect(screen.getByText('Status').nextElementSibling).toHaveTextContent('Assessing')
    // Escalated: the handoff timeline carries Acknowledged in sim time, before the escalation.
    fireEvent.click(screen.getByRole('button', { name: 'Escalate' }))
    fireEvent.click(screen.getByRole('radio', { name: 'PHL Tower' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm escalation' }))
    const handoff = (screen.getByLabelText('Handoff text') as HTMLTextAreaElement).value
    expect(handoff).toContain(`  ${at}  Acknowledged\n  ${at}  Escalated — to PHL Tower`)
  })

  it('refuses Acknowledge behind the track’s frontier (#77), and clears the cards on Dismiss', () => {
    const replay = start()
    raise(replay, 'TRK-06', '60', '02:31')
    const ack = () => within(cardOf('TRK-06')).getByRole('button', { name: 'Acknowledge' })
    seek('30')
    expect(ack()).toBeDisabled()
    expect(within(stack()).getByRole('status')).toHaveTextContent(
      'Rewound — the workflow acts at the record’s frontier',
    )
    seek('600')
    expect(ack()).toBeEnabled()
    expect(within(stack()).getByRole('status')).toHaveTextContent('')
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    fireEvent.click(within(rowOf('TRK-06')).getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(cards().some((card) => card.includes('TRK-06'))).toBe(false)
  })

  it('sounds once per raise batch under play, never on a seek, and the strip mutes it (101b)', () => {
    const replay = start()
    // A seek replays the record: cards or not, no sound.
    seek('300')
    expect(play).not.toHaveBeenCalled()
    // The ticks that raise UAS-A341's card are one batch: one play.
    raise(replay, 'UAS-A341', '820', '02:43')
    expect(play).toHaveBeenCalledTimes(1)
    // The flipping label alone carries the state, as Play/Pause does — no aria-pressed, which
    // with a flipping label announces the state inverted (ruled A on #36 [18]).
    const mute = () => screen.getByRole('button', { name: /^(Mute|Unmute)$/ })
    expect(mute()).toHaveTextContent('Mute')
    expect(mute()).not.toHaveAttribute('aria-pressed')
    fireEvent.click(mute())
    expect(mute()).toHaveTextContent('Unmute')
    expect(mute()).not.toHaveAttribute('aria-pressed')
    // Muted, the next card — UAS-A341's orbit onset at 02:44:24; its warning re-crossing at
    // 02:44:02 only re-stamps the pending card (A4) — stacks and sounds nothing: the binding,
    // not only the hook (#113 review).
    const before = cards().length
    for (let i = 0; i < 90 && cards().length === before; i++) replay.tick()
    expect(cards().length).toBeGreaterThan(before)
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('raises Re-surfaced in place of the crossing on a Dismissed track (A5)', () => {
    const replay = start()
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    seek('360')
    fireEvent.click(within(rowOf('UAS-CD84')).getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    const at = raise(replay, 'UAS-CD84', '520', '02:38')
    expect(cards()).toContain(`Re-surfacedUAS-CD84${at}`)
    expect(cards()).not.toContain(`WarningUAS-CD84${at}`)
  })
})

describe('raw mode (S4a, #136, ruled) — the fairness spec, line by line', () => {
  const rawReady = () => ready(CAPTURE, DEFAULT_RECORDING, true, 'raw')
  const map = () => screen.getByTestId('map')

  it('shows the map, the counts, the recording, the clock, the elapsed time, and the AO — no nav, no seek, no Pause, no Seed, no Alerts, no rail', () => {
    useSession.mockReturnValue(rawReady())
    render(<App schedule={never} />)
    expect(screen.queryByRole('navigation', { name: 'Surfaces' })).toBeNull()
    expect(screen.getByText('Cooperative').nextSibling).toHaveTextContent('2')
    expect(screen.getByText('Injects')).toBeInTheDocument()
    expect(screen.getByText('Recording')).toBeInTheDocument()
    expect(screen.getByText('Sim clock')).toBeInTheDocument()
    expect(screen.getByText('AO').nextSibling).toHaveTextContent('Philadelphia')
    expect(screen.getByText('Playback').nextSibling).toHaveTextContent(/^[0-9][0-9]:[0-9][0-9]$/)
    expect(screen.queryByRole('slider', { name: 'Seek' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^(Play|Pause)$/ })).toBeNull()
    expect(screen.queryByText('Seed')).toBeNull()
    expect(screen.queryByText('Alerts')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Alerts' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^(Mute|Unmute)$/ })).toBeNull()
    expect(screen.queryByRole('list', { name: 'Ranked queue' })).toBeNull()
    expect(screen.queryByLabelText('Tracks in queue')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Picture summary' })).toBeNull()
    // The map: raw, the ring drawn, no dim, no bands, no projected path, the selection shown.
    expect(map()).toHaveAttribute('data-mode', 'raw')
    expect(map()).toHaveAttribute('data-sites', 'phl-airfield')
    expect(map()).toHaveAttribute('data-terminal', '')
    expect(map()).toHaveAttribute('data-bands', '')
    expect(map()).toHaveAttribute('data-projection', '0')
    expect(map()).toHaveAttribute('data-selection-shown', 'true')
  })

  it('opens the observed-only drawer beside the map on a click, keeps the trail, and acts through Assess and Escalate', () => {
    useSession.mockReturnValue(rawReady())
    render(<App schedule={never} />)
    fireEvent.click(screen.getByTestId('map-select'))
    const drawer = screen.getByRole('complementary', { name: /Track review/ })
    expect([...drawer.querySelectorAll('.drawer__row dt')].map((dt) => dt.textContent)).toEqual([
      'Status',
      'Range',
      'Identity',
      'Source',
      'Position',
      'Altitude',
      'Speed',
      'Heading',
      'First seen',
    ])
    expect(within(drawer).queryByLabelText('Score breakdown')).toBeNull()
    expect(within(drawer).queryByText('Rank')).toBeNull()
    expect(within(drawer).queryByText('Entry')).toBeNull()
    expect(within(drawer).queryByLabelText('Event log')).toBeNull()
    expect(Number(map().getAttribute('data-trail'))).toBeGreaterThan(0)
    // No projected path and no entry reading on the map unaided (S10 item 4).
    expect(map()).toHaveAttribute('data-projection', '0')
    expect(map()).toHaveAttribute('data-entry', '')
    expect(
      within(drawer)
        .getAllByRole('button', { name: /^(Assess|Escalate|Dismiss|Resolve)$/ })
        .map((button) => button.textContent),
    ).toEqual(['Assess', 'Escalate', 'Dismiss'])
    fireEvent.click(within(drawer).getByRole('button', { name: 'Assess' }))
    expect(within(drawer).getByText('Status').nextElementSibling).toHaveTextContent('Assessing')
    fireEvent.click(within(drawer).getByRole('button', { name: 'Escalate' }))
    fireEvent.click(screen.getByRole('radio', { name: 'PHL Tower' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm escalation' }))
    expect(within(drawer).getByText('Status').nextElementSibling).toHaveTextContent('Escalated')
    // The escalation logged, the handoff not drawn: raw prints no score anywhere.
    expect(within(drawer).queryByLabelText('Handoff text')).toBeNull()
    // The map still dims nothing and paints no band after the action.
    expect(map()).toHaveAttribute('data-terminal', '')
    expect(map()).toHaveAttribute('data-bands', '')
  })

  it('raises no card and plays no tone on a tick (ruled A6)', () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve())
    if (LONG.status !== 'ready') throw new Error('LONG is a ready session')
    useSession.mockReturnValue({ ...LONG, session: { ...LONG.session, mode: 'raw' } })
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => '2026-09-01T12:04:31.000Z'} />)
    // In Vigil TRK-06 crosses warning at 73 s and raises; in raw the ticks raise nothing.
    replay.tick(90)
    expect(screen.queryByRole('region', { name: 'Alerts' })).toBeNull()
    expect(play).not.toHaveBeenCalled()
    play.mockRestore()
  })

  it('leaves Vigil unchanged: the same session in vigil has the nav, the seek, the Seed, the rail, and the bands (ruled A7)', () => {
    useSession.mockReturnValue(ready(CAPTURE))
    render(<App schedule={never} />)
    expect(screen.getByRole('navigation', { name: 'Surfaces' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Seek' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^(Play|Pause)$/ })).toBeInTheDocument()
    expect(screen.getByText('Seed')).toBeInTheDocument()
    expect(screen.getByText('Alerts')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Picture summary' })).toBeInTheDocument()
    expect(map()).toHaveAttribute('data-mode', 'vigil')
    expect(map().getAttribute('data-bands')).not.toBe('')
  })
})

describe('raw mode while the recording loads (#148 round 1)', () => {
  it('wears the raw shell from the first render — no nav, no rail, no seek, no Seed, no Alerts, no legend — never a Vigil flash', () => {
    useSession.mockReturnValue({
      status: 'loading',
      session: {
        feeds: [{ kind: 'recording', id: 'vigil-phl-002' }],
        scenario: { on: true, name: '02a', seed: 'study-02a', runS: 360 },
        mode: 'raw',
        study: null,
      },
    })
    render(<App schedule={never} />)
    expect(screen.queryByRole('navigation', { name: 'Surfaces' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Picture summary' })).toBeNull()
    expect(screen.queryByRole('slider', { name: 'Seek' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^(Play|Pause)$/ })).toBeNull()
    expect(screen.queryByText('Seed')).toBeNull()
    expect(screen.queryByText('Alerts')).toBeNull()
    expect(screen.getByText('Cooperative').nextSibling).toHaveTextContent('…')
    expect(screen.getByText('Playback').nextSibling).toHaveTextContent('—')
    expect(screen.getByTestId('map')).toHaveAttribute('data-mode', 'raw')
  })
})

describe('raw mode and the stored site plan (#36 [34], ruled A)', () => {
  const STORE_KEY = 'vigil.site-plan'
  const storedPlan = () =>
    sitePlanText(addSite(fromConfig(AO.protectedSites), [-75.2, 39.8], 600, AO), AO)

  it('ignores the plan this browser stored and draws the config’s sites — a subject can neither see nor reset it', () => {
    localStorage.setItem(STORE_KEY, storedPlan())
    useSession.mockReturnValue(ready(CAPTURE, DEFAULT_RECORDING, true, 'raw'))
    render(<App schedule={never} />)
    expect(screen.getByTestId('map')).toHaveAttribute('data-sites', 'phl-airfield')
    // The plan is left where it was, for Vigil, which shows it on its panel.
    expect(localStorage.getItem(STORE_KEY)).toBe(storedPlan())
    localStorage.removeItem(STORE_KEY)
  })

  it('leaves Vigil restoring the same plan, as #90 built it', () => {
    localStorage.setItem(STORE_KEY, storedPlan())
    useSession.mockReturnValue(ready(CAPTURE))
    render(<App schedule={never} />)
    expect(screen.getByTestId('map')).toHaveAttribute('data-sites', 'phl-airfield,site-2')
    localStorage.removeItem(STORE_KEY)
  })
})

describe('a study run (S4b, #137, ruled) — the brief, Begin, the window, the end screen, the run JSON', () => {
  const NOW = '2026-09-16T01:12:04.000Z'
  const run = (mode: 'raw' | 'vigil') => {
    if (LONG.status !== 'ready') throw new Error('LONG is a ready session')
    return { ...LONG, session: { ...LONG.session, mode, study: { subject: 'S03', run: 1 } } }
  }
  const start = (mode: 'raw' | 'vigil') => {
    useSession.mockReturnValue(run(mode))
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => NOW} />)
    return replay
  }
  const dialog = () => screen.getByRole('dialog')
  const field = (label: string) => screen.getByText(label).nextSibling as HTMLElement
  const begin = () => fireEvent.click(screen.getByRole('button', { name: 'Begin' }))
  const answer = (group: string, value: string) =>
    fireEvent.click(
      within(within(dialog()).getByRole('group', { name: group })).getByRole('radio', {
        name: value,
      }),
    )
  const answerAll = () => {
    answer('Mental demand', '6')
    answer('Time pressure', '7')
    answer('Confidence in your decisions', '5')
  }
  const runJsonText = () =>
    (within(dialog()).getByLabelText('Run JSON') as HTMLTextAreaElement).value
  const STORE_KEY = 'vigil.site-plan'

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.removeItem(STORE_KEY)
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('vigil.run.')) localStorage.removeItem(key)
    }
  })

  it('opens on the brief — the run named, the text word for word, one button — with the clock held at Begin, one track count, and the shell inert', () => {
    const replay = start('raw')
    expect(dialog()).toHaveAccessibleName('Vigil · study run — subject S03 · run 1')
    expect(within(dialog()).getByText(BRIEF)).toBeInTheDocument()
    expect(within(dialog()).getByRole('button', { name: 'Begin' })).toBeEnabled()
    // Held at Begin's tick: 001's 02:30:00 + 480 s, the elapsed time +00:00, no tick scheduled.
    expect(field('Sim clock')).toHaveTextContent('02:38:00')
    expect(field('Playback')).toHaveTextContent('+00:00')
    replay.tick(5)
    expect(field('Sim clock')).toHaveTextContent('02:38:00')
    // One count in place of the split (ruled A13); no seek and no Pause; raw's shell otherwise.
    expect(field('Tracks')).toHaveTextContent(/^[0-9]+$/)
    // The strip's Cooperative/Injects split is the one A13 replaced with a single count. Scoped
    // to the strip since S8: the run opens on the list, whose rows carry the identity word.
    const strip = document.querySelector('.strip') as HTMLElement
    expect(within(strip).queryByText('Cooperative')).toBeNull()
    expect(screen.queryByText('Injects')).toBeNull()
    expect(screen.queryByRole('slider', { name: 'Seek' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^(Play|Pause)$/ })).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Surfaces' })).toBeNull()
    // The shell under the overlay is inert, and a click through it selects nothing.
    expect(screen.getByRole('main')).toHaveAttribute('inert')
    expect(screen.getByRole('banner')).toHaveAttribute('inert')
    fireEvent.click(screen.getByTestId('map-select'))
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected', '')
  })

  it('runs as long as its scenario says (S7, #152, ruled D3, D4): on 03a the brief says about three and a half minutes and the end screen opens at +03:38', () => {
    const base = run('raw')
    useSession.mockReturnValue({
      ...base,
      session: {
        ...base.session,
        scenario: { on: true, name: '03a', seed: 'study-03a', runS: 218 },
      },
    })
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => NOW} />)
    expect(within(dialog()).getByText(briefFor(218))).toBeInTheDocument()
    expect(
      within(dialog()).getByText(
        /You can open any track. The run lasts about three and a half minutes.$/,
      ),
    ).toBeInTheDocument()
    begin()
    replay.tick(217)
    expect(field('Playback')).toHaveTextContent('+03:37')
    expect(screen.queryByRole('dialog')).toBeNull()
    replay.tick()
    expect(field('Playback')).toHaveTextContent('+03:38')
    expect(dialog()).toHaveAccessibleName('Run complete — subject S03 · run 1 · +03:38')
    replay.tick(5)
    expect(field('Playback')).toHaveTextContent('+03:38')
  })

  it('holds the brief with Begin withheld on a recording that ends at or before Begin — never an end screen no run can fill (#149 round 1)', () => {
    // Thirty-three frames at 15 s: the recording ends at 480 s, Begin's own tick.
    const short = ready({
      ...CAPTURE,
      frames: [...Array(33)].map((_, i) => ({
        tMs: i * 15000,
        records: CAPTURE.frames[0].records,
      })),
    })
    if (short.status !== 'ready') throw new Error('a ready session')
    useSession.mockReturnValue({
      ...short,
      session: { ...short.session, study: { subject: 'S03', run: 1 } },
    })
    render(<App schedule={never} />)
    expect(dialog()).toHaveAccessibleName('Vigil · study run — subject S03 · run 1')
    expect(within(dialog()).getByRole('button', { name: 'Begin' })).toBeDisabled()
    expect(screen.queryByText(/^Run complete/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy run' })).toBeNull()
    expect(field('Playback')).toHaveTextContent('+00:00')
  })

  it('offers Begin only once the recording is in, the count held back until then', () => {
    useSession.mockReturnValue({
      status: 'loading',
      session: {
        feeds: [{ kind: 'recording', id: 'vigil-phl-002' }],
        scenario: { on: true, name: '02a', seed: 'study-02a', runS: 360 },
        mode: 'vigil',
        study: { subject: 'S03', run: 2 },
      },
    })
    render(<App schedule={never} />)
    expect(dialog()).toHaveAccessibleName('Vigil · study run — subject S03 · run 2')
    expect(within(dialog()).getByRole('button', { name: 'Begin' })).toBeDisabled()
    expect(field('Tracks')).toHaveTextContent('…')
    expect(field('Playback')).toHaveTextContent('—')
  })

  it('Begin lifts the brief and the clock ticks from Begin + 1 — in Vigil too, with no Play, Pause, or seek, and no tab bar at all (S8 item 1)', () => {
    const replay = start('vigil')
    // S8 item 1: no tab bar in a study run, in either condition. Where this once held a nav
    // without Sites, the run now opens on the list and the nav is not reachable at all.
    expect(screen.queryByRole('navigation', { name: 'Surfaces' })).toBeNull()
    expect(
      screen.getByRole('heading', { name: 'Priority list — highest first' }),
    ).toBeInTheDocument()
    begin()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('main')).not.toHaveAttribute('inert')
    replay.tick()
    expect(field('Sim clock')).toHaveTextContent('02:38:01')
    expect(field('Playback')).toHaveTextContent('+00:01')
    expect(field('Tracks')).toHaveTextContent(/^[0-9]+$/)
    // The strip's Cooperative/Injects split is the one A13 replaced with a single count. Scoped
    // to the strip since S8: the run opens on the list, whose rows carry the identity word too.
    const strip = document.querySelector('.strip') as HTMLElement
    expect(within(strip).queryByText('Cooperative')).toBeNull()
    // The Seed names the scenario: hidden in a study run in both modes (#36 [37], ruled A).
    expect(screen.queryByText('Seed')).toBeNull()
    expect(screen.queryByRole('slider', { name: 'Seek' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^(Play|Pause)$/ })).toBeNull()
  })

  it('logs the looks and the actions from Begin, ends at +6:00 with the picture frozen and every click refused, and Copy run hands back the JSON — no positions, no names', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const replay = start('raw')
    begin()
    replay.tick(14)
    fireEvent.click(screen.getByTestId('map-select'))
    const id = screen.getByTestId('map').getAttribute('data-selected')
    expect(id).not.toBe('')
    const detail = () => screen.getByRole('complementary', { name: /Track review/ })
    // The open marked the track (S8-ii, the amendment's item 1): the Status row reads Assessing
    // off the click, and the drawer offers two actions — no Assess, no Resolve.
    expect(within(detail()).getByText('Status').nextElementSibling).toHaveTextContent('Assessing')
    expect(
      within(detail())
        .getAllByRole('button', { name: /^(Assess|Escalate|Dismiss|Resolve)$/ })
        .map((button) => button.textContent),
    ).toEqual(['Escalate', 'Dismiss'])
    replay.tick(35)
    fireEvent.click(within(detail()).getByRole('button', { name: 'Close review' }))
    expect(screen.queryByRole('complementary', { name: /Track review/ })).toBeNull()
    replay.tick(9)
    // A re-open is a second look, and the JSON records it as one; the record does not move.
    fireEvent.click(screen.getByTestId('map-select'))
    expect(within(detail()).getByText('Status').nextElementSibling).toHaveTextContent('Assessing')
    // Escalate takes no picker and no confirm (item 2, ruled), and closes the detail with it.
    fireEvent.click(within(detail()).getByRole('button', { name: 'Escalate' }))
    expect(screen.queryByRole('button', { name: 'Confirm escalation' })).toBeNull()
    expect(screen.queryByRole('complementary', { name: /Track review/ })).toBeNull()
    replay.tick(301)
    expect(field('Playback')).toHaveTextContent('+05:59')
    expect(screen.queryByRole('dialog')).toBeNull()
    replay.tick()
    expect(field('Playback')).toHaveTextContent('+06:00')
    expect(dialog()).toHaveAccessibleName('Run complete — subject S03 · run 1 · +06:00')
    // Frozen: a further tick moves nothing; the shell is inert and a click selects nothing new.
    replay.tick(5)
    expect(field('Playback')).toHaveTextContent('+06:00')
    expect(field('Sim clock')).toHaveTextContent('02:44:00')
    expect(screen.getByRole('main')).toHaveAttribute('inert')
    fireEvent.click(screen.getByTestId('map-select'))
    // Copy run waits for all three answers; the JSON is printed only then.
    // Before the answers the card is the questions and one hint: no backups, no way on, so the
    // backups never look like the goal (ruled, round 1).
    expect(within(dialog()).queryByRole('button')).toBeNull()
    expect(within(dialog()).getByText('Answer all three to continue.')).toBeInTheDocument()
    expect(within(dialog()).queryByLabelText('Run JSON')).toBeNull()
    answer('Mental demand', '6')
    answer('Time pressure', '7')
    expect(within(dialog()).queryByRole('button', { name: 'Copy run' })).toBeNull()
    answer('Confidence in your decisions', '5')
    // The backups appear with the rest, in their own row under the way on (ruled R1).
    expect(within(dialog()).getByRole('button', { name: 'Copy run' })).toBeEnabled()
    expect(within(dialog()).queryByText('Answer all three to continue.')).toBeNull()
    // The JSON behind a Show JSON disclosure, closed by default, the textarea inside it for the
    // copy fallback (#36 [39], ruled A).
    const details = within(dialog()).getByText('Show JSON').closest('details') as HTMLElement
    expect(details).not.toHaveAttribute('open')
    expect(details).toContainElement(within(dialog()).getByLabelText('Run JSON'))
    const json = runJsonText()
    expect(JSON.parse(json)).toEqual({
      subject: 'S03',
      scenario: 'default',
      mode: 'raw',
      run: 1,
      build: import.meta.env.VITE_BUILD,
      began_at: NOW,
      events: [
        // The first open writes its select and nothing else (S8-ii, item 4).
        { t: 14, type: 'select', track: id },
        // The re-open after the detail closed is a second look, and the record says so (S8).
        { t: 58, type: 'select', track: id },
        { t: 58, type: 'escalate', track: id },
      ],
      answers: { demand: 6, pressure: 7, confidence: 5 },
    })
    expect(typeof import.meta.env.VITE_BUILD).toBe('string')
    expect(json).not.toMatch(/position|score|band|-75[.]|UAS-|TRK-/)
    const copyNow = within(dialog()).getByRole('button', { name: 'Copy run' })
    fireEvent.click(copyNow)
    await waitFor(() =>
      expect(within(dialog()).getByRole('button', { name: 'Copied' })).toBeInTheDocument(),
    )
    expect(writeText).toHaveBeenCalledWith(json)
  })

  it('in Vigil: draws the config’s sites over a stored plan and leaves the plan for the demo (ruled A13), logs a Queue row’s selection, offers no Resolve, and refuses an action after the end', () => {
    localStorage.setItem(
      STORE_KEY,
      sitePlanText(addSite(fromConfig(AO.protectedSites), [-75.2, 39.8], 600, AO), AO),
    )
    const replay = start('vigil')
    expect(screen.getByTestId('map')).toHaveAttribute('data-sites', 'phl-airfield')
    begin()
    // The run opens on the list already (S8 item 1, ruled) — there is no tab to press.
    replay.tick(20)
    // No layer chips in a run, the state chips kept; every badge a source word, never INJECT
    // (#36 [38], ruled A).
    expect(screen.queryByRole('group', { name: 'Filter by layer' })).toBeNull()
    expect(screen.getByRole('group', { name: 'Filter by state' })).toBeInTheDocument()
    const rows = within(screen.getByRole('list', { name: 'Ranked queue' })).getAllByRole('listitem')
    expect(screen.queryByText('INJECT')).toBeNull()
    for (const row of rows) {
      expect(row.querySelector('.queue__badge--source')?.textContent).toMatch(
        /^(ADS-B|Remote ID|sensor)$/,
      )
    }
    fireEvent.click(within(rows[0]).getByRole('button'))
    const id = screen.getByTestId('map').getAttribute('data-selected')
    expect(id).not.toBe('')
    const drawer = screen.getByRole('complementary', { name: /Track review/ })
    expect(
      within(drawer)
        .getAllByRole('button', { name: /^(Assess|Escalate|Dismiss|Resolve)$/ })
        .map((button) => button.textContent),
    ).toEqual(['Escalate', 'Dismiss'])
    // The open marked the row (S8-ii): the list row and the map agree with the Status row.
    expect(document.querySelector('.queue__row--assessed')).not.toBeNull()
    expect(screen.getByTestId('map')).toHaveAttribute('data-marks', `${id}:assessed`)
    replay.tick(10)
    // The detail closes on the action (S8 item 3, ruled) and the row wears the handled mark.
    fireEvent.click(within(drawer).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('complementary', { name: /Track review/ })).toBeNull()
    expect(document.querySelector('.queue__row--handled')).not.toBeNull()
    replay.tick(330)
    expect(dialog()).toHaveAccessibleName('Run complete — subject S03 · run 1 · +06:00')
    // Refused after the end: a click on the row logs nothing and opens nothing.
    fireEvent.click(
      within(document.querySelector('.queue__row') as HTMLElement).getByRole('button'),
    )
    expect(screen.queryByRole('complementary', { name: /Track review/ })).toBeNull()
    answerAll()
    expect(JSON.parse(runJsonText())).toMatchObject({
      mode: 'vigil',
      events: [
        { t: 20, type: 'select', track: id },
        { t: 30, type: 'dismiss', track: id },
      ],
    })
    expect(localStorage.getItem(STORE_KEY)).not.toBeNull()
  })

  it('in Vigil: acknowledging a card marks nothing — the ring is the open’s alone (S8-ii, item 5)', () => {
    // A card answered from the stack is not a look: the track stays New with no mark, the
    // card clears, and the JSON carries the alert_ack as before. Opening it afterwards marks it.
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve())
    const replay = start('vigil')
    begin()
    const cards = () =>
      within(screen.getByRole('region', { name: 'Alerts' })).queryAllByRole('listitem')
    // UAS-CD84 crosses into warning at 02:38:58 — Begin + 58 on this recording — and raises.
    let t = 0
    while (cards().length === 0 && t < 120) {
      replay.tick()
      t += 1
    }
    const card = cards()[0]
    const ident = card.querySelector('.alert__ident')?.textContent as string
    fireEvent.click(within(card).getByRole('button', { name: 'Acknowledge' }))
    expect(cards()).toHaveLength(0)
    expect(screen.getByTestId('map')).toHaveAttribute('data-marks', '')
    const row = [...document.querySelectorAll('.queue__row')].find((node) =>
      node.textContent?.includes(ident),
    ) as HTMLElement
    expect(row).not.toHaveClass('queue__row--assessed')
    expect(within(row).queryByText('Assessing')).toBeNull()
    const id = row.getAttribute('data-id') as string
    // Opening it afterwards is the look that marks it.
    replay.tick(5)
    fireEvent.click(within(row).getByRole('button'))
    expect(screen.getByTestId('map')).toHaveAttribute('data-marks', `${id}:assessed`)
    replay.tick(360 - t - 5)
    answerAll()
    expect(JSON.parse(runJsonText())).toMatchObject({
      events: [
        { t, type: 'alert_ack', track: id },
        { t: t + 5, type: 'select', track: id },
      ],
    })
    play.mockRestore()
  })

  it('mounts none of it in the demo, in either mode (ruled A8)', () => {
    useSession.mockReturnValue(ready(CAPTURE))
    const { unmount } = render(<App schedule={never} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Cooperative')).toBeInTheDocument()
    expect(screen.getByText('Injects')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sites' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^(Play|Pause)$/ })).toBeInTheDocument()
    expect(screen.getByRole('main')).not.toHaveAttribute('inert')
    // The demo keeps the Seed, the layer chips, and the INJECT badge (#36 [37], [38]).
    expect(screen.getByText('Seed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    expect(screen.getByRole('group', { name: 'Filter by layer' })).toBeInTheDocument()
    expect(screen.getAllByText('INJECT').length).toBeGreaterThan(1)
    unmount()
    useSession.mockReturnValue(ready(CAPTURE, DEFAULT_RECORDING, true, 'raw'))
    render(<App schedule={never} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Cooperative')).toBeInTheDocument()
    expect(field('Playback')).toHaveTextContent(/^[0-9][0-9]:[0-9][0-9]$/)
  })
})

describe('a study run is a session (S6a-iii, #165, items 2, 3 and 8)', () => {
  const NOW = '2026-09-16T01:12:04.000Z'
  /** A run of the prioritization pair, which is a scenario that knows its other half. */
  const paired = (mode: 'raw' | 'vigil', index: number, name = '03a'): SessionState => {
    if (LONG.status !== 'ready') throw new Error('LONG is a ready session')
    return {
      ...LONG,
      session: {
        ...LONG.session,
        mode,
        scenario: { on: true, name, seed: `study-${name}`, runS: 218 },
        study: { subject: 'S03', run: index },
      },
    }
  }
  const open = (session: SessionState, navigate = vi.fn()) => {
    useSession.mockReturnValue(session)
    const replay = manualClock()
    render(<App schedule={replay.schedule} now={() => NOW} navigate={navigate} />)
    return { replay, navigate }
  }
  /** The same, with the results view's door handed in — a chunk that arrives, or one that does not. */
  const openWith = (session: SessionState, loadResults: () => Promise<never>) => {
    useSession.mockReturnValue(session)
    const replay = manualClock()
    render(
      <App
        schedule={replay.schedule}
        now={() => NOW}
        navigate={vi.fn()}
        loadResults={loadResults}
      />,
    )
    return { replay }
  }
  const dialog = () => screen.getByRole('dialog')
  const answer = (group: string, value: string) =>
    fireEvent.click(
      within(within(dialog()).getByRole('group', { name: group })).getByRole('radio', {
        name: value,
      }),
    )
  const answerAll = () => {
    answer('Mental demand', '6')
    answer('Time pressure', '7')
    answer('Confidence in your decisions', '5')
  }
  /** A run as the store holds one — the fields the shell reads back. */
  const savedRun = (index: number) => ({
    subject: 'S03',
    scenario: index === 1 ? '03a' : '03b',
    mode: index === 1 ? 'raw' : 'vigil',
    run: index,
    build: '2.60.0+deadbee',
    began_at: NOW,
    events: [],
    answers: { demand: 6, pressure: 7, confidence: 5 },
  })
  /** Run the window out: Begin, then every tick of the scenario's own length. */
  const toTheEnd = (replay: ReturnType<typeof manualClock>) => {
    fireEvent.click(screen.getByRole('button', { name: 'Begin' }))
    replay.tick(218)
  }

  afterEach(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('vigil.run.')) localStorage.removeItem(key)
    }
  })

  it('saves the run when the third answer lands, and says so', () => {
    const { replay } = open(paired('raw', 1))
    toTheEnd(replay)
    // Nothing is stored until the run is a run: two answers is not three.
    answer('Mental demand', '6')
    answer('Time pressure', '7')
    expect(localStorage.getItem('vigil.run.S03.1')).toBeNull()
    expect(within(dialog()).queryByText(/is saved in this browser/)).toBeNull()
    answer('Confidence in your decisions', '5')
    // What is stored is the run's own text — byte for byte what Copy run puts on the clipboard.
    const stored = localStorage.getItem('vigil.run.S03.1')
    expect(stored).toBe((within(dialog()).getByLabelText('Run JSON') as HTMLTextAreaElement).value)
    expect(JSON.parse(stored as string)).toMatchObject({ subject: 'S03', run: 1, mode: 'raw' })
    expect(within(dialog()).getByText(/is saved in this browser/)).toHaveTextContent(
      'Run 1 is saved in this browser. Start run 2 when you are ready.',
    )
  })

  it('makes the file the way out when the browser will not keep the run', () => {
    const refuse = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const { replay } = open(paired('raw', 1))
    toTheEnd(replay)
    answerAll()
    expect(within(dialog()).getByRole('alert')).toHaveTextContent(
      'This browser would not keep this run. Download it before you close the tab.',
    )
    expect(dialog().querySelector('.run__next')).toHaveTextContent('Download a copy')
    expect(within(dialog()).queryByRole('button', { name: 'Start run 2' })).toBeNull()
    refuse.mockRestore()
  })

  it('Start run 2 opens the pair’s other scenario in the other mode, same subject', () => {
    const { replay, navigate } = open(paired('raw', 1))
    toTheEnd(replay)
    answerAll()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Start run 2' }))
    expect(navigate).toHaveBeenCalledTimes(1)
    const params = new URLSearchParams(navigate.mock.calls[0][0] as string)
    expect(params.get('scenario')).toBe('03b')
    expect(params.get('mode')).toBe('vigil')
    expect(params.get('subject')).toBe('S03')
    expect(params.get('run')).toBe('2')
  })

  it('a link opened again resumes at the first run not yet saved, and never re-runs a saved one', () => {
    localStorage.setItem('vigil.run.S03.1', JSON.stringify(savedRun(1)))
    const { navigate } = open(paired('raw', 1))
    expect(navigate).toHaveBeenCalledTimes(1)
    const params = new URLSearchParams(navigate.mock.calls[0][0] as string)
    expect(params.get('run')).toBe('2')
    // The condition moves with it: run 2 is the other scenario in the other mode (E7).
    expect(params.get('scenario')).toBe('03b')
    expect(params.get('mode')).toBe('vigil')
  })

  it('does not move a link that is already on the first unsaved run', () => {
    const { navigate } = open(paired('raw', 1))
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Begin' })).toBeInTheDocument()
  })

  it('runs a link that asks for a run this browser has not reached, forward only', () => {
    // Nothing saved and the link asks for run 2: it runs run 2 as asked rather than sending the
    // subject back to run 1 under run 2's scenario and mode (E7).
    const { navigate } = open(paired('vigil', 2, '03b'))
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Begin' })).toBeInTheDocument()
  })

  it('makes the shell inert behind the session-complete card, as every other overlay does', () => {
    localStorage.setItem('vigil.run.S03.1', JSON.stringify(savedRun(1)))
    localStorage.setItem('vigil.run.S03.2', JSON.stringify(savedRun(2)))
    open(paired('vigil', 2, '03b'))
    // A card with aria-modal over a shell a subject can still tab into is not a modal at all
    // (round 1, finding 1).
    expect(screen.getByRole('main')).toHaveAttribute('inert')
    expect(screen.getByRole('banner')).toHaveAttribute('inert')
  })

  it('withholds the brief when the run is saved and there is no next link, on any scenario', () => {
    // A scenario with no pair — the default deal — has no run 2 to send anyone to, so forward
    // only would have fallen through to the brief and re-run a saved run (round 1, finding 3).
    localStorage.setItem(
      'vigil.run.S03.1',
      JSON.stringify({ ...savedRun(1), scenario: 'default', mode: 'raw' }),
    )
    if (LONG.status !== 'ready') throw new Error('LONG is a ready session')
    const { navigate } = open({
      ...LONG,
      session: { ...LONG.session, mode: 'raw', study: { subject: 'S03', run: 1 } },
    })
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Begin' })).toBeNull()
    expect(screen.getByText('Already run — subject S03')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download run 1' })).toBeInTheDocument()
    // And the saved run is still the saved run: nothing re-ran and nothing was overwritten.
    expect(JSON.parse(localStorage.getItem('vigil.run.S03.1') as string)).toMatchObject({
      scenario: 'default',
      run: 1,
    })
  })

  it('sends a resumed link once, not once per render (round 1, finding 4)', () => {
    // Rendered without injecting `navigate`, so the default's identity is what decides: an
    // inline arrow rebuilt each render re-fires the effect it is a dependency of.
    localStorage.setItem('vigil.run.S03.1', JSON.stringify(savedRun(1)))
    const sent: string[] = []
    const real = Object.getOwnPropertyDescriptor(window, 'location')
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        get search() {
          return '?scenario=03a&mode=raw&subject=S03&run=1'
        },
        set search(next: string) {
          sent.push(next)
        },
      },
    })
    useSession.mockReturnValue(paired('raw', 1))
    const replay = manualClock()
    const { rerender } = render(<App schedule={replay.schedule} now={() => NOW} />)
    // A render that changes nothing must send nothing more. With an inline-arrow default the
    // effect's dependency is a new function here and the subject is sent again.
    rerender(<App schedule={replay.schedule} now={() => NOW} />)
    rerender(<App schedule={replay.schedule} now={() => NOW} />)
    expect(sent).toHaveLength(1)
    expect(new URLSearchParams(sent[0]).get('run')).toBe('2')
    if (real) Object.defineProperty(window, 'location', real)
  })

  it('opens on the list with no tab bar, and the detail in place (item 1)', () => {
    const { replay } = open(paired('vigil', 1))
    fireEvent.click(screen.getByRole('button', { name: 'Begin' }))
    replay.tick(1)
    // Two tabs cost a click and explain nothing, and a subject who lands on Home sees no list.
    expect(screen.queryByRole('navigation', { name: 'Surfaces' })).toBeNull()
    expect(
      screen.getByRole('heading', { name: 'Priority list — highest first' }),
    ).toBeInTheDocument()
    expect(document.querySelector('.queue__row')).not.toBeNull()
    // Resolve is withheld here, so a chip filtering for Resolved names a state no one can reach.
    const states = screen.getByRole('group', { name: 'Filter by state' })
    expect(within(states).queryByRole('button', { name: 'Resolved' })).toBeNull()
    expect(within(states).getByRole('button', { name: 'Dismissed' })).toBeInTheDocument()
    // The detail opens in place on selection, from the list.
    fireEvent.click(
      within(document.querySelector('.queue__row') as HTMLElement).getByRole('button'),
    )
    expect(screen.getByRole('complementary', { name: /Track review/ })).toBeInTheDocument()
  })

  it('shows the selection ring and the trail in a run, in both conditions (round 1, 1 and 2)', () => {
    // A study run never changes `surfaceId`, which stays `home` from mount, so reading it here
    // withheld the ring and the trail from a whole Vigil run — and S10's lines are drawn on the
    // trail. Pinned on the run itself, in both conditions, so a rename cannot take it again.
    for (const mode of ['vigil', 'raw'] as const) {
      const { replay } = open(paired(mode, 1))
      fireEvent.click(screen.getByRole('button', { name: 'Begin' }))
      replay.tick(1)
      fireEvent.click(screen.getByTestId('map-select'))
      const map = screen.getByTestId('map')
      expect(map).toHaveAttribute('data-selection-shown', 'true')
      expect(map.getAttribute('data-selected')).not.toBe('')
      cleanup()
    }
  })

  it('escalates an untouched track in one click, and closes the detail on it (ruled)', () => {
    const { replay } = open(paired('vigil', 1))
    fireEvent.click(screen.getByRole('button', { name: 'Begin' }))
    replay.tick(1)
    const row = document.querySelector('.queue__row') as HTMLElement
    fireEvent.click(within(row).getByRole('button'))
    const escalate = screen.getByRole('button', { name: 'Escalate' })
    expect(escalate).toBeEnabled()
    fireEvent.click(escalate)
    // No picker, no confirm: the click is the escalation.
    expect(screen.queryByRole('button', { name: 'Confirm escalation' })).toBeNull()
    // The subject is done with this track, so the panel closes and its mark says what they did.
    expect(screen.queryByRole('complementary', { name: /Track review/ })).toBeNull()
    expect(document.querySelector('.queue__row--handled')).not.toBeNull()
    expect(document.querySelector('.queue__row--assessed')).toBeNull()
  })

  it('marks a track at its first open — the ring, the Status row and the list row agree — withholds Assess, and a re-open changes nothing (S8-ii, amendment items 1, 2 and 4)', () => {
    const { replay } = open(paired('vigil', 1))
    fireEvent.click(screen.getByRole('button', { name: 'Begin' }))
    replay.tick(1)
    const row = document.querySelector('.queue__row') as HTMLElement
    const id = row.getAttribute('data-id') as string
    fireEvent.click(within(row).getByRole('button'))
    // At the click: no dwell, nothing appearing later. The map's mark, the row's class and the
    // drawer's Status row all read the one status.
    expect(screen.getByTestId('map')).toHaveAttribute('data-marks', `${id}:assessed`)
    expect(row).toHaveClass('queue__row--assessed')
    expect(within(row).getByText('Assessing')).toBeInTheDocument()
    const detail = screen.getByRole('complementary', { name: /Track review/ })
    expect(within(detail).getByText('Status').nextElementSibling).toHaveTextContent('Assessing')
    // The Assess button is withheld (item 2); the two that stay are live in one click.
    expect(within(detail).queryByRole('button', { name: 'Assess' })).toBeNull()
    expect(within(detail).getByRole('button', { name: 'Escalate' })).toBeEnabled()
    expect(within(detail).getByRole('button', { name: 'Dismiss' })).toBeEnabled()
    // A re-open is a second look on the record, and nothing else moves.
    fireEvent.click(within(detail).getByRole('button', { name: 'Close review' }))
    replay.tick(4)
    fireEvent.click(within(row).getByRole('button'))
    expect(screen.getByTestId('map')).toHaveAttribute('data-marks', `${id}:assessed`)
    expect(document.querySelectorAll('.queue__row--assessed')).toHaveLength(1)
    // The run JSON's shape does not move (item 4): a first open writes its select and nothing
    // else, and the re-open is one more select.
    replay.tick(213)
    answerAll()
    const json = (within(dialog()).getByLabelText('Run JSON') as HTMLTextAreaElement).value
    expect(JSON.parse(json)).toMatchObject({
      events: [
        { t: 1, type: 'select', track: id },
        { t: 5, type: 'select', track: id },
      ],
    })
  })

  it('says Escalated and nothing after it when there is no recipient (round 1, 3)', () => {
    // The picker is gone, so `recipient` is undefined; formatting it unconditionally printed
    // *Escalated — to undefined* on a subject's screen.
    const { replay } = open(paired('vigil', 1))
    fireEvent.click(screen.getByRole('button', { name: 'Begin' }))
    replay.tick(1)
    fireEvent.click(
      within(document.querySelector('.queue__row') as HTMLElement).getByRole('button'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Escalate' }))
    fireEvent.click(
      within(document.querySelector('.queue__row') as HTMLElement).getByRole('button'),
    )
    const panel = screen.getByRole('complementary', { name: /Track review/ })
    const entries = [...panel.querySelectorAll('.drawer__event')].map((row) => row.textContent)
    expect(entries.some((text) => text?.includes('Escalated'))).toBe(true)
    expect(entries.every((text) => !text?.includes('to undefined'))).toBe(true)
    expect(panel.textContent).not.toContain('undefined')
  })

  it('draws the detail with no image area at all, so nothing beneath it moves (round 1, 6)', () => {
    // Reserving the area puts back the empty box R2 removed; withholding it until a photo lands
    // moves every row beneath it when one does. So it is withheld for the whole run.
    const { replay } = open(paired('vigil', 1))
    fireEvent.click(screen.getByRole('button', { name: 'Begin' }))
    replay.tick(1)
    fireEvent.click(
      within(document.querySelector('.queue__row') as HTMLElement).getByRole('button'),
    )
    expect(document.querySelector('.visuals__image')).toBeNull()
    expect(document.querySelector('.visuals')?.children).toHaveLength(2)
    expect(document.querySelector('.visuals__class')).not.toBeNull()
  })

  it('leaves the demo’s shell and its lifecycle alone', () => {
    useSession.mockReturnValue(LONG)
    render(<App schedule={manualClock().schedule} now={() => NOW} />)
    const nav = screen.getByRole('navigation', { name: 'Surfaces' })
    expect(nav).toBeInTheDocument()
    fireEvent.click(within(nav).getByRole('button', { name: 'Queue' }))
    const states = screen.getByRole('group', { name: 'Filter by state' })
    expect(within(states).getByRole('button', { name: 'Resolved' })).toBeInTheDocument()
    // And the demo's own lifecycle: Escalate still follows an Assess there.
    fireEvent.click(
      within(document.querySelector('.queue__row') as HTMLElement).getByRole('button'),
    )
    expect(screen.getByRole('button', { name: 'Escalate' })).toBeDisabled()
    // A click marks nothing in the demo, where Assess is still a pressed button (S8-ii, item 8).
    expect(screen.getByRole('button', { name: 'Assess' })).toBeEnabled()
    expect(document.querySelector('.queue__row--assessed')).toBeNull()
    expect(screen.getByTestId('map')).toHaveAttribute('data-marks', '')
  })

  it('does not offer a run this browser already holds, however the session was run', () => {
    // Run 2 first, then run 1 — a direct run-2 link is run as asked (E7), so this is reachable.
    // The way on must read what the store holds now, not what it held when the page opened.
    localStorage.setItem('vigil.run.S03.2', JSON.stringify(savedRun(2)))
    const { replay } = open(paired('raw', 1))
    toTheEnd(replay)
    answerAll()
    expect(within(dialog()).getByText(/is saved in this browser/)).toHaveTextContent(
      'Run 1 is saved in this browser.',
    )
    expect(within(dialog()).queryByRole('button', { name: 'Start run 2' })).toBeNull()
    // And the run that was already there is untouched.
    expect(JSON.parse(localStorage.getItem('vigil.run.S03.2') as string)).toMatchObject({
      run: 2,
    })
  })

  it('opens the results on the click, and not before (S6a-ii, ruled R1)', async () => {
    localStorage.setItem('vigil.run.S03.1', JSON.stringify(savedRun(1)))
    const { replay } = open(paired('vigil', 2, '03b'))
    toTheEnd(replay)
    answerAll()
    // The chunk is fetched on the click and nowhere else: never at load, never at Begin,
    // never on run 1's end screen.
    expect(within(dialog()).getByRole('button', { name: 'See your results' })).toBeInTheDocument()
    expect(document.querySelector('.sheet')).toBeNull()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'See your results' }))
    await waitFor(() => expect(document.querySelector('.sheet')).not.toBeNull())
    // The results stand in the shell’s place rather than after it (ruled E8).
    expect(screen.queryByRole('main')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  }, 30_000)

  it('says which run is missing rather than offering results it cannot draw', () => {
    // Run 2 run on its own link with run 1 never saved (E7): there is nothing to draw.
    const { replay } = open(paired('vigil', 2, '03b'))
    toTheEnd(replay)
    answerAll()
    expect(within(dialog()).queryByRole('button', { name: 'See your results' })).toBeNull()
    expect(within(dialog()).getByRole('alert')).toHaveTextContent(
      'Your other run is not saved in this browser, so your results cannot be drawn here.',
    )
    expect(dialog().querySelector('.run__next')).toHaveTextContent('Download a copy')
  }, 30_000)

  it('offers the results on the run that completes the session, whichever it is (ruled)', () => {
    // Run 2 taken first on its own link, then run 1. The way on follows what is saved, not the
    // run number: with both in this browser run 1's end screen is where the session ends, so it
    // carries *See your results*. Reading `study.run` left this screen with no way on at all.
    localStorage.setItem('vigil.run.S03.2', JSON.stringify(savedRun(2)))
    const { replay } = open(paired('raw', 1))
    toTheEnd(replay)
    answerAll()
    const card = dialog().querySelector('.run__card') as HTMLElement
    expect(card.querySelector('.run__next')).toHaveTextContent('See your results')
    expect(card.querySelectorAll('.run__button')).toHaveLength(1)
    expect(within(dialog()).getByText(/is saved in this browser/)).toHaveTextContent(
      'Run 1 is saved in this browser. Your results are ready.',
    )
    // And no words about a missing run, because none is missing.
    expect(within(dialog()).queryByRole('alert')).toBeNull()
  }, 30_000)

  it('says so on the screen when the results chunk will not load', async () => {
    localStorage.setItem('vigil.run.S03.1', JSON.stringify(savedRun(1)))
    // The door is the one place that chunk is fetched, so a fetch that fails is the only way it
    // can fail. Unhandled, the button did nothing at all and said nothing either.
    const { replay } = openWith(paired('vigil', 2, '03b'), () =>
      Promise.reject(new Error('Failed to fetch dynamically imported module')),
    )
    toTheEnd(replay)
    answerAll()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'See your results' }))
    await waitFor(() =>
      expect(within(dialog()).getByRole('alert')).toHaveTextContent(
        'Your results did not load — Failed to fetch dynamically imported module. Reload the page and press it again.',
      ),
    )
    // The way on stays, because pressing it again retries.
    expect(within(dialog()).getByRole('button', { name: 'See your results' })).toBeInTheDocument()
  }, 30_000)

  it('shows the session as complete rather than the brief when both runs are saved', () => {
    localStorage.setItem('vigil.run.S03.1', JSON.stringify(savedRun(1)))
    localStorage.setItem('vigil.run.S03.2', JSON.stringify(savedRun(2)))
    const { navigate } = open(paired('vigil', 2, '03b'))
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Begin' })).toBeNull()
    expect(screen.getByText('Session complete — subject S03')).toBeInTheDocument()
    expect(screen.getByText(/Both of your runs are saved in this browser/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download run 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download run 2' })).toBeInTheDocument()
    // The card reads in the same order the end screen does (ruled R1): the way on as its one
    // primary, then the files as a quiet row that says it is optional.
    const card = document.querySelector('.run__card') as HTMLElement
    expect(card.querySelectorAll('.run__button')).toHaveLength(1)
    expect(card.querySelector('.run__next')).toHaveTextContent('See your results')
    expect(card.querySelector('.run__optional')).toHaveTextContent('Optional backup:')
    expect(
      card
        .querySelector('.run__next')
        ?.compareDocumentPosition(card.querySelector('.run__optional') as Node),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })
})
