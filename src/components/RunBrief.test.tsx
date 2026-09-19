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
    // The states line (S9b; #201 round 1): each dot beside its own word — the untouched dot in
    // the column before "Untouched,", the grey before "opened,", the hollow before the rest —
    // and the untouched dot in the map's own neutral, so the step to the grey is the map's.
    const line = [...document.querySelectorAll('.brief__line')].find(
      (node) =>
        spoken(node).replace(/\s+/g, ' ').trim() === 'Untouched, opened, escalated or dismissed.',
    ) as HTMLElement
    const column = line.querySelector('.brief__symbol .shape-glyph') as HTMLElement
    expect(column.getAttribute('data-mark')).toBeNull()
    expect(column.style.color).toBe('rgb(197, 207, 220)')
    const sequence = [...line.children[1].childNodes]
      .filter((node) => node.nodeType !== Node.TEXT_NODE || node.textContent?.trim())
      .map((node) =>
        node.nodeType === Node.TEXT_NODE
          ? node.textContent?.trim()
          : (node as HTMLElement).querySelector('.shape-glyph')?.getAttribute('data-mark'),
      )
    expect(sequence).toEqual([
      'Untouched,',
      'assessed',
      'opened,',
      'handled',
      'escalated or dismissed.',
    ])
    const inline = line.querySelector('.brief__inline [data-mark="assessed"]') as HTMLElement
    expect(inline.style.color).toBe('rgb(127, 139, 152)')
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
    // Every glyph takes the run's own ink (#201 round 1): the map's neutral on the three shapes,
    // the untouched dot and the hollow dot; the grey on the opened dot; the red on warning.
    const inks = glyphs.map((glyph) => (glyph as HTMLElement).style.color)
    expect(inks.filter((ink) => ink === 'rgb(197, 207, 220)')).toHaveLength(5)
    expect(inks.filter((ink) => ink === 'rgb(127, 139, 152)')).toHaveLength(1)
    expect(inks.filter((ink) => ink === 'rgb(255, 107, 87)')).toHaveLength(1)
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
