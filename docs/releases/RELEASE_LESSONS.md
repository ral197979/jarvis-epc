# Release Lessons Learned (operational)

Operational lessons captured during the Federation v2.0.0 → v2.0.1 releases. **Operational only — no
governance changes** (governance lives in `FEDERATION_CHANGE_POLICY.md` etc.). These are habits to apply
to future releases.

## From v2.0.0 / v2.0.1
1. **Validate on the production Node version.** v2.0.0 was validated on local Node 24; CI/prod run
   **Node 20**, which has different webcrypto realm checks and ICU formatting. Local-green ≠ CI-green.
   → Run the full suite under the prod Node version (and ideally a matrix of supported versions) before
   declaring "green CI."
2. **Don't assert CI status from a local run.** CI only triggers on `main`; the federation lineage was
   never CI-validated pre-promotion. → Obtain a real CI run on the promotion lineage (e.g. a
   `denver-v2-base → main` PR) before promoting.
3. **Require RC + staging validation before promotion.** A real clean-DB migration (PG18, 070–081) and a
   live app smoke caught nothing federation-related but confirmed migration safety — do this *before* the
   FF, not after.
4. **Pin environment determinism in the test config.** Timezone (now `TZ=UTC`) and locale/ICU
   (explicit formatter options) must be fixed so tests behave identically across machines and CI.
5. **A separate flattened app needs its own pipeline.** `denver-engineering-next` leaked into the root
   runner without its aliases/Node-version expectations. Sub-apps should have their own CI; don't gate the
   root suite on them.
6. **Distinguish benign deploy signals from failures.** Render's `409` (deploy already in progress) was
   failing CI for months. Classify deploy responses; accept benign conflicts.
7. **Reserved-word / DDL safety needs a real-DB check.** The `references→refs` bug was invisible to the
   mocked-DB unit suite. → Run migrations against a real Postgres in CI/staging.

## Recommended pre-release checklist (operational habits)
- [ ] Full suite green on the **prod Node version** (matrix if multiple supported).
- [ ] Real CI run on the exact promotion lineage.
- [ ] Clean-DB migration applied on a production-like Postgres (with real extensions/roles).
- [ ] Live smoke: health, metrics, auth, authz, migration verification.
- [ ] Deploy pipeline trigger verified green (or benign statuses classified).
- [ ] Determinism (TZ/locale/crypto) pinned in test config.
