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
    for (const label of ['Download the sheet', 'Print', 'Start over']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    // One button per file, so one click is one file: two subjects, two runs, two buttons named
    // for what tells them apart (round 1, ruled 5).
    expect(screen.getByRole('button', { name: 'Save S03' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save S04' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save the runs' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy the runs' })).toBeInTheDocument()
    // The clipboard fallback has text on screen to select (round 1, finding 4).
    const saved = screen.getByLabelText(`The runs, to copy`) as HTMLTextAreaElement
    expect(saved.value).toContain(`"subject": "S03"`)
    expect(saved.value).toContain(`"subject": "S04"`)
    expect(saved.readOnly).toBe(true)
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

  it('escapes a track id that would close an attribute, so no handler lands in the DOM', async () => {
    // `esc` escapes &, < and > but not the quote, and the sheet writes ids into data-id="…".
    // A non-threat escalation puts `event.track` there verbatim, so this id closed the attribute
    // and landed a live handler in this tab (round 1, finding 1). `escAttr` is the fix, and this
    // is the case: before it, the mark carries an onmouseover and the id is not in the attribute.
    const run = JSON.parse(fixture('S03-02a-raw-1.json')) as {
      events: { t: number; type: string; track: string }[]
    }
    const hostile = 'x" onmouseover="alert(1)'
    run.events.push({ t: 100, type: 'escalate', track: hostile })
    await paste(`${JSON.stringify(run)}\n${fixture('S04-02b-vigil-1.json')}`)
    const document_ = document.querySelector('.sheet__document')
    expect(document_).not.toBeNull()
    // No element carries a handler: the quote is escaped where the value lands in an attribute,
    // so it stays one attribute rather than closing it. Elsewhere it reads as plain text, where
    // a quote is a character and nothing more — which is why `esc` leaves it alone there.
    expect(document_?.querySelector('[onmouseover]')).toBeNull()
    expect(document_?.innerHTML).toContain('data-id="x&quot; onmouseover=&quot;alert(1)"')
    // The value is still there, whole, as the one attribute it was meant to be.
    const ids = [...(document_?.querySelectorAll('[data-id]') ?? [])].map((node) =>
      node.getAttribute('data-id'),
    )
    expect(ids).toContain(hostile)
  }, 60_000)

  it('names an inner refusal once, not twice (round 1, finding 3)', async () => {
    // `parseResults` refuses under `<path> runs[i]:`, which is the page's own name already —
    // prefixing again read `pasted: pasted runs[1]: …`.
    const good = JSON.parse(fixture('S05-03a-raw-1.json')) as { subject: string; build: string }
    const bad = { ...JSON.parse(fixture('S05-03a-vigil-1.json')), run: 2, scenario: '01' }
    await paste(JSON.stringify({ subject: good.subject, build: good.build, runs: [good, bad] }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'pasted runs[1]: scenario "01" — the replay reads a study scenario: 02a, 02b, 03a, 03b',
    )
    expect(screen.getByRole('alert').textContent).not.toContain('pasted: pasted')
  }, 30_000)

  it('says so when a drop hands it nothing, naming nothing it did not get', async () => {
    // Dragging in text or a link gives an empty file list; the count refusal would have read
    // ": a document reads two runs, not 0 — …" with a bare colon (round 1, finding 7).
    render(<SheetPage fetcher={fetcher} />)
    await waitFor(() => expect(screen.getByText('Drop the files here')).toBeInTheDocument())
    fireEvent.drop(screen.getByText('Drop the files here'), { dataTransfer: { files: [] } })
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(
      'nothing to read — a results file, or both run files',
    )
    expect(screen.getByRole('alert').textContent?.startsWith(':')).toBe(false)
  }, 30_000)

  it('refuses a file it cannot read, by its name, rather than going quiet', async () => {
    // A dropped folder reads as a file whose text() rejects; before the fix the promise was
    // unhandled and the page said nothing at all (round 1, finding 6).
    render(<SheetPage fetcher={fetcher} />)
    await waitFor(() => expect(screen.getByText('Drop the files here')).toBeInTheDocument())
    const unreadable = {
      name: 'runs',
      text: () => Promise.reject(new Error('The object is a directory.')),
    }
    fireEvent.drop(screen.getByText('Drop the files here'), {
      dataTransfer: { files: [unreadable] },
    })
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(
      'runs: cannot be read — The object is a directory.',
    )
  }, 30_000)
})
