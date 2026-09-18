import { describe, expect, it } from 'vitest'
import { clearRuns, firstUnsaved, readRun, runKey, runsOf, savedKeys, writeRun } from './runs'
import type { RunStore } from './runs'
import type { RunRecord } from './run'

const record = (subject: string, run: number): RunRecord => ({
  subject,
  scenario: run === 1 ? '03a' : '03b',
  mode: run === 1 ? 'raw' : 'vigil',
  run,
  build: '2.60.0+deadbee',
  began_at: '2026-09-18T18:00:00.000Z',
  events: [{ t: 12, type: 'select', track: 'inject-31' }],
  answers: { demand: 6, pressure: 7, confidence: 5 },
})

/** A browser's store, standing in for `localStorage` so no test touches a real one. */
const memory = (): RunStore => {
  const held = new Map<string, string>()
  return {
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
    key: (i) => [...held.keys()][i] ?? null,
    get length() {
      return held.size
    },
  }
}

/** A browser that refuses: a private window, storage disabled, a quota already spent. */
const refusing = (): RunStore => ({
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
  removeItem: () => {
    throw new Error('SecurityError')
  },
  key: () => {
    throw new Error('SecurityError')
  },
  get length(): number {
    throw new Error('SecurityError')
  },
})

/** A browser that takes a write and keeps nothing — the shape a full quota can produce. */
const forgetful = (): RunStore => ({ ...memory(), setItem: () => {} })

describe('a subject’s runs, kept in their own browser (S6a-iii, #165, item 2)', () => {
  it('keeps one key per subject per run, so two subjects never collide', () => {
    expect(runKey('S13', 1)).toBe('vigil.run.S13.1')
    const store = memory()
    const thirteen = JSON.stringify(record('S13', 1))
    const fourteen = JSON.stringify(record('S14', 1))
    expect(writeRun(record('S13', 1), thirteen, store)).toBe(true)
    expect(writeRun(record('S14', 1), fourteen, store)).toBe(true)
    expect(store.getItem('vigil.run.S13.1')).toBe(thirteen)
    expect(store.getItem('vigil.run.S14.1')).toBe(fourteen)
    expect(savedKeys(store).sort()).toEqual(['vigil.run.S13.1', 'vigil.run.S14.1'])
  })

  it('stores the run’s own text, so what is handed over is what was copied', () => {
    const store = memory()
    const run = record('S13', 1)
    const text = JSON.stringify(run)
    writeRun(run, text, store)
    expect(store.getItem(runKey('S13', 1))).toBe(text)
    expect(readRun('S13', 1, store)).toEqual(run)
  })

  it('fails soft on a browser that refuses, and on none at all', () => {
    // A run that cannot be saved is never a run that cannot be finished: the end screen says so
    // and the run is still on screen to copy or download.
    const store = refusing()
    expect(writeRun(record('S13', 1), 'text', store)).toBe(false)
    expect(readRun('S13', 1, store)).toBeNull()
    expect(runsOf('S13', 2, store)).toEqual([])
    expect(firstUnsaved('S13', 2, store)).toBe(1)
    expect(savedKeys(store)).toEqual([])
    expect(clearRuns(store)).toBe(0)
    expect(writeRun(record('S13', 1), 'text', null)).toBe(false)
    expect(readRun('S13', 1, null)).toBeNull()
    expect(firstUnsaved('S13', 2, null)).toBe(1)
  })

  it('reads back what it wrote, so a store that takes and forgets is caught', () => {
    expect(writeRun(record('S13', 1), 'text', forgetful())).toBe(false)
  })

  it('reads nothing back from text that is not a run', () => {
    const store = memory()
    store.setItem(runKey('S13', 1), 'not json')
    expect(readRun('S13', 1, store)).toBeNull()
    expect(firstUnsaved('S13', 2, store)).toBe(1)
  })

  it('lists a subject’s runs in run order, whatever order they were written', () => {
    const store = memory()
    writeRun(record('S13', 2), JSON.stringify(record('S13', 2)), store)
    writeRun(record('S13', 1), JSON.stringify(record('S13', 1)), store)
    expect(runsOf('S13', 2, store).map((run) => run.run)).toEqual([1, 2])
  })
})

describe('the run a link opens at (S6a-iii, #165, item 8)', () => {
  it('is the first run this browser has not saved, and nothing when every run is in', () => {
    const store = memory()
    expect(firstUnsaved('S13', 2, store)).toBe(1)
    writeRun(record('S13', 1), JSON.stringify(record('S13', 1)), store)
    expect(firstUnsaved('S13', 2, store)).toBe(2)
    writeRun(record('S13', 2), JSON.stringify(record('S13', 2)), store)
    expect(firstUnsaved('S13', 2, store)).toBeNull()
    // A gap is the first gap: run 2 saved without run 1 still opens at run 1.
    const gapped = memory()
    writeRun(record('S14', 2), JSON.stringify(record('S14', 2)), gapped)
    expect(firstUnsaved('S14', 2, gapped)).toBe(1)
  })

  it('clears every saved run in this browser, and says how many', () => {
    const store = memory()
    writeRun(record('S13', 1), JSON.stringify(record('S13', 1)), store)
    writeRun(record('S14', 2), JSON.stringify(record('S14', 2)), store)
    store.setItem('vigil.site-plan', 'kept')
    expect(clearRuns(store)).toBe(2)
    expect(savedKeys(store)).toEqual([])
    // Only the runs: another key of the app's own is not this control's to remove.
    expect(store.getItem('vigil.site-plan')).toBe('kept')
    expect(clearRuns(store)).toBe(0)
  })
})
