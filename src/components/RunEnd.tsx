import { useRef } from 'react'
import { useCopy } from './useCopy'
import type { QuestionId, WorkloadQuestion } from '../config/study'
import type { RunAnswers } from '../lib/run'

/**
 * The end screen (S4b, #137, ruled A7; #131): over the frozen picture at the run's end, the
 * three workload questions as rows of radio buttons on the scale, and Copy run — enabled once
 * all three are answered, copying the run JSON with the handoff's mechanics (the clipboard, the
 * textarea fallback) and reading *Copied* for the text actually copied. The JSON is printed
 * read-only under the button too, so a subject who cannot copy can select it. Nothing is
 * transmitted: the subject pastes it themselves. There is no way on: the run is over, and a
 * reload of the same link opens its brief again.
 */
export function RunEnd({
  title,
  questions,
  scale,
  answers,
  onAnswer,
  json,
}: {
  title: string
  questions: readonly WorkloadQuestion[]
  scale: { min: number; max: number }
  answers: Partial<RunAnswers>
  onAnswer: (id: QuestionId, value: number) => void
  /** The run JSON once every question is answered; null before. */
  json: string | null
}) {
  const textRef = useRef<HTMLTextAreaElement>(null)
  const { copy, copied } = useCopy(textRef)
  const values = Array.from({ length: scale.max - scale.min + 1 }, (_, i) => scale.min + i)
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
        <div className="run__copy">
          <button
            type="button"
            className="run__button"
            disabled={json === null}
            onClick={() => {
              if (json !== null) void copy(json)
            }}
          >
            {json !== null && copied(json) ? 'Copied' : 'Copy run'}
          </button>
          {json === null && <span className="run__hint">Enabled once all three are answered</span>}
        </div>
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
