import './App.css'

/**
 * Placeholder shell for PR 00. The real layout, navigation, and map arrive in PR 01;
 * this exists so the scaffold, lint, typecheck, and test pipeline have something to run against.
 */
export default function App() {
  return (
    <main className="app">
      <h1 className="app__title">Vigil</h1>
      <p className="app__tagline">Explainable airspace triage for the PHL area</p>
      <p className="app__notice">
        Educational demonstration — not for operational use. Vigil makes no claims about real-world
        threat assessment. Real ADS-B aircraft are always treated as cooperative; only synthetic
        injects can score as threats.
      </p>
    </main>
  )
}
