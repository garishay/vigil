import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import './SheetPage.css'
import { documentOf, fetchStudy, filesFor, runsIn, splitPasted } from '../data/sheet'
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

const download = (name: string, type: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * `fetcher` is the network seam, injected the way the capture's and the photo lookup's are
 * (03d): the page fetches the study recording, and no test reaches the network.
 */
export function SheetPage({ fetcher = fetch }: { fetcher?: typeof fetch } = {}) {
  const [study, setStudy] = useState<Study | null>(null)
  const [pasted, setPasted] = useState('')
  const [source, setSource] = useState<{ name: string; text: string }[] | null>(null)
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
    (inputs: readonly { name: string; text: string }[]) => {
      if (study === null) return
      setRefusal(null)
      setDocument(null)
      setSource(null)
      try {
        const records = inputs.flatMap((input) => runsIn(input.text, input.name))
        // The document is drawn before anything is set, as the CLI draws before it writes: a
        // refusal — the loader's, `compose`'s count, the sheet's family — leaves the page as it
        // was. `compose` owns the count, so the page does not restate it in different words.
        const drawn = documentOf(records, study)
        setSource(filesFor(records))
        setDocument(drawn)
      } catch (error) {
        const message = (error as Error).message
        // The loader's refusals already name the file they read, since `runsIn` was given that
        // name; `compose`'s and the sheet's do not, so the page names what it was handed.
        setRefusal(
          inputs.some((input) => message.startsWith(`${input.name}: `))
            ? message
            : `${inputs.map((input) => input.name).join(', ')}: ${message}`,
        )
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
      files.map(async (file) => ({ name: file.name, text: await file.text() })),
    ).then(render)
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
              onClick={() => download(document_.name, 'image/svg+xml', document_.svg)}
            >
              Download the sheet
            </button>
            <button type="button" className="sheet__button" onClick={() => window.print()}>
              Print
            </button>
            {source !== null && (
              <button
                type="button"
                className="sheet__button"
                onClick={() => {
                  for (const file of source) download(file.name, 'application/json', file.text)
                }}
              >
                Save the runs
              </button>
            )}
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
            ref={textRef}
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
          // renderer's output, not the file's, and the loader refused anything it could not read.
          dangerouslySetInnerHTML={{ __html: document_.svg }}
        />
      )}
      {document_ !== null && source !== null && (
        <div className="sheet__copy">
          {/* The clipboard fallback for Save the runs. What it copies is what the paste box
              reads back: `splitPasted` finds each object by brace depth, so two files joined
              here come apart there whatever the clipboard does to the line breaks (R2). */}
          <button type="button" className="sheet__button" onClick={() => void copy(copyText)}>
            {copied(copyText) ? 'Copied' : 'Copy the runs'}
          </button>
        </div>
      )}
    </div>
  )
}
