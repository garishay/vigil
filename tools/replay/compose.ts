/**
 * Two runs composed into one document (S6a, #165, A3): one scenario is the pair (S5d-i), two
 * scenarios of one family the subject sheet (S5e) — the unaided run left, the Vigil run right,
 * whichever order they were named in. Two of unlike families are refused in words by the sheet
 * itself. Lifted out of `tools/replay.ts` so the CLI and the sheet page take the same branch and
 * the same file name; pure, so the browser can call it.
 */

import { sheetName, sheetSvg } from './sheet.ts'
import { pairName, pairSvg } from './pair.ts'
import { RunRefusal } from './load.ts'
import type { FrameInput, FrameOptions } from './frame.ts'

/** The pair's Queue boxes show this many rows and count the rest (S5d-i, ruled G2). */
export const PAIR_QUEUE_CAP = 5

export function compose(
  runs: readonly FrameInput[],
  options: FrameOptions = { queueCap: PAIR_QUEUE_CAP },
): { name: string; svg: string } {
  // The count is checked here rather than at the call site, so the guard travels with the
  // function: `parseResults` stays permissive about how many runs a file holds, and two is
  // required where two are actually read (round 1 on #185). A refusal, not a TypeError on
  // `second`. The sentence says what to give rather than why two, because the sheet page shows
  // it to a subject (S6a-ii, the approved mockup) and the CLI takes the same two things.
  if (runs.length !== 2) {
    throw new RunRefusal(
      `a document reads two runs, not ${runs.length} — a results file, or both run files`,
    )
  }
  const [first, second] = runs
  if (first.record.scenario === second.record.scenario) {
    return {
      name: pairName(first.record, second.record),
      svg: pairSvg({ left: first, right: second }, options),
    }
  }
  const unaided = first.record.mode === 'raw' ? first : second
  const vigil = unaided === first ? second : first
  return {
    name: sheetName(unaided.record, vigil.record),
    svg: sheetSvg({ unaided, vigil }, options),
  }
}
