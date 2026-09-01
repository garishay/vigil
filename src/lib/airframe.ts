/**
 * Which silhouette a track earns, and on what basis (scope §7, #22). Pure — a function of the
 * track and the tables in `config/airframes.ts`; nothing here is scored or ranked.
 *
 * The basis is the point. A silhouette is a claim about the airframe, and the caption says what
 * the claim rests on, in priority order: a **type code** (a registry lookup — refines the
 * category where one is known), the broadcast **emitter category** (an observation), a heard
 * **Remote ID UA type** (an observation, present only on frames the broadcast is heard), or the
 * **observed envelope** — a track with no broadcast basis at all that is flying low and slow
 * reads "small UAS (kinematic class)", labelled as such. Nothing from `behavior` or `remoteId`
 * enters here: those are the answer key (§7).
 *
 * The kinematic class applies only where there is no broadcast at all (ruled on #22). An ADS-B
 * track with neither category nor type is broadcasting its position, and reads *unknown
 * airframe* rather than wearing a small-UAS label it never earned.
 */

import {
  AIRFRAME_LABEL,
  EMITTER_CATEGORIES,
  KINEMATIC_CLASS,
  TYPE_CODE_AIRFRAME,
  type Airframe,
} from '../config/airframes.ts'
import type { Track, UaType } from './tracks.ts'

export type AirframeBasis = 'type-code' | 'emitter-category' | 'ua-type' | 'kinematic' | 'none'

export interface AirframeClass {
  /** The glyph. */
  airframe: Airframe
  /** The class line — `AIRFRAME_LABEL`, or the kinematic class's own label. */
  label: string
  basis: AirframeBasis
  /** The basis line: what the silhouette rests on, in the words the mockup fixed. */
  caption: string
}

/** ASTM F3411 UA-type names, as the caption prints them. */
const UA_TYPE_NAME: Record<UaType, string> = {
  multirotor: 'helicopter or multirotor',
  aeroplane: 'aeroplane',
  'hybrid-lift': 'hybrid lift',
}

/** Hybrid lift draws the fixed-wing glyph; the caption still names the type it heard. */
const UA_TYPE_AIRFRAME: Record<UaType, Airframe> = {
  multirotor: 'small-multirotor',
  aeroplane: 'fixed-wing-uas',
  'hybrid-lift': 'fixed-wing-uas',
}

const labelled = (airframe: Airframe, basis: AirframeBasis, caption: string): AirframeClass => ({
  airframe,
  label: AIRFRAME_LABEL[airframe],
  basis,
  caption,
})

/** An emitter category as the drawer's row prints it: the code, its name where known, provenance. */
export function describeCategory(code: string): string {
  const name = EMITTER_CATEGORIES[code]?.name
  return name ? `${code} — ${name} (broadcast)` : `${code} (broadcast)`
}

export function classify(track: Track): AirframeClass {
  if (track.source === 'adsb') {
    const typeCode = track.registry?.typeCode
    const byType = typeCode ? TYPE_CODE_AIRFRAME.get(typeCode) : undefined
    if (typeCode && byType) {
      return labelled(byType, 'type-code', `from type code ${typeCode} (registry lookup)`)
    }
    if (track.category) {
      const entry = EMITTER_CATEGORIES[track.category]
      return labelled(
        entry?.airframe ?? 'unknown',
        'emitter-category',
        `from emitter category ${describeCategory(track.category)}`,
      )
    }
    return labelled(
      'unknown',
      'none',
      typeCode
        ? `type code ${typeCode} not in the class table; no emitter category broadcast`
        : 'no emitter category broadcast, no registry type',
    )
  }

  if (track.uaType) {
    return labelled(
      UA_TYPE_AIRFRAME[track.uaType],
      'ua-type',
      `from Remote ID UA type — ${UA_TYPE_NAME[track.uaType]} (heard this frame)`,
    )
  }
  const { altitudeFt, groundSpeedKt } = track
  const lowAndSlow =
    altitudeFt !== null &&
    groundSpeedKt !== null &&
    altitudeFt <= KINEMATIC_CLASS.maxAltitudeFt &&
    groundSpeedKt <= KINEMATIC_CLASS.maxGroundSpeedKt
  if (lowAndSlow) {
    return {
      airframe: 'unknown',
      label: 'Small UAS (kinematic class)',
      basis: 'kinematic',
      caption: `from the observed envelope — ${altitudeFt} ft, ${groundSpeedKt} kt; no ident heard`,
    }
  }
  return labelled('unknown', 'none', 'no ident heard; outside the small-UAS envelope')
}
