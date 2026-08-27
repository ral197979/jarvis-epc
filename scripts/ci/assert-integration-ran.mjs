/**
 * Fail the build when an integration suite SKIPPED instead of running.
 *
 * The failure this exists to catch is a green badge that proves nothing.
 * `accountingBoundaryIntegration.test.ts` is guarded by
 * `describe.skipIf(!ACCOUNTING_IT_DATABASE_URL)` so it stays out of the way on
 * a machine with no PostgreSQL. Vitest reports a fully-skipped file as
 * `success: true` — 21 pending, 0 passed, exit code 0. A CI job that only
 * checked the exit code would therefore report success for a run in which the
 * live-database and row-level-security proofs never executed at all, which is
 * strictly worse than not having the job: it converts an absence of evidence
 * into an appearance of evidence.
 *
 * So the exit code is not the signal. The counts are.
 *
 * Usage: node scripts/ci/assert-integration-ran.mjs <report.json> <minimum-tests>
 */
import { readFileSync } from 'node:fs'

const [reportPath, minRaw] = process.argv.slice(2)
if (!reportPath) {
  console.error('usage: assert-integration-ran.mjs <report.json> [minimum-tests]')
  process.exit(2)
}
const minimum = Number(minRaw ?? 1)

let report
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'))
} catch (err) {
  console.error(`[assert-integration-ran] cannot read ${reportPath}: ${err.message}`)
  console.error('[assert-integration-ran] the suite produced no report, so it cannot be said to have run.')
  process.exit(1)
}

const total   = report.numTotalTests   ?? 0
const passed  = report.numPassedTests  ?? 0
const pending = report.numPendingTests ?? 0
const failed  = report.numFailedTests  ?? 0

const problems = []
if (failed > 0)          problems.push(`${failed} test(s) failed`)
if (pending > 0)         problems.push(`${pending} test(s) were SKIPPED — the database was almost certainly unreachable`)
if (passed < minimum)    problems.push(`only ${passed} test(s) passed, expected at least ${minimum}`)
if (total === 0)         problems.push('the suite reported no tests at all')

if (problems.length) {
  console.error('[assert-integration-ran] FAILED — this run does not constitute integration evidence:')
  for (const p of problems) console.error(`  · ${p}`)
  console.error(`  counts: total=${total} passed=${passed} skipped=${pending} failed=${failed}`)
  process.exit(1)
}

console.log(`[assert-integration-ran] OK — ${passed} integration test(s) executed against a real database (0 skipped).`)
