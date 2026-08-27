#!/usr/bin/env node
/** ADR-014 — regenerate every machine-derived inventory, in dependency order. */
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
for (const s of ['extract-endpoint-inventory.mjs', 'extract-schema-map.mjs',
                 'extract-route-data-access.mjs', 'classify-scope.mjs', 'render-report.mjs']) {
  process.stdout.write(`\n── ${s}\n`)
  execFileSync(process.execPath, [join(HERE, s)], { stdio: 'inherit', cwd: resolve(HERE, '..', '..') })
}
