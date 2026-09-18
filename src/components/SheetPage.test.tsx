import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SheetPage } from './SheetPage'

import rawRun from '../../tools/replay/__fixtures__/S03-02a-raw-1.json?raw'
import vigilRun from '../../tools/replay/__fixtures__/S04-02b-vigil-1.json?raw'
import prioritizationRaw from '../../tools/replay/__fixtures__/S05-03a-raw-1.json?raw'
import prioritizationVigil from '../../tools/replay/__fixtures__/S05-03a-vigil-1.json?raw'
import captureRaw from '../../public/adsb-phl-002.json?raw'

// The fixtures as text, imported as every other src test imports one: no disk, no network.
const FIXTURE: Record<string, string> = {
  'S03-02a-raw-1.json': rawRun,
  'S04-02b-vigil-1.json': vigilRun,
  'S05-03a-raw-1.json': prioritizationRaw,
  'S05-03a-vigil-1.json': prioritizationVigil,
}
const fixture = (name: string) => FIXTURE[name].trim()

/** The recording the page fetches, served from disk — the injected seam, so no test reaches
 * the network and none patches a global. */

const fetcher = (async () =>
  new Response(captureRaw, {
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch

/** Paste text into the box and press the button, once the recording is in. */
async function paste(text: string) {
  render(<SheetPage fetcher={fetcher} />)
  await waitFor(() => expect(screen.getByText('Drop the files here')).toBeInTheDocument())
  fireEvent.change(screen.getByLabelText('Paste a results file or two run files'), {
    target: { value: text },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Render the sheet' }))
  await waitFor(() =>
    expect(
      screen.queryByRole('alert') ?? document.querySelector('.sheet__document'),
    ).not.toBeNull(),
  )
}

describe('the sheet page (S6a-ii, #165, ruled B3–B6)', () => {
  it('opens on its intake, with Render withheld until something is pasted', async () => {
    render(<SheetPage fetcher={fetcher} />)
    // Nothing renders until the recording is in: the sheet regenerates every position from it.
    expect(screen.getByText('Loading the recording…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Render the sheet' })).toBeDisabled()
    await waitFor(() => expect(screen.getByText('Drop the files here')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Render the sheet' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Paste a results file or two run files'), {
      target: { value: '{' },
    })
    expect(screen.getByRole('button', { name: 'Render the sheet' })).toBeEnabled()
  }, 30_000)

  it('draws the subject sheet from two pasted run files, with its controls', async () => {
    await paste(`${fixture('S03-02a-raw-1.json')}\n${fixture('S04-02b-vigil-1.json')}`)
    expect(screen.queryByRole('alert')).toBeNull()
    const svg = document.querySelector('.sheet__document svg')
    expect(svg).not.toBeNull()
    expect(document.querySelector('.sheet__document')?.textContent).toContain(
      'SUBJECT SHEET · S03 · S04 · 02a unaided, 02b with Vigil',
    )
    for (const label of ['Download the sheet', 'Print', 'Save the runs', 'Start over']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Copy the runs' })).toBeInTheDocument()
    // The intake is gone while a document is up, and Start over brings it back.
    expect(screen.queryByLabelText('Paste a results file or two run files')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }))
    expect(screen.getByLabelText('Paste a results file or two run files')).toHaveValue('')
  }, 60_000)

  it('draws the pair for two runs of one scenario, from a results file', async () => {
    const raw = JSON.parse(fixture('S05-03a-raw-1.json')) as { subject: string; build: string }
    const vigil = { ...JSON.parse(fixture('S05-03a-vigil-1.json')), run: 2 }
    await paste(JSON.stringify({ subject: raw.subject, build: raw.build, runs: [raw, vigil] }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.querySelector('.sheet__document')?.textContent).toContain(
      'ATTENTION · STANDOFF AT DECISION',
    )
  }, 60_000)

  it('refuses what the CLI refuses, in the CLI’s words, and draws nothing', async () => {
    await paste(fixture('S03-02a-raw-1.json').replace('"02a"', '"01"'))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'pasted: scenario "01" — the replay reads a study scenario: 02a, 02b, 03a, 03b',
    )
    expect(document.querySelector('.sheet__document')).toBeNull()
    // The paste is kept so it can be corrected rather than retyped.
    expect(screen.getByLabelText('Paste a results file or two run files')).toHaveValue(
      fixture('S03-02a-raw-1.json').replace('"02a"', '"01"'),
    )
  }, 30_000)

  it('names what it was handed where the refusal does not name it itself', async () => {
    // `compose`'s count refusal carries no path, so the page says what it read — one paste here.
    await paste(fixture('S03-02a-raw-1.json'))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'pasted: a document reads two runs, not 1 — a results file, or both run files',
    )
    expect(document.querySelector('.sheet__document')).toBeNull()
  }, 30_000)

  it('escapes what a run carries, so a hostile track id is text and never markup', async () => {
    // The document is the renderer's own output over parsed data, which is why it may be set as
    // HTML; `frame.ts`'s escaper is what makes that true, and this is the page-side pin of it.
    const run = JSON.parse(fixture('S03-02a-raw-1.json')) as {
      events: { t: number; type: string; track: string }[]
    }
    run.events.push({ t: 100, type: 'escalate', track: '<img src=x onerror=alert(1)>' })
    await paste(`${JSON.stringify(run)}\n${fixture('S04-02b-vigil-1.json')}`)
    const document_ = document.querySelector('.sheet__document')
    expect(document_).not.toBeNull()
    expect(document_?.querySelector('img')).toBeNull()
    expect(document_?.querySelector('script')).toBeNull()
    expect(document_?.textContent).toContain('<img src=x onerror=alert(1)>')
  }, 60_000)
})
