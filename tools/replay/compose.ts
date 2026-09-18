/**
 * Two runs composed into one document (S6a, #165, A3): one scenario is the pair (S5d-i), two
 * scenarios of one family the subject sheet (S5e) — the unaided run left, the Vigil run right,
 * whichever order they were named in. Two of unlike families are refused in words by the sheet
 * itself. Lifted out of `tools/replay.ts` so the CLI and the sheet page take the same branch and
 * the same file name; pure, so the browser can call it.
 */

import { sheetName, sheetSvg } from './sheet.ts'
import { pairName, pairSvg } from './pair.ts'
import type { FrameInput, FrameOptions } from './frame.ts'

/** The pair's Queue boxes show this many rows and count the rest (S5d-i, ruled G2). */
export const PAIR_QUEUE_CAP = 5

export function compose(
  runs: readonly FrameInput[],
  options: FrameOptions = { queueCap: PAIR_QUEUE_CAP },
): { name: string; svg: string } {
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
