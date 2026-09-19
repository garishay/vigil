import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BENCH_SCENARIOS,
  REVISIT_ID,
  STUDY_CAST,
  STUDY_RECORDING,
  STUDY_SCENARIOS,
  THREAT_ID,
  flapsOf,
  kindChangesOf,
  kindsOf,
  loadRecording,
  outPath,
  renderStudy,
  runStudy,
  type StudyResult,
} from './study.ts'
import { SCENARIOS, scenarioNamed } from '../src/config/scenarios.ts'
import { SCENARIO_03A } from '../src/config/scenarios/03a.ts'
import { at, shuttle, silentAt } from '../src/config/scenarios/cast.ts'
import { SCORING } from '../src/config/scoring.ts'
import { STUDY, briefBlocks, runLengthWords } from '../src/config/study.ts'
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

/** All four studies, run once for every pin below — about a second each on the dev machine. */
const results: Record<string, StudyResult> = Object.fromEntries(
  BENCH_SCENARIOS.map((name) => [name, runStudy(scenarioNamed(name, SCENARIOS), recording)]),
)
/** The corroboration pair — the S3c pins read these two. */
const both = STUDY_SCENARIOS.map((name) => results[name])
/** The prioritization pair (S7, #152, ruled A8; S7b). */
const pair = ['03a', '03b'] as const

describe('the study config (A8)', () => {
  it('is the ruled window and raw distance, with the acceptance and audit numbers beside them', () => {
    expect(STUDY).toMatchObject({ beginS: 480, runS: 360, rawAssociationM: 1500 })
    expect(STUDY.acceptance).toEqual({ entryLeadS: 60, marginAtLeast: 5, heardCalmUnder: 40 })
    expect(STUDY.audit).toEqual({ closingAtLeast: 50, insideM: 6500, hoveringUnderKt: 2 })
    // The prioritization pair's numbers (S7, ruled A8; S7b): the lock's tolerance, the tangential
    // bait's miss, the leak tell.
    expect(STUDY.prioritization).toEqual({ lockToleranceTicks: 3, baitMissM: 1000, leakOpenS: 30 })
    // The replay's list stays the corroboration pair until the #138 re-gate; the bench runs all four.
    expect(STUDY_SCENARIOS).toEqual(['02a', '02b'])
    expect(BENCH_SCENARIOS).toEqual(['02a', '02b', '03a', '03b'])
    expect(STUDY_CAST['02a']).toEqual({
      family: 'corroboration',
      threats: ['inject-11'],
      revisit: 'inject-12',
    })
    // The prioritization pair's ids are its own and disjoint (S7d, #167, ruled M1, M2), so the
    // two tables share a shape and no id.
    expect(STUDY_CAST['03a']).toEqual({
      family: 'prioritization',
      threats: ['inject-31', 'inject-57'],
      tangential: ['inject-36'],
      orbit: 'inject-25',
      band: ['inject-65', 'inject-74', 'inject-94', 'inject-15'],
      lockS: STUDY.beginS,
    })
    expect(STUDY_CAST['03b']).toEqual({
      family: 'prioritization',
      threats: ['inject-29', 'inject-23'],
      tangential: ['inject-79'],
      orbit: 'inject-19',
      band: ['inject-80', 'inject-33', 'inject-13', 'inject-95'],
      lockS: STUDY.beginS,
    })
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

  it('writes the brief’s last sentence from the run’s length, to the half minute in words — 02’s byte for byte (S7, #152, ruled D4)', () => {
    // The brief's clock line (S8-ii): the run's length first, then the same words whatever it is.
    const clockLine = (runS: number) => briefBlocks(runS)[0].lines[0].text
    expect(clockLine(STUDY.runS)).toBe(
      'Six minutes. The clock starts when you press Begin and cannot be paused.',
    )
    expect(clockLine(218)).toMatch(/^About three and a half minutes\. /)
    expect(clockLine(179)).toMatch(/^About three minutes\. /)
    const rest = (line: string) => line.slice(line.indexOf('. '))
    expect(rest(clockLine(218))).toBe(rest(clockLine(STUDY.runS)))
    expect(rest(clockLine(179))).toBe(rest(clockLine(STUDY.runS)))
    expect(runLengthWords(360)).toBe('six minutes')
    expect(runLengthWords(180)).toBe('three minutes')
    expect(runLengthWords(179)).toBe('about three minutes')
    expect(runLengthWords(218)).toBe('about three and a half minutes')
    expect(runLengthWords(90)).toBe('one and a half minutes')
    expect(runLengthWords(60)).toBe('one minute')
    expect(runLengthWords(20)).toBe('about half a minute')
    expect(runLengthWords(720)).toBe('12 minutes')
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
      expect(r.revisit!.maxBand).toBe('caution')
      expect(Math.round(r.revisit!.maxComposite)).toBe(65)
      expect(r.revisit!.ticks).toBe(r.revisit!.ticksExpected)
      expect(r.revisit!.ticks).toBe(STUDY.runS + 1)
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

  it('no track flaps inside either window, and only the threat changes its named pattern — once, at its orbit’s onset (#155)', () => {
    for (const r of both) expect(r.flaps).toEqual([])
    for (const r of both) {
      expect(r.kindChanges).toEqual([{ id: 'inject-11', count: 1, kinds: 'null → orbit' }])
    }
    expect(kindChangesOf(['null', 'null', 'orbit', 'orbit'])).toBe(1)
    expect(kindChangesOf(['orbit', 'loiter', 'orbit'])).toBe(2)
    expect(kindChangesOf([])).toBe(0)
    expect(kindsOf(['null', 'orbit', 'null', 'orbit'])).toBe('null → orbit')
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
    for (const name of STUDY_SCENARIOS) {
      const r = results[name]
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
    expect(renderStudy(results['03a'])).toBe(
      renderStudy(runStudy(scenarioNamed('03a', SCENARIOS), recording)),
    )
  }, 60_000)

  it('are exactly what the run renders — a scenario or scoring edit that moves them regenerates them', () => {
    for (const name of BENCH_SCENARIOS) {
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
    // The evidence line for the last-leg floor (#155, R2): the threat's real onset after its entry,
    // and nothing else on either 02 cast, before and after the floor.
    expect(text).toContain(
      'pattern-kind changes per track in the window: inject-11 1 (null → orbit)',
    )
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
    expect(result.revisit!.ticks).toBe(0)
    const text = renderStudy(result)
    expect(text).toContain('rank 1 from its warning crossing: not held — ≥ 5 ✗')
    expect(text).toContain('revisit track inject-12: scored on 0 of 361 ticks — never warning ✗')
    // Present for part of the window: the count says so, and the line does not pass on it.
    const partial = {
      name: 'partial',
      config: { ...base, cast: [rows[0], { ...rows[6], startS: 580 }] },
    }
    const part = runStudy(partial, empty)
    expect(part.revisit!.ticks).toBe(261)
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

describe('the prioritization pair (S7, #152, ruled A8; #154 round 2; S7b)', () => {
  const p = (name: '03a' | '03b') => {
    const block = results[name].prioritization
    if (block === null) throw new Error(`${name} carries its prioritization block`)
    return block
  }
  const c = STUDY.prioritization
  /**
   * A cast row's id, by its row in the scenario file (S7d, #167, ruled M1): the pair's ids are
   * each scenario's own and carry no role, so a pin here names the row it means and reads the id
   * from the list the app plans with. The ids themselves are pinned where they are read — the
   * roles table below, and the rendered sentences at the foot of this block.
   */
  const rowId = (name: '03a' | '03b', row: number) =>
    `inject-${scenarioNamed(name, SCENARIOS).config.castIds![row - 1]}`
  /** The roles table's own names, for the rows it names. */
  const roles = (name: '03a' | '03b') => STUDY_CAST[name]

  it('is the prioritization family, run to the registry’s length — 218 s on both since S7d — with no revisit row', () => {
    expect(results['03a']).toMatchObject({ family: 'prioritization', runS: 218, revisit: null })
    expect(results['03b']).toMatchObject({ family: 'prioritization', runS: 218, revisit: null })
    expect(results['02a']).toMatchObject({
      family: 'corroboration',
      runS: 360,
      prioritization: null,
    })
    expect(results['02b']).toMatchObject({
      family: 'corroboration',
      runS: 360,
      prioritization: null,
    })
  })

  it('line 3 — both threats enter inside the run in row order, warning on every tick from Begin to entry: 582 and 668 on both, since 03b is 03a rotated (S7d)', () => {
    for (const name of pair) {
      expect(p(name).threats).toEqual([
        { id: roles(name).threats[0], enteredS: 582, firstWarningS: 480, warningToEntry: true },
        { id: roles(name).threats[1], enteredS: 668, firstWarningS: 480, warningToEntry: true },
      ])
    }
    for (const name of pair) {
      expect(p(name).rowOrderIsEntryOrder).toBe(true)
      expect(p(name).firstEntryS).toBe(p(name).threats[0].enteredS)
      expect(p(name).lastEntryS).toBe(p(name).threats[1].enteredS)
      expect(p(name).lastEntryS!).toBeLessThanOrEqual(STUDY.beginS + results[name].runS)
    }
  })

  it('line 1 — ranks 1 and 2 are the threats in entry order from T_lock = Begin through the first entry, inside the 3-tick tolerance, with 0 inverted ticks; the margins beside it', () => {
    for (const name of pair) {
      const block = p(name)
      expect(block.lockStatedS).toBe(STUDY.beginS)
      expect(block.lockS).toBe(STUDY.beginS)
      expect(block.lockS!).toBeLessThanOrEqual(block.lockStatedS + c.lockToleranceTicks)
      expect(block.invertedTicks).toBe(0)
      expect(block.entryBeforeBegin).toBeNull()
      expect(block.threatMargin!.min).toBeGreaterThan(0)
      expect(block.rank3Margin!.min).toBeGreaterThanOrEqual(2)
      // Row 3 is the hover bait, the closest silent track on either cast.
      expect(block.rank3Margin!.over).toBe(rowId(name, 3))
      // 03b is 03a rotated (S7d, #167), so the lock and both margins are 03a's to the hundredth.
      expect(block.threatMargin).toEqual({ min: expect.closeTo(0.42, 2), atS: 546 })
      expect(block.rank3Margin).toEqual({
        min: expect.closeTo(2.74, 2),
        atS: 480,
        over: rowId(name, 3),
      })
    }
  })

  it('line 2 — no bait enters inside the run, and the tangential bait’s course misses the ring by at least 1 000 m on every airborne tick, never reading an entry', () => {
    for (const name of pair) {
      expect(p(name).baitsEntered).toEqual([])
      expect(p(name).tangential).toHaveLength(1)
      const [tangential] = p(name).tangential
      expect(tangential.id).toBe(roles(name).tangential![0])
      expect(tangential.ticks.entry).toBe(0)
      expect(tangential.ticks.inside).toBe(0)
      expect(tangential.ticks.other).toBe(0)
      expect(tangential.ticks.misses + tangential.ticks.away).toBe(results[name].runS + 1)
      expect(tangential.minMissM!).toBeGreaterThanOrEqual(c.baitMissM)
      expect(Math.round(tangential.minMissM!)).toBe(1052)
    }
  })

  it('the orbit bait’s closing read sweeps 0 to 23 and it holds ranks 13 to 18, with no pattern-kind change on either cast under the floor (#155, R2)', () => {
    for (const name of pair) {
      expect(p(name).orbit).toEqual({
        id: roles(name).orbit,
        closingMin: 0,
        closingMax: expect.closeTo(23, 0),
        rankMin: 13,
        rankMax: 18,
      })
      expect(results[name].kindChanges).toEqual([])
      expect(results[name].flaps).toEqual([])
    }
  })

  it('the band rows cross into warning after the first entry and never outrank the threats: Begin + 157, + 128, + 189, and + 130 on 03a, and within a tick of those on 03b', () => {
    // A tick apart where they differ: 03b is 03a turned, and the real layer it is scored beside
    // is not (S7d, #167). The ranks and the maxima are the same numbers.
    const firstWarnings = { '03a': [637, 608, 669, 610], '03b': [637, 609, 670, 609] } as const
    for (const name of pair) {
      expect(p(name).band).toEqual(
        roles(name).band!.map((id, i) => ({
          id,
          firstWarningS: firstWarnings[name][i],
          rankMin: [5, 3, 6, 3][i],
          rankMax: [7, 5, 8, 5][i],
          maxComposite: expect.closeTo([71.1, 71.8, 70.2, 71.7][i], 0),
        })),
      )
      for (const row of p(name).band)
        if (row.firstWarningS !== null)
          expect(row.firstWarningS).toBeGreaterThan(p(name).firstEntryS!)
    }
  })

  it('runS is the rule — the last threat entry + 30 s from Begin: 218 = 668 − 480 + 30 on both, since S7d makes 03b 03a turned', () => {
    for (const name of pair) {
      expect(p(name).runS).toEqual({ actual: 218, rule: 218 })
      expect(scenarioNamed(name, SCENARIOS).runS).toBe(218)
    }
  })

  it('the restated lines: above calm 26 / 26 / 27 / 26 on both with the twenty-six ids; the audit; the entries — every load inbound after both windows and inside the recording', () => {
    // The twenty-five silent rows — the threats, the four baits, the nineteen load rows — and
    // 02a's closing drone at row 27; by row, since the ids carry no role (S7d, #167).
    const silentRows = [1, 2, 3, 4, 5, 6, ...Array.from({ length: 19 }, (_, i) => 31 + i)]
    const twentySix = (name: '03a' | '03b') =>
      [...silentRows, 27]
        .map((row) => rowId(name, row))
        .sort((a, b) => Number(a.slice(7)) - Number(b.slice(7)))
    for (const name of pair) {
      expect(results[name].aboveCalm).toEqual({
        atBegin: 26,
        atBeginPlus1: 26,
        idsAtBeginPlus1: twentySix(name),
        max: 27,
        atEnd: 26,
      })
      expect(results[name].audit).toEqual({
        closingDrones: 15,
        closingAircraft: 14,
        silent: 25,
        inside: 12,
        hovering: 15,
      })
    }
    for (const name of pair) {
      expect(Math.round(results[name].heardNotClosing!.maxComposite)).toBe(38)
      expect(results[name].heardNotClosing!.id).toBe(rowId(name, 10))
      const entered = new Map(results[name].entries.map((e) => [e.id, e.enteredS]))
      expect(results[name].entries).toHaveLength(49)
      expect(entered.get(rowId(name, 27))).toBe(935)
      expect(entered.get(rowId(name, 6))).toBe(1066)
      expect(entered.get(rowId(name, 31))).toBe(899)
      expect(entered.get(rowId(name, 32))).toBe(872)
      expect(entered.get(rowId(name, 38))).toBe(942)
      // A metre of rotation moves this one by a tick.
      expect(entered.get(rowId(name, 39))).toBe(name === '03a' ? 879 : 878)
      expect(entered.get(rowId(name, 40))).toBe(925)
      expect(entered.get(rowId(name, 41))).toBe(912)
      for (const row of [3, 4, 5, 36, 37]) expect(entered.get(rowId(name, row))).toBeNull()
      for (let row = 42; row <= 49; row++) expect(entered.get(rowId(name, row))).toBeNull()
      // Eleven non-threat entries — the ten silent inbounds and 02a's heard closing drone: every
      // one after both windows and inside the recording, so the replay reads each as a later
      // entrant, never the class that throws (#138, E5).
      const end = STUDY.beginS + results[name].runS
      const later = results[name].entries.filter(
        (e) => e.enteredS !== null && !roles(name).threats.includes(e.id),
      )
      expect(later.map((e) => e.id)).toEqual(
        [6, 27, 31, 32, 33, 34, 35, 38, 39, 40, 41].map((row) => rowId(name, row)),
      )
      for (const e of later) {
        expect(e.enteredS!).toBeGreaterThan(end)
        expect(e.enteredS!).toBeLessThanOrEqual(indexCapture(recording.capture).durationS)
      }
    }
  })

  it('carry the lines as sentences an owner can read', () => {
    const text = renderStudy(results['03a'])
    expect(text).toContain(
      '# Study baseline — 03a on vigil-phl-002 · Begin 480 s · run 218 s · 1 Hz through the feed',
    )
    expect(text).toContain(
      'threats in row order: inject-31 enters 582 s (Begin + 102) · inject-57 enters 668 s (Begin + 188) — row order is entry order ✓ · both inside the run ✓ · warning on every tick from Begin to entry ✓',
    )
    expect(text).toContain(
      'lock — ranks 1 and 2 the threats in entry order through the first entry: from 480 s (Begin + 0), 0 inverted ticks before it — T_lock 480 s (Begin + 0), tolerance 3 ticks ✓ · threat 1 over threat 2 min 0.42 at 546 s · rank 2 over rank 3 min 2.74 at 480 s (inject-35)',
    )
    expect(text).toContain(
      'baits: none enters inside the run ✓ · tangential inject-36 misses by ≥ 1052 m on 60 airborne ticks, opening on 159, never inside or entering — ≥ 1000 ✓',
    )
    expect(text).toContain('orbit inject-25: closing 0–23 · rank 13–18')
    expect(text).toContain(
      'band rows: inject-65 first warning 637 s (Begin + 157) · rank 5–7 · max 71 · inject-74 first warning 608 s (Begin + 128) · rank 3–5 · max 72 · inject-94 first warning 669 s (Begin + 189) · rank 6–8 · max 70 · inject-15 first warning 610 s (Begin + 130) · rank 3–5 · max 72 — none before the first entry ✓',
    )
    expect(text).toContain('runS 218 = last entry 668 − Begin 480 + 30 ✓')
    expect(text).toContain(
      'leak tell (stated, unmeasured until the leak test runs): threat 1 inject-31 opened on raw under 30 s by both volunteers',
    )
    expect(text).toContain('pattern-kind changes per track in the window: none')
    expect(text).toContain('inject-65 899 s (after the run) · inject-74 872 s (after the run)')
    expect(text).toContain(
      'inject-94 942 s (after the run) · inject-15 879 s (after the run) · inject-20 925 s (after the run) · inject-45 912 s (after the run) · inject-62 —',
    )
    // 03b says the same lines under its own ids, the two band ticks a second apart (S7d, #167).
    const text03b = renderStudy(results['03b'])
    expect(text03b).toContain(
      'threats in row order: inject-29 enters 582 s (Begin + 102) · inject-23 enters 668 s (Begin + 188) — row order is entry order ✓ · both inside the run ✓ · warning on every tick from Begin to entry ✓',
    )
    expect(text03b).toContain(
      'band rows: inject-80 first warning 637 s (Begin + 157) · rank 5–7 · max 71 · inject-33 first warning 609 s (Begin + 129) · rank 3–5 · max 72 · inject-13 first warning 670 s (Begin + 190) · rank 6–8 · max 70 · inject-95 first warning 609 s (Begin + 129) · rank 3–5 · max 72 — none before the first entry ✓',
    )
    expect(text03b).toContain('runS 218 = last entry 668 − Begin 480 + 30 ✓')
    expect(text03b).toContain(
      'threat 1 over threat 2 min 0.42 at 546 s · rank 2 over rank 3 min 2.74 at 480 s (inject-21)',
    )
  })
})

describe('the prioritization lines fail on what they guard (S7b) — two synthetic casts', () => {
  /** 002's grid with no aircraft on it: the injects alone, so the fold runs in a second. */
  const empty = {
    ...recording,
    capture: {
      ...recording.capture,
      frames: Array.from({ length: 80 }, (_, i) => ({ tMs: i * 15000, records: [] })),
    },
  }
  const rows = SCENARIO_03A.cast!

  it('a cast whose rows are out of entry order fails the row-order line, its lock read on the entrants as they are', () => {
    // 03a with its two threat rows swapped: row 1 now enters second.
    const swapped = {
      name: '03a-swapped',
      config: { ...SCENARIO_03A, cast: [rows[1], rows[0], ...rows.slice(2)] },
    }
    const result = runStudy(swapped, empty, STUDY, SCORING, STUDY_CAST['03a'])
    const block = result.prioritization!
    expect(block.threats.map((t) => [t.id, t.enteredS])).toEqual([
      ['inject-31', 668],
      ['inject-57', 582],
    ])
    expect(block.rowOrderIsEntryOrder).toBe(false)
    expect(renderStudy(result)).toContain('row order is entry order ✗')
    // The lock reads the entrants in entry order regardless, so the swap alone does not invert it.
    expect(block.invertedTicks).toBe(0)
  }, 120_000)

  it('a bait inside the ring fails the baits line, and a tangential course that enters fails its miss', () => {
    // The hover moved to 4.5 km — inside the ring from t = 0 — and the tangential bait turned
    // inbound at 12 kt from its 6.05 km, entering at Begin + 170.
    const inside = shuttle(at(160, 4.5), 250, 30, 1)
    const aimed = silentAt(at(215, 6.05), 35, 12, STUDY.beginS)
    const broken = {
      name: '03a-broken',
      config: { ...SCENARIO_03A, cast: [rows[0], rows[1], inside, aimed, ...rows.slice(4)] },
    }
    const result = runStudy(broken, empty, STUDY, SCORING, STUDY_CAST['03a'])
    const block = result.prioritization!
    expect(block.baitsEntered).toEqual(['inject-35', 'inject-36'])
    expect(block.tangential[0].ticks.entry).toBeGreaterThan(0)
    const text = renderStudy(result)
    expect(text).toContain('entered inside the run: inject-35, inject-36 ✗')
    expect(text).toMatch(/on an entering course on \d+ — ≥ 1000 ✗/)
  }, 120_000)
})

describe('the prioritization lines say what they measure (#158 round 1)', () => {
  const empty = {
    ...recording,
    capture: {
      ...recording.capture,
      frames: Array.from({ length: 80 }, (_, i) => ({ tMs: i * 15000, records: [] })),
    },
  }
  const rows = SCENARIO_03A.cast!
  const T0 = STUDY.beginS
  const withCast = (name: string, cast: typeof rows) =>
    runStudy({ name, config: { ...SCENARIO_03A, cast } }, empty, STUDY, SCORING, STUDY_CAST['03a'])
  const block03a = () => results['03a'].prioritization!

  it('the lock verdict is the tolerance’s: a lock two ticks after T_lock passes with its two inverted ticks counted, four ticks after fails', () => {
    const late = {
      ...results['03a'],
      prioritization: { ...block03a(), lockS: T0 + 2, invertedTicks: 2 },
    }
    expect(renderStudy(late)).toContain(
      'from 482 s (Begin + 2), 2 inverted ticks before it — T_lock 480 s (Begin + 0), tolerance 3 ticks ✓',
    )
    const later = {
      ...results['03a'],
      prioritization: { ...block03a(), lockS: T0 + 4, invertedTicks: 4 },
    }
    expect(renderStudy(later)).toContain(
      'from 484 s (Begin + 4), 4 inverted ticks before it — T_lock 480 s (Begin + 0), tolerance 3 ticks ✗',
    )
  })

  it('the miss verdict reads the rounded number it prints — 999.6 m prints 1000 and passes, 999.4 prints 999 and fails', () => {
    const [tangential] = block03a().tangential
    const miss = (minMissM: number) =>
      renderStudy({
        ...results['03a'],
        prioritization: { ...block03a(), tangential: [{ ...tangential, minMissM }] },
      })
    expect(miss(999.6)).toMatch(
      /misses by ≥ 1000 m on \d+ airborne ticks, opening on \d+, never inside or entering — ≥ 1000 ✓/,
    )
    expect(miss(999.4)).toMatch(
      /misses by ≥ 999 m on \d+ airborne ticks, opening on \d+, never inside or entering — ≥ 1000 ✗/,
    )
  })

  it('a threat that appears after Begin is not warning from Begin: the line reads the ticks it names, not the track’s own first ticks', () => {
    // Threat 1 written at its Begin placement with no flight back, appearing at Begin + 20.
    const late = { ...silentAt(at(285, 6.3), 111, 25, 0), startS: T0 + 20 }
    const result = withCast('03a-late-threat', [late, ...rows.slice(1)])
    const block = result.prioritization!
    expect(block.threats[0].enteredS).toBeGreaterThan(T0)
    expect(block.threats[0].warningToEntry).toBe(false)
    expect(renderStudy(result)).toContain('warning on every tick from Begin to entry ✗')
  }, 120_000)

  it('a role the table names that never reaches the window’s picture is a loud error, not a line of Infinity', () => {
    const orbit = { ...rows[4], startS: 9000 }
    expect(() => withCast('03a-no-orbit', [...rows.slice(0, 4), orbit, ...rows.slice(5)])).toThrow(
      "inject-25 is named by the cast table but never in the window's picture",
    )
  }, 120_000)

  it('on a degraded cast the rank-2-over-rank-3 margin reads whoever holds those ranks, so it is a margin on the inverted ticks too', () => {
    // Two silent 30 kt inbounds at 6.0 and 6.1 km take ranks 1 and 2 from Begin; the threats sit
    // at 3 and 4 until they enter.
    const fastA = silentAt(at(20, 6.0), 200, 30, T0)
    const fastB = silentAt(at(125, 6.1), 305, 30, T0)
    const result = withCast('03a-degraded', [...rows.slice(0, 30), fastA, fastB, ...rows.slice(32)])
    const block = result.prioritization!
    expect(block.invertedTicks).toBeGreaterThan(0)
    expect(block.lockS).toBeNull()
    expect(block.rank3Margin!.min).toBeGreaterThanOrEqual(0)
    expect(renderStudy(result)).toContain('tolerance 3 ticks ✗')
  }, 120_000)

  it('a tangential bait inside the ring reads inside on its ticks and fails the miss, whatever its least miss elsewhere', () => {
    const insideBait = shuttle(at(215, 4.5), 305, 30, 1)
    const result = withCast('03a-tangential-inside', [
      ...rows.slice(0, 3),
      insideBait,
      ...rows.slice(4),
    ])
    const block = result.prioritization!
    expect(block.tangential[0].ticks.inside).toBeGreaterThan(0)
    const text = renderStudy(result)
    expect(text).toMatch(
      /tangential inject-36 misses by ≥ — m on 0 airborne ticks, opening on \d+, inside the ring on \d+ — ≥ 1000 ✗/,
    )
    expect(text).toContain('entered inside the run: inject-36 ✗')
  }, 120_000)

  it('a threat inside the ring before Begin makes the lock unmeasurable, and the line says so instead of reading a clean zero', () => {
    const early = silentAt(at(285, 4.5), 111, 25, T0)
    const result = withCast('03a-early-threat', [early, ...rows.slice(1)])
    const block = result.prioritization!
    expect(block.entryBeforeBegin!.id).toBe('inject-31')
    expect(block.entryBeforeBegin!.enteredS).toBeLessThan(T0)
    expect(block.lockS).toBeNull()
    expect(block.threatMargin).toBeNull()
    const text = renderStudy(result)
    expect(text).toMatch(
      /not measured — inject-31 entered the ring at \d+ s, before Begin — T_lock 480 s \(Begin \+ 0\), tolerance 3 ticks ✗/,
    )
    expect(text).toContain('both inside the run ✗')
  }, 120_000)
})
