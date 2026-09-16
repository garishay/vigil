/**
 * The brief a study run opens on (S4b, #137, ruled A2; #131): an opaque overlay over the whole
 * shell — the run's name, the parent's text word for word, one button. Under it the clock is
 * held at Begin's tick and nothing of the picture is readable. Begin is offered once the
 * recording is in and reaches past Begin, since the clock has nothing to run on otherwise;
 * pressing it is the parent's Begin — the shell stamps `began_at` and starts the clock.
 */
export function RunBrief({
  title,
  brief,
  ready,
  onBegin,
}: {
  title: string
  brief: string
  ready: boolean
  onBegin: () => void
}) {
  return (
    <div className="run" role="dialog" aria-modal="true" aria-labelledby="run-title">
      <div className="run__card">
        <h2 className="run__title" id="run-title">
          {title}
        </h2>
        <p className="run__brief">{brief}</p>
        <button type="button" className="run__button" disabled={!ready} onClick={onBegin}>
          Begin
        </button>
      </div>
    </div>
  )
}
