import { BANDS, BAND_LABEL } from '../config/scoring'
import { GLYPHS, GLYPH_BOX, GLYPH_PX, polygonPoints, type Part } from './glyphs'
import {
  BAND_COLOR,
  MARK_RING,
  OPENED_GREY,
  OPENED_MARK,
  SHAPES,
  SHAPE_LABEL,
  type TrackShape,
  type WarmBand,
} from '../lib/display'
import { IDENTITIES, IDENTITY_COLOR, IDENTITY_LABEL } from '../lib/identity'
import type { Mark } from '../lib/lifecycle'
import type { Identity } from '../lib/tracks'

/**
 * The identity swatch the Queue rows and the map legend share. One component, so the two cannot
 * disagree about what a colour means. Decorative: the plain-English label beside it carries the
 * meaning for a reader who cannot see the colour.
 */
export function IdentityDot({ identity }: { identity: Identity }) {
  return (
    <span
      className="identity-dot"
      style={{ background: IDENTITY_COLOR[identity] }}
      data-identity={identity}
      aria-hidden="true"
    />
  )
}

/**
 * The band swatch (#96): the fill an inject marker wears in that band, from the same literal the
 * map paints with, so the key and the marker cannot drift. Decorative, as the identity dot is.
 */
export function BandDot({ band }: { band: WarmBand }) {
  return (
    <span
      className="band-dot"
      style={{ background: BAND_COLOR[band] }}
      data-band={band}
      aria-hidden="true"
    />
  )
}

/** One glyph part as SVG: a polygon filled, a ring stroked at its width, the body a rounded square. */
function GlyphPart({ part }: { part: Part }) {
  switch (part.kind) {
    case 'polygon':
      return <polygon points={polygonPoints(part.points)} />
    case 'ring':
      return (
        <circle
          cx={part.center[0]}
          cy={part.center[1]}
          r={part.radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={part.width}
        />
      )
    case 'rect':
      return (
        <rect
          x={part.center[0] - part.size / 2}
          y={part.center[1] - part.size / 2}
          width={part.size}
          height={part.size}
          rx={part.corner}
        />
      )
  }
}

/** Glyph units per map pixel: the 24-unit box is drawn at `GLYPH_PX` on the map. */
const UNITS_PER_PX = GLYPH_BOX / GLYPH_PX
/** The dot's outer radius in glyph units — the 13 px circle the map draws, stroke included. */
const DOT_R = 6.5 * UNITS_PER_PX
/** The dot's stroke, which a hollowed dot keeps: the map's 2 px. */
const DOT_STROKE = 2 * UNITS_PER_PX

/**
 * The map's shape as inline SVG (S9, #181): the same parts the map rasterises, so the key and
 * the marker cannot drift; the dot is the circle the map draws. Decorative, as the dots are, and
 * the brief's legend draws with it too (S8), with the subject's own mark on the dot (S8-ii,
 * ruled R1): **assessed** is the faint ring about it, in the map's own pixels scaled to the
 * box; **handled** is the dot drawn hollow at its own size — the fill gone, the stroke kept.
 */
export function ShapeGlyph({
  shape,
  mark,
  warning = false,
}: {
  shape: TrackShape
  mark?: Mark
  /** Vigil's one colour in a run (S9b): the marker at warning, drawn in the warning colour. */
  warning?: boolean
}) {
  const c = GLYPH_BOX / 2
  // The opened mark as the run paints it (S9b): the grey on the marker itself, or the ring.
  const opened = mark === 'assessed'
  const ink = warning
    ? BAND_COLOR.warning
    : opened && OPENED_MARK === 'grey'
      ? OPENED_GREY
      : undefined
  return (
    <svg
      className="shape-glyph"
      viewBox={`0 0 ${GLYPH_BOX} ${GLYPH_BOX}`}
      data-shape={shape}
      data-mark={mark}
      data-warning={warning || undefined}
      aria-hidden="true"
      style={ink ? { color: ink } : undefined}
    >
      {shape !== 'dot' ? (
        GLYPHS[shape].map((part, i) => <GlyphPart key={i} part={part} />)
      ) : mark === 'handled' ? (
        <circle
          cx={c}
          cy={c}
          r={DOT_R - DOT_STROKE / 2}
          fill="none"
          stroke="currentColor"
          strokeWidth={DOT_STROKE}
        />
      ) : (
        <circle cx={c} cy={c} r={DOT_R} />
      )}
      {opened && OPENED_MARK === 'ring' && (
        <circle
          cx={c}
          cy={c}
          // The map paints `circle-stroke-width` outside `circle-radius`, so the ring's
          // mid-stroke sits half a stroke out from `radiusPx`; an SVG stroke straddles its
          // path, so the radius carries that half here — the dot's own hollowing does the
          // same, and the legend keeps the marker's outer edge.
          r={(MARK_RING.radiusPx + MARK_RING.widthPx / 2) * UNITS_PER_PX}
          fill="none"
          stroke={MARK_RING.color}
          strokeWidth={MARK_RING.widthPx * UNITS_PER_PX}
          strokeOpacity={MARK_RING.opacity}
        />
      )}
    </svg>
  )
}

/** The bands that have a swatch, in band order — calm is the marker's default and has none. */
const WARM_BANDS = BANDS.filter((band): band is WarmBand => band !== 'calm')

/**
 * The three shapes first — what a track said about itself (S9) — then the three identity states
 * in queue order and the two warm bands beside them (#96), what Vigil made of it, in a map
 * corner. Visible on every surface, which matters on Home — there is no Queue there to read the
 * colours from.
 */
export function IdentityLegend() {
  return (
    <div className="legend" role="group" aria-label="Map legend">
      <ul className="legend__group" aria-label="Shape legend">
        {SHAPES.map((shape) => (
          <li key={shape} className="legend__item">
            <ShapeGlyph shape={shape} />
            {SHAPE_LABEL[shape]}
          </li>
        ))}
      </ul>
      <ul className="legend__group" aria-label="Identity legend">
        {IDENTITIES.map((identity) => (
          <li key={identity} className="legend__item">
            <IdentityDot identity={identity} />
            {IDENTITY_LABEL[identity]}
          </li>
        ))}
      </ul>
      <ul className="legend__group" aria-label="Band legend">
        {WARM_BANDS.map((band) => (
          <li key={band} className="legend__item">
            <BandDot band={band} />
            {BAND_LABEL[band]}
          </li>
        ))}
      </ul>
    </div>
  )
}
