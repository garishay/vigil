import { useEffect, useRef, useState } from 'react'
import { Map as MapLibreMap, NavigationControl } from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import '../lib/maplibreWorker'
import type { AreaOfOperations } from '../config/ao'
import { circlePolygon } from '../lib/geo'
import type { AdsbTrack } from '../lib/tracks'

const SITES_SOURCE = 'protected-sites'
const ADSB_SOURCE = 'adsb-tracks'

/** Mirrors --accent in the theme; MapLibre paint properties take literals, not CSS variables. */
const RING_COLOR = '#4c9aff'

/**
 * Cooperative traffic is drawn small, cool, and quiet on purpose (§3): it is the calm background
 * the injects have to stand out against. The warm end of the palette stays unspent so alarm color
 * remains something a score has to earn.
 */
const ADSB_COLOR = '#8fa3bf'

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

/**
 * The persistent map canvas. Mounted once for the life of the app — switching surfaces must not
 * remount it, because rebuilding a MapLibre map is expensive and throws away the operator's view.
 */
export function MapView({ ao, tracks = [] }: { ao: AreaOfOperations; tracks?: AdsbTrack[] }) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [styleReady, setStyleReady] = useState(false)

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

  return (
    <div
      className="map"
      ref={container}
      role="application"
      aria-label={`Airspace map centered on ${ao.name}`}
    />
  )
}
