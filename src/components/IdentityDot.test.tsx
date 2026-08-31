import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { IdentityDot, IdentityLegend } from './IdentityDot'
import { IDENTITIES, IDENTITY_COLOR, IDENTITY_LABEL } from '../lib/identity'

describe('IdentityDot', () => {
  it('is decorative: the colour is data, the label beside it carries the meaning', () => {
    render(<IdentityDot identity="unknown" />)
    const dot = document.querySelector('.identity-dot') as HTMLElement
    expect(dot).toHaveAttribute('aria-hidden', 'true')
    expect(dot).toHaveAttribute('data-identity', 'unknown')
    expect(dot.style.background).not.toBe('')
  })
})

describe('IdentityLegend', () => {
  it('lists the three states in queue order, in plain English, with the shared dot', () => {
    render(<IdentityLegend />)
    const legend = screen.getByRole('list', { name: 'Identity legend' })
    const items = within(legend).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual(
      IDENTITIES.map((identity) => IDENTITY_LABEL[identity]),
    )
    expect(
      items.map((item) => item.querySelector('.identity-dot')?.getAttribute('data-identity')),
    ).toEqual([...IDENTITIES])
  })

  it('reads Non-cooperative, Unknown, Cooperative — no symbology standard', () => {
    render(<IdentityLegend />)
    expect(screen.getByText('Non-cooperative')).toBeInTheDocument()
    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.getByText('Cooperative')).toBeInTheDocument()
  })
})

describe('the identity palette', () => {
  it('stays cool or neutral — alarm colour is earned by a score, not spent on identity', () => {
    // Every hue has its red channel at or below its blue channel: no warm tone in the set.
    for (const hex of Object.values(IDENTITY_COLOR)) {
      const n = parseInt(hex.slice(1), 16)
      expect((n >> 16) & 255).toBeLessThanOrEqual(n & 255)
    }
  })
})
