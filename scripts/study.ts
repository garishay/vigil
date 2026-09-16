/**
 * The study bench (S3c, #135, ruled A7): the operator study's acceptance, measured. One scenario,
 * one recording, one window — each study scenario through the feed (`scenarioFeed`, so
 * `associate` at the scorer's threshold: what Vigil shows) beside the recording's real layer, at
 * one-second ticks over the window from Begin, through the seams the app itself calls — the
 * picture, the identity memory, the histories, the origins, the scorer, the queue's own
 * comparator. Nothing is reimplemented; a number here is a number the app would show.
 *
 * Per scenario, the four acceptance lines (#131, the S3 gate's mockup 4): the threat's warning
 * crossing at least `entryLeadS` before ring entry; rank 1 from that crossing by at least
 * `marginAtLeast`; the revisit track never warning; a heard, consistent, not-closing track never
 * reaching `heardCalmUnder`. The cue audit through `associate` at raw mode's distance — the leak
 * test's count of what a raw display shows — on airborne ticks only: a landed track counts for
 * nothing (ruled at #145's closure). And the lines the rulings added: the above-calm count at
 * Begin, at Begin + 1, its maximum in the window, and at the end; flaps per track; pattern-kind
 * changes per track (#155, R2 on #152 — the evidence line for the last-leg floor); every track's
 * ring entry; the threat's first frame (02a) or its lie's first tick (02b).
 *
 * The generator's labels never reach this file: the threat is the cast's first row and the
 * revisit track its second, by the study files' own numbering — ids, not the answer key.
 *
 * Run: `npm run bench:study` writes `docs/bench/study-02a.md` and `study-02b.md`, which
 * `study.test.ts` holds byte for byte and reads the lines off, so a scenario or scoring edit that
 * breaks the study fails CI. Without `--write` the two files print instead.
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
/** The study scenarios, by their registry names. */
export const STUDY_SCENARIOS = ['02a', '02b'] as const
/** The cast's first row is the threat, its second the revisit track (the study files' numbering). */
export const THREAT_ID = 'inject-11'
export const REVISIT_ID = 'inject-12'
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
  /** The band on each tick of the window, in order. */
  bands: Band[]
  /** The named pattern on each tick, `null` as a word, in order. */
  kinds: string[]
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

export interface StudyResult {
  name: string
  seed: string
  recording: string
  config: StudyConfig
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
  /** The revisit track over the window, with the ticks it was scored on against the window's length. */
  revisit: { maxComposite: number; maxBand: Band; ticks: number; ticksExpected: number }
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

export function runStudy(
  scenario: NamedScenario,
  recording: Recording,
  config: StudyConfig = STUDY,
  scoring: ScoringConfig = SCORING,
): StudyResult {
  const site = AO.protectedSites[0]
  const index = indexCapture(recording.capture)
  const startLocal = clockStartOf(recording.entry, recording.capture, AO)
  const feed = scenarioFeed(timelineOf(recording.capture), scenario.config, AO)
  const plan = feed.plan
  const origins = originsOf(index, plan)
  const begin = config.beginS
  const end = config.beginS + config.runS
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
        kinds: [],
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
      if (run.enteredS === null && distanceMeters(site.center, track.position) <= site.radiusM) {
        run.enteredS = tSec
      }
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
      run.kinds.push(score.pattern ?? 'null')
      run.maxComposite = Math.max(run.maxComposite, score.composite)
      if (track.source === 'inject' && band !== 'calm') above.push(track.id)
      // The audit, on airborne ticks only.
      if (!track.onGround) {
        // The closing factor by id, as the rest of the tree reads a factor (#147 round 2).
        const closingValue = score.factors.find((factor) => factor.id === 'closing')?.value ?? 0
        if (closingValue >= config.audit.closingAtLeast) run.closing = true
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
  const revisit = runs.get(REVISIT_ID)
  if (!revisit)
    throw new Error(
      `${scenario.name}: no ${REVISIT_ID} — the cast's second row is the revisit track`,
    )
  const heardNotClosing = injects
    .filter((run) => run.id !== THREAT_ID && run.heard && !run.closing)
    .reduce<TrackRun | null>(
      (best, run) => (best === null || run.maxComposite > best.maxComposite ? run : best),
      null,
    )
  const aircraft = [...runs.values()].filter((run) => run.source === 'adsb')
  return {
    name: scenario.name,
    seed: plan.seed,
    recording: recording.entry.id,
    config,
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
    revisit: {
      maxComposite: revisit.maxComposite,
      maxBand: revisit.bands.reduce(
        (top, band) => (BANDS.indexOf(band) > BANDS.indexOf(top) ? band : top),
        'calm',
      ),
      ticks: revisit.bands.length,
      ticksExpected: end - begin + 1,
    },
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

const km = (m: number) => `${(m / 1000).toFixed(2)} km`
const check = (ok: boolean) => (ok ? '✓' : '✗')

export function renderStudy(result: StudyResult): string {
  const { config: c, threat: t } = result
  const begin = c.beginS
  const end = c.beginS + c.runS
  const lines: string[] = []
  lines.push(
    `# Study baseline — ${result.name} on ${result.recording} · Begin ${begin} s · run ${c.runS} s · 1 Hz through the feed`,
  )
  lines.push('')
  lines.push(
    'Generated by `npm run bench:study` — never hand-edit; `scripts/study.test.ts` holds it byte for byte and asserts the lines below (S3c, #135). Config: `src/config/study.ts` and `src/config/scoring.ts` as committed; the scenario through the feed at the scorer’s threshold beside the recording’s real layer; the cue audit through `associate` at ' +
      `${c.rawAssociationM} m on airborne ticks only — a landed track counts for nothing.`,
  )
  lines.push('')
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
  const revisitScored = r.ticks === r.ticksExpected
  lines.push(
    `revisit track ${REVISIT_ID}: ${revisitScored ? `max band ${r.maxBand} (${Math.round(r.maxComposite)})` : `scored on ${r.ticks} of ${r.ticksExpected} ticks`} — never warning ${check(revisitScored && r.maxBand !== 'warning')}`,
  )
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

function main(): void {
  const write = process.argv.includes('--write')
  const recording = loadRecording(STUDY_RECORDING)
  for (const name of STUDY_SCENARIOS) {
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
