import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AlertStack } from './AlertStack'
import type { Alert } from '../lib/alerts'
import { simClock } from '../lib/display'

const clock = (tSec: number) => simClock('02:30', tSec)
const ALERTS: Alert[] = [
  { trackId: 'inject-04', kind: 'pattern', word: 'Revisiting', tSec: 538, seq: 3 },
  { trackId: 'inject-04', kind: 'warning', word: 'Warning', tSec: 538, seq: 2 },
  { trackId: 'inject-06', kind: 'warning', word: 'Warning', tSec: 491, seq: 2 },
]
const IDENT: Record<string, string> = { 'inject-04': 'UAS-CD84', 'inject-06': 'TRK-06' }
const FRONTIER: Record<string, number> = { 'inject-04': 538, 'inject-06': 491 }

type Props = Parameters<typeof AlertStack>[0]
const props = (over: Partial<Props> = {}): Props => ({
  alerts: ALERTS,
  identOf: (id) => IDENT[id] ?? id,
  clock,
  tSec: 600,
  frontierOf: (id) => FRONTIER[id] ?? 0,
  onOpen: vi.fn(),
  onClear: vi.fn(),
  ...over,
})
const live = () => document.querySelector('.alerts [aria-live="polite"]') as HTMLElement
const faces = () => screen.getAllByRole('button', { name: /Open$/ })
const clears = () => screen.getAllByRole('button', { name: /^Clear card/ })

describe('AlertStack (#101, 101a)', () => {
  it('lists the cards newest first — the word, the ident, the sim time', () => {
    render(<AlertStack {...props()} />)
    const region = screen.getByRole('region', { name: 'Alerts' })
    const cards = within(region).getAllByRole('listitem')
    expect(cards.map((card) => card.querySelector('.alert__open')?.textContent)).toEqual([
      'Revisiting UAS-CD84 02:38:58 Open',
      'Warning UAS-CD84 02:38:58 Open',
      'Warning TRK-06 02:38:11 Open',
    ])
    expect(cards.map((card) => card.getAttribute('data-kind'))).toEqual([
      'pattern',
      'warning',
      'warning',
    ])
  })

  it('announces a raise once, on a hidden polite line mounted from the first frame (#111 review)', () => {
    // The cards are not live: the region over them would re-read a card whenever an intermittent
    // broadcast flipped its ident. One line, written per raise, is what a reader hears.
    const { rerender } = render(<AlertStack {...props({ alerts: [] })} />)
    expect(live()).toBeInTheDocument()
    expect(live()).toHaveTextContent('')
    expect(screen.getByRole('region', { name: 'Alerts' })).not.toHaveAttribute('aria-live')
    rerender(<AlertStack {...props()} />)
    expect(live()).toHaveTextContent('Revisiting UAS-CD84 02:38:58')
    // The ident flips on a quiet tick: the card changes, the announcement does not.
    rerender(
      <AlertStack {...props({ identOf: (id) => (id === 'inject-04' ? 'TRK-04' : 'TRK-06') })} />,
    )
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('TRK-04')
    expect(live()).toHaveTextContent('Revisiting UAS-CD84 02:38:58')
    // A re-stamp of the top card is a raise: announced again with its new time.
    rerender(
      <AlertStack
        {...props({ alerts: [{ ...ALERTS[0], tSec: 600, seq: 5 }, ...ALERTS.slice(1)] })}
      />,
    )
    expect(live()).toHaveTextContent('Revisiting UAS-CD84 02:40:00')
  })

  it('opens the track from the card’s face — named with the card and the verb — and clears from the × beside it, named for its card (S8b, #202)', () => {
    const p = props()
    render(<AlertStack {...p} />)
    const [first] = screen.getAllByRole('listitem')
    // The face carries the click's modality: a keyboard activation has detail 0, a pointer's a
    // count (#54), and the shell lands focus by it.
    fireEvent.click(
      within(first).getByRole('button', { name: 'Revisiting UAS-CD84 02:38:58 Open' }),
    )
    expect(p.onOpen).toHaveBeenLastCalledWith('inject-04', true)
    fireEvent.click(within(first).getByRole('button', { name: /Open$/ }), { detail: 1 })
    expect(p.onOpen).toHaveBeenLastCalledWith('inject-04', false)
    fireEvent.click(within(first).getByRole('button', { name: 'Clear card — Revisiting UAS-CD84' }))
    expect(p.onClear).toHaveBeenCalledWith('inject-04')
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull()
  })

  it('lands a keyboard × on the card that took its place, and leaves a pointer × where it fell', () => {
    const { rerender } = render(<AlertStack {...props()} />)
    // Browsers drop focus to body when the focused button unmounts; jsdom does not, so the drop
    // is simulated between the click and the re-render, as the drawer's tests do.
    const cleared = (index: number, detail: number) => {
      const button = clears()[index]
      button.focus()
      fireEvent.click(button, { detail })
      button.blur()
    }
    cleared(1, 0)
    rerender(<AlertStack {...props({ alerts: [ALERTS[0], ALERTS[2]] })} />)
    expect(document.activeElement).toBe(faces()[1])
    // The last card cleared lands on the last one standing.
    cleared(1, 0)
    rerender(<AlertStack {...props({ alerts: [ALERTS[0]] })} />)
    expect(document.activeElement).toBe(faces()[0])
    // A pointer clear moves nothing: a mouse user parked on a face would have Space open it.
    cleared(0, 1)
    rerender(<AlertStack {...props({ alerts: [ALERTS[2]] })} />)
    expect(document.activeElement).toBe(document.body)
  })

  it('lands a keyboard × on the nearest face still enabled, never on a disabled one (#204 round 1, finding 2)', () => {
    // Clock at 02:38:20: inject-04's record is ahead of it, the other two behind. Clearing the
    // top card leaves a disabled face where it stood and an enabled one below it.
    const mixed: Alert[] = [
      { trackId: 'inject-08', kind: 'warning', word: 'Warning', tSec: 491, seq: 2 },
      ALERTS[1],
      ALERTS[2],
    ]
    const frontierOf = (id: string) => ({ ...FRONTIER, 'inject-08': 491 })[id] ?? 0
    const { rerender } = render(<AlertStack {...props({ alerts: mixed, tSec: 500, frontierOf })} />)
    const button = clears()[0]
    button.focus()
    fireEvent.click(button, { detail: 0 })
    button.blur()
    rerender(<AlertStack {...props({ alerts: mixed.slice(1), tSec: 500, frontierOf })} />)
    expect(faces()[0]).toBeDisabled()
    expect(document.activeElement).toBe(faces()[1])
  })

  it('refuses both controls behind the track’s own frontier, each described by its own record time (#77)', () => {
    // Clock at 02:38:20: TRK-06's record (02:38:11) is behind it, UAS-CD84's (02:38:58) ahead.
    const { rerender } = render(<AlertStack {...props({ tSec: 500 })} />)
    const acks = clears
    expect(faces().map((button) => button.hasAttribute('disabled'))).toEqual([true, true, false])
    expect(acks().map((button) => button.hasAttribute('disabled'))).toEqual([true, true, false])
    expect(faces()[0]).toHaveAttribute(
      'aria-describedby',
      'alerts-rewound-state alert-times-inject-04-pattern',
    )
    expect(acks()[0]).toHaveAttribute(
      'aria-describedby',
      'alerts-rewound-state alert-times-inject-04-pattern',
    )
    expect(faces()[2]).not.toHaveAttribute('aria-describedby')
    expect(acks()[2]).not.toHaveAttribute('aria-describedby')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Rewound — the workflow acts at the record’s frontier',
    )
    // Clock at 02:38:00: every card is behind. The shared line names the earliest record — the
    // first moment any card becomes actionable — and each button its own, never another's.
    rerender(<AlertStack {...props({ tSec: 480 })} />)
    expect(acks().map((button) => button.hasAttribute('disabled'))).toEqual([true, true, true])
    expect(document.getElementById('alerts-rewound-times')).toHaveTextContent(
      'Clock 02:38:00 · record 02:38:11',
    )
    expect(document.getElementById('alert-times-inject-04-pattern')).toHaveTextContent(
      'Clock 02:38:00 · record 02:38:58',
    )
    expect(document.getElementById('alert-times-inject-06-warning')).toHaveTextContent(
      'Clock 02:38:00 · record 02:38:11',
    )
  })

  it('holds no state line while it holds no card', () => {
    render(<AlertStack {...props({ alerts: [] })} />)
    expect(screen.getByRole('region', { name: 'Alerts' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})
