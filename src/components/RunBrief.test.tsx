import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RunBrief } from './RunBrief'
import { CONTACTS } from '../config/contacts'
import { BRIEF_GOAL, briefBlocks, runOfSession } from '../config/study'

/** The card's text as it reads, text nodes joined by a space — jsdom has no innerText. */
const spoken = (node: Node): string =>
  node.nodeType === Node.TEXT_NODE
    ? (node.textContent ?? '')
    : [...node.childNodes].map(spoken).join(' ')

/** The gate's count: every whitespace-separated token with a letter or a digit in it. */
const words = (text: string) => text.split(/\s+/).filter((token) => /[A-Za-z0-9]/.test(token))

const card = () => document.querySelector('.run__card') as HTMLElement

const draw = (raw: boolean, runS = 218) =>
  render(
    <RunBrief
      title="Vigil · study run — subject S99 · run 1"
      place={runOfSession(1, 2)}
      goal={BRIEF_GOAL}
      blocks={briefBlocks(runS)}
      raw={raw}
      ready
      onBegin={() => {}}
    />,
  )

describe('the brief, rebuilt for reading (S8, #180 item 6, ruled; the amendment’s item 6)', () => {
  it('reads the run’s place, the goal and the labelled blocks, with the one Vigil-only block withheld unaided', () => {
    const { unmount } = draw(false)
    expect(screen.getByText('Run 1 of 2')).toBeInTheDocument()
    expect(screen.getByText('Stop drones before they reach the ring')).toBeInTheDocument()
    const headings = () =>
      [...document.querySelectorAll('.brief__heading')].map((node) => node.textContent)
    expect(headings()).toEqual([
      'The clock',
      'On the map',
      'What you do',
      'What counts',
      'The priority list',
    ])
    unmount()
    draw(true)
    expect(headings()).toEqual(['The clock', 'On the map', 'What you do', 'What counts'])
    // The red line is the Vigil block's, so unaided never hears of a colour it does not see.
    expect(screen.queryByText('Red is warning: it needs you now.')).toBeNull()
  })

  it('does not grow: 159 words in Vigil and 134 unaided, at and under the accepted 159 and 141, the title and Begin included (ruled B; S9b, ruled D)', () => {
    // The ceiling is the rule; the exact count is pinned so any growth is a re-pin, not a drift.
    // S9b: the two mark lines (11) became one row (5), and the Vigil block gained the red line (7).
    const { unmount } = draw(false)
    expect(words(spoken(card()))).toHaveLength(159)
    unmount()
    draw(true)
    expect(words(spoken(card()))).toHaveLength(134)
  })

  it('says what the screen does: the ring means opened, the hollow marker means escalated or dismissed, Escalate is one click, no Assess line, the restraint sentence, and never who an escalation goes to (R4)', () => {
    draw(false)
    // The three states in one row (S9b): untouched, opened in the run's grey, handled hollow.
    const row = screen.getByText(
      'Untouched, opened, escalated or dismissed.',
    ).previousElementSibling
    const marks = [...(row?.querySelectorAll('.shape-glyph') ?? [])]
    expect(marks.map((glyph) => glyph.getAttribute('data-mark'))).toEqual([
      null,
      'assessed',
      'handled',
    ])
    expect((marks[1] as HTMLElement).style.color).toBe('rgb(127, 139, 152)')
    // Vigil's one colour, said in the Vigil-only block and drawn as the dot at warning.
    const red = screen.getByText('Red is warning: it needs you now.').previousElementSibling
    expect(red?.querySelector('.shape-glyph')).toHaveAttribute('data-warning', 'true')
    expect((red?.querySelector('.shape-glyph') as HTMLElement).style.color).toBe(
      'rgb(255, 107, 87)',
    )
    expect(screen.getByText(/One click, and you are done with that track\.$/)).toBeInTheDocument()
    expect(
      screen.getByText(
        'Escalating sends a response team. Do not escalate a track you do not believe is a threat.',
      ),
    ).toBeInTheDocument()
    const text = spoken(card())
    expect(text).not.toMatch(/Assess/)
    for (const contact of CONTACTS) expect(text).not.toContain(contact.name)
    // And never how many tracks will enter the ring.
    expect(text).not.toMatch(/\b(one|two|three|four|five) (drone|track)s?\b/i)
  })

  it('draws the legend with the map’s own parts and the actions as the buttons they are, none of them a control', () => {
    draw(false)
    const glyphs = [...document.querySelectorAll('.brief .shape-glyph')]
    expect(glyphs.map((glyph) => glyph.getAttribute('data-shape'))).toEqual([
      'aircraft',
      'drone',
      'dot',
      'dot',
      'dot',
      'dot',
      'dot',
    ])
    for (const glyph of glyphs) expect(glyph).toHaveAttribute('aria-hidden', 'true')
    expect(document.querySelector('.brief__ring')).toHaveAttribute('aria-hidden', 'true')
    const buttons = [...document.querySelectorAll('.brief__button')]
    expect(buttons.map((button) => button.textContent)).toEqual(['Escalate', 'Dismiss'])
    // Drawn as buttons but never controls — and never hidden from a reader either: the word is
    // the line's own verb, so a subject who cannot see the brief still hears which button to
    // press (#198 round 1).
    for (const button of buttons) {
      expect(button.tagName).toBe('SPAN')
      expect(button).not.toHaveAttribute('aria-hidden')
    }
    const lines = [...document.querySelectorAll('.brief__line')].map((line) =>
      spoken(line).replace(/\s+/g, ' ').trim(),
    )
    expect(lines).toContain(
      'Escalate if you think it will enter the ring. One click, and you are done with that track.',
    )
    expect(lines).toContain('Dismiss if it is not a concern.')
    // Begin is the brief's one control.
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Begin'])
  })
})
