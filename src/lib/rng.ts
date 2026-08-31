/**
 * The scenario's only source of randomness (scope §5.2).
 *
 * Determinism is a requirement, not a nicety: same seed, same picture, proven by a committed
 * golden fixture. That rules out `Math.random` (unseedable), `crypto.getRandomValues`
 * (nondeterministic by design), and anything that reads a clock. It also rules out a dependency —
 * `seedrandom` would be a package for fifteen lines of arithmetic.
 *
 * `mulberry32` is those fifteen lines. Its whole state is one uint32, and every operation below
 * is `Math.imul`, `^`, `>>>`, or `+`, all of which ECMAScript specifies *exactly* on 32-bit
 * integers — no engine latitude, no floating-point associativity. The final `/ 4294967296` is a
 * division by a power of two, which is exact in IEEE-754. The same seed produces the same bits on
 * every engine and every Node version.
 *
 * What this module cannot promise is that `Math.sin` and friends agree across engines — the spec
 * lets those be implementation-approximated. The generator handles that by quantizing its output
 * (see `src/lib/injects.ts`), which puts a ~1e-16 relative disagreement five orders of magnitude
 * below the smallest value it emits.
 */

/** A seeded stream. Every method advances it; call order is therefore part of the contract. */
export interface Rng {
  /** The next value in [0, 1). */
  next(): number
  /** The next value in [min, max). */
  range(min: number, max: number): number
  /** The next integer in [0, bound). */
  int(bound: number): number
  /** True with probability `p`. */
  bool(p: number): boolean
  /** One item, uniformly. */
  pick<T>(items: readonly T[]): T
  /** A shuffled copy; the input is not mutated. */
  shuffle<T>(items: readonly T[]): T[]
}

/**
 * A readable seed string to a uint32 — the `xmur3` mixer, so that `'vigil-phl-001'` and
 * `'vigil-phl-002'` land far apart in the state space rather than one step apart.
 */
export function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^ (h >>> 16)) >>> 0
}

export function makeRng(seed: string): Rng {
  let state = hashSeed(seed)
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (bound: number): number => Math.floor(next() * bound)
  return {
    next,
    int,
    range: (min, max) => min + next() * (max - min),
    bool: (p) => next() < p,
    pick: (items) => items[int(items.length)],
    shuffle: (items) => {
      const out = [...items]
      // Fisher-Yates downward, so the draw count depends only on length — never on the values.
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1)
        ;[out[i], out[j]] = [out[j], out[i]]
      }
      return out
    },
  }
}
