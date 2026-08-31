import { describe, expect, it } from 'vitest'
import { hashSeed, makeRng } from './rng'

describe('hashSeed', () => {
  it('is stable for a given string', () => {
    expect(hashSeed('vigil-phl-001')).toBe(hashSeed('vigil-phl-001'))
  })

  it('scatters seeds that differ by one character', () => {
    // Adjacent seed names must not produce adjacent streams, or "different seed" is a lie.
    const a = hashSeed('vigil-phl-001')
    const b = hashSeed('vigil-phl-002')
    expect(Math.abs(a - b)).toBeGreaterThan(1_000_000)
  })

  it('returns an unsigned 32-bit integer', () => {
    for (const seed of ['', 'a', 'vigil-phl-001', 'x'.repeat(200)]) {
      const h = hashSeed(seed)
      expect(Number.isInteger(h)).toBe(true)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(0xffffffff)
    }
  })
})

describe('makeRng', () => {
  it('replays the same stream for the same seed', () => {
    const one = makeRng('seed-a')
    const two = makeRng('seed-a')
    expect(Array.from({ length: 50 }, () => one.next())).toEqual(
      Array.from({ length: 50 }, () => two.next()),
    )
  })

  it('produces a different stream for a different seed', () => {
    const one = makeRng('seed-a')
    const two = makeRng('seed-b')
    expect(Array.from({ length: 20 }, () => one.next())).not.toEqual(
      Array.from({ length: 20 }, () => two.next()),
    )
  })

  it('stays inside [0, 1)', () => {
    const rng = makeRng('bounds')
    for (let i = 0; i < 5000; i++) {
      const value = rng.next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('pins known values, so a refactor of the mixer cannot pass silently', () => {
    const rng = makeRng('vigil-phl-001')
    expect([rng.next(), rng.next(), rng.next()].map((v) => v.toFixed(12))).toEqual([
      '0.404211801942',
      '0.202571172966',
      '0.479524792638',
    ])
  })

  it('keeps range, int, and bool inside their bounds', () => {
    const rng = makeRng('bounded')
    for (let i = 0; i < 1000; i++) {
      const r = rng.range(-5, 5)
      expect(r).toBeGreaterThanOrEqual(-5)
      expect(r).toBeLessThan(5)
      const n = rng.int(7)
      expect(Number.isInteger(n)).toBe(true)
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThan(7)
      expect(typeof rng.bool(0.5)).toBe('boolean')
    }
    expect(rng.bool(1)).toBe(true)
    expect(rng.bool(0)).toBe(false)
  })

  it('shuffles without mutating the input or losing items', () => {
    const source = Object.freeze(['a', 'b', 'c', 'd', 'e'])
    const shuffled = makeRng('shuffle').shuffle(source)
    expect(shuffled).not.toBe(source)
    expect([...shuffled].sort()).toEqual([...source].sort())
    expect(source).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('draws the same number of values from shuffle regardless of the items', () => {
    // The generator relies on this: swapping a behavior name must not shift the stream.
    const one = makeRng('draws')
    one.shuffle(['a', 'b', 'c', 'd'])
    const two = makeRng('draws')
    two.shuffle([1, 2, 3, 4])
    expect(one.next()).toBe(two.next())
  })
})
