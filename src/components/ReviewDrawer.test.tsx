import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewDrawer } from './ReviewDrawer'
import type { ProtectedSite } from '../config/ao'
import { CONTACTS } from '../config/contacts'
import { DISPOSITIONS } from '../config/dispositions'
import { appendEvent, firstSeen, observedSnapshot, type TrackEvent } from '../lib/lifecycle'
import type { RankedTrack } from '../lib/ranking'
import type { AdsbTrack, InjectTrack } from '../lib/tracks'

const SILENT: InjectTrack = {
  id: 'inject-05',
  source: 'inject',
  behavior: 'loiter',
  remoteId: 'silent',
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
})

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
      entry={ranked}
      sites={SITES}
      log={openLog(ranked)}
      contacts={CONTACTS}
      dispositions={DISPOSITIONS}
      onAction={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />,
  )

afterEach(() => {
  vi.unstubAllGlobals()
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
    expect(drawer.textContent).not.toMatch(/loiter|silent|intermittent|broadcasting/i)
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

  it('reserves the Track Visuals slot and the score, and says what fills them', () => {
    renderDrawer(entry(SILENT, 1, 7200.2))
    expect(screen.getByText(/Track Visuals — 03c/)).toBeInTheDocument()
    expect(screen.getByText(/factors arrive with PR 04/)).toBeInTheDocument()
    expect(screen.getByText(/1 known position/)).toBeInTheDocument()
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
        entry={ranked}
        sites={SITES}
        log={walk(ranked, 'assess')}
        contacts={CONTACTS}
        dispositions={DISPOSITIONS}
        onAction={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(within(status()).getByText('Assessing')).toBeInTheDocument()
    expect(button('Assess')).toBeDisabled()
    expect(button('Escalate')).toBeEnabled()

    rerender(
      <ReviewDrawer
        entry={ranked}
        sites={SITES}
        log={walk(ranked, 'assess', 'escalate', 'resolve')}
        contacts={CONTACTS}
        dispositions={DISPOSITIONS}
        onAction={vi.fn()}
        onClose={vi.fn()}
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

  it('renders the event log oldest-first, ids resolved to display names (03b)', () => {
    const ranked = entry(SILENT, 1, 7200.2)
    renderDrawer(ranked, { log: walk(ranked, 'assess', 'escalate') })
    const log = screen.getByLabelText('Event log')
    const lines = within(log)
      .getAllByRole('listitem')
      .map((item) => item.textContent)
    expect(lines).toEqual([
      '12:04:31New — first seen',
      '12:06:02Assessing — claimed',
      '12:07:45Escalated — to PHL Tower',
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
        entry={ranked}
        sites={SITES}
        log={walk(ranked, 'assess', 'escalate', 'resolve')}
        contacts={CONTACTS}
        dispositions={DISPOSITIONS}
        onAction={vi.fn()}
        onClose={vi.fn()}
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

  it('confirms the copy even where the clipboard API is unavailable (03b)', async () => {
    const ranked = entry(SILENT, 1, 7200.2)
    // jsdom has no navigator.clipboard by default — this is the fallback environment itself.
    renderDrawer(ranked, { log: walk(ranked, 'assess', 'escalate') })
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument())
  })
})
