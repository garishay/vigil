/**
 * The sheet in the browser (S6a, #165, A1): the tool's own modules, called from the app.
 *
 * Nothing here draws or measures — `tools/replay` does both, unchanged, and the CLI's byte-for-
 * byte pins prove it is the same code. What this module holds is the one thing the CLI got from
 * its filesystem and the browser gets from its network: the study's recording, fetched the way
 * the app fetches every recording, turned into the `Study` the tool takes.
 *
 * This module and everything it imports are loaded on demand — `main.tsx` reaches the page by a
 * dynamic `import()` — so a build a subject runs never carries the roles table, the answer key,
 * on the run's own path (A2, R1).
 */

import { loadCapture, captureUrl } from './capture.ts'
import { recordingNamed } from '../config/recordings.ts'
import { compose, type Composed } from '../../tools/replay/compose.ts'
import { STUDY_RECORDING } from '../../scripts/study-spec.ts'
import { planFor, studyOf, type Study } from '../../tools/replay/load.ts'
import { runMetrics } from '../../tools/replay/metrics.ts'
import { conditionWord } from '../../tools/replay/pair.ts'
import { resultsJson } from '../lib/run.ts'
import type { RunRecord } from '../lib/run.ts'

export { runsIn } from '../../tools/replay/load.ts'
export type { Composed } from '../../tools/replay/compose.ts'

/** The study's recording, fetched and indexed — the CLI's `loadStudy`, over the network. */
export async function fetchStudy(fetcher: typeof fetch = fetch): Promise<Study> {
  const entry = recordingNamed(STUDY_RECORDING)
  return studyOf({ entry, capture: await loadCapture(captureUrl(entry), fetcher) })
}

/** A file the page offers to save, and the word its own button carries. */
export interface SaveFile {
  name: string
  text: string
  /** What tells this run from the other one: the subject, else the scenario, else the condition. */
  label: string
}

/** A results envelope reads back only when every run is one subject's and the runs differ. */
const oneSubjectsSession = (records: readonly RunRecord[]): boolean =>
  records.every((record) => record.subject === records[0].subject) &&
  new Set(records.map((record) => record.run)).size === records.length

/**
 * What tells two runs apart, in the order the pair's row title asks them (#177): the subject
 * where the subjects differ, else the scenario, else the condition, else the run index.
 */
function labelOf(record: RunRecord, others: readonly RunRecord[]): string {
  const differs = (read: (run: RunRecord) => string) =>
    others.some((other) => read(other) !== read(record))
  if (differs((run) => run.subject)) return record.subject
  if (differs((run) => run.scenario)) return record.scenario
  if (differs((run) => run.mode)) return conditionWord(record)
  return `run ${record.run}`
}

/**
 * What *Save the runs* hands back (D4, ruled: one normalised results file).
 *
 * One subject's two runs normalise to their results file, which is the file to hand over and the
 * file the CLI reads — written **in run order whatever order the files arrived in**, since
 * `parseResults` reads the runs ascending and would refuse the envelope otherwise (round 1).
 *
 * Anything else does not make an envelope: it is one subject's by contract, and two runs that
 * share a run index have no order to be written in. The page composes a pair from two subjects —
 * the viewer's artifact (#131, the amendment of 2026-09-16 evening) — and a pair of one subject's
 * two conditions is the S5a fixtures' own shape, so both hand back each run's own file, named for
 * everything that tells one run from another. Either way what comes back is what the tool reads
 * back, and each file has its own button (round 1, ruled 5: one click, one file).
 */
export function filesFor(records: readonly RunRecord[]): SaveFile[] {
  if (oneSubjectsSession(records)) {
    const runs = [...records].sort((a, b) => a.run - b.run)
    return [
      {
        name: `vigil-${runs[0].subject}-results.json`,
        text: resultsJson(runs),
        label: 'the runs',
      },
    ]
  }
  return records.map((record) => ({
    name: `vigil-${record.subject}-${record.scenario}-${record.mode}-run${record.run}.json`,
    text: JSON.stringify(record, null, 2),
    label: labelOf(record, records),
  }))
}

/**
 * Two runs as the document they make — the sheet for two scenarios of one family, the pair for
 * one scenario — and the file name the CLI would have written it under. `compose` is the CLI's
 * own branch, so this is the only code between the page and the renderer.
 */
export function documentOf(records: readonly RunRecord[], study: Study): Composed {
  return compose(
    records.map((record) => {
      const plan = planFor(record.scenario, study.timeline)
      return { record, plan, study, metrics: runMetrics(record, study.index, plan) }
    }),
  )
}

/**
 * Pasted text as one input per top-level JSON object: two runs pasted one after the other are
 * two objects, a results file is one.
 *
 * The split reads **structure, not line shape** (R2, ruled): a run's text reaches the page by way
 * of a chat client, which is free to fold or drop every line break, so the pretty-printed form
 * and the same text on one line must split the same way. Objects are found by brace depth
 * counted outside strings, escapes honoured, so no `{` or `}` inside a string can split a run and
 * nothing depends on where the newlines fell.
 *
 * Text outside any top-level object is **ignored**, before, between and after (ruled, round 1 on
 * #187): the same chat client wraps a paste in a name, a time or a greeting, and the objects
 * themselves are what the loader validates. An object that opens and never closes is not stray
 * text — it is handed on whole, so the loader refuses it in words rather than the page dropping
 * it. A paste holding no object at all yields nothing, and the page says so.
 */
export function splitPasted(text: string): { name: string; text: string }[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
    } else if (char === '{') {
      if (depth === 0) start = i
      depth++
    } else if (char === '}' && depth > 0) {
      depth--
      if (depth === 0) parts.push(text.slice(start, i + 1))
    }
  }
  // An object the paste cut short: everything from its `{` on, so the loader names it.
  if (depth > 0) parts.push(text.slice(start))
  return parts.map((part, i) => ({
    name: parts.length === 1 ? 'pasted' : `pasted[${i}]`,
    text: part,
  }))
}
