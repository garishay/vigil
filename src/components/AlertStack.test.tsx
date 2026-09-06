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

function renderStack(over: Partial<Parameters<typeof AlertStack>[0]> = {}) {
  const onOpen = vi.fn()
  const onAcknowledge = vi.fn()
  render(
    <AlertStack
      alerts={ALERTS}
      identOf={(id) => IDENT[id] ?? id}
      clock={clock}
      tSec={600}
      frontierOf={(id) => FRONTIER[id] ?? 0}
      onOpen={onOpen}
      onAcknowledge={onAcknowledge}
      {...over}
    />,
  )
  return { onOpen, onAcknowledge }
}

describe('AlertStack (#101, 101a)', () => {
  it('lists the cards newest first — the word, the ident, the sim time — in a polite region', () => {
    renderStack()
    const region = screen.getByRole('region', { name: 'Alerts' })
    expect(region).toHaveAttribute('aria-live', 'polite')
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

  it('opens the track from the card’s body and acknowledges from the button beside it', () => {
    const { onOpen, onAcknowledge } = renderStack()
    const [first] = screen.getAllByRole('listitem')
    fireEvent.click(within(first).getByRole('button', { name: /Revisiting/ }))
    expect(onOpen).toHaveBeenCalledWith('inject-04')
    fireEvent.click(within(first).getByRole('button', { name: 'Acknowledge' }))
    expect(onAcknowledge).toHaveBeenCalledWith('inject-04')
  })

  it('refuses Acknowledge behind the track’s own frontier, with the static state line saying why (#77)', () => {
    // Clock at 02:38:20: TRK-06's record (02:38:11) is behind it, UAS-CD84's (02:38:58) ahead.
    renderStack({ tSec: 500 })
    const acks = screen.getAllByRole('button', { name: 'Acknowledge' })
    expect(acks.map((button) => button.hasAttribute('disabled'))).toEqual([true, true, false])
    expect(acks[0]).toHaveAttribute('aria-describedby', 'alerts-rewound-state alerts-rewound-times')
    expect(acks[2]).not.toHaveAttribute('aria-describedby')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Rewound — the workflow acts at the record’s frontier',
    )
    expect(document.getElementById('alerts-rewound-times')).toHaveTextContent(
      'Clock 02:38:20 · record 02:38:58',
    )
  })

  it('holds no state line while it holds no card', () => {
    renderStack({ alerts: [] })
    expect(screen.getByRole('region', { name: 'Alerts' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})
