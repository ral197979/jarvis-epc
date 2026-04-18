import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],

  test: {
    globals: true,

    // Use environment-per-file: jsdom for src tests, node for api tests
    environmentMatchGlobs: [
      ['api/**', 'node'],
      ['src/**', 'jsdom'],
    ],

    // Default fallback
    environment: 'jsdom',

    // v4.31.0: stub secrets that module-load-time checks in api/server + mcp
    // require, so tests that transitively import those modules don't throw
    // at construction. Tests needing real Anthropic behaviour mock the SDK.
    env: {
      ANTHROPIC_API_KEY: 'sk-test-stub-for-vitest',
      JWT_SECRET:        'test-jwt-secret',
    },

    setupFiles: [path.resolve(__dirname, './src/__tests__/setup.ts')],

    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        // Phase 22 gate — raised from Phase 10 baseline
        // Actuals as of Phase 22: 96.04% stmts / 89.87% branch / 93.44% funcs / 97.09% lines
        // Targets set ~3% below actuals so the gate is firm but doesn't fail on new code additions
        branches:   87,
        functions:  90,
        lines:      94,
        statements: 93,
      },
      include: ['src/modules/**/*.ts', 'api/**/*.ts'],
      exclude: [
        'src/jarvis/**',
        'src/__tests__/**',
        'api/**/*.test.ts',
        // Pure TypeScript type/interface files have no runtime statements —
        // V8 coverage always reports 0% for them regardless of usage.
        'src/modules/**/types.ts',
        // Pure barrel files (`export * from`) are module-level declarations,
        // not runtime statements — V8 does not track them as covered.
        // The actual logic in the re-exported modules IS covered.
        // See: https://github.com/vitest-dev/vitest/issues/3252
        'src/modules/biz/index.ts',
      ],
    },

    exclude: ['**/node_modules/**', '**/dist/**', 'src/jarvis/**', 'e2e/**'],
  },

  resolve: {
    alias: {
      '@':        path.resolve(__dirname, './src'),
      '@modules': path.resolve(__dirname, './src/modules'),
      '@api':     path.resolve(__dirname, './api'),
    },
  },
})
