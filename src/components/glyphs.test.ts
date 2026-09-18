import { describe, expect, it } from 'vitest'
import {
  GLYPHS,
  GLYPH_BOX,
  glyphImage,
  polygonPoints,
  signedDistance,
  type Polygon,
} from './glyphs'

describe('the two glyphs (S9, #181)', () => {
  it('sit inside the 24-unit box, nose up, mirrored about the vertical axis', () => {
    for (const glyph of Object.values(GLYPHS)) {
      for (const polygon of glyph)
        for (const [x, y] of polygon) {
          expect(x).toBeGreaterThanOrEqual(0)
          expect(x).toBeLessThanOrEqual(GLYPH_BOX)
          expect(y).toBeGreaterThanOrEqual(0)
          expect(y).toBeLessThanOrEqual(GLYPH_BOX)
        }
      // Symmetric: the signed distance reads the same on either side of the axis, sampled.
      for (let y = 0.5; y < GLYPH_BOX; y += 1)
        for (let x = 0.5; x < GLYPH_BOX / 2; x += 1)
          expect(signedDistance(glyph, [x, y])).toBeCloseTo(
            signedDistance(glyph, [GLYPH_BOX - x, y]),
            6,
          )
    }
    // The aircraft's nose is its topmost point, on the axis: `icon-rotate` by the heading turns
    // the nose to the course.
    const [nose] = GLYPHS.aircraft[0]
    expect(nose).toEqual([GLYPH_BOX / 2, 0.5])
    expect(GLYPHS.aircraft[0].every(([, y]) => y >= nose[1])).toBe(true)
  })

  it('reads as one plane and one quadcopter: the fuselage and the body are inside, the box corner is out', () => {
    const c = GLYPH_BOX / 2
    expect(signedDistance(GLYPHS.aircraft, [c, c])).toBeLessThan(0)
    expect(signedDistance(GLYPHS.drone, [c, c])).toBeLessThan(0)
    // A rotor disc's centre is inside the drone; the top edge's midpoint, between two discs, is
    // not — the X, not a blob.
    expect(signedDistance(GLYPHS.drone, [5.6, 5.6])).toBeLessThan(0)
    expect(signedDistance(GLYPHS.drone, [c, 2])).toBeGreaterThan(0)
    // The aircraft's wing tip is inside and the space behind the wing root is not.
    expect(signedDistance(GLYPHS.aircraft, [22, 15])).toBeLessThan(0)
    expect(signedDistance(GLYPHS.aircraft, [18, 20])).toBeGreaterThan(0)
    expect(signedDistance(GLYPHS.aircraft, [0.2, 0.2])).toBeGreaterThan(0)
  })
})

describe('signedDistance', () => {
  const square: Polygon = [
    [4, 4],
    [20, 4],
    [20, 20],
    [4, 20],
  ]

  it('is the distance to the nearest edge, negative inside, zero on the edge', () => {
    expect(signedDistance([square], [12, 12])).toBe(-8)
    expect(signedDistance([square], [5, 12])).toBe(-1)
    expect(signedDistance([square], [2, 12])).toBe(2)
    expect(signedDistance([square], [4, 12])).toBeCloseTo(0, 12)
    // Off a corner: the Euclidean distance to the vertex, not the axis gap.
    expect(signedDistance([square], [1, 0])).toBeCloseTo(5, 6)
  })

  it('takes the deepest containing polygon inside a union, so an overlap leaves no seam', () => {
    const bar: Polygon = [
      [0, 11],
      [24, 11],
      [24, 13],
      [0, 13],
    ]
    // Inside both: the square's 8 beats the bar's 1. Inside the bar alone: the bar's own edge.
    expect(signedDistance([square, bar], [12, 12])).toBe(-8)
    expect(signedDistance([square, bar], [2, 12])).toBe(-1)
    // Outside both: the nearer edge.
    expect(signedDistance([square, bar], [2, 15])).toBe(2)
  })
})

describe('glyphImage', () => {
  const square: Polygon = [
    [4, 4],
    [20, 4],
    [20, 20],
    [4, 20],
  ]

  it('encodes the distance as MapLibre reads an SDF: the edge at 191 of 255, 8 pixels of range, in alpha alone', () => {
    // A 22 px box at ratio 2: 44 px for the glyph, 7 px of margin each side.
    const image = glyphImage([square], 22, 2)
    expect(image.width).toBe(58)
    expect(image.height).toBe(58)
    const alpha = (x: number, y: number) => image.data[(y * image.width + x) * 4 + 3]
    const rgb = (x: number, y: number) =>
      [0, 1, 2].map((i) => image.data[(y * image.width + x) * 4 + i])
    // The centre pixel is deep inside: full alpha, nothing in the colour channels.
    expect(alpha(29, 29)).toBe(255)
    expect(rgb(29, 29)).toEqual([0, 0, 0])
    // A pixel 4.83 px outside the square's left edge (its centre at 2.5 px, the edge at 14.33):
    // 255 − 255 · (4.83 / 8 + 0.25) = 37. The convention the halo shader assumes.
    expect(alpha(9, 29)).toBe(37)
    // Past the 6 px reach, nothing; the corner of the image is nothing.
    expect(alpha(2, 29)).toBe(0)
    expect(alpha(0, 0)).toBe(0)
    // Walking out from the centre, the alpha falls through 191 where the geometry's edge is:
    // pixel 14 (its centre 0.17 px inside the edge at 14.33) reads 197, pixel 13 reads 165.
    const row = Array.from({ length: 30 }, (_, x) => alpha(x, 29))
    let edge = 29
    while (row[edge] >= 191) edge--
    expect(edge).toBe(13)
    expect([row[14], row[13]]).toEqual([197, 165])
  })

  it('covers the glyph’s own area: the pixels inside the edge count the union’s area at the scale', () => {
    for (const glyph of Object.values(GLYPHS)) {
      const image = glyphImage(glyph, 22, 2)
      const scale = 44 / GLYPH_BOX
      let inside = 0
      for (let i = 3; i < image.data.length; i += 4) if (image.data[i] >= 191) inside++
      // The union's area on a fine grid, by containment alone — no distance in it.
      const step = 0.1
      let cells = 0
      for (let y = step / 2; y < GLYPH_BOX; y += step)
        for (let x = step / 2; x < GLYPH_BOX; x += step)
          if (signedDistance(glyph, [x, y]) < 0) cells++
      const union = cells * step * step * scale * scale
      expect(inside / union).toBeGreaterThan(0.9)
      expect(inside / union).toBeLessThan(1.1)
    }
  })

  it('prints a polygon as SVG points', () => {
    expect(polygonPoints(square)).toBe('4,4 20,4 20,20 4,20')
  })
})
