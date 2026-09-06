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
  onAcknowledge: vi.fn(),
  ...over,
})
const live = () => document.querySelector('.alerts [aria-live="polite"]') as HTMLElement

describe('AlertStack (#101, 101a)', () => {
  it('lists the cards newest first — the word, the ident, the sim time', () => {
    render(<AlertStack {...props()} />)
    const region = screen.getByRole('region', { name: 'Alerts' })
    const cards = within(region).getAllByRole('listitem')
    expect(cards.map((card) => card.querySelector('.alert__open')?.textContent)).toEqual([
      'RevisitingUAS-CD8402:38:58',
      'WarningUAS-CD8402:38:58',
      'WarningTRK-0602:38:11',
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

  it('opens the track from the card’s body and acknowledges from the button beside it', () => {
    const p = props()
    render(<AlertStack {...p} />)
    const [first] = screen.getAllByRole('listitem')
    fireEvent.click(within(first).getByRole('button', { name: /Revisiting/ }))
    expect(p.onOpen).toHaveBeenCalledWith('inject-04')
    fireEvent.click(within(first).getByRole('button', { name: 'Acknowledge' }))
    expect(p.onAcknowledge).toHaveBeenCalledWith('inject-04')
  })

  it('refuses Acknowledge behind the track’s own frontier, each button described by its own record time (#77)', () => {
    // Clock at 02:38:20: TRK-06's record (02:38:11) is behind it, UAS-CD84's (02:38:58) ahead.
    const { rerender } = render(<AlertStack {...props({ tSec: 500 })} />)
    const acks = () => screen.getAllByRole('button', { name: 'Acknowledge' })
    expect(acks().map((button) => button.hasAttribute('disabled'))).toEqual([true, true, false])
    expect(acks()[0]).toHaveAttribute(
      'aria-describedby',
      'alerts-rewound-state alert-times-inject-04-pattern',
    )
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
