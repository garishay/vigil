import { describe, expect, it } from 'vitest'
import { eventClock, roundHeading } from './display'

describe('eventClock', () => {
  it('renders a UTC instant as its Zulu clock', () => {
    expect(eventClock('2026-09-01T12:07:45.000Z')).toBe('12:07:45Z')
  })

  it('normalizes an offset form before labelling it Zulu (#47 review)', () => {
    // The PR 06 clock seam permits any ISO form; 14:07 at +02:00 *is* 12:07Z, and the record
    // must say so rather than slicing the local digits and stamping a Z on them.
    expect(eventClock('2026-09-01T14:07:45.000+02:00')).toBe('12:07:45Z')
  })
})

describe('roundHeading', () => {
  it('rounds to the whole degree both the drawer and the handoff print (#49)', () => {
    expect(roundHeading(345.6)).toBe(346)
    expect(roundHeading(0.3)).toBe(0)
  })

  it('wraps a heading that rounds up to north — 0, never an off-the-compass 360 (#51 review)', () => {
    expect(roundHeading(359.7)).toBe(0)
    expect(roundHeading(359.5)).toBe(0)
    expect(roundHeading(359.4)).toBe(359)
  })
})
