import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest runs without globals, so Testing Library's automatic cleanup does not
// self-register. Unmount between tests so renders never leak across cases.
afterEach(cleanup)

// The site plan lives in localStorage between sessions (#90); between tests it must not, or an
// App test's edit would be the next test's opening set. Every test starts on config. A file that
// runs under the node environment has no storage to clear.
afterEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear()
})
