import { useEffect, useState } from 'react'
import './SheetPage.css'
import { SheetDocument } from './SheetDocument'
import { documentOf, fetchStudy, filesFor } from '../data/sheet'
import type { RunRecord } from '../lib/run'

/**
 * The results view (S6a-iii, #165, items 4 and 5): a subject's own two runs, drawn as the
 * subject sheet in the tab they ran them in, with the file to hand over beside it.
 *
 * Reached from run 2's end screen once both runs are in this browser and the three questions are
 * answered. It is the CLI's own document by the CLI's own code — `documentOf` is the sheet
 * page's seam, so the subject and the owner read the same sheet — and it says what the file it
 * offers holds, because a subject is handing it to someone.
 *
 * This module is in the chunk the *See your results* click fetches, never on the run's own path
 * (R1): a subject who never presses it never downloads the replay tool, nor the roles table.
 */
export function RunResults({
  runs,
  fetcher = fetch,
}: {
  /** The subject's runs, from this browser's store. */
  runs: readonly RunRecord[]
  fetcher?: typeof fetch
}) {
  const [drawn, setDrawn] = useState<{ name: string; svg: string } | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetchStudy(fetcher).then(
      (study) => {
        if (!live) return
        try {
          setDrawn(documentOf(runs, study))
        } catch (error) {
          setRefusal((error as Error).message)
        }
      },
      (error: Error) => live && setRefusal(error.message),
    )
    return () => {
      live = false
    }
  }, [runs, fetcher])

  return (
    <div className="sheet">
      <header className="sheet__head">
        <h1 className="sheet__title">Vigil — your results</h1>
        <p className="sheet__lead">
          Both of your runs, side by side. <strong>Download results</strong> saves one file holding
          them: your subject code, every track you opened and every action you took with its time,
          and your three answers. It holds no name, and nothing has been sent anywhere.{' '}
          <strong>Send that file to the person running your session.</strong>
        </p>
      </header>
      {refusal !== null && (
        <p className="sheet__refusal" role="alert">
          {refusal}
        </p>
      )}
      {drawn === null ? (
        refusal === null && <p className="sheet__lead">Drawing your sheet…</p>
      ) : (
        <SheetDocument
          document_={drawn}
          files={filesFor(runs)}
          primarySave="Download results"
          copyWord="Copy results"
        />
      )}
    </div>
  )
}
