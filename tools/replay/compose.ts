/**
 * Two runs composed into one document (S6a, #165, A3): one scenario is the pair (S5d-i), two
 * scenarios of one family the subject sheet (S5e) — the unaided run left, the Vigil run right,
 * whichever order they were named in. Two of unlike families are refused in words by the sheet
 * itself. Lifted out of `tools/replay.ts` so the CLI and the sheet page take the same branch and
 * the same file name; pure, so the browser can call it.
 */

import { sheetDocument, sheetName } from './sheet.ts'
import { pairName, pairSvg } from './pair.ts'
import { RunRefusal } from './load.ts'
import type { FrameInput, FrameOptions } from './frame.ts'

/** The pair's Queue boxes show this many rows and count the rest (S5d-i, ruled G2). */
export const PAIR_QUEUE_CAP = 5

/**
 * A document composed: the file name the CLI writes it under, the one SVG that file holds, and
 * the same document as blocks for the browser to mount one by one (S5g, #194) — the sheet's
 * blocks, or the pair whole, since a pair's log is short and its print is one page.
 */
export interface Composed {
  name: string
  svg: string
  blocks: string[]
}

export function compose(
  runs: readonly FrameInput[],
  options: FrameOptions = { queueCap: PAIR_QUEUE_CAP },
): Composed {
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
    const svg = pairSvg({ left: first, right: second }, options)
    return { name: pairName(first.record, second.record), svg, blocks: [svg] }
  }
  const unaided = first.record.mode === 'raw' ? first : second
  const vigil = unaided === first ? second : first
  // One layout, both readings (round 1 on #195): the file and the blocks come from the same
  // `sheetLayout` call, so neither the CLI, which writes the file, nor the page, which mounts
  // the blocks, pays for a second one it throws away.
  const { svg, blocks } = sheetDocument({ unaided, vigil }, options)
  return { name: sheetName(unaided.record, vigil.record), svg, blocks }
}
