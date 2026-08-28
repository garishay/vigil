import { useEffect, useRef } from 'react'
import { Map as MapLibreMap, NavigationControl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import '../lib/maplibreWorker'
import type { AreaOfOperations } from '../config/ao'
import { circlePolygon } from '../lib/geo'

const SITES_SOURCE = 'protected-sites'

/** Mirrors --accent in the theme; MapLibre paint properties take literals, not CSS variables. */
const RING_COLOR = '#4c9aff'

/**
 * The persistent map canvas. Mounted once for the life of the app — switching surfaces must not
 * remount it, because rebuilding a MapLibre map is expensive and throws away the operator's view.
 */
export function MapView({ ao }: { ao: AreaOfOperations }) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!container.current) return
    const map = new MapLibreMap({
      container: container.current,
      style: ao.basemapStyleUrl,
      center: ao.center,
      zoom: ao.zoom,
      attributionControl: { compact: true },
    })
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
    })

    return () => map.remove()
  }, [ao])

  return (
    <div
      className="map"
      ref={container}
      role="application"
      aria-label={`Airspace map centered on ${ao.name}`}
    />
  )
}
