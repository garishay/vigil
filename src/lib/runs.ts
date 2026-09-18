/**
 * A subject's runs, kept in their own browser (S6a-iii, #165, items 2 and 8).
 *
 * A study run is a session, and a session is two runs: the subject answers the three questions,
 * the run is written here under their code and its index, and the end screen offers the next
 * one. Nothing leaves the browser — the store exists so a subject can hand over one file at the
 * end and so a link opened twice does not re-run a run already given.
 *
 * Fail-soft, as the site plan's store is: a browser with storage disabled, a private window, a
 * quota refused — reading gives nothing and writing gives false, and the run is still on screen
 * to copy. A run that cannot be saved is never a run that cannot be finished.
 *
 * Pure but for `storage`, which is a parameter: the tests hand in their own.
 */

import type { RunRecord } from './run.ts'

/** One key per subject per run — `vigil.run.S13.1` — so two subjects never collide. */
export const runKey = (subject: string, run: number) => `vigil.run.${subject}.${run}`

/** What a browser gives us: the two methods this store uses, and the ones it may refuse. */
export type RunStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

const browserStore = (): RunStore | null => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** The run saved under a subject and index, or null — an unreadable or unparsable one is null. */
export function readRun(
  subject: string,
  run: number,
  store: RunStore | null = browserStore(),
): RunRecord | null {
  try {
    const text = store?.getItem(runKey(subject, run)) ?? null
    return text === null ? null : (JSON.parse(text) as RunRecord)
  } catch {
    return null
  }
}

/** Writes a run under its subject and index. False when the browser refused to keep it. */
export function writeRun(
  record: RunRecord,
  text: string,
  store: RunStore | null = browserStore(),
): boolean {
  try {
    store?.setItem(runKey(record.subject, record.run), text)
  } catch {
    return false
  }
  return readRun(record.subject, record.run, store) !== null
}

/** Every run this browser holds for a subject, in run order. */
export function runsOf(
  subject: string,
  upTo: number,
  store: RunStore | null = browserStore(),
): RunRecord[] {
  const found: RunRecord[] = []
  for (let run = 1; run <= upTo; run++) {
    const record = readRun(subject, run, store)
    if (record !== null) found.push(record)
  }
  return found
}

/**
 * The run a subject link opens at (item 8): the first of the session's runs this browser has not
 * saved. A link is sent for run 1, and a subject who reloads it after finishing run 1 lands on
 * run 2 rather than running run 1 again; with both saved there is no run left, and the shell
 * shows the results instead.
 */
export function firstUnsaved(
  subject: string,
  runs: number,
  store: RunStore | null = browserStore(),
): number | null {
  for (let run = 1; run <= runs; run++) {
    if (readRun(subject, run, store) === null) return run
  }
  return null
}

/** Every run key this browser holds, whatever subject wrote it — what *Clear saved runs* clears. */
export function savedKeys(store: RunStore | null = browserStore()): string[] {
  const keys: string[] = []
  try {
    if (store === null) return keys
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      if (key !== null && key.startsWith('vigil.run.')) keys.push(key)
    }
  } catch {
    return keys
  }
  return keys
}

/** Clears every saved run in this browser, and says how many it cleared. */
export function clearRuns(store: RunStore | null = browserStore()): number {
  const keys = savedKeys(store)
  try {
    for (const key of keys) store?.removeItem(key)
  } catch {
    return 0
  }
  return keys.length
}
