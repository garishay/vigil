/**
 * The map's two glyphs (S9, #181): an aircraft and a quadcopter, seen from above, nose up, as
 * polygons on a 24-unit box — original, drawn here rather than imported, like the drawer's
 * silhouettes (#22). The map rasterises them into signed-distance fields for MapLibre, whose
 * `icon-color` and `icon-halo-color` paint only an SDF image, so one shape takes the band fill,
 * the identity stroke, raw's neutral, and the dim from paint exactly as the dot does; the legend
 * draws the same polygons as SVG. Pure: no canvas, no DOM, so the raster is tested directly.
 */

export type Polygon = readonly (readonly [number, number])[]

/** The glyph box, units. A glyph's union of polygons is the shape; nose up is north. */
export const GLYPH_BOX = 24

/** A regular polygon standing in for a disc, so the raster reads the rotors exactly. */
function disc(cx: number, cy: number, r: number, sides = 12): Polygon {
  return Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * 2 * Math.PI
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const
  })
}

/** A bar from the box's centre out to (x, y), `w` wide — a quadcopter's arm. */
function arm(x: number, y: number, w: number): Polygon {
  const c = GLYPH_BOX / 2
  const len = Math.hypot(x - c, y - c)
  const nx = (-(y - c) / len) * (w / 2)
  const ny = ((x - c) / len) * (w / 2)
  return [
    [c + nx, c + ny],
    [x + nx, y + ny],
    [x - nx, y - ny],
    [c - nx, c - ny],
  ]
}

/**
 * The aircraft: one outline — a slender fuselage, swept wings, a tailplane — that reads as a
 * plane at the map's working size and claims nothing finer. The drone: a body with four arms to
 * four rotor discs, the X every quadcopter is drawn as; its arms run through the body so the
 * raster's inside distance holds across the joins.
 */
export const GLYPHS: Record<'aircraft' | 'drone', readonly Polygon[]> = {
  aircraft: [
    [
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
  ],
  drone: [
    disc(12, 12, 2.5, 8),
    arm(5.6, 5.6, 1.3),
    arm(18.4, 5.6, 1.3),
    arm(5.6, 18.4, 1.3),
    arm(18.4, 18.4, 1.3),
    disc(5.6, 5.6, 1.8),
    disc(18.4, 5.6, 1.8),
    disc(5.6, 18.4, 1.8),
    disc(18.4, 18.4, 1.8),
  ],
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

/**
 * The signed distance from a point to the union's boundary, negative inside: outside, the
 * nearest polygon's edge; inside, the deepest containing polygon's — exact for one polygon and
 * for a union whose overlaps run deep, which is how the drone is drawn.
 */
export function signedDistance(polygons: readonly Polygon[], point: readonly [number, number]) {
  let inside = false
  let deepest = 0
  let nearest = Infinity
  for (const polygon of polygons) {
    const d = edgeDistance(polygon, point)
    if (contains(polygon, point)) {
      inside = true
      deepest = Math.max(deepest, d)
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
export function glyphImage(polygons: readonly Polygon[], boxPx: number, pixelRatio: number) {
  const scale = (boxPx * pixelRatio) / GLYPH_BOX
  const size = Math.ceil(GLYPH_BOX * scale) + 2 * SDF_PAD_PX
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const point = [(x + 0.5 - SDF_PAD_PX) / scale, (y + 0.5 - SDF_PAD_PX) / scale] as const
      const d = signedDistance(polygons, point) * scale
      data[(y * size + x) * 4 + 3] = Math.round(255 - 255 * (d / SDF_RADIUS_PX + SDF_CUTOFF))
    }
  }
  return { width: size, height: size, data } satisfies GlyphImage
}

/** The polygons as SVG `points` strings, for the legend and the brief. */
export const polygonPoints = (polygon: Polygon) => polygon.map(([x, y]) => `${x},${y}`).join(' ')
