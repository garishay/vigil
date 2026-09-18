import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import './SheetPage.css'
import { documentOf, fetchStudy, filesFor, runsIn, splitPasted, type SaveFile } from '../data/sheet'
import { useCopy } from './useCopy'
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
 * One click, one file (round 1 on #187, ruled 5). The anchor is attached before the click,
 * because a detached one does not download in every browser, and the object URL is revoked on a
 * later turn: the click is taken synchronously but the blob is not read until after it.
 */
const save = (name: string, type: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * `fetcher` is the network seam, injected the way the capture's and the photo lookup's are
 * (03d): the page fetches the study recording, and no test reaches the network.
 */
export function SheetPage({ fetcher = fetch }: { fetcher?: typeof fetch } = {}) {
  const [study, setStudy] = useState<Study | null>(null)
  const [pasted, setPasted] = useState('')
  const [source, setSource] = useState<SaveFile[] | null>(null)
  const [document_, setDocument] = useState<{ name: string; svg: string } | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const { copy, copied } = useCopy(textRef)

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

  const copyText = source === null ? '' : source.map((file) => file.text).join('\n')

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
      <header className="sheet__head">
        <h1 className="sheet__title">Vigil — subject sheet</h1>
        {document_ === null ? (
          <p className="sheet__lead">
            Drop a results file, or both run files, below — or paste their JSON. Nothing is stored
            and nothing is sent: the sheet is drawn in this tab.
          </p>
        ) : (
          <div className="sheet__actions">
            <button
              type="button"
              className="sheet__button"
              onClick={() => save(document_.name, 'image/svg+xml', document_.svg)}
            >
              Download the sheet
            </button>
            <button type="button" className="sheet__button" onClick={() => window.print()}>
              Print
            </button>
            {/* One button per file, so one click is one file: a document of one subject's two
                runs saves their results file, and any other pair saves each run's own, named
                for what tells it from the other (round 1, ruled 5). */}
            {(source ?? []).map((file) => (
              <button
                key={file.name}
                type="button"
                className="sheet__button"
                onClick={() => save(file.name, 'application/json', file.text)}
              >
                Save {file.label}
              </button>
            ))}
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
          </div>
        )}
      </header>
      {refusal !== null && (
        <p className="sheet__refusal" role="alert">
          {refusal}
        </p>
      )}
      {document_ === null ? (
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
          <button
            type="button"
            className="sheet__button"
            disabled={study === null || pasted.trim() === ''}
            onClick={() => render(splitPasted(pasted))}
          >
            Render the sheet
          </button>
        </div>
      ) : (
        <div
          className="sheet__document"
          // The tool's own SVG, built in this tab from text this tab parsed: the string is the
          // renderer's output, not the file's, and every value a file supplied is escaped for
          // the context it lands in — text by `esc`, attributes by `escAttr` (round 1).
          dangerouslySetInnerHTML={{ __html: document_.svg }}
        />
      )}
      {document_ !== null && source !== null && (
        <div className="sheet__copy">
          {/* The clipboard fallback for Save (round 1, finding 4): `useCopy` selects this
              textarea when the clipboard API is missing or refused, so it is on screen and
              holding the text rather than unmounted — and a manual Ctrl+C works either way.
              What it holds is what the paste box reads back: `splitPasted` finds each object by
              brace depth, so two files joined here come apart there (R2). */}
          <button type="button" className="sheet__button" onClick={() => void copy(copyText)}>
            {copied(copyText) ? 'Copied' : 'Copy the runs'}
          </button>
          <textarea
            ref={textRef}
            className="sheet__paste sheet__saved"
            readOnly
            value={copyText}
            rows={4}
            aria-label="The runs, to copy"
          />
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
