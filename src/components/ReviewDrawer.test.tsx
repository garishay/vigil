import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode, type ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewDrawer } from './ReviewDrawer'
import type { ProtectedSite } from '../config/ao'
import { simClock } from '../lib/display'
import { CONTACTS } from '../config/contacts'
import { DISPOSITIONS } from '../config/dispositions'
import { appendEvent, firstSeen, observedSnapshot, type TrackEvent } from '../lib/lifecycle'
import type { RankedTrack } from '../lib/ranking'
import { scoreTrack } from '../lib/scoring'
import type { AdsbTrack, InjectTrack } from '../lib/tracks'

const SILENT: InjectTrack = {
  id: 'inject-05',
  source: 'inject',
  behavior: 'loiter',
  remoteId: 'silent',
  uaType: null,
  identity: 'non-cooperative',
  callsign: null,
  position: [-75.20547, 39.81341],
  altitudeFt: 63,
  onGround: false,
  groundSpeedKt: 19.1,
  headingDeg: 345.6,
  verticalRateFpm: 85,
  lastSeenSec: 0,
}

const PARKED: AdsbTrack = {
  id: 'adsb-a3303d',
  source: 'adsb',
  icaoHex: 'a3303d',
  identity: 'cooperative',
  callsign: null,
  position: [-75.26544, 39.86816],
  altitudeFt: 0,
  onGround: true,
  groundSpeedKt: 0,
  headingDeg: null,
  verticalRateFpm: null,
  lastSeenSec: 38,
  category: null,
  registry: null,
}

// Two sites, decoy first: the drawer must name the site the range was measured to, not `[0]`.
const SITES: ProtectedSite[] = [
  { id: 'decoy', name: 'Decoy Stadium', center: [-75.17, 39.9], radiusM: 1000 },
  { id: 'phl-airfield', name: 'PHL Airfield', center: [-75.2411, 39.8721], radiusM: 5000 },
]

const entry = (track: InjectTrack | AdsbTrack, rank: number, rangeM: number): RankedTrack => ({
  track,
  rank,
  rangeM,
  siteId: 'phl-airfield',
  score: scoreTrack(track, SITES, { tSec: 0, minuteOfDay: 150, memory: {} }),
})

/** The photo tier is 03d's and tested in TrackVisuals.test.tsx; here it answers nothing. */
const noPhoto = async () => null

const openLog = (ranked: RankedTrack): TrackEvent[] =>
  firstSeen(ranked.track.id, observedSnapshot(ranked), '2026-09-01T12:04:31.000Z')

const walk = (ranked: RankedTrack, ...steps: ('assess' | 'escalate' | 'dismiss' | 'resolve')[]) => {
  const times = ['2026-09-01T12:06:02.000Z', '2026-09-01T12:07:45.000Z', '2026-09-01T12:09:12.000Z']
  return steps.reduce(
    (log, action, index) =>
      appendEvent(log, action, {
        at: times[index],
        tSec: 0,
        observed: observedSnapshot(ranked),
        ...(action === 'escalate' ? { recipient: 'phl-tower' as const } : {}),
        ...(action === 'resolve' ? { disposition: 'benign' as const } : {}),
      }),
    openLog(ranked),
  )
}

const renderDrawer = (
  ranked: RankedTrack,
  props: Partial<ComponentProps<typeof ReviewDrawer>> = {},
) =>
  render(
    <ReviewDrawer
      lookupPhoto={noPhoto}
      entry={ranked}
      sites={SITES}
      log={openLog(ranked)}
      contacts={CONTACTS}
      dispositions={DISPOSITIONS}
      onAction={vi.fn()}
      onClose={vi.fn()}
      clock={(tSec) => simClock('02:30', tSec)}
      tSec={0}
      trail={{ count: 1, windowS: 120 }}
      {...props}
    />,
  )

afterEach(() => {
  vi.unstubAllGlobals()
  // jsdom ships no execCommand; tests that stub one must not leak it into tests written
  // against its absence — cleaned here so a mid-test failure cannot cascade (#47 review).
  Reflect.deleteProperty(document, 'execCommand')
})

describe('ReviewDrawer', () => {
  it('names the track by the observed-or-derived rule, never the inject id', () => {
    renderDrawer(entry(SILENT, 1, 7200.2))
    expect(screen.getByRole('heading', { name: 'TRK-05' })).toBeInTheDocument()
    expect(screen.getByLabelText('Track review: TRK-05')).toBeInTheDocument()
    expect(screen.queryByText(/inject-\d/)).not.toBeInTheDocument()
  })

  it('shows identity, the layer badge, rank, and range to the named site', () => {
    renderDrawer(entry(SILENT, 1, 7200.2))
    // Unique again: the breakdown's cooperativity row is labelled Identity (ruled on #65).
    expect(screen.getByText('Non-cooperative')).toBeInTheDocument()
    expect(screen.getByText('INJECT')).toBeInTheDocument()
    // Named from entry.siteId, not sites[0]: the decoy site sits first in SITES on purpose.
    expect(screen.getByText('7.2 km to PHL Airfield')).toBeInTheDocument()
    expect(screen.queryByText(/Decoy Stadium/)).not.toBeInTheDocument()
    const rank = screen.getByText('Rank').parentElement as HTMLElement
    expect(within(rank).getByText('1')).toBeInTheDocument()
  })

  it('displays observed and derived fields only — never the ground truth', () => {
    renderDrawer(entry(SILENT, 1, 7200.2))
    const drawer = screen.getByLabelText('Track review: TRK-05')
    // The UA types join the sweep (03c): a silent inject's is never heard, so never shown.
    expect(drawer.textContent).not.toMatch(
      /loiter|silent|intermittent|broadcasting|multirotor|aeroplane|hybrid/i,
    )
  })

  it('renders an unbroadcast value as an em dash, never a zero', () => {
    renderDrawer(entry(PARKED, 57, 2122.9))
    const heading = screen.getByText('Heading').parentElement as HTMLElement
    expect(within(heading).getByText('—')).toBeInTheDocument()
    const vs = screen.getByText('Vertical rate').parentElement as HTMLElement
    expect(within(vs).getByText('—')).toBeInTheDocument()
    // A real zero stays a zero: the parked aircraft's ground level is a reading, not a gap.
    const alt = screen.getByText('Altitude').parentElement as HTMLElement
    expect(within(alt).getByText('0 ft')).toBeInTheDocument()
    // Same for ground speed: the parked aircraft's broadcast 0 kt is a reading, not a gap (#35).
    const gs = screen.getByText('Ground speed').parentElement as HTMLElement
    expect(within(gs).getByText('0 kt')).toBeInTheDocument()
    expect(screen.getByText('on ground')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'a3303d' })).toBeInTheDocument()
  })

  it('shows the heading in integer degrees, the same number the handoff prints (#49)', () => {
    const ranked = entry(SILENT, 1, 7200.2)
    renderDrawer(ranked, { log: walk(ranked, 'assess', 'escalate') })
    const heading = screen.getByText('Heading').parentElement as HTMLElement
    expect(within(heading).getByText('346°')).toBeInTheDocument()
    expect(within(heading).queryByText(/345\.6/)).not.toBeInTheDocument()
    // Same observation, same drawer, same number — one helper feeds both surfaces.
    const text = screen.getByLabelText('Handoff text') as HTMLTextAreaElement
    expect(text.value).toContain('hdg 346')
  })

  it('wraps a heading that rounds up to north, never printing 360° (#51 review)', () => {
    renderDrawer(entry({ ...SILENT, headingDeg: 359.7 }, 1, 7200.2))
    const heading = screen.getByText('Heading').parentElement as HTMLElement
    expect(within(heading).getByText('0°')).toBeInTheDocument()
  })

  it('dashes an unreported ground speed instead of asserting a hover (#35)', () => {
    // The shape from the recording that motivated #35: positive altitude, no speed broadcast.
    const positionOnly: AdsbTrack = {
      ...PARKED,
      id: 'adsb-ae2683',
      icaoHex: 'ae2683',
      altitudeFt: 525,
      onGround: false,
      groundSpeedKt: null,
    }
    renderDrawer(entry(positionOnly, 3, 4100.0))
    const gs = screen.getByText('Ground speed').parentElement as HTMLElement
    expect(within(gs).getByText('—')).toBeInTheDocument()
  })

  it('opens the score to its factors in the breakdown, and still reserves the history (04b)', () => {
    const ranked = entry(SILENT, 1, 7200.2)
    renderDrawer(ranked)
    const breakdown = screen.getByLabelText('Score breakdown')
    expect(
      within(breakdown).getByText(`Score ${Math.round(ranked.score.composite)}`),
    ).toBeInTheDocument()
    expect(within(breakdown).getAllByRole('listitem')).toHaveLength(6)
    expect(document.querySelector('.drawer__slot')).toBeNull()
    expect(screen.getByText(/1 known position/)).toBeInTheDocument()
  })

  it('shows a silent inject the kinematic class, labelled as such, and no registry rows (03c)', () => {
    renderDrawer(entry(SILENT, 1, 7200.2))
    const visuals = screen.getByLabelText('Track visuals')
    expect(within(visuals).getByText('Small UAS (kinematic class)')).toBeInTheDocument()
    expect(
      within(visuals).getByText('from the observed envelope — 63 ft, 19.1 kt; no ident heard'),
    ).toBeInTheDocument()
    expect(visuals.querySelector('[data-airframe="unknown"]')).not.toBeNull()
    for (const label of ['Category', 'Type', 'Registration'])
      expect(screen.queryByText(label)).not.toBeInTheDocument()
  })

  it('shows a heard inject its UA-type silhouette, and loses it with the ident (03c)', () => {
    const heard: InjectTrack = {
      ...SILENT,
      id: 'inject-01',
      remoteId: 'intermittent',
      identity: 'cooperative',
      callsign: 'UAS-7CD5',
      uaType: 'multirotor',
    }
    const { rerender } = renderDrawer(entry(heard, 5, 6500))
    const visuals = () => screen.getByLabelText('Track visuals')
    expect(within(visuals()).getByText('Small multirotor')).toBeInTheDocument()
    expect(
      within(visuals()).getByText(
        'from Remote ID UA type — helicopter or multirotor (heard this frame)',
      ),
    ).toBeInTheDocument()
    expect(visuals().querySelector('[data-airframe="small-multirotor"]')).not.toBeNull()

    // The same inject on a frame its broadcast is not heard: the observed-only rule, kept.
    const unheard = entry({ ...heard, identity: 'unknown', callsign: null, uaType: null }, 5, 6500)
    rerender(
      <ReviewDrawer
        lookupPhoto={noPhoto}
        entry={unheard}
        sites={SITES}
        log={openLog(unheard)}
        contacts={CONTACTS}
        dispositions={DISPOSITIONS}
        onAction={vi.fn()}
        onClose={vi.fn()}
        clock={(tSec) => simClock('02:30', tSec)}
        tSec={0}
        trail={{ count: 1, windowS: 120 }}
      />,
    )
    expect(within(visuals()).getByText('Small UAS (kinematic class)')).toBeInTheDocument()
    expect(within(visuals()).queryByText(/multirotor/)).not.toBeInTheDocument()
  })

  it('shows an ADS-B track its class from the type code, with the three rows labelled (03c)', () => {
    const airliner: AdsbTrack = {
      ...PARKED,
      id: 'adsb-a0540a',
      icaoHex: 'a0540a',
      callsign: 'DAL989',
      altitudeFt: 2175,
      onGround: false,
      groundSpeedKt: 180,
      category: 'A3',
      registry: { typeCode: 'A321', registration: 'N120DN' },
    }
    renderDrawer(entry(airliner, 12, 3400))
    const visuals = screen.getByLabelText('Track visuals')
    expect(within(visuals).getByText('Narrowbody')).toBeInTheDocument()
    expect(within(visuals).getByText('from type code A321 (registry lookup)')).toBeInTheDocument()
    expect(visuals.querySelector('[data-airframe="narrowbody"]')).not.toBeNull()
    const row = (label: string) => screen.getByText(label).parentElement as HTMLElement
    expect(within(row('Category')).getByText('A3 — large (broadcast)')).toBeInTheDocument()
    expect(within(row('Type')).getByText('A321 (lookup)')).toBeInTheDocument()
    expect(within(row('Registration')).getByText('N120DN (lookup)')).toBeInTheDocument()
    // Rows in the mockup's order: after Range, before the kinematics.
    const labels = Array.from(document.querySelectorAll('.drawer__row dt')).map(
      (dt) => dt.textContent,
    )
    expect(labels.slice(2, 6)).toEqual(['Range', 'Category', 'Type', 'Registration'])
  })

  it('shows an ADS-B track with no enrichment as unknown, rows dashed, never small-UAS (03c)', () => {
    renderDrawer(entry(PARKED, 57, 2122.9))
    const visuals = screen.getByLabelText('Track visuals')
    expect(within(visuals).getByText('Unknown airframe')).toBeInTheDocument()
    expect(
      within(visuals).getByText('no emitter category broadcast, no registry type'),
    ).toBeInTheDocument()
    expect(within(visuals).queryByText(/kinematic/)).not.toBeInTheDocument()
    for (const label of ['Category', 'Type', 'Registration']) {
      const row = screen.getByText(label).parentElement as HTMLElement
      expect(within(row).getByText('—')).toBeInTheDocument()
    }
  })

  it('closes through its close button', () => {
    const onClose = vi.fn()
    renderDrawer(entry(SILENT, 1, 7200.2), { onClose })
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows the status from the log, and every action disabled or enabled by it (03b)', () => {
    const ranked = entry(SILENT, 1, 7200.2)
    const { rerender, container } = renderDrawer(ranked)
    const status = () => screen.getByText('Status').parentElement as HTMLElement
    const button = (name: string) => screen.getByRole('button', { name })

    // New: the whole vocabulary is on screen, only the legal half of it enabled.
    expect(within(status()).getByText('New')).toBeInTheDocument()
    expect(button('Assess')).toBeEnabled()
    expect(button('Dismiss')).toBeEnabled()
    expect(button('Escalate')).toBeDisabled()
    expect(button('Resolve')).toBeDisabled()

    rerender(
      <ReviewDrawer
        lookupPhoto={noPhoto}
        entry={ranked}
        sites={SITES}
        log={walk(ranked, 'assess')}
        contacts={CONTACTS}
        dispositions={DISPOSITIONS}
        onAction={vi.fn()}
        onClose={vi.fn()}
        clock={(tSec) => simClock('02:30', tSec)}
        tSec={0}
        trail={{ count: 1, windowS: 120 }}
      />,
    )
    expect(within(status()).getByText('Assessing')).toBeInTheDocument()
    expect(button('Assess')).toBeDisabled()
    expect(button('Escalate')).toBeEnabled()

    rerender(
      <ReviewDrawer
        lookupPhoto={noPhoto}
        entry={ranked}
        sites={SITES}
        log={walk(ranked, 'assess', 'escalate', 'resolve')}
        contacts={CONTACTS}
        dispositions={DISPOSITIONS}
        onAction={vi.fn()}
        onClose={vi.fn()}
        clock={(tSec) => simClock('02:30', tSec)}
        tSec={0}
        trail={{ count: 1, windowS: 120 }}
      />,
    )
    expect(within(status()).getByText('Resolved')).toBeInTheDocument()
    for (const name of ['Assess', 'Escalate', 'Dismiss', 'Resolve'])
      expect(button(name)).toBeDisabled()
    expect(container.querySelector('.drawer__status')).not.toBeNull()
  })

  it('fires Assess and Dismiss directly (03b)', () => {
    const onAction = vi.fn()
    renderDrawer(entry(SILENT, 1, 7200.2), { onAction })
    fireEvent.click(screen.getByRole('button', { name: 'Assess' }))
    expect(onAction).toHaveBeenCalledWith('assess')
  })

  it('escalates through the picker, and Cancel backs out without an event (03b)', () => {
    const ranked = entry(SILENT, 1, 7200.2)
    const onAction = vi.fn()
    renderDrawer(ranked, { log: walk(ranked, 'assess'), onAction })

    // Cancel: the picker closes and nothing fires (ruled on #3).
    fireEvent.click(screen.getByRole('button', { name: 'Escalate' }))
    expect(screen.getByText('Escalate to:')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Escalate to:')).not.toBeInTheDocument()
    expect(onAction).not.toHaveBeenCalled()

    // Confirm requires a recipient, then carries it.
    fireEvent.click(screen.getByRole('button', { name: 'Escalate' }))
    const confirm = screen.getByRole('button', { name: 'Confirm escalation' })
    expect(confirm).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: 'PHL Tower' }))
    fireEvent.click(confirm)
    expect(onAction).toHaveBeenCalledWith('escalate', { recipient: 'phl-tower' })
    expect(screen.queryByText('Escalate to:')).not.toBeInTheDocument()
  })

  it('resolves through a disposition drawn from the config list, never free text (03b)', () => {
    const ranked = entry(SILENT, 1, 7200.2)
    const onAction = vi.fn()
    renderDrawer(ranked, { log: walk(ranked, 'assess', 'escalate'), onAction })

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(screen.getByText('Resolve as:')).toBeInTheDocument()
    // The closed vocabulary from config — a selection, not an input (ruled on #3). The only
    // textarea on the surface is the read-only handoff.
    expect(document.querySelector('input[type="text"], textarea:not([readonly])')).toBeNull()
    for (const disposition of DISPOSITIONS)
      expect(screen.getByRole('radio', { name: disposition.label })).toBeInTheDocument()

    const confirm = screen.getByRole('button', { name: 'Confirm resolution' })
    expect(confirm).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: 'Departed AO' }))
    fireEvent.click(confirm)
    expect(onAction).toHaveBeenCalledWith('resolve', { disposition: 'departed-ao' })
  })

  it('steals no focus on mount, StrictMode double-mount included (03b)', () => {
    const ranked = entry(SILENT, 1, 7200.2)
    // StrictMode's dev remount re-runs the effect with refs intact; the guard must key on an
    // actual [status, pending] transition, not on "first run" (#47 round 5).
    render(
      <StrictMode>
        <ReviewDrawer
          lookupPhoto={noPhoto}
          entry={ranked}
          sites={SITES}
          log={walk(ranked, 'assess')}
          contacts={CONTACTS}
          dispositions={DISPOSITIONS}
          onAction={vi.fn()}
          onClose={vi.fn()}
          clock={(tSec) => simClock('02:30', tSec)}
          tSec={0}
          trail={{ count: 1, windowS: 120 }}
        />
      </StrictMode>,
    )
    expect(document.activeElement).toBe(document.body)
  })

  it('skips focus recovery after a mouse-driven action (03b round 6)', () => {
    const ranked = entry(SILENT, 1, 7200.2)
    const { rerender } = renderDrawer(ranked)
    // A real mouse click carries a positive detail; recovery must stand down, or Space would
    // activate the parked button instead of scrolling. (Keyboard activation dispatches detail
    // 0 — the shape every other test's fireEvent.click uses, keeping recovery covered there.)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }), { detail: 1 })
    rerender(
      <ReviewDrawer
        lookupPhoto={noPhoto}
        entry={ranked}
        sites={SITES}
        log={walk(ranked, 'dismiss')}
        contacts={CONTACTS}
        dispositions={DISPOSITIONS}
        onAction={vi.fn()}
        onClose={vi.fn()}
        clock={(tSec) => simClock('02:30', tSec)}
        tSec={0}
        trail={{ count: 1, windowS: 120 }}
      />,
    )
    expect(document.activeElement).toBe(document.body)
  })

  it('catches the focus a disabled action drops, landing on the next legal one (03b)', () => {
    const ranked = entry(SILENT, 1, 7200.2)
    const { rerender } = renderDrawer(ranked, { log: walk(ranked, 'assess') })
    const props = {
      entry: ranked,
      sites: SITES,
      contacts: CONTACTS,
      dispositions: DISPOSITIONS,
      onAction: vi.fn(),
      onClose: vi.fn(),
      lookupPhoto: noPhoto,
      clock: (tSec: number) => simClock('02:30', tSec),
      tSec: 0,
      trail: { count: 1, windowS: 120 },
    }
    // Mount steals nothing: engines that don't focus clicked buttons (Safari) leave focus on
    // body during mouse use, and opening a track must not yank it into the drawer (#47 round 4).
    expect(document.activeElement).toBe(document.body)
    // Browsers blur a button the moment it re-renders disabled; jsdom does not, so the drop to
    // body is simulated between steps. The guard must land on the next legal action.
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    rerender(<ReviewDrawer {...props} log={walk(ranked, 'assess', 'escalate')} />)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Resolve' }))
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    rerender(<ReviewDrawer {...props} log={walk(ranked, 'assess', 'escalate', 'resolve')} />)
    // Terminal: every action is disabled, so Close is the one legal landing.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close review' }))
  })

  it('renders the event log oldest-first, ids resolved to display names (03b)', () => {
    const ranked = entry(SILENT, 1, 7200.2)
    renderDrawer(ranked, { log: walk(ranked, 'assess', 'escalate') })
    const log = screen.getByLabelText('Event log')
    const lines = within(log)
      .getAllByRole('listitem')
      .map((item) => item.textContent)
    expect(lines).toEqual([
      '02:30:00New — first seen',
      '02:30:00Assessing — claimed',
      '02:30:00Escalated — to PHL Tower',
    ])
  })

  it('shows the handoff once escalated, still there after resolve, and copies it (03b)', async () => {
    const ranked = entry(SILENT, 1, 7200.2)
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })

    const { rerender } = renderDrawer(ranked, { log: walk(ranked, 'assess') })
    expect(screen.queryByLabelText('Handoff summary')).not.toBeInTheDocument()

    rerender(
      <ReviewDrawer
        lookupPhoto={noPhoto}
        entry={ranked}
        sites={SITES}
        log={walk(ranked, 'assess', 'escalate', 'resolve')}
        contacts={CONTACTS}
        dispositions={DISPOSITIONS}
        onAction={vi.fn()}
        onClose={vi.fn()}
        clock={(tSec) => simClock('02:30', tSec)}
        tSec={0}
        trail={{ count: 1, windowS: 120 }}
      />,
    )
    const text = screen.getByLabelText('Handoff text') as HTMLTextAreaElement
    expect(text.value).toContain('VIGIL HANDOFF\nDemonstration only — not for operational use')
    expect(text.value).toContain('To: PHL Tower')
    expect(text.value).toContain('Resolved — Benign')

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument())
    expect(writeText).toHaveBeenCalledWith(text.value)
  })

  it('confirms through the execCommand fallback where the clipboard API is unavailable (03b)', async () => {
    const ranked = entry(SILENT, 1, 7200.2)
    // jsdom has no navigator.clipboard by default — this is the fallback environment itself.
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
    renderDrawer(ranked, { log: walk(ranked, 'assess', 'escalate') })
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument())
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('falls back when the clipboard API rejects asynchronously, not only when absent (03b)', async () => {
    const ranked = entry(SILENT, 1, 7200.2)
    // The secure-context denial shape: writeText exists and rejects from a microtask.
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
    renderDrawer(ranked, { log: walk(ranked, 'assess', 'escalate') })
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument())
    expect(writeText).toHaveBeenCalled()
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('never claims a copy that failed — the text stays selected for a manual Ctrl+C (03b)', async () => {
    const ranked = entry(SILENT, 1, 7200.2)
    // Neither clipboard API nor execCommand exists: the button must not read "Copied".
    renderDrawer(ranked, { log: walk(ranked, 'assess', 'escalate') })
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    const handoff = screen.getByLabelText('Handoff text') as HTMLTextAreaElement
    await waitFor(() => expect(handoff.selectionEnd).toBe(handoff.value.length))
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument()
  })

  it('treats a throwing execCommand as a failed copy, never as a claim (03b)', async () => {
    const ranked = entry(SILENT, 1, 7200.2)
    // Engines that refuse execCommand outside the original gesture throw from the microtask the
    // rejected clipboard call leaves us in (#47 round 5): still no false "Copied".
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn(() => {
        throw new Error('gesture expired')
      }),
      configurable: true,
    })
    renderDrawer(ranked, { log: walk(ranked, 'assess', 'escalate') })
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    const handoff = screen.getByLabelText('Handoff text') as HTMLTextAreaElement
    await waitFor(() => expect(handoff.selectionEnd).toBe(handoff.value.length))
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument()
  })
})
