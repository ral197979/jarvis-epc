import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
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
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-recharts': ['recharts'],
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
  },

  // Preview server config
  preview: {
    port: 4000,
    open: true,
  },
})
