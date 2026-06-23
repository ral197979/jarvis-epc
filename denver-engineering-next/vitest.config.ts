import { defineConfig } from 'vitest/config'
import { alias } from './vite.config'

// No plugins here: the unit suite is non-JSX (tokens + adapters), and omitting
// the react plugin sidesteps the dual-vite Plugin type conflict.
export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: false,
  },
})
