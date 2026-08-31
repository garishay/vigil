import { useEffect, useRef, useState } from 'react'
import { Map as MapLibreMap, NavigationControl } from 'maplibre-gl'
import type { ExpressionSpecification, GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import '../lib/maplibreWorker'
import { IdentityLegend } from './IdentityDot'
import type { AreaOfOperations } from '../config/ao'
import { circlePolygon } from '../lib/geo'
import { IDENTITY_COLOR } from '../lib/identity'
import type { AdsbTrack, InjectTrack } from '../lib/tracks'

const SITES_SOURCE = 'protected-sites'
const ADSB_SOURCE = 'adsb-tracks'
const INJECT_SOURCE = 'inject-tracks'
const SELECT_SOURCE = 'selected-track'

/** Zero or one point: the selected track's position, or an empty collection. */
function selectionFeature(position: [number, number] | null) {
  return {
    type: 'FeatureCollection' as const,
    features: position
      ? [
          {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: position },
            properties: {},
          },
        ]
      : [],
  }
}

/** Mirrors --accent in the theme; MapLibre paint properties take literals, not CSS variables. */
const RING_COLOR = '#4c9aff'

/**
 * Cooperative traffic is drawn small, cool, and quiet on purpose (§3): it is the calm background
 * the injects have to stand out against. The warm end of the palette stays unspent so alarm color
 * remains something a score has to earn.
 */
const ADSB_COLOR = '#8fa3bf'

/**
 * Injects are prominent by size, brightness, and a halo — never by warmth. Their stroke carries
 * the *observed* identity, so a Remote ID track that goes quiet visibly changes state on the map
 * (§5.2). The palette is the one the Queue rows and the legend draw from, so the three states
 * read the same everywhere on screen.
 */
const IDENTITY_STROKE: ExpressionSpecification = [
  'match',
  ['get', 'identity'],
  'cooperative',
  IDENTITY_COLOR.cooperative,
  'unknown',
  IDENTITY_COLOR.unknown,
  IDENTITY_COLOR['non-cooperative'],
]

function trackFeatures(tracks: AdsbTrack[]) {
  return {
    type: 'FeatureCollection' as const,
    features: tracks.map((track) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: track.position },
      properties: { id: track.id, callsign: track.callsign ?? '', onGround: track.onGround },
    })),
  }
}

function injectFeatures(tracks: InjectTrack[]) {
  return {
    type: 'FeatureCollection' as const,
    features: tracks.map((track) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: track.position },
      properties: {
        id: track.id,
        callsign: track.callsign ?? '',
        identity: track.identity,
        behavior: track.behavior,
        remoteId: track.remoteId,
      },
    })),
  }
}

/**
 * The persistent map canvas. Mounted once for the life of the app — switching surfaces must not
 * remount it, because rebuilding a MapLibre map is expensive and throws away the operator's view.
 */
export function MapView({
  ao,
  tracks = [],
  injects = [],
  selectedId = null,
  onSelect,
}: {
  ao: AreaOfOperations
  tracks?: AdsbTrack[]
  injects?: InjectTrack[]
  selectedId?: string | null
  onSelect?: (id: string) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [styleReady, setStyleReady] = useState(false)
  // The click handlers are registered once, inside the load effect; the ref keeps them reading
  // the current callback instead of the one that existed when the map was built.
  const onSelectRef = useRef(onSelect)
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])
  // Ease only when the selection itself changes — not when the same track's data refreshes.
  const easedIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!container.current) return
    const map = new MapLibreMap({
      container: container.current,
      style: ao.basemapStyleUrl,
      center: ao.center,
      zoom: ao.zoom,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')

    map.on('load', () => {
      map.addSource(SITES_SOURCE, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: ao.protectedSites.map((site) =>
            circlePolygon(site.center, site.radiusM, { id: site.id, name: site.name }),
          ),
        },
      })
      map.addLayer({
        id: `${SITES_SOURCE}-fill`,
        type: 'fill',
        source: SITES_SOURCE,
        paint: { 'fill-color': RING_COLOR, 'fill-opacity': 0.08 },
      })
      map.addLayer({
        id: `${SITES_SOURCE}-line`,
        type: 'line',
        source: SITES_SOURCE,
        paint: { 'line-color': RING_COLOR, 'line-width': 1.5, 'line-opacity': 0.7 },
      })

      // Added empty and fed by the effect below, so track updates never rebuild the layer.
      map.addSource(ADSB_SOURCE, { type: 'geojson', data: trackFeatures([]) })
      map.addLayer({
        id: `${ADSB_SOURCE}-dot`,
        type: 'circle',
        source: ADSB_SOURCE,
        paint: {
          'circle-radius': ['case', ['get', 'onGround'], 1.8, 2.8],
          'circle-color': ADSB_COLOR,
          'circle-opacity': ['case', ['get', 'onGround'], 0.4, 0.8],
          'circle-stroke-width': 0.5,
          'circle-stroke-color': ADSB_COLOR,
          'circle-stroke-opacity': 0.35,
        },
      })
      // Added last, so injects draw above cooperative traffic rather than under it.
      map.addSource(INJECT_SOURCE, { type: 'geojson', data: injectFeatures([]) })
      map.addLayer({
        id: `${INJECT_SOURCE}-halo`,
        type: 'circle',
        source: INJECT_SOURCE,
        paint: {
          'circle-radius': 11,
          'circle-color': IDENTITY_STROKE,
          'circle-opacity': 0.14,
          'circle-blur': 0.6,
        },
      })
      map.addLayer({
        id: `${INJECT_SOURCE}-dot`,
        type: 'circle',
        source: INJECT_SOURCE,
        paint: {
          'circle-radius': 4.5,
          'circle-color': '#f2f6fc',
          'circle-opacity': 0.95,
          'circle-stroke-width': 2,
          'circle-stroke-color': IDENTITY_STROKE,
        },
      })

      // The selection ring rides its own source, above everything, and holds zero or one point.
      map.addSource(SELECT_SOURCE, { type: 'geojson', data: selectionFeature(null) })
      map.addLayer({
        id: `${SELECT_SOURCE}-ring`,
        type: 'circle',
        source: SELECT_SOURCE,
        paint: {
          'circle-radius': 13,
          'circle-opacity': 0,
          'circle-stroke-width': 2,
          'circle-stroke-color': RING_COLOR,
        },
      })

      // Selection flows both ways (§7): a dot click selects the track, exactly as a row click
      // does. Registered per dot layer, so empty basemap clicks select nothing.
      for (const layerId of [`${ADSB_SOURCE}-dot`, `${INJECT_SOURCE}-dot`]) {
        map.on('click', layerId, (event) => {
          const id = event.features?.[0]?.properties?.id as unknown
          if (typeof id === 'string') onSelectRef.current?.(id)
        })
      }

      setStyleReady(true)
    })

    return () => {
      mapRef.current = null
      setStyleReady(false)
      map.remove()
    }
  }, [ao])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    map.getSource<GeoJSONSource>(ADSB_SOURCE)?.setData(trackFeatures(tracks))
  }, [tracks, styleReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    map.getSource<GeoJSONSource>(INJECT_SOURCE)?.setData(injectFeatures(injects))
  }, [injects, styleReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    const selected =
      (selectedId && [...tracks, ...injects].find((track) => track.id === selectedId)) || null
    map
      .getSource<GeoJSONSource>(SELECT_SOURCE)
      ?.setData(selectionFeature(selected?.position ?? null))
    if (selected && selectedId !== easedIdRef.current) {
      map.easeTo({ center: selected.position, duration: 600 })
    }
    easedIdRef.current = selectedId
  }, [selectedId, tracks, injects, styleReady])

  return (
    <div className="map-frame">
      <div
        className="map"
        ref={container}
        role="application"
        aria-label={`Airspace map centered on ${ao.name}`}
      />
      <IdentityLegend />
    </div>
  )
}
