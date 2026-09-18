/**
 * The sheet in the browser (S6a, #165, A1): the tool's own modules, called from the app.
 *
 * Nothing here draws or measures — `tools/replay` does both, unchanged, and the CLI's byte-for-
 * byte pins prove it is the same code. What this module holds is the one thing the CLI got from
 * its filesystem and the browser gets from its network: the study's recording, fetched the way
 * the app fetches every recording, turned into the `Study` the tool takes.
 *
 * This module and everything it imports are loaded on demand (`App.tsx`), so a build a subject
 * runs never carries the roles table — the answer key — on the run's own path (A2).
 */

import { loadCapture, captureUrl } from './capture.ts'
import { recordingNamed } from '../config/recordings.ts'
import { compose } from '../../tools/replay/compose.ts'
import { STUDY_RECORDING } from '../../scripts/study-spec.ts'
import { planFor, studyOf, type Study } from '../../tools/replay/load.ts'
import { runMetrics } from '../../tools/replay/metrics.ts'
import type { RunRecord } from '../lib/run.ts'

export { runsIn } from '../../tools/replay/load.ts'

/** The study's recording, fetched and indexed — the CLI's `loadStudy`, over the network. */
export async function fetchStudy(fetcher: typeof fetch = fetch): Promise<Study> {
  const entry = recordingNamed(STUDY_RECORDING)
  return studyOf({ entry, capture: await loadCapture(captureUrl(entry), fetcher) })
}

/**
 * Two runs as the document they make — the sheet for two scenarios of one family, the pair for
 * one scenario — and the file name the CLI would have written it under.
 */
/**
 * What *Save the runs* hands back (D4, ruled: one normalised results file).
 *
 * One subject's two runs normalise to their results file, which is the file to hand over and the
 * file the CLI reads. Two subjects' runs do not: a results envelope is one subject's by contract
 * (`parseResults`), so an envelope built over two would be refused by the tool that has to read
 * it. The page composes a pair from two subjects — the viewer's artifact (#131, the amendment of
 * 2026-09-16 evening) — so that case writes each run's own file instead, under the name a run
 * download already carries. Either way what comes back is what the tool reads back.
 */
export function filesFor(records: readonly RunRecord[]): { name: string; text: string }[] {
  const [first] = records
  if (records.every((record) => record.subject === first.subject)) {
    return [
      {
        name: `vigil-${first.subject}-results.json`,
        text: JSON.stringify(
          { subject: first.subject, build: first.build, runs: records },
          null,
          2,
        ),
      },
    ]
  }
  return records.map((record) => ({
    name: `vigil-${record.subject}-run${record.run}.json`,
    text: JSON.stringify(record, null, 2),
  }))
}

export function documentOf(
  records: readonly RunRecord[],
  study: Study,
): { name: string; svg: string } {
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
 * nothing depends on where the newlines fell. Text outside any object — a stray word, a
 * half-pasted tail — is kept as its own input, which the loader then refuses by name rather than
 * silently dropping.
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
      if (depth === 0) {
        parts.push(text.slice(start, i + 1))
        start = i + 1
      }
    }
  }
  // An object the paste cut short, or text after the last one: handed on whole so the loader
  // names it in its refusal.
  const tail = text.slice(start).trim()
  if (tail !== '') parts.push(tail)
  const found = parts.length === 0 ? [text] : parts
  return found.map((part, i) => ({
    name: found.length === 1 ? 'pasted' : `pasted[${i}]`,
    text: part,
  }))
}
