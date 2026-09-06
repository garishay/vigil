/**
 * Writes the alert tone (#101, 101b): an original, synthesized sound — two short sine notes, a
 * fifth apart, with a fade at each end so nothing clicks — as a plain 16-bit mono WAV in
 * `public/`. Generated rather than sampled so the file's provenance is this script (§2: nothing
 * from anywhere else enters the repo), and deterministic so a test can hold the committed bytes
 * to the function that made them, as the inject golden is held.
 *
 * Run: `npm run fixture:tone`
 */

import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'

export const TONE = {
  sampleRate: 22050,
  /** Two notes, A5 then E6 — attend, then act — each held for `noteS`. */
  notesHz: [880, 1320],
  noteS: 0.125,
  /** A linear fade in and out of each note, so the tone starts and ends at silence. */
  fadeS: 0.02,
  /** Of full scale: audible on a laptop speaker without startling a room. */
  amplitude: 0.4,
} as const

export const OUT = 'public/alert-tone.wav'

/** The samples, one note after the other, each faded at both ends. */
export function toneSamples(): Int16Array {
  const perNote = Math.round(TONE.sampleRate * TONE.noteS)
  const fade = Math.round(TONE.sampleRate * TONE.fadeS)
  const samples = new Int16Array(perNote * TONE.notesHz.length)
  TONE.notesHz.forEach((hz, note) => {
    for (let i = 0; i < perNote; i++) {
      const envelope = Math.min(1, i / fade, (perNote - 1 - i) / fade)
      const value = Math.sin((2 * Math.PI * hz * i) / TONE.sampleRate) * envelope * TONE.amplitude
      samples[note * perNote + i] = Math.round(value * 32767)
    }
  })
  return samples
}

/** The WAV: a 44-byte RIFF header and the samples, little-endian. */
export function toneWav(): Buffer {
  const samples = toneSamples()
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // the fmt chunk's size
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(TONE.sampleRate, 24)
  header.writeUInt32LE(TONE.sampleRate * 2, 28) // bytes per second
  header.writeUInt16LE(2, 32) // bytes per frame
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

async function main(): Promise<void> {
  const wav = toneWav()
  await writeFile(OUT, wav)
  console.log(`Wrote ${OUT}: ${wav.length} bytes, ${TONE.notesHz.join(' → ')} Hz`)
}

if (process.argv[1] && basename(process.argv[1]) === 'generate-tone.ts') {
  main().catch((error: Error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
