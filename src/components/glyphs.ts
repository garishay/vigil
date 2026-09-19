/**
 * The map's two glyphs (S9, #181): an aircraft and a quadcopter, seen from above, nose up, on a
 * 24-unit box — original, drawn here rather than imported, like the drawer's silhouettes (#22).
 * The map rasterises them into signed-distance fields for MapLibre, whose `icon-color` and
 * `icon-halo-color` paint only an SDF image, so one shape takes the band fill, the identity
 * stroke, raw's neutral, and the dim from paint exactly as the dot does; the legend draws the
 * same parts as SVG. Pure: no canvas, no DOM, so the raster is tested directly.
 */

export type Polygon = readonly (readonly [number, number])[]

/**
 * A glyph is the union of its parts: a polygon; an open ring, drawn as a band of `width` about
 * a circle of `radius` (R1 on #181: a rotor is a ring, so it carries the shape without the ink
 * a disc spends); a square with rounded corners.
 */
export type Part =
  | { readonly kind: 'polygon'; readonly points: Polygon }
  | {
      readonly kind: 'ring'
      readonly center: readonly [number, number]
      readonly radius: number
      readonly width: number
    }
  | {
      readonly kind: 'rect'
      readonly center: readonly [number, number]
      readonly size: number
      readonly corner: number
    }

/** The glyph box, units. A glyph's union of parts is the shape; nose up is north. */
export const GLYPH_BOX = 24
const C = GLYPH_BOX / 2

/**
 * The glyphs' box on screen, pixels (S9, #181): one visual weight across the three shapes — the
 * plain dot is 13 px across with its stroke, and a silhouette needs a wider box to carry the
 * same ink. The map rasterises at it; the legend scales a mark drawn in map pixels by it.
 */
export const GLYPH_PX = 22

/** A bar between two points, `w` wide — a quadcopter's arm, bridging the body to a rotor. */
function bar(from: readonly [number, number], to: readonly [number, number], w: number): Part {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1])
  const nx = (-(to[1] - from[1]) / len) * (w / 2)
  const ny = ((to[0] - from[0]) / len) * (w / 2)
  return {
    kind: 'polygon',
    points: [
      [from[0] + nx, from[1] + ny],
      [to[0] + nx, to[1] + ny],
      [to[0] - nx, to[1] - ny],
      [from[0] - nx, from[1] - ny],
    ],
  }
}

/**
 * The drone's geometry, in units from the box's centre, as the owner's note on #181 (R1) has it:
 * four open rings at the corners, a small solid body, and arms no longer than the gap between
 * the two — the rotors carry the shape. `rotorAt` is a rotor's centre on each axis, `arm` the
 * arm's run along each axis. `scale` cuts the whole at 0.9 of the note (ruled on #186): at the
 * note's size the heard drones out-inked the dots they sit among, and the hole stays open
 * without a stroke to narrow it.
 */
export const DRONE = {
  scale: 0.9,
  rotorAt: 6.8,
  rotorRadius: 3.2,
  rotorWidth: 1.6,
  body: 5.5,
  bodyCorner: 1.2,
  arm: [2.4, 4.2] as const,
  armWidth: 1.5,
} as const

/** A drone measure at the cut. */
const cut = (units: number) => units * DRONE.scale

/** The four corners' signs, for the rotors and the arms. */
const CORNERS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
]

/**
 * The aircraft: one outline — a slender fuselage, swept wings, a tailplane — that reads as a
 * plane at the map's working size and claims nothing finer. The drone: the body, the four arms,
 * the four rotor rings.
 */
export const GLYPHS: Record<'aircraft' | 'drone', readonly Part[]> = {
  aircraft: [
    {
      kind: 'polygon',
      points: [
        [12, 0.5],
        [13.8, 3.4],
        [13.8, 8],
        [23.5, 13.2],
        [23.5, 16.4],
        [13.8, 12.8],
        [13.8, 18.2],
        [17.6, 21.2],
        [17.6, 23.5],
        [13.2, 22.4],
        [12, 23.5],
        [10.8, 22.4],
        [6.4, 23.5],
        [6.4, 21.2],
        [10.2, 18.2],
        [10.2, 12.8],
        [0.5, 16.4],
        [0.5, 13.2],
        [10.2, 8],
        [10.2, 3.4],
      ],
    },
  ],
  drone: [
    { kind: 'rect', center: [C, C], size: cut(DRONE.body), corner: cut(DRONE.bodyCorner) },
    ...CORNERS.map(([sx, sy]) =>
      bar(
        [C + sx * cut(DRONE.arm[0]), C + sy * cut(DRONE.arm[0])],
        [C + sx * cut(DRONE.arm[1]), C + sy * cut(DRONE.arm[1])],
        cut(DRONE.armWidth),
      ),
    ),
    ...CORNERS.map(([sx, sy]): Part => ({
      kind: 'ring',
      center: [C + sx * cut(DRONE.rotorAt), C + sy * cut(DRONE.rotorAt)],
      radius: cut(DRONE.rotorRadius),
      width: cut(DRONE.rotorWidth),
    })),
  ],
}

/**
 * The map's two marks (S10, #182), on the same box and raster as the glyphs: the heading tick,
 * a bar the box's full height, drawn in raw at one screen length from a marker's edge along
 * the observed heading; the arrowhead the projected path ends in where it meets the ring, its
 * tip at the top of the box so the anchor is the tip.
 */
export const MARKS: Record<'tick' | 'arrow', readonly Part[]> = {
  tick: [
    {
      kind: 'polygon',
      points: [
        [10.5, 0],
        [13.5, 0],
        [13.5, 24],
        [10.5, 24],
      ],
    },
  ],
  arrow: [
    {
      kind: 'polygon',
      points: [
        [12, 0.5],
        [21, 20],
        [12, 15],
        [3, 20],
      ],
    },
  ],
}

/** The drone's full extent on the box, units — its width across an axis. */
export const DRONE_EXTENT =
  2 * (cut(DRONE.rotorAt) + cut(DRONE.rotorRadius) + cut(DRONE.rotorWidth) / 2)

/**
 * How far a glyph's ink reaches from the box's centre along a heading, units (#192, ruled 2):
 * the last point on that ray inside the union, to a twentieth of a unit. The drone is drawn
 * nose-up while raw's tick swings round it, so where the tick starts is this reach along the
 * tick's own heading — the body's edge on an axis, where the ray passes between two rotors,
 * and a rotor's far edge on a diagonal.
 */
export function reachAlong(parts: readonly Part[], headingDeg: number): number {
  const rad = (headingDeg * Math.PI) / 180
  const ux = Math.sin(rad)
  const uy = -Math.cos(rad)
  let reach = 0
  for (let t = 0; t <= C * Math.SQRT2; t += 0.05) {
    if (signedDistance(parts, [C + ux * t, C + uy * t]) < 0) reach = t
  }
  return reach
}

/** Even-odd ray cast: whether the point is inside the polygon. */
function contains(polygon: Polygon, [px, py]: readonly [number, number]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** The distance from the point to the polygon's nearest edge. */
function edgeDistance(polygon: Polygon, [px, py]: readonly [number, number]): number {
  let best = Infinity
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[j]
    const [bx, by] = polygon[i]
    const dx = bx - ax
    const dy = by - ay
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)))
  }
  return best
}

/** One part's signed distance: negative inside, the distance to its boundary either way. */
function partDistance(part: Part, [px, py]: readonly [number, number]): number {
  switch (part.kind) {
    case 'polygon':
      return (contains(part.points, [px, py]) ? -1 : 1) * edgeDistance(part.points, [px, py])
    case 'ring':
      return (
        Math.abs(Math.hypot(px - part.center[0], py - part.center[1]) - part.radius) -
        part.width / 2
      )
    case 'rect': {
      const qx = Math.abs(px - part.center[0]) - (part.size / 2 - part.corner)
      const qy = Math.abs(py - part.center[1]) - (part.size / 2 - part.corner)
      return (
        Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - part.corner
      )
    }
  }
}

/**
 * The signed distance from a point to the union's boundary, negative inside: outside, the
 * nearest part's boundary; inside, the deepest containing part's — exact for one part and for a
 * union whose overlaps run deep, which is how the drone's arms meet its body and its rings.
 */
export function signedDistance(parts: readonly Part[], point: readonly [number, number]) {
  let inside = false
  let deepest = 0
  let nearest = Infinity
  for (const part of parts) {
    const d = partDistance(part, point)
    if (d < 0) {
      inside = true
      deepest = Math.max(deepest, -d)
    } else {
      nearest = Math.min(nearest, d)
    }
  }
  return inside ? -deepest : nearest
}

/**
 * The SDF's encoding, MapLibre's own (its sprite convention, via TinySDF): the edge at alpha
 * 191 of 255, 8 image pixels of distance across the range, so a halo can reach 6 pixels out.
 */
const SDF_RADIUS_PX = 8
const SDF_CUTOFF = 0.25
/** Image pixels around the glyph box: the halo's reach, plus a pixel of margin. */
const SDF_PAD_PX = 7

export interface GlyphImage {
  width: number
  height: number
  data: Uint8ClampedArray
}

/**
 * The glyph as an SDF image for `map.addImage(id, image, { sdf: true, pixelRatio })`: the box
 * drawn `boxPx` screen pixels wide at the given ratio, the distance in the alpha channel and
 * nothing in the colour channels, since paint supplies the colour.
 */
export function glyphImage(parts: readonly Part[], boxPx: number, pixelRatio: number) {
  const scale = (boxPx * pixelRatio) / GLYPH_BOX
  const size = Math.ceil(GLYPH_BOX * scale) + 2 * SDF_PAD_PX
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const point = [(x + 0.5 - SDF_PAD_PX) / scale, (y + 0.5 - SDF_PAD_PX) / scale] as const
      const d = signedDistance(parts, point) * scale
      data[(y * size + x) * 4 + 3] = Math.round(255 - 255 * (d / SDF_RADIUS_PX + SDF_CUTOFF))
    }
  }
  return { width: size, height: size, data } satisfies GlyphImage
}

/** A polygon as an SVG `points` string, for the legend and the brief. */
export const polygonPoints = (polygon: Polygon) => polygon.map(([x, y]) => `${x},${y}`).join(' ')
