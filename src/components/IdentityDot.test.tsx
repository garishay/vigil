import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BandDot, IdentityDot, IdentityLegend } from './IdentityDot'
import { BAND_COLOR } from '../lib/display'
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

describe('BandDot (#96)', () => {
  it('is decorative too, and wears the literal the map fills with', () => {
    render(<BandDot band="warning" />)
    const dot = document.querySelector('.band-dot') as HTMLElement
    expect(dot).toHaveAttribute('aria-hidden', 'true')
    expect(dot).toHaveAttribute('data-band', 'warning')
    expect(dot.style.background).toBe('rgb(255, 107, 87)')
    expect(BAND_COLOR.warning).toBe('#ff6b57')
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

  it('lists the two warm bands in band order beside the identities, and no Calm entry (#96)', () => {
    render(<IdentityLegend />)
    const group = screen.getByRole('group', { name: 'Map legend' })
    const lists = within(group).getAllByRole('list')
    expect(lists.map((list) => list.getAttribute('aria-label'))).toEqual([
      'Identity legend',
      'Band legend',
    ])
    const items = within(lists[1]).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual(['Caution', 'Warning'])
    expect(items.map((item) => item.querySelector('.band-dot')?.getAttribute('data-band'))).toEqual(
      ['caution', 'warning'],
    )
    expect(within(group).queryByText('Calm')).toBeNull()
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
