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
import { SCENARIO } from '../src/config/scenario.ts'
import type { AdsbCapture } from '../src/lib/adsb.ts'

const CAPTURE = 'public/adsb-phl.json'
const OUT = `src/lib/__fixtures__/injects-${SCENARIO.seed}.json`

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
  const scenario = generateScenario(timelineOf(capture))

  await writeFile(OUT, serialize(scenario), 'utf8')

  const first = scenario.frames[0].tracks
  console.log(`Wrote ${OUT}`)
  console.log(`  seed ${scenario.seed}, ${first.length} injects, ${scenario.frameCount} frames`)
  for (const track of first) {
    console.log(`  ${track.id}  ${track.behavior.padEnd(17)} ${track.remoteId}`)
  }
}

main().catch((error: Error) => {
  console.error(error.message)
  process.exitCode = 1
})
