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

/**
 * Whether a parsed value is a run this browser wrote. A `vigil.run.*` key on a shared origin
 * — github.io is one — can hold anything at all, so what comes back is checked rather than
 * cast (round 1, finding 5). The check is the contract’s own shape and nothing more: the
 * replay loader's refusals are the tool's, and bringing them here would put them on the app's
 * graph, which R1 keeps clear.
 */
function isRunRecord(value: unknown): value is RunRecord {
  if (typeof value !== 'object' || value === null) return false
  const run = value as Record<string, unknown>
  return (
    typeof run.subject === 'string' &&
    typeof run.scenario === 'string' &&
    typeof run.mode === 'string' &&
    typeof run.run === 'number' &&
    typeof run.build === 'string' &&
    typeof run.began_at === 'string' &&
    Array.isArray(run.events) &&
    typeof run.answers === 'object' &&
    run.answers !== null
  )
}

/**
 * The run saved under a subject and index, or null — anything that is not a run is null.
 *
 * And nothing is trusted that the key cannot confirm (ruled, round 1): a record whose `subject`
 * or `run` disagrees with the key it came out from reads as not saved. The key is the only claim
 * this store makes; a value that contradicts it would otherwise travel into a results file under
 * a run index it does not hold, and `firstUnsaved` would count a run the subject never gave.
 */
export function readRun(
  subject: string,
  run: number,
  store: RunStore | null = browserStore(),
): RunRecord | null {
  try {
    const text = store?.getItem(runKey(subject, run)) ?? null
    if (text === null) return null
    const value: unknown = JSON.parse(text)
    if (!isRunRecord(value)) return null
    return value.subject === subject && value.run === run ? value : null
  } catch {
    return null
  }
}

/**
 * Writes a run under its subject and index, and says whether the browser kept it.
 *
 * True only when what comes back is **the text that went in** (round 1, finding 2): a store
 * that takes a write and holds an earlier value would otherwise report success while a stale
 * run sat under the key. On any failure the key is removed, so what the store holds, what
 * `firstUnsaved` reads, and the warning on the subject's screen can never disagree.
 */
export function writeRun(
  record: RunRecord,
  text: string,
  store: RunStore | null = browserStore(),
): boolean {
  const key = runKey(record.subject, record.run)
  try {
    store?.setItem(key, text)
    if (store?.getItem(key) === text) return true
  } catch {
    // Fall through: a refused write leaves whatever was there, and that is what is removed.
  }
  try {
    store?.removeItem(key)
  } catch {
    // A store that will not even remove holds nothing this browser can be trusted about.
  }
  return false
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

/**
 * Clears every saved run in this browser, and says how many it cleared.
 *
 * Every subject's, not one's: the sheet page has no subject in hand, and a machine shared between
 * two subjects is the case this exists for (ruled E4). Only the run keys — another key of the
 * app's own, the site plan's, is not this control's to remove.
 */
export function clearRuns(store: RunStore | null = browserStore()): number {
  const keys = savedKeys(store)
  try {
    for (const key of keys) store?.removeItem(key)
  } catch {
    return 0
  }
  return keys.length
}
