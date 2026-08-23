# ADR-014 PHASE 3K — DOWNLOAD-TOKEN LIVE REVOCATION

## A. Verdict

```text
DOWNLOAD-TOKEN LIVE REVOCATION ................. CLOSED
  membership revocation .......................... PROVED  (404 on next call)
  role capability loss ........................... PROVED  (403, before the record)
  account deactivation ........................... PROVED  (401)
  version no longer active / key moved ........... PROVED  (404)
TOKEN BEARER-TRANSFERABILITY ................... CLOSED  (subject + tenant bound)
UNBOUND (PRE-3K) TOKENS ........................ FAIL CLOSED
TOKEN-PARAMETER PATH TRAVERSAL ................. CLOSED  (download + upload)
DUAL_PROJECT_OR_TENANT `_global` DOCUMENTS ..... PRESERVED

IN-APP VIEWER ROUTE (recorded honesty issue) ... REPAIRED
  inline mime allowlist .......................... ENFORCED (stored value never echoed)
  scoped identically to the document list ........ PROVED

S3 BACKEND LIVE REVOCATION ..................... NOT CLOSED — see §E.1
PROMOTION ...................................... NOT AUTHORIZED
```

## B. Provenance

```text
repository ..... ral197979 / jarvis-epc
branch ......... security/adr-014-phase3j-subcollection-guard-sweep
parent commit .. e398e79996cf42cd54f35fc5850812e497e309d5  (Phase 3J tip)
origin/main .... untouched.  No PR opened, nothing merged, tagged or deployed.
```

## C. What changed

**1. `authorizeRecordScope` extracted from `requireRecordScope`** (`api/authz/recordScope.ts`).
Behaviour-preserving. The middleware is now that function plus a `req.params`
lookup, so a surface whose record id is *not* in the path can ask the identical
question instead of skipping it. Registered as a canonical record-scope call in
`scripts/adr014/extract-endpoint-inventory.mjs` and `helpers/endpointCensus.ts`.

**2. Download tokens are bound** (`api/files/storage.ts`). `presignDownload` now
*requires* a `DownloadBinding` — tenant, subject, resource, record. The sidecar
records it. `PresignDownloadResult.enforceable` reports whether the backend can
actually refuse at redemption (local `true`, S3 `false`).

**3. `GET /files/download/:token` re-derives authority** (`api/routes/files.ts`).
Eight ordered checks: token format → sidecar/expiry → binding present → tenant →
subject → live record scope → version still active and still on this key →
consume and stream. A refusal never consumes the token.

**4. Token-parameter path traversal closed.** Express percent-decodes path
params, so `/files/download/x%2F..%2F..%2Fp` arrived as one parameter containing
a traversal, and `path.join` honoured it — a readable JSON file anywhere on the
host was the head of a file-read chain, and on the upload route its `key` chose
where uploaded bytes landed. Both routes now reject anything that is not a
minted token shape before building a path.

**5. `GET /files/documents/:id/content` added; the drawings viewer repaired.**
`DrawingsView.tsx` pointed an iframe at `/api/v1/documents/:id/file`, which has
never existed — the request fell into the SPA catch-all and the frame rendered
the app's own HTML. The registry recorded this as an honesty issue. The route
streams the current active version behind tenant + `docs.view` +
`requireRecordScope('documents')`, inline, restricted to a passive-format mime
allowlist (PDF and raster images; SVG excluded, as in the upload allowlist), and
serves the *allowlist's* spelling so a crafted `mime_type` column cannot choose
the response type. `capabilityRegistry.ts` updated — still `PARTIAL`, for the
new reasons in §E.4.

## D. Mutation proof

Each planted independently, then reverted; `files.ts` and `recordScope.ts`
verified byte-identical afterwards.

| Mutant | Change | Result |
|---|---|---|
| A | record scope not re-derived on redemption | **RED** |
| B | subject binding dropped | **RED** |
| C | tenant binding dropped | **RED** |
| D | download token format unchecked | **RED** |
| E | unbound token honoured | GREEN — see below |
| F | version liveness / key re-read dropped | **RED** |
| G | upload token format unchecked | **RED** |
| H | project branch admits without membership | **RED** |
| I | guard keeps its own divergent copy of the ladder | **RED** |
| J | inline mime allowlist removed | **RED** |
| K | stored mime echoed as response Content-Type | **RED** |
| L | record scope dropped from the viewer route | **RED** |
| M | `nosniff` / `sandbox` headers removed | **RED** |
| N | tenant predicate dropped from the version lookup | GREEN — see below |

**Two mutants stay green, and both are reported rather than papered over.**

- **E** — the "binding present" check is a type-narrowing gate and defence in
  depth, not an independent control: every missing field is caught again by the
  tenant, subject, scope and key comparisons below it.
- **N** — the tenant predicate on the viewer's version lookup is masked by
  `requireRecordScope('documents')`, which is tenant-bounded on the same row and
  has already refused. It stays so the statement is correct on its own.

Both are annotated in the source at the exact line, with this reason.

The first mutation run reported **all seven mutants green**. That was the
harness, not the mutants: `--reporter=basic` does not exist in vitest 4, so
every run errored before testing and the parser read zero failures. Three more
were green for a real but different reason — the tests were masked by adjacent
checks — and were rewritten to isolate each check before being believed.

## E. Residual risk

1. **S3 live revocation is NOT closed.** `S3Storage.presignDownload` returns a
   URL validated by S3; this process never sees the redemption and cannot
   re-authorize it. The binding is accepted and deliberately not stored, and
   `enforceable: false` says so. Closing it needs a streaming proxy or
   short-lived STS credentials — an infrastructure decision, not an edit.
2. **`readStream` on the S3 backend is untested.** Implemented symmetrically
   with the other S3 methods and typechecked; exercising it requires live S3
   credentials, i.e. a cost-bearing external call. Local backend is covered.
3. **Pre-3K tokens stop working.** Tokens live one hour, so this self-clears
   within an hour of deploy. A user mid-download would need to re-request.
4. **The repaired viewer has API tests only.** No browser-level verification was
   performed. The markup overlay is a fixed 800×500 canvas over a responsive
   iframe, so annotation coordinates do not track the rendered page — recorded
   in `capabilityRegistry.ts`, and the reason the entry stays `PARTIAL`.
5. **`GET /files/presign/:versionId` has no frontend consumer.** It was
   hardened as API surface; no UI calls it. `DocumentsView` is a metadata
   register with no content or download affordance at all.
6. **Two accessibility test files are nondeterministic** under parallel load
   (`Axe is already running`) — 16 failures at the Phase-3J parent commit, 0 on
   two consecutive isolated runs afterwards. Pre-existing, unrelated to this
   work, and not investigated here.
7. Carried forward unchanged: the realtime `readiness` scope model (blocked on
   an owner ruling), the SAML census gap, full-repo determinism, migrations
   085/086.

## F. Counters

```text
ENDPOINTS ENFORCING SCOPE ....... 352 → 354   (download token, viewer route)
UNRESOLVED_DATA_ACCESS ........... 31 → 30    (download token resolved)
PROJECT-BOUND DIRECT-ID READS .... 60 → 62 / scoped 56 → 58
DELIVERY READS REGISTERED ....... 108 → 109   (new surface, not a reclassification)
CAPABILITY-GUARDED TOTAL ........ 730 → 731
CAPABILITY HOLDER DELTA .......... 0          (capabilities.ts unchanged)
INVENTORY DETERMINISM ............ 3/3 byte-identical
```

No migration written or applied. No new persistent state.

## G. Next

```text
NEXT: realtime `readiness` scope-model repair — BLOCKED on an owner ruling.
```

Two producers write different identifier kinds into one column; no amount of
source reading settles which meaning is intended. It is a product question, not
a slice. After it, the ADR-014 authorization rollout has no remaining
engineering-completable item — what is left is S3 infrastructure (§E.1) and
full-repo determinism qualification on clean infrastructure.

---

*A pushed branch and this report are not promotion authorization.*
