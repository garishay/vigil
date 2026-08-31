/**
 * The one track shape both layers share (scope §5.1, §5.2). The map, the Queue, and the scoring
 * engine read `Track`; none of them ever sees the ADS-B feed or the inject generator underneath.
 *
 * The §2 guardrail — real aircraft are never the threat — is enforced here by the type system
 * rather than by convention. `AdsbTrack.identity` is the literal `'cooperative'`, not the
 * `Identity` union, so an ADS-B-sourced track that claims to be non-cooperative fails to compile.
 * Making it unrepresentable is the point; making it merely unlikely would not be.
 */

/** Plain English (principle 3). Vigil ships no military identification symbology — scope §9. */
export type Identity = 'cooperative' | 'non-cooperative' | 'unknown'

/**
 * FAA Remote ID as public context (scope §2), and an inject attribute only: a real aircraft's
 * cooperativity is settled by the ADS-B broadcast Vigil is already receiving from it.
 *
 * `intermittent` is the dropout case — something is identifying itself, but not reliably enough
 * to be believed. It is what makes `unknown` a state the Queue can actually display.
 */
export type RemoteIdStatus = 'broadcasting' | 'intermittent' | 'silent'

/** Scripted inject motion. The pattern features in scope §6 exist to catch exactly these. */
export type Behavior = 'transit' | 'loiter' | 'orbit' | 'lawnmower' | 'approach-retreat'

/** Everything true of any track, whichever layer produced it. */
interface TrackBase {
  /** Unique across both layers. Source-prefixed, so a real hex can never collide with an inject. */
  id: string
  /** ADS-B flight ident or inject label; null when the aircraft broadcasts no ident. */
  callsign: string | null
  /** [longitude, latitude] — GeoJSON order, matching the AO config and MapLibre. */
  position: [number, number]
  /**
   * Barometric altitude in feet, or null when the aircraft broadcast none. Zero only when
   * `onGround`, where ground level is a real reading rather than a missing one.
   *
   * Nullable on purpose: some traffic broadcasts no altitude (61 of 3,859 records in the first
   * recording; none in the current one — the feed varies by day), and scoring an unknown altitude
   * as zero would drag a real aircraft toward the low-and-slow envelope that the kinematic factor
   * reads as small-UAS behavior (§6). The null forces PR 04 to say what it means to do about an
   * unknown, whether or not the committed recording happens to contain one.
   */
  altitudeFt: number | null
  onGround: boolean
  groundSpeedKt: number
  /** Degrees true, 0–360. Null when the aircraft reports no track angle. */
  headingDeg: number | null
  /** Feet per minute, positive climbing. Null when unreported. */
  verticalRateFpm: number | null
  /** Seconds since this track last updated — the raw material for the staleness factor. */
  lastSeenSec: number
}

/**
 * What the registry says about an airframe, as opposed to what the airframe broadcast. Kept apart
 * from the observed fields so a display can label it as a lookup, and so the scoring path has
 * nothing to reach for by accident.
 *
 * Part of the track model's shape rather than the feed's, so it lives here and `adsb.ts` imports
 * it: the arrow runs adapter → model everywhere, and the header's promise above — that nothing
 * here sees the ADS-B feed underneath — holds for this file's imports too.
 */
export interface AircraftRegistry {
  typeCode?: string
  typeDesc?: string
  registration?: string
}

/** A real, publicly broadcast aircraft. Cooperative by construction; see the note above. */
export interface AdsbTrack extends TrackBase {
  source: 'adsb'
  icaoHex: string
  identity: 'cooperative'
  /**
   * Display enrichment, never scored (§5.1). `category` is the broadcast emitter category — an
   * observation. `registry` is what the aggregator's database says the airframe is registered as
   * — a lookup, shown labelled as one. Each is null when the recording carries none for this
   * track; the two null independently.
   */
  category: string | null
  registry: AircraftRegistry | null
}

/** A simulated small UAS. The only kind of track that can score as a threat. */
export interface InjectTrack extends TrackBase {
  source: 'inject'
  behavior: Behavior
  remoteId: RemoteIdStatus
  identity: Identity
}

export type Track = AdsbTrack | InjectTrack
