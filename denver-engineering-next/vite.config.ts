import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// Path aliases mirror the four-folder repo layout:
//   @         → frontend/src   (the application)
//   @ds       → design-system  (tokens + primitive components)
//   @adapters → backend-adapters (typed API adapter layer + mock data)
// Test config lives in vitest.config.ts to avoid the dual-vite type clash.
export const alias = [
  { find: /^@ds$/, replacement: fileURLToPath(new URL('./design-system/src/index.ts', import.meta.url)) },
  { find: /^@ds\//, replacement: fileURLToPath(new URL('./design-system/src/', import.meta.url)) },
  { find: /^@adapters$/, replacement: fileURLToPath(new URL('./backend-adapters/src/index.ts', import.meta.url)) },
  { find: /^@adapters\//, replacement: fileURLToPath(new URL('./backend-adapters/src/', import.meta.url)) },
  { find: /^@\//, replacement: fileURLToPath(new URL('./frontend/src/', import.meta.url)) },
]

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  server: { port: 5174, host: true },
})
