/**
 * The study bench (S3c, #135, ruled A7): the operator study's acceptance, measured. One scenario,
 * one recording, one window — each study scenario through the feed (`scenarioFeed`, so
 * `associate` at the scorer's threshold: what Vigil shows) beside the recording's real layer, at
 * one-second ticks over the window from Begin, through the seams the app itself calls — the
 * picture, the identity memory, the histories, the origins, the scorer, the queue's own
 * comparator. Nothing is reimplemented; a number here is a number the app would show.
 *
 * Per scenario of the corroboration pair (02a, 02b), the four acceptance lines (#131, the S3
 * gate's mockup 4): the threat's warning crossing at least `entryLeadS` before ring entry; rank 1
 * from that crossing by at least `marginAtLeast`; the revisit track never warning; a heard,
 * consistent, not-closing track never reaching `heardCalmUnder`. Per scenario of the
 * prioritization pair (03a, 03b; S7, #152, ruled A8; S7b): the two threats in row order enter
 * inside the run, row order is entry order, both warning from Begin to their entry; ranks 1 and 2
 * are the threats in entry order from T_lock (Begin, `lockToleranceTicks`) through the first
 * entry, with the narrowest margins reported; no bait enters and the tangential bait's course
 * misses by `baitMissM`; the orbit bait's closing range and rank; the band rows' first warning
 * after the first entry; the run's length against the rule (the last entry + 30 s). The cue audit through `associate` at raw mode's distance — the leak
 * test's count of what a raw display shows — on airborne ticks only: a landed track counts for
 * nothing (ruled at #145's closure). And the lines the rulings added: the above-calm count at
 * Begin, at Begin + 1, its maximum in the window, and at the end; flaps per track; pattern-kind
 * changes per track (#155, R2 on #152 — the evidence line for the last-leg floor); every track's
 * ring entry; the threat's first frame (02a) or its lie's first tick (02b).
 *
 * The generator's labels never reach this file: the threat is the cast's first row and the
 * revisit track its second, by the study files' own numbering — ids, not the answer key.
 *
 * Run: `npm run bench:study` writes `docs/bench/study-<name>.md` for every study scenario, which
 * `study.test.ts` holds byte for byte and reads the lines off, so a scenario or scoring edit that
 * breaks the study fails CI. Without `--write` the files print instead.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { AO } from '../src/config/ao.ts'
import { recordingNamed, type RecordingEntry } from '../src/config/recordings.ts'
import { SCENARIOS, scenarioNamed, type NamedScenario } from '../src/config/scenarios.ts'
import { SCORING, type Band, type ScoringConfig } from '../src/config/scoring.ts'
import { STUDY, type StudyConfig } from '../src/config/study.ts'
import type { AdsbCapture } from '../src/lib/adsb.ts'
import { associate, scenarioFeed } from '../src/lib/feeds.ts'
import { distanceMeters } from '../src/lib/geo.ts'
import { injectTracksAt, timelineOf } from '../src/lib/injects.ts'
import { entryAt } from '../src/lib/projection.ts'
import { queueOrder } from '../src/lib/ranking.ts'
import { historiesAt, indexCapture, memoryAt, originsOf, pictureAt } from '../src/lib/replay.ts'
import { bandOf, clockStartOf, minuteOfDay, scoreTrack } from '../src/lib/scoring.ts'
import type { Track } from '../src/lib/tracks.ts'

/** The study runs on 002 — the evening arrivals bank, the window inside it (the S3 gate's check 4). */
export const STUDY_RECORDING = 'vigil-phl-002'
/**
 * The corroboration pair, by registry name — the replay tool's list (`tools/replay/load.ts`)
 * until the #138 re-gate carries the prioritization pair; the bench runs `BENCH_SCENARIOS`.
 */
export const STUDY_SCENARIOS = ['02a', '02b'] as const
/** Every study scenario the bench baselines, by registry name. */
export const BENCH_SCENARIOS = ['02a', '02b', '03a', '03b'] as const
/** The cast's first row is the threat, its second the revisit track (the study files' numbering). */
export const THREAT_ID = 'inject-11'
export const REVISIT_ID = 'inject-12'

export type Family = 'corroboration' | 'prioritization'

/**
 * Each study cast's roles by the study files' own numbering — ids, never the generator's labels
 * (S7, #152, ruled A8): the answer key stays here in the bench, where the app cannot reach it.
 * `lockS` is T_lock, the tick the prioritization lock is stated from.
 */
export interface CastRoles {
  family: Family
  threats: readonly string[]
  revisit?: string
  tangential?: readonly string[]
  orbit?: string
  band?: readonly string[]
  lockS?: number
}

export const STUDY_CAST: Record<string, CastRoles> = {
  '02a': { family: 'corroboration', threats: [THREAT_ID], revisit: REVISIT_ID },
  '02b': { family: 'corroboration', threats: [THREAT_ID], revisit: REVISIT_ID },
  '03a': {
    family: 'prioritization',
    threats: ['inject-11', 'inject-12'],
    tangential: ['inject-14'],
    orbit: 'inject-15',
    band: ['inject-41', 'inject-42', 'inject-48', 'inject-49'],
    lockS: STUDY.beginS,
  },
  '03b': {
    family: 'prioritization',
    threats: ['inject-11', 'inject-12'],
    tangential: ['inject-14'],
    orbit: 'inject-15',
    band: ['inject-41', 'inject-42', 'inject-48', 'inject-49'],
    lockS: STUDY.beginS,
  },
}
export const outPath = (name: string) => `docs/bench/study-${name}.md`

export interface Recording {
  entry: RecordingEntry
  capture: AdsbCapture
}

const BANDS: readonly Band[] = ['calm', 'caution', 'warning']

/** One track's run over the window, plus its ring entry over the whole recording. */
export interface TrackRun {
  id: string
  source: Track['source']
  /** The label raw mode would show — the last one heard on an airborne tick, or null. */
  label: string | null
  /** The band on each tick of the window, in order — and keyed by tick, for a track not in the picture on every tick. */
  bands: Band[]
  bandAt: Map<number, Band>
  /** The named pattern on each tick, `null` as a word, in order. */
  kinds: string[]
  /** The queue position on each tick of the window, both layers ranked, keyed by tick. */
  rankAt: Map<number, number>
  /** The composite on each tick, keyed by tick. */
  compositeAt: Map<number, number>
  /** The first tick in the window it reads warning; null when never. */
  firstWarningS: number | null
  /** The course's least miss of the ring on an airborne tick, metres beyond the ring; null when it never read a miss. */
  minMissM: number | null
  /** What the course read on each airborne tick of the window: a miss of the ring, opening, an entry, inside it, or nothing readable (still, unobserved). */
  course: { misses: number; away: number; entry: number; inside: number; other: number }
  /** Whether the position lay inside the ring on any tick of the window. */
  insideInWindow: boolean
  /** The closing factor's range over airborne ticks. */
  closingMin: number
  closingMax: number
  maxComposite: number
  /** The first tick, anywhere in the recording, at or inside the ring; null when never. */
  enteredS: number | null
  /** The cue audit, on airborne ticks in the window. */
  closing: boolean
  silent: boolean
  heard: boolean
  hovering: boolean
  inside: boolean
}

/** The prioritization pair's lines (S7, #152, ruled A8; S7b), computed after the fold. */
export interface Prioritization {
  /** The threats in row order: the entry, the first warning tick, and warning on every tick from Begin to the entry. */
  threats: {
    id: string
    enteredS: number | null
    firstWarningS: number | null
    warningToEntry: boolean
  }[]
  rowOrderIsEntryOrder: boolean
  firstEntryS: number | null
  lastEntryS: number | null
  /** A threat already inside the ring before Begin, if any — the lock is then not measurable. */
  entryBeforeBegin: { id: string; enteredS: number } | null
  /** T_lock as stated, and the measured lock: the first tick from which ranks 1 and 2 are the threats in entry order through the first entry; null when never. */
  lockStatedS: number
  lockS: number | null
  /** Ticks from Begin to the first entry on which the order did not hold — all of them before the lock, by its definition. */
  invertedTicks: number
  /** The narrowest margins to the first entry: threat 1 over threat 2, and rank 2 over rank 3 with who was third. */
  threatMargin: { min: number; atS: number } | null
  rank3Margin: { min: number; atS: number; over: string } | null
  tangential: { id: string; minMissM: number | null; ticks: TrackRun['course'] }[]
  /** Injects other than the threats whose position lay inside the ring on any tick of the window. */
  baitsEntered: string[]
  orbit: {
    id: string
    closingMin: number
    closingMax: number
    rankMin: number
    rankMax: number
  } | null
  band: {
    id: string
    firstWarningS: number | null
    rankMin: number
    rankMax: number
    maxComposite: number
  }[]
  /** The run's length against the rule: the last threat entry + 30 s from Begin. */
  runS: { actual: number; rule: number | null }
}

export interface StudyResult {
  name: string
  seed: string
  recording: string
  family: Family
  config: StudyConfig
  /** The run's length from Begin — the registry entry's own, or the study's default. */
  runS: number
  threat: {
    /** The threat's first frame in the scenario (0 when present from the start). */
    firstFrameS: number
    /** The scenario second its broadcast begins lying; 0 for a lie from the first frame. */
    lieFromS: number
    /** The first tick in the window it reads warning; null when never. */
    crossingS: number | null
    crossingRangeM: number | null
    /** The projection's own seconds to ring entry at the crossing. */
    toEntryS: number | null
    /** From the crossing on: the least margin over the next candidate, and who that was. */
    minMargin: number | null
    marginOver: string | null
    /** Rank 1 on every tick from the crossing to the end of the window — and scored on all of them. */
    rank1Throughout: boolean
    /** The ticks the threat was in the picture from its crossing on, against the window's remainder. */
    ticksFromCrossing: number
    ticksExpected: number
  }
  /** The revisit track over the window, with the ticks it was scored on against the window's length; null where the cast has none. */
  revisit: { maxComposite: number; maxBand: Band; ticks: number; ticksExpected: number } | null
  prioritization: Prioritization | null
  /** The highest heard, consistent, not-closing track — null when there is none. */
  heardNotClosing: { id: string; label: string | null; maxComposite: number } | null
  audit: {
    closingDrones: number
    closingAircraft: number
    silent: number
    inside: number
    hovering: number
  }
  aboveCalm: {
    atBegin: number
    atBeginPlus1: number
    idsAtBeginPlus1: string[]
    max: number
    atEnd: number
  }
  flaps: { id: string; count: number }[]
  /** Every inject whose named pattern changed inside the window: how often, and the kinds in order. */
  kindChanges: { id: string; count: number; kinds: string }[]
  /** Every inject of the cast, in id order, with its ring entry. */
  entries: { id: string; enteredS: number | null }[]
}

export function loadRecording(id: string): Recording {
  const entry = recordingNamed(id)
  return { entry, capture: JSON.parse(readFileSync(`public/${entry.file}`, 'utf8')) as AdsbCapture }
}

/**
 * The bench's flap (`foldInject`), over one track's window: an upward crossing enters every band
 * between the one last seen and this one, and each already entered counts one — so a calm →
 * warning jump over a caution already seen counts, as the scoreboard counts it (#147 round 2).
 */
export function flapsOf(bands: readonly Band[]): number {
  let flaps = 0
  const entered = new Set<Band>()
  const rank = (band: Band) => BANDS.indexOf(band)
  bands.forEach((band, i) => {
    const last = i === 0 ? 'calm' : bands[i - 1]
    if (rank(band) <= rank(last)) return
    for (const between of BANDS) {
      if (rank(between) <= rank(last) || rank(between) > rank(band)) continue
      if (entered.has(between)) flaps++
      else entered.add(between)
    }
  })
  return flaps
}

/** How often the named pattern changed over one track's ticks — the onset itself is one. */
export function kindChangesOf(kinds: readonly string[]): number {
  let changes = 0
  for (let i = 1; i < kinds.length; i++) if (kinds[i] !== kinds[i - 1]) changes++
  return changes
}

/** The kinds a track was named over the window, in order of first appearance — `null → orbit`. */
export const kindsOf = (kinds: readonly string[]) => [...new Set(kinds)].join(' → ')

/** The roles a cast the table does not list is read with — the corroboration shape, the S3c bench's own. */
const CORROBORATION: CastRoles = {
  family: 'corroboration',
  threats: [THREAT_ID],
  revisit: REVISIT_ID,
}

export function runStudy(
  scenario: NamedScenario,
  recording: Recording,
  config: StudyConfig = STUDY,
  scoring: ScoringConfig = SCORING,
  roles: CastRoles = STUDY_CAST[scenario.name] ?? CORROBORATION,
): StudyResult {
  const site = AO.protectedSites[0]
  const index = indexCapture(recording.capture)
  const startLocal = clockStartOf(recording.entry, recording.capture, AO)
  const feed = scenarioFeed(timelineOf(recording.capture), scenario.config, AO)
  const plan = feed.plan
  const origins = originsOf(index, plan)
  const runS = scenario.runS ?? config.runS
  const begin = config.beginS
  const end = config.beginS + runS
  if (end > index.durationS) {
    throw new Error(
      `${scenario.name}: the window ends at ${end} s, past ${recording.entry.id}'s ${index.durationS} s`,
    )
  }
  const runs = new Map<string, TrackRun>()
  const runOf = (track: Track): TrackRun => {
    let run = runs.get(track.id)
    if (!run) {
      run = {
        id: track.id,
        source: track.source,
        label: null,
        bands: [],
        bandAt: new Map(),
        kinds: [],
        rankAt: new Map(),
        compositeAt: new Map(),
        firstWarningS: null,
        minMissM: null,
        course: { misses: 0, away: 0, entry: 0, inside: 0, other: 0 },
        insideInWindow: false,
        closingMin: Infinity,
        closingMax: -Infinity,
        maxComposite: -Infinity,
        enteredS: null,
        closing: false,
        silent: false,
        heard: false,
        hovering: false,
        inside: false,
      }
      runs.set(track.id, run)
    }
    return run
  }
  const aboveCalm: { tSec: number; ids: string[] }[] = []
  const threat = {
    crossingS: null as number | null,
    crossingRangeM: null as number | null,
    toEntryS: null as number | null,
    minMargin: null as number | null,
    marginOver: null as string | null,
    rank1Throughout: true,
    ticksFromCrossing: 0,
  }
  for (let tSec = 0; tSec <= index.durationS; tSec++) {
    // Ring entry is read over the whole recording — the closing drone's falls after the run.
    const layer = feed.pictureAt(tSec)
    for (const track of layer) {
      const run = runOf(track)
      const inRing = distanceMeters(site.center, track.position) <= site.radiusM
      if (run.enteredS === null && inRing) run.enteredS = tSec
      if (inRing && tSec >= begin && tSec <= end) run.insideInWindow = true
    }
    if (tSec < begin || tSec > end) continue
    // Inside the window: the fused picture, scored and ranked as the app does it.
    const adsb = pictureAt(index, tSec)
    const raw = new Map(
      injectTracksAt(plan, tSec).map((track) => [
        track.id,
        associate(track, config.rawAssociationM),
      ]),
    )
    const context = {
      tSec,
      minuteOfDay: minuteOfDay(startLocal, tSec),
      memory: memoryAt((t) => injectTracksAt(plan, t), plan.intervalS, tSec),
      history: historiesAt(index, plan, [...adsb, ...layer], tSec, scoring.pattern.windowS),
      friendly: AO.friendlyAreas,
      origins,
      config: scoring,
    }
    const ranked = [...adsb, ...layer]
      .map((track) => {
        const score = scoreTrack(track, AO.protectedSites, context)
        return { track, score, rangeM: score.rangeM, siteId: score.siteId }
      })
      .sort(queueOrder)
    const above: string[] = []
    ranked.forEach((entry, i) => {
      const { track, score } = entry
      const run = runOf(track)
      const band = bandOf(Math.round(score.composite), scoring.bands)
      run.bands.push(band)
      run.bandAt.set(tSec, band)
      run.kinds.push(score.pattern ?? 'null')
      run.rankAt.set(tSec, i + 1)
      run.compositeAt.set(tSec, score.composite)
      if (run.firstWarningS === null && band === 'warning') run.firstWarningS = tSec
      run.maxComposite = Math.max(run.maxComposite, score.composite)
      if (track.source === 'inject' && band !== 'calm') above.push(track.id)
      // The audit, on airborne ticks only.
      if (!track.onGround) {
        // The closing factor by id, as the rest of the tree reads a factor (#147 round 2).
        const closingValue = score.factors.find((factor) => factor.id === 'closing')?.value ?? 0
        if (closingValue >= config.audit.closingAtLeast) run.closing = true
        run.closingMin = Math.min(run.closingMin, closingValue)
        run.closingMax = Math.max(run.closingMax, closingValue)
        if (track.source === 'inject') {
          const course = entryAt(track, site)
          if (course.kind === 'misses') {
            const missM = course.cpaM - site.radiusM
            run.minMissM = run.minMissM === null ? missM : Math.min(run.minMissM, missM)
            run.course.misses++
          } else if (course.kind === 'away') run.course.away++
          else if (course.kind === 'entry') run.course.entry++
          else if (course.kind === 'inside') run.course.inside++
          else run.course.other++
        }
        if (distanceMeters(site.center, track.position) <= config.audit.insideM) run.inside = true
        if (track.source === 'inject') {
          // What raw mode shows: the same track through associate at its own distance — an
          // inject still, by associate's contract; the check narrows the type and nothing else.
          const shown = raw.get(track.id)!
          if (shown.source === 'inject') {
            if (shown.broadcast === null) run.silent = true
            if (shown.callsign !== null) {
              run.heard = true
              run.label = shown.callsign
              if ((shown.groundSpeedKt ?? Infinity) < config.audit.hoveringUnderKt)
                run.hovering = true
            }
          }
        }
      }
      if (track.id !== THREAT_ID) return
      if (threat.crossingS === null && band === 'warning') {
        threat.crossingS = tSec
        threat.crossingRangeM = distanceMeters(site.center, track.position)
        const path = entryAt(track, site)
        threat.toEntryS = path.kind === 'entry' ? path.tSec : path.kind === 'inside' ? 0 : null
      }
      if (threat.crossingS === null) return
      threat.ticksFromCrossing++
      if (i !== 0) {
        threat.rank1Throughout = false
        return
      }
      // The next candidate, when the picture holds one: a cast of the threat alone has none.
      const next = ranked[1]
      if (!next) return
      const margin = Math.round(score.composite) - Math.round(next.score.composite)
      if (threat.minMargin === null || margin < threat.minMargin) {
        threat.minMargin = margin
        threat.marginOver = `${next.track.callsign ?? next.track.id} at ${tSec} s`
      }
    })
    aboveCalm.push({ tSec, ids: above })
  }
  const spec = plan.specs.find((s) => s.id === THREAT_ID)
  if (!spec)
    throw new Error(`${scenario.name}: no ${THREAT_ID} — the cast's first row is the threat`)
  const injects = plan.specs.map((s) => runOf({ id: s.id, source: 'inject' } as Track))
  const revisit = roles.revisit === undefined ? null : (runs.get(roles.revisit) ?? null)
  if (roles.revisit !== undefined && !revisit)
    throw new Error(
      `${scenario.name}: no ${roles.revisit} — the cast's second row is the revisit track`,
    )
  const heardNotClosing = injects
    .filter((run) => !roles.threats.includes(run.id) && run.heard && !run.closing)
    .reduce<TrackRun | null>(
      (best, run) => (best === null || run.maxComposite > best.maxComposite ? run : best),
      null,
    )
  const aircraft = [...runs.values()].filter((run) => run.source === 'adsb')
  return {
    name: scenario.name,
    seed: plan.seed,
    recording: recording.entry.id,
    family: roles.family,
    config,
    runS,
    threat: {
      firstFrameS: spec.startS,
      lieFromS: spec.broadcastOffset?.fromS ?? 0,
      ...threat,
      // Rank 1 throughout means on every tick left in the window, not only the ticks it was
      // in the picture: a threat that leaves the queue is not rank 1 (#147 round 2).
      ticksExpected: threat.crossingS === null ? 0 : end - threat.crossingS + 1,
      rank1Throughout:
        threat.rank1Throughout &&
        threat.crossingS !== null &&
        threat.ticksFromCrossing === end - threat.crossingS + 1,
    },
    revisit: revisit && {
      maxComposite: revisit.maxComposite,
      maxBand: revisit.bands.reduce(
        (top, band) => (BANDS.indexOf(band) > BANDS.indexOf(top) ? band : top),
        'calm',
      ),
      ticks: revisit.bands.length,
      ticksExpected: end - begin + 1,
    },
    prioritization:
      roles.family === 'prioritization' ? prioritizationOf(roles, runs, begin, end, runS) : null,
    heardNotClosing: heardNotClosing && {
      id: heardNotClosing.id,
      label: heardNotClosing.label,
      maxComposite: heardNotClosing.maxComposite,
    },
    audit: {
      closingDrones: injects.filter((run) => run.closing).length,
      closingAircraft: aircraft.filter((run) => run.closing).length,
      silent: injects.filter((run) => run.silent).length,
      inside: injects.filter((run) => run.inside).length,
      hovering: injects.filter((run) => run.hovering).length,
    },
    aboveCalm: {
      atBegin: aboveCalm[0].ids.length,
      atBeginPlus1: aboveCalm[1].ids.length,
      idsAtBeginPlus1: [...aboveCalm[1].ids].sort(),
      max: Math.max(...aboveCalm.map((tick) => tick.ids.length)),
      atEnd: aboveCalm[aboveCalm.length - 1].ids.length,
    },
    flaps: injects
      .map((run) => ({ id: run.id, count: flapsOf(run.bands) }))
      .filter((f) => f.count > 0),
    kindChanges: injects
      .map((run) => ({ id: run.id, count: kindChangesOf(run.kinds), kinds: kindsOf(run.kinds) }))
      .filter((k) => k.count > 0),
    entries: injects.map((run) => ({ id: run.id, enteredS: run.enteredS })),
  }
}

/**
 * The prioritization pair's lines from the fold (S7, #152, ruled A8; S7b): the threats' entries
 * and crossings in row order, the lock through the first entry with its inverted ticks and the
 * narrowest margins, the baits' entries and the tangential's miss, the orbit's closing range and
 * rank, the band rows' first warning, and the run's length against the rule.
 */
function prioritizationOf(
  roles: CastRoles,
  runs: Map<string, TrackRun>,
  begin: number,
  end: number,
  runS: number,
): Prioritization {
  const runOf = (id: string) => {
    const run = runs.get(id)
    // Every plan spec has a run once the fold has seen it, so the guard is the picture, not the map.
    if (!run || run.rankAt.size === 0)
      throw new Error(`${id} is named by the cast table but never in the window's picture`)
    return run
  }
  const threats = roles.threats.map((id) => {
    const run = runOf(id)
    const enteredS = run.enteredS
    // Read by tick: a track not in the picture on a tick from Begin to its entry was not warning on it.
    const warningToEntry =
      enteredS !== null &&
      enteredS >= begin &&
      Array.from({ length: enteredS - begin + 1 }, (_, k) => begin + k).every(
        (t) => run.bandAt.get(t) === 'warning',
      )
    return { id, enteredS, firstWarningS: run.firstWarningS, warningToEntry }
  })
  const early = threats
    .filter((t) => t.enteredS !== null && t.enteredS < begin)
    .sort((a, b) => a.enteredS! - b.enteredS!)[0]
  const entryBeforeBegin = early ? { id: early.id, enteredS: early.enteredS! } : null
  const entered = threats.filter((t) => t.enteredS !== null) as { id: string; enteredS: number }[]
  const byEntry = [...entered].sort((a, b) => a.enteredS - b.enteredS)
  const rowOrderIsEntryOrder =
    entered.length === threats.length && byEntry.every((t, i) => t.id === threats[i].id)
  const firstEntryS = byEntry[0]?.enteredS ?? null
  const lastEntryS = byEntry[byEntry.length - 1]?.enteredS ?? null
  const [first, second] = byEntry.map((t) => runOf(t.id))
  const inOrder = (t: number) =>
    first !== undefined &&
    second !== undefined &&
    first.rankAt.get(t) === 1 &&
    second.rankAt.get(t) === 2
  let lockS: number | null = null
  let invertedTicks = 0
  let threatMargin: Prioritization['threatMargin'] = null
  let rank3Margin: Prioritization['rank3Margin'] = null
  // A threat inside the ring before Begin leaves nothing to lock on: the line says so instead of
  // reading a clean zero off an empty range.
  const lastTick = firstEntryS === null ? end : Math.min(firstEntryS, end)
  if (entryBeforeBegin === null) {
    for (let t = lastTick; t >= begin; t--) {
      if (inOrder(t)) lockS = t
      else break
    }
    for (let t = begin; t <= lastTick; t++) if (!inOrder(t)) invertedTicks++
    if (first && second) {
      const holder = (t: number, rank: number) =>
        [...runs.values()].find((run) => run.rankAt.get(t) === rank)
      for (let t = begin; t <= lastTick; t++) {
        const a = first.compositeAt.get(t)
        const b = second.compositeAt.get(t)
        if (a === undefined || b === undefined) continue
        if (threatMargin === null || a - b < threatMargin.min) threatMargin = { min: a - b, atS: t }
        // Rank 2 over rank 3 reads whoever holds those ranks on the tick — the threat only while the
        // order holds — so the number is a margin on every tick, the inverted ones included.
        const runnerUp = holder(t, 2)
        const third = holder(t, 3)
        const b2 = runnerUp?.compositeAt.get(t)
        const c = third?.compositeAt.get(t)
        if (
          third &&
          b2 !== undefined &&
          c !== undefined &&
          (rank3Margin === null || b2 - c < rank3Margin.min)
        )
          rank3Margin = { min: b2 - c, atS: t, over: third.id }
      }
    }
  }
  const tangential = (roles.tangential ?? []).map((id) => {
    const run = runOf(id)
    return { id, minMissM: run.minMissM, ticks: { ...run.course } }
  })
  const baitsEntered = [...runs.values()]
    .filter(
      (run) => run.source === 'inject' && !roles.threats.includes(run.id) && run.insideInWindow,
    )
    .map((run) => run.id)
  const ranks = (run: TrackRun) => [...run.rankAt.values()]
  const orbitRun = roles.orbit === undefined ? null : runOf(roles.orbit)
  const orbit = orbitRun && {
    id: orbitRun.id,
    closingMin: orbitRun.closingMin,
    closingMax: orbitRun.closingMax,
    rankMin: Math.min(...ranks(orbitRun)),
    rankMax: Math.max(...ranks(orbitRun)),
  }
  const band = (roles.band ?? []).map((id) => {
    const run = runOf(id)
    return {
      id,
      firstWarningS: run.firstWarningS,
      rankMin: Math.min(...ranks(run)),
      rankMax: Math.max(...ranks(run)),
      maxComposite: run.maxComposite,
    }
  })
  return {
    threats,
    rowOrderIsEntryOrder,
    firstEntryS,
    lastEntryS,
    entryBeforeBegin,
    lockStatedS: roles.lockS ?? begin,
    lockS,
    invertedTicks,
    threatMargin,
    rank3Margin,
    tangential,
    baitsEntered,
    orbit,
    band,
    runS: { actual: runS, rule: lastEntryS === null ? null : lastEntryS - begin + 30 },
  }
}

const km = (m: number) => `${(m / 1000).toFixed(2)} km`
const check = (ok: boolean) => (ok ? '✓' : '✗')

export function renderStudy(result: StudyResult): string {
  const { config: c } = result
  const begin = c.beginS
  const end = c.beginS + result.runS
  const lines: string[] = []
  lines.push(
    `# Study baseline — ${result.name} on ${result.recording} · Begin ${begin} s · run ${result.runS} s · 1 Hz through the feed`,
  )
  lines.push('')
  lines.push(
    'Generated by `npm run bench:study` — never hand-edit; `scripts/study.test.ts` holds it byte for byte and asserts the lines below (S3c, #135). Config: `src/config/study.ts` and `src/config/scoring.ts` as committed; the scenario through the feed at the scorer’s threshold beside the recording’s real layer; the cue audit through `associate` at ' +
      `${c.rawAssociationM} m on airborne ticks only — a landed track counts for nothing.`,
  )
  lines.push('')
  if (result.family === 'prioritization') {
    lines.push(...prioritizationLines(result, begin))
  } else {
    lines.push(...corroborationLines(result, begin))
  }
  const h = result.heardNotClosing
  lines.push(
    `heard, consistent, not closing: ${h ? `max composite ${Math.round(h.maxComposite)} (${h.id}${h.label ? ' ' + h.label : ''})` : 'none'} — < ${c.acceptance.heardCalmUnder} ${check(h === null || Math.round(h.maxComposite) < c.acceptance.heardCalmUnder)}`,
  )
  const a = result.audit
  lines.push(
    `cue audit through associate at ${c.rawAssociationM} m, airborne ticks only: closing ${a.closingDrones} drones + ${a.closingAircraft} aircraft · silent ${a.silent} · inside ${(c.audit.insideM / 1000).toFixed(1)} km ${a.inside} · Remote ID hovering ${a.hovering}`,
  )
  const ac = result.aboveCalm
  lines.push(
    `above calm: ${ac.atBegin} at Begin · ${ac.atBeginPlus1} at Begin + 1 (${ac.idsAtBeginPlus1.join(', ')}) · max ${ac.max} in the window · ${ac.atEnd} at its end`,
  )
  lines.push(
    `flaps per track in the window: ${result.flaps.length === 0 ? 'none' : result.flaps.map((f) => `${f.id} ${f.count}`).join(' · ')}`,
  )
  lines.push(
    `pattern-kind changes per track in the window: ${result.kindChanges.length === 0 ? 'none' : result.kindChanges.map((k) => `${k.id} ${k.count} (${k.kinds})`).join(' · ')}`,
  )
  lines.push(
    `ring entry, every track: ${result.entries
      .map(
        (e) =>
          `${e.id} ${e.enteredS === null ? '—' : `${e.enteredS} s${e.enteredS > end ? ' (after the run)' : ''}`}`,
      )
      .join(' · ')}`,
  )
  return lines.join('\n') + '\n'
}

/** The corroboration pair's four lines (02a, 02b), as S3c wrote them. */
function corroborationLines(result: StudyResult, begin: number): string[] {
  const { config: c, threat: t } = result
  const lines: string[] = []
  const presence =
    t.firstFrameS === 0
      ? `present from 0 s, heard and consistent, the lie from ${t.lieFromS} s`
      : `first frame ${t.firstFrameS} s (Begin + ${t.firstFrameS - begin})`
  // The seconds print rounded, and the verdict reads the rounded number too (#147 round 2).
  const leadS = t.toEntryS === null ? null : Math.round(t.toEntryS)
  const crossing =
    t.crossingS === null
      ? 'never warning in the window ✗'
      : `first warning at Begin + ${t.crossingS - begin} s · ${km(t.crossingRangeM ?? 0)} · ${leadS === null ? 'no entry on its course' : `${leadS} s to entry`} — ≥ ${c.acceptance.entryLeadS} s ${check(leadS !== null && leadS >= c.acceptance.entryLeadS)}`
  lines.push(`threat ${THREAT_ID}: ${presence} · ${crossing}`)
  const held = t.rank1Throughout && t.minMargin !== null
  const rankLine = held
    ? `min margin ${t.minMargin} over ${t.marginOver}`
    : t.crossingS !== null && t.ticksFromCrossing !== t.ticksExpected
      ? `not held — in the picture on ${t.ticksFromCrossing} of ${t.ticksExpected} ticks from the crossing`
      : 'not held'
  lines.push(
    `rank 1 from its warning crossing: ${rankLine} — ≥ ${c.acceptance.marginAtLeast} ${check(held && (t.minMargin ?? -Infinity) >= c.acceptance.marginAtLeast)}`,
  )
  const r = result.revisit
  if (r === null) throw new Error(`${result.name}: the corroboration pair names a revisit track`)
  const revisitScored = r.ticks === r.ticksExpected
  lines.push(
    `revisit track ${REVISIT_ID}: ${revisitScored ? `max band ${r.maxBand} (${Math.round(r.maxComposite)})` : `scored on ${r.ticks} of ${r.ticksExpected} ticks`} — never warning ${check(revisitScored && r.maxBand !== 'warning')}`,
  )
  return lines
}

const at = (tSec: number | null, begin: number) =>
  tSec === null ? 'never' : `${tSec} s (Begin + ${tSec - begin})`

/** The prioritization pair's lines (03a, 03b) — S7's four, the lock, the baits, the orbit, the band rows, the rule. */
function prioritizationLines(result: StudyResult, begin: number): string[] {
  const p = result.prioritization
  if (p === null) throw new Error(`${result.name}: the prioritization pair carries its block`)
  const c = result.config.prioritization
  const lines: string[] = []
  const end = begin + result.runS
  const bothInside = p.threats.every(
    (t) => t.enteredS !== null && t.enteredS >= begin && t.enteredS <= end,
  )
  lines.push(
    `threats in row order: ${p.threats.map((t) => `${t.id} enters ${at(t.enteredS, begin)}`).join(' · ')} — row order is entry order ${check(p.rowOrderIsEntryOrder)} · both inside the run ${check(bothInside)} · warning on every tick from Begin to entry ${check(p.threats.every((t) => t.warningToEntry))}`,
  )
  // The verdict is the tolerance's: a lock at or before T_lock + the tolerance passes, whatever
  // the ticks before it read — they are the inverted ticks the line counts, all before the lock.
  const lockOk = p.lockS !== null && p.lockS <= p.lockStatedS + c.lockToleranceTicks
  const lockRead = p.entryBeforeBegin
    ? `not measured — ${p.entryBeforeBegin.id} entered the ring at ${p.entryBeforeBegin.enteredS} s, before Begin`
    : `${p.lockS === null ? 'never' : `from ${at(p.lockS, begin)}`}, ${p.invertedTicks} inverted ticks before it`
  lines.push(
    `lock — ranks 1 and 2 the threats in entry order through the first entry: ${lockRead} — T_lock ${at(p.lockStatedS, begin)}, tolerance ${c.lockToleranceTicks} ticks ${check(lockOk)} · threat 1 over threat 2 min ${p.threatMargin ? `${p.threatMargin.min.toFixed(2)} at ${p.threatMargin.atS} s` : '—'} · rank 2 over rank 3 min ${p.rank3Margin ? `${p.rank3Margin.min.toFixed(2)} at ${p.rank3Margin.atS} s (${p.rank3Margin.over})` : '—'}`,
  )
  // The miss prints rounded and the verdict reads the rounded number, as the corroboration lead
  // line does; every airborne tick is accounted for — a miss, opening, inside the ring, entering,
  // or unreadable — and the verdict holds only with no tick inside or entering.
  const missOf = (b: Prioritization['tangential'][number]) =>
    b.minMissM === null ? null : Math.round(b.minMissM)
  const missOk = p.tangential.every((b) => {
    const miss = missOf(b)
    return miss !== null && miss >= c.baitMissM && b.ticks.inside === 0 && b.ticks.entry === 0
  })
  const courseRead = (b: Prioritization['tangential'][number]) =>
    [
      `misses by ≥ ${missOf(b) ?? '—'} m on ${b.ticks.misses} airborne ticks`,
      `opening on ${b.ticks.away}`,
      b.ticks.inside > 0 ? `inside the ring on ${b.ticks.inside}` : null,
      b.ticks.entry > 0 ? `on an entering course on ${b.ticks.entry}` : null,
      b.ticks.other > 0 ? `unreadable on ${b.ticks.other}` : null,
      b.ticks.inside === 0 && b.ticks.entry === 0 ? 'never inside or entering' : null,
    ]
      .filter((part) => part !== null)
      .join(', ')
  lines.push(
    `baits: ${p.baitsEntered.length === 0 ? 'none enters inside the run ✓' : `entered inside the run: ${p.baitsEntered.join(', ')} ✗`} · ${p.tangential.map((b) => `tangential ${b.id} ${courseRead(b)}`).join(' · ')} — ≥ ${c.baitMissM} ${check(missOk)}`,
  )
  if (p.orbit)
    lines.push(
      `orbit ${p.orbit.id}: closing ${Math.round(p.orbit.closingMin)}–${Math.round(p.orbit.closingMax)} · rank ${p.orbit.rankMin}–${p.orbit.rankMax}`,
    )
  const bandOk =
    p.firstEntryS !== null &&
    p.band.every((b) => b.firstWarningS === null || b.firstWarningS > p.firstEntryS!)
  lines.push(
    `band rows: ${p.band.map((b) => `${b.id} first warning ${at(b.firstWarningS, begin)} · rank ${b.rankMin}–${b.rankMax} · max ${Math.round(b.maxComposite)}`).join(' · ')} — none before the first entry ${check(bandOk)}`,
  )
  lines.push(
    `runS ${p.runS.actual} = last entry ${p.lastEntryS ?? '—'} − Begin ${begin} + 30 ${check(p.runS.rule !== null && p.runS.rule === p.runS.actual)}`,
  )
  // A criterion for the leak test, not a measurement: nothing in the fold reads a volunteer.
  lines.push(
    `leak tell (stated, unmeasured until the leak test runs): threat 1 ${p.threats[0]?.id ?? '—'} opened on raw under ${c.leakOpenS} s by both volunteers`,
  )
  return lines
}

function main(): void {
  const write = process.argv.includes('--write')
  const recording = loadRecording(STUDY_RECORDING)
  for (const name of BENCH_SCENARIOS) {
    const started = performance.now()
    const text = renderStudy(runStudy(scenarioNamed(name, SCENARIOS), recording))
    const elapsed = ((performance.now() - started) / 1000).toFixed(1)
    if (write) {
      writeFileSync(outPath(name), text, 'utf8')
      console.log(`Wrote ${outPath(name)} in ${elapsed} s`)
    } else {
      process.stdout.write(text + '\n')
      console.error(`study ${name}: ${elapsed} s`)
    }
  }
}

if (process.argv[1] && basename(process.argv[1]) === 'study.ts') {
  try {
    main()
  } catch (error) {
    console.error((error as Error).message)
    process.exitCode = 1
  }
}
