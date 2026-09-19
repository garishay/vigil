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
  })

  it('does not grow: 158 words in Vigil and 140 unaided, under the accepted 159 and 141, the title and Begin included (ruled B; the amendment’s item 6)', () => {
    // The ceiling is the rule; the exact count is pinned so any growth is a re-pin, not a drift.
    // The gate's 159 carried a 12-word Assess line; the two mark lines that replace it are 11.
    const { unmount } = draw(false)
    expect(words(spoken(card()))).toHaveLength(158)
    unmount()
    draw(true)
    expect(words(spoken(card()))).toHaveLength(140)
  })

  it('says what the screen does: the ring means opened, the hollow marker means escalated or dismissed, Escalate is one click, no Assess line, the restraint sentence, and never who an escalation goes to (R4)', () => {
    draw(false)
    const symbolBefore = (text: string) =>
      screen.getByText(text).previousElementSibling?.querySelector('.shape-glyph')
    expect(symbolBefore('A track you have opened.')).toHaveAttribute('data-mark', 'assessed')
    expect(symbolBefore('A track you escalated or dismissed.')).toHaveAttribute(
      'data-mark',
      'handled',
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
    ])
    for (const glyph of glyphs) expect(glyph).toHaveAttribute('aria-hidden', 'true')
    expect(document.querySelector('.brief__ring')).toHaveAttribute('aria-hidden', 'true')
    const buttons = [...document.querySelectorAll('.brief__button')]
    expect(buttons.map((button) => button.textContent)).toEqual(['Escalate', 'Dismiss'])
    for (const button of buttons) {
      expect(button.tagName).toBe('SPAN')
      expect(button).toHaveAttribute('aria-hidden', 'true')
    }
    // Begin is the brief's one control.
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Begin'])
  })
})
