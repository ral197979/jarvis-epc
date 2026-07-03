/**
 * Test-only stub for the optional `@sentry/node` peer dependency.
 *
 * api/services/observability/errorTracking.ts dynamic-imports `@sentry/node`
 * only when SENTRY_DSN is set, but Vite's static import analysis still needs
 * the bare specifier to be resolvable at transform time for any test that
 * imports errorTracking.ts at all — even one that never sets SENTRY_DSN and
 * so never actually reaches the dynamic import. Aliased in vitest.config.ts.
 */
export function init(): void {}
export default { init }
