import { ShapeGlyph } from './IdentityDot'
import type { BriefBlock, BriefLine } from '../config/study'

/**
 * The brief a study run opens on (S4b, #137, ruled A2; #131), rebuilt for reading (S8, #180
 * item 6): an opaque overlay over the whole shell — the run's name, its place in the session and
 * the goal in large type, then labelled blocks in two columns so the whole fits one screen at
 * 1280×720 with nothing scrolling, and one button. Under it the clock is held at Begin's tick and
 * nothing of the picture is readable. Begin is offered once the recording is in and reaches past
 * Begin, since the clock has nothing to run on otherwise; pressing it is the parent's Begin — the
 * shell stamps `began_at` and starts the clock.
 *
 * The legend is drawn with the map's own parts — `ShapeGlyph` for the shapes and the marks, the
 * ring in the ring's own stroke — so the key cannot drift from the marker, and the actions are
 * drawn as the buttons they are, so the word on the brief is the word on the screen. None of it
 * is a control and nothing here takes an action but Begin. One block is Vigil's alone and is
 * withheld unaided; everything else is identical across the conditions.
 */
export function RunBrief({
  title,
  place,
  goal,
  blocks,
  raw,
  ready,
  onBegin,
}: {
  title: string
  /** *Run 1 of 2* — above the goal. */
  place: string
  goal: string
  blocks: readonly BriefBlock[]
  /** The unaided condition: the Vigil-only block is withheld. */
  raw: boolean
  ready: boolean
  onBegin: () => void
}) {
  return (
    <div className="run" role="dialog" aria-modal="true" aria-labelledby="run-title">
      <div className="run__card run__card--brief">
        <h2 className="run__title" id="run-title">
          {title}
        </h2>
        <p className="brief__place">{place}</p>
        <p className="brief__goal">{goal}</p>
        <div className="brief">
          {blocks
            .filter((block) => !raw || block.vigilOnly !== true)
            .map((block) => (
              <section className="brief__block" key={block.heading} aria-label={block.heading}>
                <h3 className="brief__heading">{block.heading}</h3>
                <ul className="brief__lines">
                  {block.lines.map((line) => (
                    <li className="brief__line" key={line.text}>
                      <span className="brief__symbol">
                        <Symbol line={line} />
                      </span>
                      <span>{line.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
        <button type="button" className="run__button" disabled={!ready} onClick={onBegin}>
          Begin
        </button>
      </div>
    </div>
  )
}

/**
 * What stands before a line: the map's shape with its mark, the ring, the action's button, or
 * nothing. The shape and the ring are decorative; the button is the line's own first word —
 * *Escalate if you think it will enter the ring* — drawn as the button it names, and read as
 * the word, so a subject who cannot see the brief is still told which button to press (#198
 * round 1). It is a span, never a control.
 */
function Symbol({ line }: { line: BriefLine }) {
  if (line.shape !== undefined) return <ShapeGlyph shape={line.shape} mark={line.mark} />
  if (line.ring === true) return <span className="brief__ring" aria-hidden="true" />
  if (line.button !== undefined) return <span className="brief__button">{line.button}</span>
  return null
}
