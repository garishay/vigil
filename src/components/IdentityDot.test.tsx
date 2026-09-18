import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BandDot, IdentityDot, IdentityLegend, ShapeGlyph } from './IdentityDot'
import { GLYPHS } from './glyphs'
import { BAND_COLOR, SHAPES, SHAPE_LABEL } from '../lib/display'
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
      'Shape legend',
      'Identity legend',
      'Band legend',
    ])
    const items = within(lists[2]).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual(['Caution', 'Warning'])
    expect(items.map((item) => item.querySelector('.band-dot')?.getAttribute('data-band'))).toEqual(
      ['caution', 'warning'],
    )
    expect(within(group).queryByText('Calm')).toBeNull()
  })

  it('leads with the three shapes — what a track said about itself — drawn as the map draws them (S9, #181)', () => {
    render(<IdentityLegend />)
    const group = screen.getByRole('group', { name: 'Map legend' })
    const shapes = within(group).getByRole('list', { name: 'Shape legend' })
    const items = within(shapes).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual(SHAPES.map((shape) => SHAPE_LABEL[shape]))
    expect(
      items.map((item) => item.querySelector('.shape-glyph')?.getAttribute('data-shape')),
    ).toEqual([...SHAPES])
  })
})

describe('ShapeGlyph (S9)', () => {
  it('draws the map’s own parts for the two glyphs and a circle for the dot, decoratively', () => {
    const { rerender } = render(<ShapeGlyph shape="aircraft" />)
    const svg = () => document.querySelector('.shape-glyph') as SVGElement
    expect(svg()).toHaveAttribute('aria-hidden', 'true')
    // The aircraft is one outline, its points verbatim.
    expect(svg().querySelectorAll('polygon')).toHaveLength(1)
    const [outline] = GLYPHS.aircraft
    if (outline.kind !== 'polygon') throw new Error('the aircraft is one outline')
    expect(svg().querySelector('polygon')?.getAttribute('points')).toBe(
      outline.points.map(([x, y]) => `${x},${y}`).join(' '),
    )
    // The drone: the body a rounded square, four arms, four rotor rings stroked at their width
    // and unfilled — the hole is the point (R1).
    rerender(<ShapeGlyph shape="drone" />)
    expect(svg().querySelectorAll('rect')).toHaveLength(1)
    expect(svg().querySelectorAll('polygon')).toHaveLength(4)
    const rings = [...svg().querySelectorAll('circle')]
    expect(rings).toHaveLength(4)
    for (const ring of rings) {
      expect(ring.getAttribute('fill')).toBe('none')
      expect(ring.getAttribute('stroke-width')).toBe('1.6')
      expect(ring.getAttribute('r')).toBe('3.2')
    }
    rerender(<ShapeGlyph shape="dot" />)
    expect(svg().querySelectorAll('polygon')).toHaveLength(0)
    expect(svg().querySelector('circle')?.getAttribute('fill')).toBeNull()
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
