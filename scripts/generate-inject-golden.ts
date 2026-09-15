/**
 * Writes the golden inject scenario for the default seed.
 *
 * The golden is what turns "same seed → identical picture" from a claim into a check: the test
 * deep-equals a freshly generated scenario against the committed file, so any drift in the RNG,
 * the behavior geometry, the envelope, or the rounding fails CI.
 *
 * This is a script rather than a `toMatchSnapshot()` because a snapshot is one `-u` away from
 * ratifying a regression. Regenerating here is deliberate, and the diff is reviewable.
 *
 * Run: `npm run fixture:injects`
 */

import { readFile, writeFile } from 'node:fs/promises'
import { generateScenario, timelineOf } from '../src/lib/injects.ts'
import type { InjectScenario } from '../src/lib/injects.ts'
import { DEFAULT_RECORDING } from '../src/config/recordings.ts'
import { SCENARIO } from '../src/config/scenario.ts'
import { BEHAVIORS_SCENARIO } from '../src/lib/__fixtures__/behaviors.ts'
import type { AdsbCapture } from '../src/lib/adsb.ts'

/** The golden is 001's, whatever else the registry holds (R5 on #84). */
const CAPTURE = `public/${DEFAULT_RECORDING.file}`

/**
 * `--behaviors` writes the behavior test scenario's golden instead (S2a, #133, ruled A7): 001's
 * deal plus one cast entry per scripted behavior, on 001's timeline — the same script, so the
 * two fixtures cannot drift in shape.
 */
const behaviors = process.argv.includes('--behaviors')
const CONFIG = behaviors ? BEHAVIORS_SCENARIO : SCENARIO
const OUT = `src/lib/__fixtures__/injects-${SCENARIO.seed}${behaviors ? '-behaviors' : ''}.json`

/** One track per line, so a regeneration diffs as data rather than as reflowed whitespace. */
function serialize(scenario: InjectScenario): string {
  const { frames, ...header } = scenario
  const headerJson = JSON.stringify(header).slice(1, -1)
  const frameBlocks = frames.map((frame) => {
    const tracks = frame.tracks.map((track) => JSON.stringify(track)).join(',\n')
    return `{"tMs": ${frame.tMs}, "tracks": [\n${tracks}\n]}`
  })
  return `{${headerJson},\n"frames": [\n${frameBlocks.join(',\n')}\n]}\n`
}

async function main(): Promise<void> {
  // The inject timeline is the capture's own frame times. Reading them here rather than assuming
  // a grid is what keeps the two layers on one timeline through a recapture, holes included.
  const capture = JSON.parse(await readFile(CAPTURE, 'utf8')) as AdsbCapture
  const scenario = generateScenario(timelineOf(capture), CONFIG)

  await writeFile(OUT, serialize(scenario), 'utf8')

  // Each inject at the frame it first appears — frame 0 for a dealt inject, its own start for a
  // cast inject that appears later (S2a).
  const debut = new Map<string, { tMs: number; track: InjectScenario['frames'][0]['tracks'][0] }>()
  for (const frame of scenario.frames) {
    for (const track of frame.tracks) {
      if (!debut.has(track.id)) debut.set(track.id, { tMs: frame.tMs, track })
    }
  }
  console.log(`Wrote ${OUT}`)
  console.log(`  seed ${scenario.seed}, ${debut.size} injects, ${scenario.frameCount} frames`)
  for (const { tMs, track } of debut.values()) {
    const from = tMs > 0 ? `  from ${tMs / 1000} s` : ''
    console.log(`  ${track.id}  ${track.behavior.padEnd(17)} ${track.remoteId}${from}`)
  }
}

main().catch((error: Error) => {
  console.error(error.message)
  process.exitCode = 1
})
