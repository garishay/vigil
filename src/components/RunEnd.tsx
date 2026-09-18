import { useRef } from 'react'
import { useCopy } from './useCopy'
import type { QuestionId, WorkloadQuestion } from '../config/study'
import type { RunAnswers } from '../lib/run'

/**
 * The end screen (S4b, #137, ruled A7; #131; S6a-iii, #165, items 2 and 3): over the frozen
 * picture at the run's end, the three workload questions as rows of radio buttons on the scale.
 *
 * Once all three are answered the run is saved in this browser and the card reads in the order
 * the subject moves through it (ruled R1): **the saved line**, which says what to do and not
 * only what happened; then **the way on** as the card's one primary button; then the backups as
 * a quiet row that says it is optional; then the JSON behind its disclosure. A subject should
 * never have to wonder whether Copy run must be pressed before Start run 2 — the hierarchy
 * answers it without a word.
 *
 * **The way on follows what is saved, not this run's number** (ruled, round 1): every run of the
 * session in this browser means *See your results*, whatever order they were run in; a run left
 * to offer means *Start run N*; and neither means the words for what is missing with *Download a
 * copy* as the primary instead. No end screen is left with neither a primary nor words.
 *
 * When the browser refuses to keep the run the order flips: the warning first, and *Download a
 * copy* as the primary, because the file is then the only way the run survives the tab.
 *
 * Before the three answers there is nothing to save, copy or go on to, so the card is the
 * questions and one hint and nothing else.
 *
 * Nothing of the run just finished is shown either way: no frame, no counts, no answer read
 * back (item 3). Nothing is transmitted; the subject hands it over themselves.
 */
export function RunEnd({
  title,
  run,
  questions,
  scale,
  answers,
  onAnswer,
  json,
  saved,
  onDownload,
  onNext,
  onResults,
  resultsMissing,
  resultsRefusal = null,
}: {
  title: string
  /** This run's index, for the saved line's own words. */
  run: number
  questions: readonly WorkloadQuestion[]
  scale: { min: number; max: number }
  answers: Partial<RunAnswers>
  onAnswer: (id: QuestionId, value: number) => void
  /** The run JSON once every question is answered; null before. */
  json: string | null
  /** Whether this browser kept the run. False before the answers, and after a refused write. */
  saved: boolean
  /** Saves this run as its own file. */
  onDownload: () => void
  /** Opens the next run of this session; absent on the session's last run. */
  onNext?: () => void
  /** Draws this subject's results; absent until every run of the session is in this browser. */
  onResults?: () => void
  /**
   * Whether the session's other run is missing from this browser with no run left to offer — the
   * words for it, and the file as the way out. Follows what is saved, not this run's number
   * (ruled, round 1).
   */
  resultsMissing?: boolean
  /** What the browser said when the results chunk would not load; null when it did. */
  resultsRefusal?: string | null
}) {
  const textRef = useRef<HTMLTextAreaElement>(null)
  const { copy, copied } = useCopy(textRef)
  const values = Array.from({ length: scale.max - scale.min + 1 }, (_, i) => scale.min + i)
  const answered = json !== null
  const copyRun = (
    <button
      type="button"
      className="run__quiet"
      onClick={() => {
        if (json !== null) void copy(json)
      }}
    >
      {copied(json ?? '') ? 'Copied' : 'Copy run'}
    </button>
  )
  const downloadQuiet = (
    <button type="button" className="run__quiet" onClick={onDownload}>
      Download a copy
    </button>
  )
  return (
    <div className="run" role="dialog" aria-modal="true" aria-labelledby="run-title">
      <div className="run__card">
        <h2 className="run__title" id="run-title">
          {title}
        </h2>
        {questions.map((question) => (
          <fieldset className="run__question" key={question.id}>
            <legend className="run__legend">{question.label}</legend>
            <div className="run__scale">
              {values.map((value) => (
                <label className="run__choice" key={value}>
                  <input
                    type="radio"
                    name={`run-${question.id}`}
                    value={value}
                    checked={answers[question.id] === value}
                    onChange={() => onAnswer(question.id, value)}
                  />
                  <span>{value}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        {/* Before the answers the card is the questions and one hint. The backups appear
            with the rest once the third answer lands: two disabled buttons under a hint made
            the backups look like the goal (ruled, round 1). */}
        {!answered && <p className="run__hint">Answer all three to continue.</p>}
        {answered && !saved && (
          <>
            <p className="run__warn" role="alert">
              This browser would not keep this run. Download it before you close the tab.
            </p>
            <button type="button" className="run__button run__next" onClick={onDownload}>
              Download a copy
            </button>
            <div className="run__optional">
              <span className="run__optional-label">Also:</span>
              {copyRun}
            </div>
          </>
        )}
        {answered && saved && (
          <>
            <p className="run__saved">
              Run {run} is saved in this browser.
              {onNext !== undefined && ` Start run ${run + 1} when you are ready.`}
              {onResults !== undefined && ' Your results are ready.'}
            </p>
            {/* When the earlier run is not in this browser there is nothing to draw, so the words
                say so and the file becomes the way out — the primary, as when a write is refused
                (ruled R1). */}
            {resultsMissing === true && (
              <p className="run__warn" role="alert">
                Your other run is not saved in this browser, so your results cannot be drawn here.
                Download this run and hand both runs over.
              </p>
            )}
            {/* The chunk did not arrive. The button stays — pressing it retries — and the words
                carry the one thing to do, as the sheet page's door does (round 1, finding 2). */}
            {resultsRefusal !== null && (
              <p className="run__warn" role="alert">
                Your results did not load — {resultsRefusal}. Reload the page and press it again.
              </p>
            )}
            {onNext !== undefined && (
              <button type="button" className="run__button run__next" onClick={onNext}>
                Start run {run + 1}
              </button>
            )}
            {onResults !== undefined && (
              <button type="button" className="run__button run__next" onClick={onResults}>
                See your results
              </button>
            )}
            {resultsMissing === true && (
              <button type="button" className="run__button run__next" onClick={onDownload}>
                Download a copy
              </button>
            )}
            <div className="run__optional">
              {/* Labelled optional only where a primary way on exists; where these are the way
                  out, calling them a backup would be a lie (ruled R1). */}
              {(onNext !== undefined || onResults !== undefined || resultsMissing === true) && (
                <span className="run__optional-label">Optional backup:</span>
              )}
              {copyRun}
              {resultsMissing !== true && downloadQuiet}
            </div>
          </>
        )}
        {/* Behind a disclosure, closed by default (#36 [39], ruled A): the subject copies without
          reading the ids; the textarea stays mounted for the copy fallback and for a subject who
          cannot copy. */}
        {json !== null && (
          <details className="run__details">
            <summary className="run__summary">Show JSON</summary>
            <textarea
              ref={textRef}
              className="run__json"
              readOnly
              value={json}
              rows={Math.min(16, json.split('\n').length)}
              aria-label="Run JSON"
            />
          </details>
        )}
      </div>
    </div>
  )
}
