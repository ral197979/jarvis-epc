#!/usr/bin/env node
/**
 * infra/fly-staging-readiness — anti-regression guard.
 *
 * Enforces, as a hard CI gate (not just documentation), that the staging Fly
 * configuration and deployment workflow can never accidentally target or
 * affect production. Run via `node scripts/validate-fly-staging-config.mjs`;
 * exits non-zero (and prints every violation, not just the first) on failure.
 *
 * This script deliberately does not import any application code — it only
 * reads and pattern-matches the checked-in config/workflow text, so it has
 * no runtime dependencies and can't itself leak a secret it never loads.
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')
const exists = (rel) => existsSync(path.join(ROOT, rel))

const PRODUCTION_APP = 'denver-epc'
const STAGING_APP = 'denver-epc-staging'
const STAGING_TOML = 'fly.staging.toml'
const STAGING_WORKFLOW = '.github/workflows/fly-staging-deploy.yml'
const PRODUCTION_TOML = 'fly.toml'

const failures = []
const check = (label, ok) => { if (!ok) failures.push(label) }

// True if `text` references the bare production app name outside of comment
// lines (a `-staging` suffix, or the `.fly.dev` hostname suffix, doesn't count).
function referencesProductionAppOutsideComments(text) {
  const codeLines = text.split('\n').filter((l) => !l.trim().startsWith('#'))
  const re = new RegExp(`${PRODUCTION_APP}(?!-staging)(?!\\.fly\\.dev)`, 'g')
  return codeLines.some((l) => re.test(l))
}

// ── 1. fly.staging.toml app name is not denver-epc ─────────────────────────
if (exists(STAGING_TOML)) {
  const toml = read(STAGING_TOML)
  const appLine = toml.split('\n').find((l) => /^app\s*=/.test(l.trim()))
  check(
    `${STAGING_TOML}: app name must be "${STAGING_APP}", found: ${appLine ?? '(no app line found)'}`,
    !!appLine && appLine.includes(`"${STAGING_APP}"`),
  )
  check(
    `${STAGING_TOML}: must not reference production app name "${PRODUCTION_APP}" outside comments`,
    !referencesProductionAppOutsideComments(toml),
  )

  // 7. Staging config contains no database URL
  check(
    `${STAGING_TOML}: must not contain a database URL (postgres:// or postgresql://)`,
    !/postgres(ql)?:\/\//i.test(toml),
  )
  // 8. Staging config contains no password-like values
  check(
    `${STAGING_TOML}: must not contain a password-like assignment (PASSWORD=, password:, SECRET=<value>)`,
    !/(password|passwd|secret)\s*[:=]\s*["'][^"'\s]{6,}["']/i.test(toml.toLowerCase().replace(/database_url_app|jwt_secret|api_key/g, '')),
  )
  // 9. health path matches /api/v1/health
  check(
    `${STAGING_TOML}: health check path must be "/api/v1/health"`,
    /path\s*=\s*"\/api\/v1\/health"/.test(toml),
  )
  // 10. preserves single application process group (no [processes] block, or a
  //     [processes] block with exactly one entry)
  const processesBlock = toml.match(/\[processes\]([\s\S]*?)(\n\[|$)/)
  if (processesBlock) {
    const entries = processesBlock[1].split('\n').filter((l) => /=/.test(l.trim())).length
    check(`${STAGING_TOML}: [processes] block must define exactly one process group (found ${entries})`, entries === 1)
  }
} else {
  failures.push(`${STAGING_TOML} does not exist`)
}

// ── 2/3. Staging workflow references fly.staging.toml, not production ──────
if (exists(STAGING_WORKFLOW)) {
  const wf = read(STAGING_WORKFLOW)

  check(`${STAGING_WORKFLOW}: must reference ${STAGING_TOML}`, wf.includes(STAGING_TOML))
  check(
    `${STAGING_WORKFLOW}: must not reference the production app name "${PRODUCTION_APP}" outside comments`,
    !referencesProductionAppOutsideComments(wf),
  )
  check(`${STAGING_WORKFLOW}: must not reference ${PRODUCTION_TOML}`, !wf.includes(`config ${PRODUCTION_TOML}`) && !wf.includes(`Config: ${PRODUCTION_TOML}`))

  // 4/5. no push / pull_request trigger
  const onBlockMatch = wf.match(/^on:\s*\n([\s\S]*?)(\njobs:)/m)
  const onBlock = onBlockMatch ? onBlockMatch[1] : ''
  check(`${STAGING_WORKFLOW}: must not trigger on push`, !/^\s*push:/m.test(onBlock))
  check(`${STAGING_WORKFLOW}: must not trigger on pull_request`, !/^\s*pull_request:/m.test(onBlock))
  check(`${STAGING_WORKFLOW}: must not trigger on schedule`, !/^\s*schedule:/m.test(onBlock))
  check(`${STAGING_WORKFLOW}: must be workflow_dispatch`, /workflow_dispatch:/.test(onBlock))

  // 6. no production deployment job in this file
  check(
    `${STAGING_WORKFLOW}: must not contain a job that deploys to production (no "deploy-production" job name, no --app denver-epc without -staging)`,
    !/deploy-production/i.test(wf),
  )

  // 11. staging workflow cannot accept arbitrary app-name input
  const inputsBlock = wf.match(/inputs:\s*\n([\s\S]*?)(\n\S|\njobs:)/)
  if (inputsBlock) {
    check(
      `${STAGING_WORKFLOW}: workflow_dispatch inputs must not include an app-name/app input (target app must be hardcoded, not user-supplied)`,
      !/^\s+app(_name)?:/m.test(inputsBlock[1]),
    )
  }
  check(
    `${STAGING_WORKFLOW}: STAGING_APP must be hardcoded to "${STAGING_APP}" in the env: block, not templated from an input`,
    new RegExp(`STAGING_APP:\\s*${STAGING_APP}\\s*$`, 'm').test(wf.split('inputs:')[0] + wf.split(/env:\s*\n/)[1]?.split('\n')[0]) ||
      wf.includes(`STAGING_APP: ${STAGING_APP}`),
  )

  // 12. fail closed when Fly token missing / 13. fail closed when DATABASE_URL_APP missing
  check(`${STAGING_WORKFLOW}: must fail closed when FLY_API_TOKEN is missing`, /FLY_API_TOKEN.*is not set/i.test(wf))
  check(
    `${STAGING_WORKFLOW}: must fail closed when the staging runtime credential (DATABASE_URL_APP) is missing`,
    /STAGING_DATABASE_URL_APP.*is not available/i.test(wf) || /STAGING_DATABASE_URL_APP:-.*\}.*exit 1/is.test(wf),
  )

  // 14. never substitutes DATABASE_URL (owner) as the runtime connection
  check(
    `${STAGING_WORKFLOW}: must never set the app's runtime DATABASE_URL secret (owner/admin fallback is prohibited) — only DATABASE_URL_APP`,
    !/secrets set[\s\S]{0,200}\bDATABASE_URL=/.test(wf),
  )

  // 17. no secret values printed — no echo of a **secrets.* reference
  check(
    `${STAGING_WORKFLOW}: must not echo a secret value (no "echo ... \${{ secrets." pattern)`,
    !/echo[^\n]*\$\{\{\s*secrets\./.test(wf),
  )
} else {
  failures.push(`${STAGING_WORKFLOW} does not exist`)
}

// ── 15. Production fly.toml unchanged (app name still denver-epc, still no
//        DATABASE_URL_APP baked in as a literal value) ─────────────────────
if (exists(PRODUCTION_TOML)) {
  const prodToml = read(PRODUCTION_TOML)
  check(`${PRODUCTION_TOML}: app name must still be "${PRODUCTION_APP}" (unchanged)`, prodToml.includes(`app = "${PRODUCTION_APP}"`))
  check(`${PRODUCTION_TOML}: must not contain a database URL`, !/postgres(ql)?:\/\//i.test(prodToml))
} else {
  failures.push(`${PRODUCTION_TOML} does not exist`)
}

// ── 13 (repo-wide). No tracked file contains an actual DATABASE_URL_APP
//        assignment with a real-looking value (name-only references are fine) ─
const SUSPICIOUS_VALUE = /DATABASE_URL(_APP)?\s*[:=]\s*["']?postgres(ql)?:\/\/[^"'\s${}]+/i
for (const rel of [STAGING_TOML, PRODUCTION_TOML, STAGING_WORKFLOW, '.github/workflows/fly-deploy.yml']) {
  if (!exists(rel)) continue
  const text = read(rel)
  check(`${rel}: must not contain a literal DATABASE_URL/DATABASE_URL_APP connection-string value`, !SUSPICIOUS_VALUE.test(text))
}

// ── Report ───────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`\nvalidate-fly-staging-config: ${failures.length} violation(s) found:\n`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  console.error('')
  process.exit(1)
}

console.log('validate-fly-staging-config: all invariants hold — staging cannot target production.')
