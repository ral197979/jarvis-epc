import { defineConfig, devices } from '@playwright/test'

/**
 * Denver Engineering — Playwright E2E Configuration
 * ──────────────────────────────────────────
 * Phase 4: Critical workflow smoke tests.
 *
 * Run with:   npx playwright test
 * UI mode:    npx playwright test --ui
 * Debug:      npx playwright test --debug
 * Report:     npx playwright show-report
 *
 * Phase 5 targets:
 *  - Add visual regression tests (screenshots)
 *  - Add authenticated user session tests
 *  - Add AI chat integration tests (mocked)
 *  - Add mobile viewport tests
 */
export default defineConfig({
  testDir: './e2e',

  // Run tests in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Reporter
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],

  use: {
    // Base URL of the running app
    baseURL: 'http://localhost:4173',

    // Collect trace when retrying a failed test
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Viewport matching JARVIS primary desktop target
    viewport: { width: 1440, height: 900 },

    // Action timeout
    actionTimeout: 10_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    // Mobile viewport — minimal smoke test
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],

  // Start the preview server before tests.
  //
  // The port is pinned HERE rather than inherited from `npm run preview`.
  // vite.config.js sets `preview.port: 4000` while this file has always waited
  // on 4173, so the two disagreed and the webServer could never come up — the
  // suite failed with "Timed out waiting 120000ms" before running a single
  // test. Passing the port explicitly keeps this file self-consistent, and
  // --strictPort makes a clash fail loudly instead of silently landing on
  // another port and timing out the same way.
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url:     'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
