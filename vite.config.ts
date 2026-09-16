import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

/**
 * The build string a run JSON carries (S4b, #137, ruled A6), so a run says which build produced
 * it: the package version and the commit's short hash, `-dirty` when the tree had uncommitted
 * changes — `2.60.0+efac241`. A checkout without git reads `unknown` for the commit.
 */
function buildString(): string {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
  const git = (args: string) =>
    execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  let commit = 'unknown'
  try {
    // Tracked files only (`-uno`): a stray untracked file is not a change to what was built.
    commit = git('rev-parse --short HEAD') + (git('status --porcelain -uno') === '' ? '' : '-dirty')
  } catch {
    // No repository under the build: the version alone still names it.
  }
  return `${version}+${commit}`
}

// https://vite.dev/config/
export default defineConfig({
  // The Pages deploy (#106) serves the site from /<repository>/; the workflow passes the path.
  // Dev, tests, and a bare build stay at `/`, so nothing that pins a URL moves.
  base: process.env.PAGES_BASE ?? '/',
  define: { 'import.meta.env.VITE_BUILD': JSON.stringify(buildString()) },
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.test.ts'],
    // Stylesheets resolve empty under test by default; the theme is let through so a test can
    // hold a MapLibre literal to its CSS token (#96).
    css: { include: [/\/src\/index\.css(\?|$)/] },
  },
})
