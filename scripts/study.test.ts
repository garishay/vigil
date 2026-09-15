import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  REVISIT_ID,
  STUDY_RECORDING,
  STUDY_SCENARIOS,
  THREAT_ID,
  flapsOf,
  loadRecording,
  outPath,
  renderStudy,
  runStudy,
  type StudyResult,
} from './study.ts'
import { SCENARIOS, scenarioNamed } from '../src/config/scenarios.ts'
import { STUDY } from '../src/config/study.ts'
import { indexCapture } from '../src/lib/replay.ts'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const recording = (() => {
  const cwd = process.cwd()
  process.chdir(repo)
  try {
    return loadRecording(STUDY_RECORDING)
  } finally {
    process.chdir(cwd)
  }
})()

/** Both studies, run once for every pin below — about a second each on the dev machine. */
const results: Record<string, StudyResult> = Object.fromEntries(
  STUDY_SCENARIOS.map((name) => [name, runStudy(scenarioNamed(name, SCENARIOS), recording)]),
)
const both = STUDY_SCENARIOS.map((name) => results[name])

describe('the study config (A8)', () => {
  it('is the ruled window and raw distance, with the acceptance and audit numbers beside them', () => {
    expect(STUDY).toMatchObject({ beginS: 480, runS: 360, rawAssociationM: 1500 })
    expect(STUDY.acceptance).toEqual({ entryLeadS: 60, marginAtLeast: 5, heardCalmUnder: 40 })
    expect(STUDY.audit).toEqual({ closingAtLeast: 50, insideM: 6500, hoveringUnderKt: 2 })
    // The window sits inside the recording it runs on — read off the loaded capture, not a
    // number typed here (#147 round 2); runStudy refuses a window past the recording's end.
    expect(STUDY.beginS + STUDY.runS).toBeLessThanOrEqual(indexCapture(recording.capture).durationS)
    const short = {
      ...recording,
      capture: { ...recording.capture, frames: recording.capture.frames.slice(0, 20) },
    }
    expect(() => runStudy(scenarioNamed('02a', SCENARIOS), short)).toThrow(
      "02a: the window ends at 840 s, past vigil-phl-002's 285 s",
    )
  })
})

describe('the four acceptance lines (#131; the S3 gate’s mockup 4)', () => {
  it('02a: the threat’s first frame is Begin + 1, and it crosses warning on it with 122 s to entry', () => {
    const t = results['02a'].threat
    expect(t.firstFrameS).toBe(STUDY.beginS + 1)
    expect(t.lieFromS).toBe(0)
    expect(t.crossingS).toBe(STUDY.beginS + 1)
    expect(Math.round((t.crossingRangeM ?? 0) / 10) * 10).toBe(7200)
    expect(Math.round(t.toEntryS ?? 0)).toBe(122)
  })

  it('02b: the threat is present from 0, its lie begins at Begin + 30, and it crosses warning on that tick with 92 s to entry', () => {
    const t = results['02b'].threat
    expect(t.firstFrameS).toBe(0)
    expect(t.lieFromS).toBe(STUDY.beginS + 30)
    expect(t.crossingS).toBe(STUDY.beginS + 30)
    expect(Math.round((t.crossingRangeM ?? 0) / 10) * 10).toBe(6660)
    expect(Math.round(t.toEntryS ?? 0)).toBe(92)
  })

  it('the crossing leads ring entry by at least 60 s, and the threat holds rank 1 from it by at least 5, on both', () => {
    for (const r of both) {
      expect(r.threat.toEntryS ?? 0).toBeGreaterThanOrEqual(STUDY.acceptance.entryLeadS)
      expect(r.threat.rank1Throughout).toBe(true)
      expect(r.threat.minMargin).toBe(6)
      expect(r.threat.marginOver).toMatch(/^inject-12 at \d+ s$/)
      // Rank 1 on every tick left in the window — and in the picture on every one of them.
      expect(r.threat.ticksFromCrossing).toBe(r.threat.ticksExpected)
      expect(r.threat.ticksExpected).toBe(STUDY.beginS + STUDY.runS - (r.threat.crossingS ?? 0) + 1)
    }
    expect(results['02a'].threat.ticksExpected).toBe(360)
    expect(results['02b'].threat.ticksExpected).toBe(331)
  })

  it('the revisit track never reads warning, and no heard, consistent, not-closing track reaches 40, on both', () => {
    for (const r of both) {
      expect(r.revisit.maxBand).toBe('caution')
      expect(Math.round(r.revisit.maxComposite)).toBe(65)
      expect(r.revisit.ticks).toBe(r.revisit.ticksExpected)
      expect(r.revisit.ticks).toBe(STUDY.runS + 1)
      expect(r.heardNotClosing).not.toBeNull()
      expect(Math.round(r.heardNotClosing!.maxComposite)).toBe(38)
      expect(Math.round(r.heardNotClosing!.maxComposite)).toBeLessThan(
        STUDY.acceptance.heardCalmUnder,
      )
      expect(r.heardNotClosing!.id).toBe('inject-20')
    }
  })
})

describe('the cue audit, through associate at 1 500 m on airborne ticks only', () => {
  it('counts the threat, the closing drone, and the three returns as closing; five silent; six inside 6.5 km; the fifteen hovers hovering — and the landed returns for nothing', () => {
    for (const r of both) {
      expect(r.audit).toEqual({
        closingDrones: 5,
        closingAircraft: 20,
        silent: 5,
        inside: 6,
        hovering: 15,
      })
    }
  })
})

describe('the lines the rulings added', () => {
  it('above calm: the four the ruling names at Begin + 1, at most five in the window, a return joining for its 40 s', () => {
    expect(results['02a'].aboveCalm).toEqual({
      atBegin: 3,
      atBeginPlus1: 4,
      idsAtBeginPlus1: ['inject-11', 'inject-12', 'inject-13', 'inject-37'],
      max: 5,
      atEnd: 4,
    })
    expect(results['02b'].aboveCalm).toEqual({
      atBegin: 4,
      atBeginPlus1: 4,
      idsAtBeginPlus1: ['inject-11', 'inject-12', 'inject-13', 'inject-37'],
      max: 5,
      atEnd: 4,
    })
  })

  it('no track flaps inside either window', () => {
    for (const r of both) expect(r.flaps).toEqual([])
    // The fold itself, the bench's: an upward crossing enters every band between the last one
    // and this one, and each already entered counts one — a calm → warning jump over a caution
    // already seen is a flap, as foldInject counts it (#147 round 2).
    expect(flapsOf(['calm', 'caution', 'calm', 'caution'])).toBe(1)
    expect(flapsOf(['caution', 'warning', 'caution'])).toBe(0)
    expect(flapsOf(['calm', 'caution', 'calm', 'warning'])).toBe(1)
    expect(flapsOf(['calm', 'warning', 'caution', 'warning', 'calm', 'warning'])).toBe(3)
    expect(flapsOf(['warning', 'calm', 'warning'])).toBe(2)
  })

  it('the threat is the only ring entry inside a run — 604 s on 02a, 603 s on 02b — and the closing drone’s falls at 935 s, after it', () => {
    for (const [name, r] of Object.entries(results)) {
      const entered = new Map(r.entries.map((e) => [e.id, e.enteredS]))
      expect(entered.get(THREAT_ID)).toBe(name === '02a' ? 604 : 603)
      expect(entered.get('inject-37')).toBe(935)
      expect(935).toBeGreaterThan(STUDY.beginS + STUDY.runS)
      for (const [id, at] of entered) {
        if (id !== THREAT_ID && id !== 'inject-37') expect(at).toBeNull()
      }
      expect(r.entries).toHaveLength(30)
      expect(entered.has(REVISIT_ID)).toBe(true)
    }
  })
})

describe('the baselines (A7)', () => {
  it('render the same bytes twice', () => {
    expect(renderStudy(results['02a'])).toBe(
      renderStudy(runStudy(scenarioNamed('02a', SCENARIOS), recording)),
    )
  }, 30_000)

  it('are exactly what the run renders — a scenario or scoring edit that moves them regenerates them', () => {
    for (const name of STUDY_SCENARIOS) {
      const committed = readFileSync(join(repo, outPath(name)), 'utf8')
      expect(renderStudy(results[name])).toBe(committed)
    }
  })

  it('carry the four lines and the audit as sentences an owner can read', () => {
    const text = renderStudy(results['02a'])
    expect(text).toContain(
      'first frame 481 s (Begin + 1) · first warning at Begin + 1 s · 7.20 km · 122 s to entry — ≥ 60 s ✓',
    )
    expect(text).toContain(
      'rank 1 from its warning crossing: min margin 6 over inject-12 at 481 s — ≥ 5 ✓',
    )
    expect(text).toContain('revisit track inject-12: max band caution (65) — never warning ✓')
    expect(text).toContain(
      'heard, consistent, not closing: max composite 38 (inject-20 UAS-8E8F) — < 40 ✓',
    )
    expect(text).toContain(
      'cue audit through associate at 1500 m, airborne ticks only: closing 5 drones + 20 aircraft · silent 5 · inside 6.5 km 6 · Remote ID hovering 15',
    )
    expect(text).toContain(
      'above calm: 3 at Begin · 4 at Begin + 1 (inject-11, inject-12, inject-13, inject-37) · max 5 in the window · 4 at its end',
    )
    expect(text).toContain('flaps per track in the window: none')
    expect(text).toContain('inject-11 604 s · inject-12 — ·')
    expect(text).toContain('inject-37 935 s (after the run)')
    expect(renderStudy(results['02b'])).toContain(
      'present from 0 s, heard and consistent, the lie from 510 s · first warning at Begin + 30 s · 6.66 km · 92 s to entry — ≥ 60 s ✓',
    )
  })
})

describe('the folds say what they mean (#147 round 2)', () => {
  const base = scenarioNamed('02a', SCENARIOS).config
  const rows = base.cast!
  /** 002's grid with no aircraft on it: the injects alone, so the queue can run short. */
  const empty = {
    ...recording,
    capture: {
      ...recording.capture,
      frames: Array.from({ length: 80 }, (_, i) => ({ tMs: i * 15000, records: [] })),
    },
  }

  it('a revisit track that enters the window late is not vacuously clear, and a threat with no next candidate throws nothing', () => {
    // Row 2 is a return that appears at 900 s: absent from the whole window, so the threat is
    // alone in the picture — no next candidate — and the revisit line has no ticks to read.
    const late = { name: 'late', config: { ...base, cast: [rows[0], { ...rows[6], startS: 900 }] } }
    const result = runStudy(late, empty)
    expect(result.threat.minMargin).toBeNull()
    expect(result.threat.ticksFromCrossing).toBe(result.threat.ticksExpected)
    expect(result.revisit.ticks).toBe(0)
    const text = renderStudy(result)
    expect(text).toContain('rank 1 from its warning crossing: not held — ≥ 5 ✗')
    expect(text).toContain('revisit track inject-12: scored on 0 of 361 ticks — never warning ✗')
    // Present for part of the window: the count says so, and the line does not pass on it.
    const partial = {
      name: 'partial',
      config: { ...base, cast: [rows[0], { ...rows[6], startS: 580 }] },
    }
    const part = runStudy(partial, empty)
    expect(part.revisit.ticks).toBe(261)
    expect(renderStudy(part)).toContain(
      'revisit track inject-12: scored on 261 of 361 ticks — never warning ✗',
    )
  })

  it('prints the seconds to entry rounded and judges the rounded number — the page never contradicts itself', () => {
    const at = (toEntryS: number) =>
      renderStudy({ ...results['02a'], threat: { ...results['02a'].threat, toEntryS } })
    expect(at(59.6)).toContain('60 s to entry — ≥ 60 s ✓')
    expect(at(59.4)).toContain('59 s to entry — ≥ 60 s ✗')
  })
})
