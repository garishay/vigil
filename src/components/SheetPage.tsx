import { useCallback, useEffect, useState, type DragEvent } from 'react'
import './SheetPage.css'
import { SheetDocument } from './SheetDocument'
import {
  documentOf,
  fetchStudy,
  filesFor,
  runsIn,
  splitPasted,
  type Composed,
  type SaveFile,
} from '../data/sheet'
import { clearRuns, savedKeys } from '../lib/runs'
import type { Study } from '../../tools/replay/load'

/**
 * The sheet page (S6a, #165, A4): `?sheet` — a results file, or two run files, dropped or
 * pasted, rendered by the tool's own modules and offered back as a file. It refuses what the
 * CLI refuses, in the CLI's own words: a dropped file is named by its file name, pasted text by
 * the word `pasted`, and the sentence after the colon is the loader's or the sheet's.
 *
 * Nothing is stored and nothing is sent: the text is read in this tab, the document is drawn in
 * this tab, and the download is the browser's own save.
 */

/** What a run or a file gave the page, under the name its refusal will carry. */
interface Input {
  name: string
  text: string
}

/**
 * `fetcher` is the network seam, injected the way the capture's and the photo lookup's are
 * (03d): the page fetches the study recording, and no test reaches the network.
 */
export function SheetPage({ fetcher = fetch }: { fetcher?: typeof fetch } = {}) {
  const [study, setStudy] = useState<Study | null>(null)
  const [pasted, setPasted] = useState('')
  const [source, setSource] = useState<SaveFile[] | null>(null)
  const [document_, setDocument] = useState<Composed | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  // What this browser is holding, so the page can say it and offer to clear it (item 8).
  const [saved, setSaved] = useState(() => savedKeys().length)
  // Clear asks once before it clears (ruled R3): the control becomes its own question in place,
  // never a dialog. One click must not be able to destroy a subject's unsent session.
  const [asking, setAsking] = useState(false)

  // The recording, once: the sheet regenerates every position from it, so nothing renders until
  // it is in. A fetch that fails says so where the refusals go.
  useEffect(() => {
    let live = true
    fetchStudy(fetcher).then(
      (loaded) => live && setStudy(loaded),
      (error: Error) => live && setRefusal(error.message),
    )
    return () => {
      live = false
    }
  }, [fetcher])

  const render = useCallback(
    (inputs: readonly Input[]) => {
      if (study === null) return
      setRefusal(null)
      setDocument(null)
      setSource(null)
      // Nothing to read at all — an empty drop, or a paste holding no object. The sentence names
      // nothing, because there is nothing it was given to name (round 1, finding 7).
      if (inputs.length === 0) {
        setRefusal('nothing to read — a results file, or both run files')
        return
      }
      try {
        const records = inputs.flatMap((input) => runsIn(input.text, input.name))
        // The document is drawn before anything is set, as the CLI draws before it writes: a
        // refusal — the loader's, `compose`'s count, the sheet's family — leaves the page as it
        // was. `compose` owns the count, so the page does not restate it in different words.
        const drawn = documentOf(records, study)
        setSource(filesFor(records))
        setDocument(drawn)
      } catch (error) {
        setRefusal(named(inputs, (error as Error).message))
      }
    },
    [study],
  )

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setOver(false)
    const files = [...event.dataTransfer.files]
    void Promise.all(
      // A file that cannot be read — a dropped folder, a file the browser refuses — is refused
      // in words under its own name rather than leaving the page silent (round 1, finding 6).
      files.map(async (file): Promise<Input> => {
        try {
          return { name: file.name, text: await file.text() }
        } catch (error) {
          throw new Error(`${file.name}: cannot be read — ${(error as Error).message}`, {
            cause: error,
          })
        }
      }),
    ).then(render, (error: Error) => setRefusal(error.message))
  }

  return (
    <div className="sheet">
      {/* The chrome, which print hides: the title and, before a document is drawn, the lead.
          The document itself is a sibling, never a child — `@media print` sets `display: none`
          on this header, and an ancestor hidden that way takes the sheet down with it whatever
          the sheet's own rules say, so the leave-behind printed blank (round 1, finding 1). */}
      <header className="sheet__head">
        <h1 className="sheet__title">Vigil — subject sheet</h1>
        {document_ === null && (
          <p className="sheet__lead">
            Drop a results file, or both run files, below — or paste their JSON. The sheet is drawn
            in this tab and nothing is sent anywhere.{' '}
            {saved === 0
              ? 'No runs are kept in this browser.'
              : `${saved} run${saved === 1 ? '' : 's'} ${saved === 1 ? 'is' : 'are'} kept in this browser, under the subject's own code, so a study session can be finished and handed over; Clear saved runs below removes ${saved === 1 ? 'it' : 'them'}.`}
          </p>
        )}
      </header>
      {document_ !== null && (
        <SheetDocument document_={document_} files={source ?? []}>
          <button
            type="button"
            className="sheet__button"
            onClick={() => {
              setDocument(null)
              setSource(null)
              setPasted('')
            }}
          >
            Start over
          </button>
        </SheetDocument>
      )}
      {refusal !== null && (
        <p className="sheet__refusal" role="alert">
          {refusal}
        </p>
      )}
      {document_ === null && (
        <div className="sheet__intake">
          <div
            className={`sheet__drop${over ? ' sheet__drop--over' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
          >
            {study === null ? 'Loading the recording…' : 'Drop the files here'}
          </div>
          <textarea
            className="sheet__paste"
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            placeholder="…or paste a results file, or one run then the other"
            rows={10}
            aria-label="Paste a results file or two run files"
          />
          <div className="sheet__actions">
            <button
              type="button"
              className="sheet__button"
              disabled={study === null || pasted.trim() === ''}
              onClick={() => render(splitPasted(pasted))}
            >
              Render the sheet
            </button>
            {/* The one place a subject's saved runs can be removed (item 8). It clears this
                browser's runs whatever subject wrote them, which is what a shared machine
                between two subjects needs, and says how many it cleared. */}
            {saved > 0 &&
              (asking ? (
                <>
                  <span className="sheet__asking" role="alert">
                    Clear {saved} saved run{saved === 1 ? '' : 's'}? This cannot be undone.
                  </span>
                  <button
                    type="button"
                    className="sheet__button"
                    onClick={() => {
                      clearRuns()
                      setSaved(savedKeys().length)
                      setAsking(false)
                    }}
                  >
                    Clear
                  </button>
                  <button type="button" className="sheet__quiet" onClick={() => setAsking(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" className="sheet__quiet" onClick={() => setAsking(true)}>
                  Clear saved runs
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * A refusal under the name of what was read. The loader's already carry it — `runsIn` was given
 * that name — including a results file's inner refusals, which read `<name> runs[1]: …`, so the
 * page prefixes only what carries no name at all (round 1, finding 3).
 */
function named(inputs: readonly Input[], message: string): string {
  const already = inputs.some(
    (input) => message.startsWith(`${input.name}: `) || message.startsWith(`${input.name} `),
  )
  return already ? message : `${inputs.map((input) => input.name).join(', ')}: ${message}`
}
