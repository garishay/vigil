import { describe, expect, it } from 'vitest'
import {
  DRONE,
  GLYPHS,
  GLYPH_BOX,
  MARKS,
  glyphImage,
  polygonPoints,
  signedDistance,
  type Part,
  type Polygon,
} from './glyphs'

/** A drone measure at the cut, as the geometry applies it. */
const cut = (units: number) => units * DRONE.scale

/** A part's extent on each axis, for the box check. */
function extent(part: Part): [number, number, number, number] {
  switch (part.kind) {
    case 'polygon': {
      const xs = part.points.map(([x]) => x)
      const ys = part.points.map(([, y]) => y)
      return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    }
    case 'ring': {
      const r = part.radius + part.width / 2
      return [part.center[0] - r, part.center[0] + r, part.center[1] - r, part.center[1] + r]
    }
    case 'rect': {
      const h = part.size / 2
      return [part.center[0] - h, part.center[0] + h, part.center[1] - h, part.center[1] + h]
    }
  }
}

describe('the two glyphs (S9, #181)', () => {
  it('sit inside the 24-unit box, nose up, mirrored about the vertical axis', () => {
    for (const glyph of Object.values(GLYPHS)) {
      for (const part of glyph) {
        const [x0, x1, y0, y1] = extent(part)
        expect(x0).toBeGreaterThanOrEqual(0)
        expect(x1).toBeLessThanOrEqual(GLYPH_BOX)
        expect(y0).toBeGreaterThanOrEqual(0)
        expect(y1).toBeLessThanOrEqual(GLYPH_BOX)
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
    const [outline] = GLYPHS.aircraft
    if (outline.kind !== 'polygon') throw new Error('the aircraft is one outline')
    const [nose] = outline.points
    expect(nose).toEqual([GLYPH_BOX / 2, 0.5])
    expect(outline.points.every(([, y]) => y >= nose[1])).toBe(true)
  })

  it('reads as one plane and one quadcopter: the rotors are open rings, the body solid, the arms bridge them (R1)', () => {
    const c = GLYPH_BOX / 2
    expect(signedDistance(GLYPHS.aircraft, [c, c])).toBeLessThan(0)
    // The body's centre is inside; a rotor's band is inside and its hole is not — a ring, not a
    // disc; the top edge's midpoint between two rotors is not; an arm's midpoint is.
    const at = cut(DRONE.rotorAt)
    expect(signedDistance(GLYPHS.drone, [c, c])).toBeLessThan(0)
    expect(signedDistance(GLYPHS.drone, [c - at + cut(DRONE.rotorRadius), c - at])).toBeLessThan(0)
    expect(signedDistance(GLYPHS.drone, [c - at, c - at])).toBeGreaterThan(0)
    expect(signedDistance(GLYPHS.drone, [c, 2])).toBeGreaterThan(0)
    expect(signedDistance(GLYPHS.drone, [c - cut(3.3), c - cut(3.3)])).toBeLessThan(0)
    // The arm reaches from inside the body to inside the ring's band: no gap on the diagonal
    // out to the band (axis offset 3.57 to 4.59 at the cut), then the hole, then the far band.
    for (let d = 2; d <= 4.5; d += 0.25)
      expect([d, signedDistance(GLYPHS.drone, [c - d, c - d]) < 0]).toEqual([d, true])
    expect(signedDistance(GLYPHS.drone, [c - 5.5, c - 5.5])).toBeGreaterThan(0)
    expect(signedDistance(GLYPHS.drone, [c - 8, c - 8])).toBeLessThan(0)
    // The aircraft's wing tip is inside and the space behind the wing root is not.
    expect(signedDistance(GLYPHS.aircraft, [22, 15])).toBeLessThan(0)
    expect(signedDistance(GLYPHS.aircraft, [18, 20])).toBeGreaterThan(0)
    expect(signedDistance(GLYPHS.aircraft, [0.2, 0.2])).toBeGreaterThan(0)
  })

  it('draws the drone as the owner’s note has it — rings at ±6.8, radius 3.2, width 1.6; a 5.5 body; arms from 2.4 to 4.2 — cut at 0.9 (#186)', () => {
    const c = GLYPH_BOX / 2
    expect(DRONE).toMatchObject({
      scale: 0.9,
      rotorAt: 6.8,
      rotorRadius: 3.2,
      rotorWidth: 1.6,
      body: 5.5,
      bodyCorner: 1.2,
      arm: [2.4, 4.2],
      armWidth: 1.5,
    })
    const rings = GLYPHS.drone.filter((part) => part.kind === 'ring')
    expect(rings).toHaveLength(4)
    for (const ring of rings) {
      if (ring.kind !== 'ring') throw new Error('ring')
      expect(Math.abs(ring.center[0] - c)).toBeCloseTo(6.12, 9)
      expect(Math.abs(ring.center[1] - c)).toBeCloseTo(6.12, 9)
      expect(ring.radius).toBeCloseTo(2.88, 9)
      expect(ring.width).toBeCloseTo(1.44, 9)
    }
    const [body] = GLYPHS.drone
    if (body.kind !== 'rect') throw new Error('body')
    expect(body.center).toEqual([c, c])
    expect(body.size).toBeCloseTo(4.95, 9)
    expect(body.corner).toBeCloseTo(1.08, 9)
    const arms = GLYPHS.drone.filter((part) => part.kind === 'polygon')
    expect(arms).toHaveLength(4)
    // The full extent at the cut: 2 · (6.12 + 2.88 + 0.72) = 19.44 units, 17.8 px at the 22 px box.
    const [x0, x1] = extent(rings[0])
    expect(Math.min(x0, GLYPH_BOX - x1)).toBeCloseTo((GLYPH_BOX - 19.44) / 2, 9)
  })
})

describe('the mark (S10, #182; the tick removed by S10b, #211)', () => {
  it('is the arrowhead alone, inside the box, its tip at the top on the axis, mirrored about it', () => {
    expect(Object.keys(MARKS)).toEqual(['arrow'])
    for (const part of MARKS.arrow) {
      const [x0, x1, y0, y1] = extent(part)
      expect([x0 >= 0, x1 <= GLYPH_BOX, y0 >= 0, y1 <= GLYPH_BOX]).toEqual([true, true, true, true])
    }
    const [head] = MARKS.arrow
    if (head.kind !== 'polygon') throw new Error('head')
    expect(head.points[0]).toEqual([GLYPH_BOX / 2, 0.5])
    expect(head.points.every(([, y]) => y >= 0.5)).toBe(true)
    // Mirrored about the axis, as the glyphs are: it is drawn along a bearing, so an asymmetry
    // would read as a turn.
    for (let y = 0.5; y < GLYPH_BOX; y += 1)
      for (let x = 0.5; x < GLYPH_BOX / 2; x += 1)
        expect(signedDistance(MARKS.arrow, [x, y])).toBeCloseTo(
          signedDistance(MARKS.arrow, [GLYPH_BOX - x, y]),
          6,
        )
  })
})

describe('signedDistance', () => {
  const square: Part = {
    kind: 'polygon',
    points: [
      [4, 4],
      [20, 4],
      [20, 20],
      [4, 20],
    ],
  }

  it('is the distance to the nearest edge, negative inside, zero on the edge', () => {
    expect(signedDistance([square], [12, 12])).toBe(-8)
    expect(signedDistance([square], [5, 12])).toBe(-1)
    expect(signedDistance([square], [2, 12])).toBe(2)
    expect(signedDistance([square], [4, 12])).toBeCloseTo(0, 12)
    // Off a corner: the Euclidean distance to the vertex, not the axis gap.
    expect(signedDistance([square], [1, 0])).toBeCloseTo(5, 6)
  })

  it('reads a ring as a band about its circle, its hole outside, and a rounded square by its corner', () => {
    const ring: Part = { kind: 'ring', center: [12, 12], radius: 5, width: 2 }
    expect(signedDistance([ring], [12, 12])).toBe(4)
    expect(signedDistance([ring], [17, 12])).toBe(-1)
    expect(signedDistance([ring], [18, 12])).toBeCloseTo(0, 12)
    expect(signedDistance([ring], [19, 12])).toBe(1)
    const rect: Part = { kind: 'rect', center: [12, 12], size: 6, corner: 1 }
    expect(signedDistance([rect], [12, 12])).toBe(-3)
    expect(signedDistance([rect], [16, 12])).toBe(1)
    // The corner is rounded: the square's corner point is outside by the rounding.
    expect(signedDistance([rect], [15, 15])).toBeCloseTo(Math.SQRT2 * 1 - 1, 6)
  })

  it('takes the deepest containing part inside a union, so an overlap leaves no seam', () => {
    const bar: Part = {
      kind: 'polygon',
      points: [
        [0, 11],
        [24, 11],
        [24, 13],
        [0, 13],
      ],
    }
    // Inside both: the square's 8 beats the bar's 1. Inside the bar alone: the bar's own edge.
    expect(signedDistance([square, bar], [12, 12])).toBe(-8)
    expect(signedDistance([square, bar], [2, 12])).toBe(-1)
    // Outside both: the nearer edge.
    expect(signedDistance([square, bar], [2, 15])).toBe(2)
  })
})

describe('glyphImage', () => {
  const square: Part = {
    kind: 'polygon',
    points: [
      [4, 4],
      [20, 4],
      [20, 20],
      [4, 20],
    ],
  }

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

  it('keeps a rotor’s hole open at device scale 1 and 2 — 3.96 and 7.92 px across, no stroke narrowing it (#186)', () => {
    // The hole's diameter in units is twice the ring's inner radius: 2 · (2.88 − 0.72) = 4.32,
    // which the 22 px box draws at 3.96 screen px; at ratio 2 the image holds it at 7.92 px.
    const hole = 2 * (cut(DRONE.rotorRadius) - cut(DRONE.rotorWidth) / 2)
    expect(hole).toBeCloseTo(4.32, 9)
    expect((hole * 22) / GLYPH_BOX).toBeCloseTo(3.96, 9)
    for (const ratio of [1, 2]) {
      const image = glyphImage(GLYPHS.drone, 22, ratio)
      const scale = (22 * ratio) / GLYPH_BOX
      const alpha = (x: number, y: number) => image.data[(y * image.width + x) * 4 + 3]
      // The top-left rotor's centre, as a pixel index on both axes (its centre sits on the
      // diagonal); the hole's centre pixel and its four neighbours read outside the edge, so
      // the hole is at least three pixels across as drawn, and the band beside it reads inside.
      const centre = Math.round(7 + (GLYPH_BOX / 2 - cut(DRONE.rotorAt)) * scale - 0.5)
      const around = [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]
      expect(around.map(([dx, dy]) => alpha(centre + dx, centre + dy) < 191)).toEqual(
        around.map(() => true),
      )
      const band = Math.round(centre + cut(DRONE.rotorRadius) * scale)
      expect(alpha(band, centre)).toBeGreaterThanOrEqual(191)
    }
  })

  it('prints a polygon as SVG points', () => {
    const polygon: Polygon = [
      [4, 4],
      [20, 4],
    ]
    expect(polygonPoints(polygon)).toBe('4,4 20,4')
  })
})
