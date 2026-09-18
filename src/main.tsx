import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { isSheetPage } from './lib/session.ts'

const root = createRoot(document.getElementById('root')!)

/**
 * `?sheet` is the sheet page; anything else is the app (S6a-ii, #165, ruled B1, B2).
 *
 * The page is reached by a dynamic `import()`, so it is a chunk of its own rather than a static
 * edge: a build a subject runs never downloads the replay tool, nor the roles table it reads,
 * which names each scenario's threats. `tools/replay/imports.test.ts` pins that — the walk
 * follows static imports only, and the app's graph carries neither.
 *
 * A chunk that does not arrive — a stale deploy, a network that dropped — says so on the page
 * with the one thing to do, rather than leaving an empty document (round 1 on #187, finding 9).
 */
if (isSheetPage(window.location.search)) {
  void import('./components/SheetPage.tsx').then(
    ({ SheetPage }) =>
      root.render(
        <StrictMode>
          <SheetPage />
        </StrictMode>,
      ),
    (error: Error) =>
      root.render(
        <p className="sheet__refusal" role="alert">
          The sheet page did not load — {error.message}. Reload the page.
        </p>,
      ),
  )
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
