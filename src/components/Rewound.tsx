/**
 * Why the workflow refuses behind the record's frontier (#77, ruled on #79), in one place for the
 * drawer's actions and the Sites editor (08a). The live region announces the *state*, never the
 * clock: its line is static and the element stays mounted with only the text toggling, so seeking
 * behind the frontier announces once and scrubbing announces nothing further — a region inserted
 * in the same commit as its text is one some screen readers never announce (#51 review). The two
 * times move in their own element beside it, outside the region. The caller describes its
 * disabled controls by both ids, since `disabled` takes them out of the tab order (#79 review).
 */
export function Rewound({
  base,
  idPrefix,
  rewound,
  clock,
  tSec,
  frontier,
}: {
  /** The CSS class of the state line; the times take `${base}-times`. */
  base: string
  /** The ids: `${idPrefix}-state` and `${idPrefix}-times`, for the caller's `aria-describedby`. */
  idPrefix: string
  rewound: boolean
  clock: (tSec: number) => string
  tSec: number
  frontier: number
}) {
  return (
    <>
      <p className={base} id={`${idPrefix}-state`} role="status">
        {rewound ? 'Rewound — the workflow acts at the record’s frontier' : null}
      </p>
      {rewound && (
        <p className={`${base}-times`} id={`${idPrefix}-times`}>
          Clock {clock(tSec)} · record {clock(frontier)}
        </p>
      )}
    </>
  )
}
