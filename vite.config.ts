import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
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
