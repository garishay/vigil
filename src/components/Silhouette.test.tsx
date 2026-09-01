import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Silhouette } from './Silhouette'
import { PATHS } from './silhouettes'
import type { Airframe } from '../config/airframes'

/**
 * The path data as polygons, one per subpath. Only `M`, `L`, `Q`, and `Z` are used; a quadratic
 * is taken by its endpoint, which is exact for the overlap check (the curved glyph is excluded
 * from it) and a safe approximation for the hole check (the probed points sit well inside).
 */
function polygons(d: string): [number, number][][] {
  return d
    .split('M')
    .filter((part) => part.trim())
    .map((part) =>
      part
        .replace(/Z/g, '')
        .split(/[LQ]/)
        .map((segment) => segment.trim().split(/\s+/).map(Number))
        .map((numbers) => numbers.slice(-2) as [number, number]),
    )
}

/** Even-odd containment against one polygon: crossings of a ray to +x from the point. */
function inside([x, y]: [number, number], polygon: [number, number][]): boolean {
  let crossings = 0
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) crossings++
  }
  return crossings % 2 === 1
}

const covered = (point: [number, number], d: string) =>
  polygons(d).filter((polygon) => inside(point, polygon)).length

/** Every glyph but `unknown` is solid: an overlap would render as a hole under even-odd. */
const SOLID = (Object.keys(PATHS) as Airframe[]).filter((airframe) => airframe !== 'unknown')

/** One interior point per body, and one per detail a reader should see filled. */
const FILLED: Record<Airframe, [number, number][]> = {
  'light-piston': [
    [48, 22],
    [67, 12], // fin
    [44, 29], // wing stub
  ],
  turboprop: [
    [48, 22],
    [41, 15], // wing
    [41, 30], // nacelle
    [76, 10], // fin
  ],
  'business-jet': [
    [48, 23],
    [70, 30], // rear engine
    [86, 9], // T-tail
  ],
  narrowbody: [
    [48, 22],
    [39, 37], // engine pod
    [86, 9], // fin
  ],
  widebody: [
    [48, 21],
    [31, 37], // first pod
    [45, 37], // second pod
  ],
  rotorcraft: [
    [40, 20],
    [40, 6], // rotor disc
    [41, 10], // mast
    [43, 33], // skid
  ],
  'small-multirotor': [
    [48, 22],
    [20, 22], // arm
    [16, 16], // rotor disc
  ],
  'fixed-wing-uas': [
    [38, 22], // fuselage — the review's bisected case
    [12, 20], // wing, left piece
    [70, 20], // wing, right piece
    [70, 23], // boom
    [84, 24], // tail
  ],
  unknown: [
    [10, 20], // the plate
  ],
}

describe('Silhouette paths', () => {
  it('never overlap their own subpaths — an overlap is a hole under even-odd (#55 review)', () => {
    for (const airframe of SOLID) {
      for (let x = 0; x < 96; x += 0.5) {
        for (let y = 0; y < 40; y += 0.5) {
          const count = covered([x + 0.25, y + 0.25], PATHS[airframe])
          if (count > 1) throw new Error(`${airframe} overlaps itself at (${x}, ${y})`)
        }
      }
    }
  })

  it('fill every body and every detail a reader should see', () => {
    for (const [airframe, points] of Object.entries(FILLED) as [Airframe, [number, number][]][]) {
      for (const point of points) {
        expect(covered(point, PATHS[airframe]) % 2, `${airframe} at ${point}`).toBe(1)
      }
    }
  })

  it('cut the question mark and its dot out of the unknown plate — the one glyph that wants holes', () => {
    expect(covered([48, 22], PATHS.unknown) % 2).toBe(0) // the stem
    expect(covered([48, 28], PATHS.unknown) % 2).toBe(0) // the dot
    expect(covered([48, 36], PATHS.unknown) % 2).toBe(0) // below the plate: nothing
  })

  it('renders one hidden, evenodd-filled path per airframe', () => {
    for (const airframe of Object.keys(PATHS) as Airframe[]) {
      const { container, unmount } = render(<Silhouette airframe={airframe} />)
      const svg = container.querySelector('svg')!
      expect(svg.getAttribute('aria-hidden')).toBe('true')
      expect(svg.dataset.airframe).toBe(airframe)
      expect(svg.querySelector('path')?.getAttribute('fill-rule')).toBe('evenodd')
      unmount()
    }
  })
})
