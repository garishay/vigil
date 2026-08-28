import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

/**
 * MapLibre derives its worker URL from `import.meta.url` at runtime, which no bundler can see.
 * Left alone the worker 404s, the style never finishes loading, and the map renders blank with
 * no error. Vite's `?worker&url` bundles the worker with the shared chunk it imports and hands
 * back an emitted URL that is correct in both dev and the production build.
 *
 * Imported for side effect by MapView, before any map is constructed.
 */
setWorkerUrl(workerUrl)
