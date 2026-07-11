import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // AUDIT-P0-01 (follow-up fix): plain `process.env` inside this config file
  // is NOT populated from .env by default — Vite only auto-loads .env into
  // `import.meta.env` for client code, not into this file's own process.env.
  // Without loadEnv() here, `process.env.PORT` below is always undefined
  // regardless of what .env actually sets, silently defaulting the proxy
  // target to the wrong port (reproduced live: proxied requests 502'd
  // against an unrelated app squatting on port 3001 while the real API
  // server was listening on the .env-configured port 4001).
  const env = loadEnv(mode, process.cwd(), '')

  return {
  plugins: [
    react({
      // Support JSX in .jsx files without pragma
      jsxRuntime: 'automatic',
    }),
  ],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@modules': path.resolve(__dirname, './src/modules'),
      '@components': path.resolve(__dirname, './src/components'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@styles': path.resolve(__dirname, './src/styles'),
    },
  },

  build: {
    // Output directory
    outDir: 'dist',

    // JarvisCore.jsx monolith is still large; extracted components reduce this over time
    chunkSizeWarningLimit: 5000,

    rollupOptions: {
      output: {
        // Manual chunk splitting — expand as we extract further modules
        // Vite 8 (Rolldown) requires a function; object form is no longer supported.
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'vendor-react'
          if (id.includes('node_modules/recharts')) return 'vendor-recharts'
        },
      },
    },

    // Source maps for production debugging
    sourcemap: true,

    // Target modern browsers
    target: 'es2020',
  },

  // Dev server config
  server: {
    port: 3000,
    open: true,
    cors: true,
    // AUDIT-P0-01: without this proxy, fetch('/api/...') in dev falls through to
    // Vite's own SPA handler and returns index.html with a 200 — every API-backed
    // view then fails JSON parsing and shows a generic error. Target is
    // configurable via VITE_API_PROXY_TARGET (defaults to the Express API's own
    // default port; override if PORT is set differently in your .env).
    proxy: {
      '/api': {
        target: env.VITE_API_PROXY_TARGET || `http://localhost:${env.PORT || 3001}`,
        changeOrigin: true,
      },
    },
  },

  // Preview server config
  preview: {
    port: 4000,
    open: true,
  },
  }
})
