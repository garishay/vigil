/**
 * The replay's files (S6a, #165, A1): the two places the tool touches a disk. Split out of
 * `load.ts` so the loader's refusals — the half the sheet page shares with the CLI — carry no
 * `node:` import and bundle for a browser. Nothing here parses or measures; it reads a file and
 * hands the text to `load.ts`.
 */

import { readFileSync } from 'node:fs'
import { loadRecording } from '../../scripts/study.ts'
import { STUDY_RECORDING } from '../../scripts/study-spec.ts'
import { runsIn, studyOf, type Study } from './load.ts'
import type { RunRecord } from '../../src/lib/run.ts'

/** The runs a file holds: one from a run file, both of a subject's from a results file (A7). */
export const readRuns = (path: string): RunRecord[] => runsIn(readFileSync(path, 'utf8'), path)

/** The study's recording, indexed, with its frame grid — loaded once and shared by every run. */
export const loadStudy = (id: string = STUDY_RECORDING): Study => studyOf(loadRecording(id))
