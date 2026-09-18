import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RunEnd } from './RunEnd'
import { QUESTIONS, WORKLOAD_SCALE } from '../config/study'
import type { RunAnswers } from '../lib/run'

const ALL: RunAnswers = { demand: 6, pressure: 7, confidence: 5 }
type Props = Parameters<typeof RunEnd>[0]
const props = (over: Partial<Props> = {}): Props => ({
  title: 'Run complete — subject S13 · run 1 · +03:38',
  run: 1,
  questions: QUESTIONS,
  scale: WORKLOAD_SCALE,
  answers: ALL,
  onAnswer: () => {},
  json: '{"subject":"S13"}',
  saved: true,
  onDownload: () => {},
  onNext: () => {},
  ...over,
})

/** The card's blocks in the order a reader meets them, by what each one is. */
const order = () =>
  [...document.querySelectorAll('.run__card > *')]
    .map((node) =>
      node.classList.contains('run__saved')
        ? 'saved'
        : node.classList.contains('run__warn')
          ? 'warning'
          : node.classList.contains('run__next')
            ? `primary:${node.textContent?.trim()}`
            : node.classList.contains('run__optional')
              ? 'optional'
              : node.classList.contains('run__question')
                ? 'question'
                : node.tagName.toLowerCase(),
    )
    .filter((what) => what !== 'question')

describe('the end screen’s hierarchy (S6a-iii, #165, ruled R1)', () => {
  it('reads saved line, then the one way on, then the backups as an optional row', () => {
    render(<RunEnd {...props()} />)
    expect(order()).toEqual(['h2', 'saved', 'primary:Start run 2', 'optional', 'details'])
    // The saved line says what to do, not only what happened.
    expect(screen.getByText(/Run 1 is saved in this browser\./)).toHaveTextContent(
      'Run 1 is saved in this browser. Start run 2 when you are ready.',
    )
    // One primary on the card; the backups are quiet and say they are optional.
    expect(document.querySelectorAll('.run__button').length).toBe(1)
    const optional = document.querySelector('.run__optional') as HTMLElement
    expect(optional).toHaveTextContent('Optional backup:')
    expect(within(optional).getByRole('button', { name: 'Copy run' })).toHaveClass('run__quiet')
    expect(within(optional).getByRole('button', { name: 'Download a copy' })).toHaveClass(
      'run__quiet',
    )
  })

  it('shows nothing of the run just finished', () => {
    render(<RunEnd {...props()} />)
    const card = document.querySelector('.run__card') as HTMLElement
    expect(card.querySelector('svg')).toBeNull()
    expect(card.textContent).not.toMatch(/escalat|threat|look|km|missed/i)
  })

  it('is the questions and one hint before the answers — no backups, no way on', () => {
    // Two disabled backups under a hint made the backups look like the goal, so they appear with
    // the rest once the third answer lands (ruled, round 1).
    render(<RunEnd {...props({ json: null, saved: false, answers: { demand: 6 } })} />)
    expect(order()).toEqual(['h2', 'p'])
    expect(screen.getByText('Answer all three to continue.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText(/is saved in this browser/)).toBeNull()
    expect(document.querySelector('.run__optional')).toBeNull()
    expect(screen.queryByLabelText('Run JSON')).toBeNull()
  })

  it('flips the order when the browser would not keep the run', () => {
    const onDownload = vi.fn()
    render(<RunEnd {...props({ saved: false, onDownload })} />)
    // The warning first, and the file as the primary: it is the only way the run survives.
    expect(order()).toEqual(['h2', 'warning', 'primary:Download a copy', 'optional', 'details'])
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This browser would not keep this run. Download it before you close the tab.',
    )
    expect(screen.queryByRole('button', { name: 'Start run 2' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Download a copy' }))
    expect(onDownload).toHaveBeenCalledTimes(1)
  })

  it('does not call a backup optional when it is the only way out', () => {
    // The session's last run in this PR has no way on, so the row is the way out and says so by
    // saying nothing (ruled R1).
    render(<RunEnd {...props({ run: 2, onNext: undefined })} />)
    expect(order()).toEqual(['h2', 'saved', 'optional', 'details'])
    expect(screen.getByText('Run 2 is saved in this browser.')).toBeInTheDocument()
    expect(document.querySelector('.run__optional')).not.toHaveTextContent('Optional backup:')
    expect(document.querySelectorAll('.run__button').length).toBe(0)
  })

  it('names the next run by its number and hands the click on', () => {
    const onNext = vi.fn()
    render(<RunEnd {...props({ onNext })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start run 2' }))
    expect(onNext).toHaveBeenCalledTimes(1)
  })
})

describe('the last run’s end screen (S6a-iii-b, #165, item 4, ruled R1)', () => {
  const last = (over: Partial<Props> = {}) => props({ run: 2, onNext: undefined, ...over })

  it('makes See your results the one way on once both runs are in this browser', () => {
    const onResults = vi.fn()
    render(<RunEnd {...last({ onResults })} />)
    expect(order()).toEqual(['h2', 'saved', 'primary:See your results', 'optional', 'details'])
    expect(screen.getByText(/Run 2 is saved in this browser./)).toHaveTextContent(
      'Run 2 is saved in this browser. Your results are ready.',
    )
    expect(document.querySelectorAll('.run__button')).toHaveLength(1)
    expect(document.querySelector('.run__optional')).toHaveTextContent('Optional backup:')
    fireEvent.click(screen.getByRole('button', { name: 'See your results' }))
    expect(onResults).toHaveBeenCalledTimes(1)
  })

  it('says which run is missing, and makes the file the way out, when it cannot draw them', () => {
    const onDownload = vi.fn()
    render(<RunEnd {...last({ resultsMissing: true, onDownload })} />)
    // Nothing to draw, so the words say so and the file is the primary — the same shape as a
    // refused write (ruled R1).
    expect(order()).toEqual([
      'h2',
      'saved',
      'warning',
      'primary:Download a copy',
      'optional',
      'details',
    ])
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your first run is not saved in this browser, so your results cannot be drawn here. Download this run and hand both runs over.',
    )
    expect(screen.queryByRole('button', { name: 'See your results' })).toBeNull()
    // One Download a copy, not two: the primary is the one the words name.
    expect(screen.getAllByRole('button', { name: 'Download a copy' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Download a copy' }))
    expect(onDownload).toHaveBeenCalledTimes(1)
  })

  it('withholds the results until the questions are answered', () => {
    render(<RunEnd {...last({ json: null, saved: false, onResults: () => {} })} />)
    expect(screen.queryByRole('button', { name: 'See your results' })).toBeNull()
    expect(screen.getByText('Answer all three to continue.')).toBeInTheDocument()
  })
})
