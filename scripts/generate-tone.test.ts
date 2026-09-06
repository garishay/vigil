// @vitest-environment node
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { OUT, TONE, toneSamples, toneWav } from './generate-tone.ts'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('the alert tone (#101, 101b)', () => {
  it('is a plain 16-bit mono WAV of the two notes, header and length agreeing', () => {
    const wav = toneWav()
    const samples = Math.round(TONE.sampleRate * TONE.noteS) * TONE.notesHz.length
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ')
    expect(wav.readUInt16LE(20)).toBe(1) // PCM
    expect(wav.readUInt16LE(22)).toBe(1) // mono
    expect(wav.readUInt32LE(24)).toBe(22050)
    expect(wav.readUInt16LE(34)).toBe(16)
    expect(wav.toString('ascii', 36, 40)).toBe('data')
    expect(wav.readUInt32LE(40)).toBe(samples * 2)
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8)
    expect(wav.length).toBe(44 + samples * 2)
    // A quarter second: 2 × 2,756 samples, 11,068 bytes.
    expect(wav.length).toBe(11068)
  })

  it('starts and ends at silence, and sounds in between — the fades are what stop the click', () => {
    const samples = toneSamples()
    const perNote = Math.round(TONE.sampleRate * TONE.noteS)
    expect(samples[0]).toBe(0)
    expect(samples[perNote - 1]).toBe(0)
    expect(samples[perNote]).toBe(0)
    expect(samples[samples.length - 1]).toBe(0)
    const loudest = Math.max(...Array.from(samples, Math.abs))
    expect(loudest).toBeGreaterThan(32767 * TONE.amplitude * 0.95)
    expect(loudest).toBeLessThanOrEqual(Math.round(32767 * TONE.amplitude))
  })

  it('is deterministic, and the committed file is exactly what the script writes', () => {
    expect(Buffer.compare(toneWav(), toneWav())).toBe(0)
    const committed = readFileSync(join(repo, OUT))
    expect(Buffer.compare(committed, toneWav())).toBe(0)
  })
})
