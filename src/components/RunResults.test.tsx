import { render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RunResults } from './RunResults'
import { documentOf, fetchStudy, filesFor } from '../data/sheet'
import { SheetDocument } from './SheetDocument'
import rawRun from '../../tools/replay/__fixtures__/S05-03a-raw-1.json?raw'
import vigilRun from '../../tools/replay/__fixtures__/S06-03b-vigil-1.json?raw'
import captureRaw from '../../public/adsb-phl-002.json?raw'
import type { RunRecord } from '../lib/run'

// One subject's session, from the committed fixtures: run 1 as it stands, run 2 the other
// scenario's run under the same code. Nothing here reads a disk or a network.
const one = JSON.parse(rawRun) as RunRecord
const two = { ...(JSON.parse(vigilRun) as RunRecord), subject: one.subject, run: 2 }
const fetcher = (async () =>
  new Response(captureRaw, {
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch

const drawn = async () => {
  render(<RunResults runs={[one, two]} fetcher={fetcher} />)
  await waitFor(() => expect(document.querySelector('.sheet__document svg')).not.toBeNull(), {
    timeout: 30_000,
  })
  return document.querySelector('.sheet') as HTMLElement
}

describe('the results view (S6a-iii-b, #165, items 4 and 5, ruled R2)', () => {
  it('draws the subject sheet by the tool’s own code, in this tab', async () => {
    const view = await drawn()
    const study = await fetchStudy(fetcher)
    // The same document `documentOf` gives the sheet page, which is `compose`'s — one renderer.
    // Both sides go through the DOM, so this compares what was parsed rather than two spellings
    // of the same markup.
    const expected = document.createElement('div')
    expected.innerHTML = documentOf([one, two], study).svg
    expect((view.querySelector('.sheet__document') as HTMLElement).innerHTML).toBe(
      expected.innerHTML,
    )
    expect(view.textContent).toContain('SUBJECT SHEET')
  }, 60_000)

  it('makes Download results the one primary, the sheet and the print quiet beside it', async () => {
    const view = await drawn()
    // The session runner needs one thing: the file. The hierarchy says so without a word.
    const primary = within(view).getByRole('button', { name: 'Download results' })
    expect(primary).toHaveClass('sheet__button')
    for (const label of ['Download the sheet', 'Print', 'Copy results']) {
      expect(within(view).getByRole('button', { name: label })).toHaveClass('sheet__quiet')
    }
    // One control carries the weight, and it is that one.
    expect(view.querySelectorAll('.sheet__button')).toHaveLength(1)
  }, 60_000)

  it('says what the file holds, and who to send it to', async () => {
    const view = await drawn()
    const lead = view.querySelector('.sheet__lead') as HTMLElement
    expect(lead).toHaveTextContent(
      'your subject code, every track you opened and every action you took with its time, and your three answers',
    )
    expect(lead).toHaveTextContent('It holds no name, and nothing has been sent anywhere.')
    expect(lead).toHaveTextContent('Send that file to the person running your session.')
  }, 60_000)

  it('offers one results file, and the runs on screen for the clipboard fallback', async () => {
    const view = await drawn()
    const saved = within(view).getByLabelText('The runs, to copy') as HTMLTextAreaElement
    expect(saved.readOnly).toBe(true)
    expect(JSON.parse(saved.value)).toMatchObject({ subject: one.subject })
    expect(JSON.parse(saved.value).runs.map((run: RunRecord) => run.run)).toEqual([1, 2])
  }, 60_000)

  it('says so rather than drawing nothing when the recording will not load', async () => {
    const refusing = (async () => {
      throw new Error('Failed to fetch')
    }) as unknown as typeof fetch
    render(<RunResults runs={[one, two]} fetcher={refusing} />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to fetch')
    expect(document.querySelector('.sheet__document')).toBeNull()
  }, 30_000)
})

describe('one primary save, ever (round 1, finding 4)', () => {
  it('gives the label to one file and leaves any other quiet under its own run', async () => {
    // Two subjects' runs make a pair, not a session, so `filesFor` hands back a file each. The
    // primary label names one file; a second button reading *Download results* too would name
    // neither, which is the opposite of what R2 asks.
    const other = { ...(JSON.parse(vigilRun) as RunRecord), subject: 'S07', run: 1 }
    const study = await fetchStudy(fetcher)
    const files = filesFor([one, other])
    expect(files).toHaveLength(2)
    render(
      <SheetDocument
        document_={documentOf([one, other], study)}
        files={files}
        primarySave="Download results"
      />,
    )
    const view = document.querySelector('.sheet__actions') as HTMLElement
    expect(within(view).getByRole('button', { name: 'Download results' })).toHaveClass(
      'sheet__button',
    )
    expect(view.querySelectorAll('.sheet__button')).toHaveLength(1)
    // The second is quiet and named for its own run, so the two are told apart.
    const second = within(view).getByRole('button', { name: `Save ${files[1].label}` })
    expect(second).toHaveClass('sheet__quiet')
    expect(second).not.toHaveTextContent('Download results')
  }, 60_000)
})
