import { useRef, type ReactNode } from 'react'
import { useCopy } from './useCopy'
import { download } from '../lib/download'
import type { Composed, SaveFile } from '../data/sheet'

/**
 * A drawn document and what a reader does with it (S6a-iii, #165): the SVG the tool wrote, the
 * saves, the print, and the clipboard fallback with its text on screen.
 *
 * Shared by the sheet page (`?sheet`) and the results view a subject reaches from run 2's end
 * screen, so the two show one document with one set of controls and neither becomes a second
 * implementation of the other. Both live in the same chunk, fetched on the *See your results*
 * click and at `?sheet`, and never before (S6a-ii's R1).
 *
 * The hierarchy is the reader's own (ruled R2): on the sheet page there is nothing to hand
 * over, so the controls stay level as that page has always had them; in a session there is one
 * thing the runner needs — the results file — so that save keeps `sheet__button` and everything
 * else drops to `sheet__quiet`, the same pair the end screen draws its primary and its backups
 * with. The label is one file's: only the first save wears it, and any further file stays quiet
 * under its own run's name (ruled, round 1).
 */
export function SheetDocument({
  document_,
  files,
  primarySave,
  copyWord = 'Copy the runs',
  children,
}: {
  document_: Composed
  files: readonly SaveFile[]
  /** What the save reads when it is the one thing to hand over; absent leaves every control quiet. */
  primarySave?: string
  /** What the clipboard fallback's button reads. */
  copyWord?: string
  /** What the view puts beside the controls — the page's Start over, a session's own words. */
  children?: ReactNode
}) {
  const textRef = useRef<HTMLTextAreaElement>(null)
  const { copy, copied } = useCopy(textRef)
  const copyText = files.map((file) => file.text).join('\n')
  const quiet = primarySave === undefined ? 'sheet__button' : 'sheet__quiet'
  return (
    <>
      <div className="sheet__actions">
        {/* One click, one file: a document of one subject's two runs saves their results file,
            and any other pair saves each run's own, named for what tells it from the other
            (round 1 on #187, ruled 5). */}
        {files.map((file, index) => (
          <button
            key={file.name}
            type="button"
            // One primary, ever (ruled, round 1): the label names one file. A second file is a
            // second thing to save, not a second copy of the first, so it goes quiet under its
            // own run's name — two buttons reading *Download results* would name neither.
            className={primarySave === undefined || index === 0 ? 'sheet__button' : 'sheet__quiet'}
            onClick={() => download(file.name, 'application/json', file.text)}
          >
            {primarySave !== undefined && index === 0 ? primarySave : `Save ${file.label}`}
          </button>
        ))}
        <button
          type="button"
          className={quiet}
          onClick={() => download(document_.name, 'image/svg+xml', document_.svg)}
        >
          Download the sheet
        </button>
        <button type="button" className={quiet} onClick={() => window.print()}>
          Print
        </button>
        {children}
      </div>
      <div className="sheet__document">
        {/* The tool's own SVG, built in this tab from text this tab parsed: the string is the
            renderer's output, not the file's, and every value a file supplied is escaped for
            the context it lands in — text by `esc`, attributes by `escAttr` (round 1 on
            #187). Mounted block by block (S5g, #194): the sheet is its blocks, one element
            each, so a print breaks only between them and never through a log line; the download
            is the CLI's one file of the same blocks. */}
        {document_.blocks.map((block, index) => (
          <div key={index} className="sheet__block" dangerouslySetInnerHTML={{ __html: block }} />
        ))}
      </div>
      <div className="sheet__copy">
        {/* The clipboard fallback for the save: `useCopy` selects this textarea when the
            clipboard API is missing or refused, so it is on screen and holding the text rather
            than unmounted — and a manual Ctrl+C works either way. */}
        <button type="button" className="sheet__quiet" onClick={() => void copy(copyText)}>
          {copied(copyText) ? 'Copied' : copyWord}
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
    </>
  )
}
