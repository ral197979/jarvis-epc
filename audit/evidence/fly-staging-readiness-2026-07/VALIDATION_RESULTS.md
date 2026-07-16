# Validation Results — infra/fly-staging-readiness

All commands run against this branch's working tree, from the repo root.

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | ✅ 0 errors |
| Typecheck (modules) | `npx tsc --project tsconfig.modules.json --noEmit` | ✅ 0 errors |
| Full test suite | `npx vitest run` | ✅ **5,302 / 5,302 passing**, 158/158 files (up from 5,298/157 at the PR #18 baseline — 4 new tests in `api/__tests__/releaseIdentity.test.ts`) |
| Build | `npm run build` | ✅ built in 417ms, no errors |
| Lint | `npm run lint` | ⚠️ 32 warnings, 0 errors — same pre-existing set as the PR #18 baseline; confirmed no new warnings from any file this task touched (`releaseIdentity.ts`, the `server.ts` diff) |
| Dependency audit | `npm audit --audit-level=high` | ✅ 0 high/critical — same single pre-existing low-severity dev-only esbuild advisory |
| Fly config validation | `flyctl config validate --config fly.staging.toml --app denver-epc-staging` | ✅ Configuration is valid |
| Anti-regression guard | `node scripts/validate-fly-staging-config.mjs` | ✅ all invariants hold — staging cannot target production |
| Workflow YAML sanity | `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/fly-staging-deploy.yml'))"` and same for `ci.yml` | ✅ both valid YAML |
| Docker build | `docker build -f Dockerfile.api -t denver-epc-staging-validate:test .` | ✅ built successfully from the exact working-tree source, same Dockerfile as production, no secret values required at build time, no secret embedded in any layer (build takes no `--build-arg`/`--secret` at all). Test image removed after validation (`docker rmi`) — nothing left behind. |

No gate failed at any point in this task. `npm run check:monolith` was not re-run in this task (no changes to `src/jarvis/JarvisCore.jsx` were made here) — last known-good result remains the one recorded in `audit/evidence/CLOSURE_EVIDENCE_2026-07-02.md`.
