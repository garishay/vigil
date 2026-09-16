/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * The build string a run JSON carries (S4b, #137, ruled A6): the package version and the
   * commit it was built from, set by `vite.config.ts` at build time and under test.
   */
  readonly VITE_BUILD?: string
}
