# Nova ↔ Denver EPC Integration — v1

Status: implemented on `feat/denver-integration` (Nova) / `feat/nova-integration` (Denver). Not deployed. Contracts: [contracts/v1](contracts/v1/). Architecture decision: [ADR-001.md](ADR-001.md).

## 1. Product boundary

**Nova owns** customers, contacts, opportunities, contracts and commercial value, the commercial project record, purchase orders/vendors (commercial), billing/invoices, executive reporting, and the *integration reference* to Denver.
**Denver owns** EPC execution: engineering deliverables, equipment/system hierarchy, construction and mechanical completion, commissioning, tests and evidence, deficiencies/punch, readiness gates, turnover packages, and client technical acceptance.
**Nova displays** only Denver-derived summaries (stage, percents, counts, turnover status) stamped with the time they were produced. Nova is never the authoritative store for commissioning detail. Neither system writes the other's authoritative fields — by construction: Nova's only command is `project.create` (+ reconcile), and Denver's events can only touch Nova's projection tables (`denver_project_summaries`, `denver_turnover_packages`) and integration status, never `projects` commercial columns.

## 2. Source-of-truth matrix

| Data | Authoritative system |
|---|---|
| Customer commercial account, opportunity, contract value, commercial project status, invoices | Nova |
| Denver integration reference (link row) | Nova |
| Engineering deliverables, system hierarchy, procurement technical status | Denver |
| Construction/mechanical completion evidence, commissioning checklists, test readings | Denver |
| Deficiencies, punch items, technical readiness | Denver |
| Turnover package, client technical acceptance | Denver |
| Commissioning summary shown in Nova | Denver-derived projection (read-only in Nova, timestamped) |

Commercial values never cross the boundary in v1 (security amendment 5): the create command carries no `commercialSummary`; Denver never stores or logs contract values.

## 3. Architecture (summary — full detail in ADR-001)

- **Nova → Denver commands:** HMAC-SHA256-signed raw-body `POST {DENVER_BASE_URL}/api/nova/commands` (headers `X-Nova-Signature: sha256=<hex>` over `${timestamp}.${body}`, `X-Nova-Timestamp`, ±5 min skew). Idempotency key per command; Denver's ledger (`nova_inbound_commands`) stores a response snapshot + raw-body SHA-256 digest — replay returns the stored response; same key with a different digest → `409 idempotency_conflict`.
- **Denver → Nova events:** transactional outbox (`nova_outbox`) drained by Denver's worker with bounded exponential backoff and dead-letter; delivered as HMAC-signed raw-body `POST {NOVA_BASE_URL}/api/integrations/denver/events` (headers `X-Denver-Delivery`, `X-Denver-Timestamp`, `X-Denver-Signature: v1=<hex>`). Nova's ledger (`denver_inbound_events`, `UNIQUE(tenant_id, event_id)`) makes consumption idempotent; the projection stale-guard on `(occurredAt, sequence)` ensures an older event never overwrites a newer summary.
- **Progress detection:** a Denver worker job snapshots each linked project's summary every ~5 minutes, hash-compares, and enqueues `denver.project.progress.updated` only on change (enqueued in the same transaction as the hash update).
- **Honesty rule:** discipline percents/counts Denver cannot compute from real data are omitted from the payload; Nova renders "Not reported", never fake zeros.

## 4. Authentication, authorization, tenancy

- **Service auth** is per-direction shared-secret HMAC over raw bytes with timestamp skew windows and `timingSafeEqual`. No cookies, no CSRF, no user JWTs on the machine channel. Receivers fail closed (503) when secrets are unset; there are no default secrets.
- **Tenant mapping:** each side stores a connection row (`denver_connections` in Nova, `nova_connections` in Denver) binding `connection_id` ↔ tenant. Inbound messages resolve the tenant **only** from the connection row matched by `connectionId` + verified signature — payload tenant IDs are cross-checked, never trusted. Mismatches are rejected and audited.
- **User-facing RBAC:**
  - Nova: creating/retrying/reconciling the link requires `admin` or `operations_manager` (reconcile: admin only). Members see read-only state.
  - Denver: manual retry of failed deliveries requires `owner`/`admin`. Inbound commands act as the recorded service principal.
- **Deep links ("Open in Denver"/"Open in Nova")** are plain links composed from `*_PUBLIC_URL` + a validated **relative** path stored at link time (absolute URLs are rejected). The destination product independently enforces its own login, tenant, and role checks — a link can never bypass authorization.
- **SSO is deferred** (v1 non-goal): users need accounts in both products. OIDC/account linking is the recommended next auth slice.

## 5. Reliability semantics

| Failure | Behavior |
|---|---|
| Nova times out after Denver created the project | Nova retries with the same idempotency key → Denver replays the stored response (`already_exists`); no duplicate |
| Same event delivered twice | Second insert hits the event ledger unique constraint → acknowledged no-op |
| Event arrives out of order | Stale-guard on `(occurredAt, sequence)` — recorded, but projection not regressed |
| Nova temporarily down | Outbox rows retry on backoff ladder; after max attempts → `dead` (visible in Denver panel), manual retry re-queues |
| Secrets revoked/rotated | Receivers verify current + `*_PREVIOUS` secret during rotation; verification failure → 401, audited, delivery marked failed |
| Mapping points at deleted/inaccessible record | Reconcile classifies as `mapping_mismatch` / `remote_unavailable`; never auto-repaired |

No failure renders as healthy: `sync_failed` is a red state in both UIs and the last-synchronized timestamp is always shown.

## 6. Reconciliation

Nova's admin-only reconcile action sends a signed `POST` to Denver's reconcile endpoint (connectionId inside the signed body) and compares Denver's link map + latest summary versions against its own rows, classifying each project link: `healthy`, `nova_behind`, `delivery_pending`, `mapping_mismatch`, `authorization_problem`, `remote_unavailable`, `manual_repair_required`. Ambiguous mappings are only ever flagged.

## 7. Local setup

1. **Denver** (worktree/checkout of `feat/nova-integration`): `npm ci`, Postgres + `npm run db:migrate` (through `084_nova_integration.sql`), then set env (below) and run API + worker.
2. **Nova** (checkout of `feat/denver-integration`): `npm ci`; schema applies on bootstrap (`server/schema.sql` is idempotent).
3. Generate two secrets: `openssl rand -hex 32` (one per direction).
4. Configure env on both sides (below), `NOVA_EXTERNAL=true` / `DENVER_ENABLED=true` in dev only.
5. Create the connection rows: on Nova run `npm run integration:denver:connect` (bootstrap script; documented raw-insert exception) and the Denver counterpart documented in the script's output.
6. Smoke: from Nova, create a link on a project (UI or `POST /api/tenant/projects/:id/denver`); watch Denver's `nova_inbound_commands` and Nova's `denver_project_links`.

## 8. Environment variables

| Nova | Denver | Purpose |
|---|---|---|
| `DENVER_ENABLED` | `NOVA_EXTERNAL` | Master flag; off = endpoints 503 / enqueue no-op |
| `DENVER_BASE_URL` | `NOVA_BASE_URL` | Partner API origin (no trailing slash) |
| `DENVER_COMMAND_SECRET` | `NOVA_COMMAND_SECRET` (+`_PREVIOUS`) | Nova signs commands / Denver verifies |
| `DENVER_WEBHOOK_SECRET` (+`_PREVIOUS`) | `NOVA_WEBHOOK_SECRET` | Denver signs events / Nova verifies |
| `DENVER_PUBLIC_URL` | `NOVA_PUBLIC_URL` | Deep-link composition |

**Rotation:** set the new secret on the signer, move the old value into the receiver's `*_PREVIOUS`, deploy receiver first, then signer, then clear `*_PREVIOUS`. Never reuse a secret across environments; dev/staging/prod each get their own pair. Missing secrets fail closed.

## 9. Deployment order & rollback

Deploy: (1) Denver migration + code with `NOVA_EXTERNAL=false`; (2) Nova code with `DENVER_ENABLED=false` (schema blocks are idempotent); (3) create connection rows + secrets in the target environment; (4) enable Denver flag; (5) enable Nova flag; (6) run the integration smoke (connectivity event + one reconcile). **Nova production enablement is preconditioned on Nova CI (test+build workflow) being green** (amendment 12). Recommend `min_machines_running=1` on Nova once live (scale-to-zero adds webhook cold-start latency).

Rollback: flip the flags off (both sides degrade to honest `not_connected`/disabled states; no data loss — outbox rows queue, links remain); revert code only if the flags-off state is insufficient. Tables are additive; no destructive rollback needed.

## 10. Operational troubleshooting

- **Nova panel shows `sync_warning`/stale timestamp:** check Denver worker liveness and `nova_outbox` (`status='failed'/'dead'`, `last_error`). Manual retry from either panel (audited).
- **401s on delivery:** secret mismatch/rotation mid-step — verify pairs and `*_PREVIOUS` handling; failures are in both audit logs.
- **409 `idempotency_conflict`:** a retry mutated the payload — investigate before overriding; never bypass the ledger.
- **Reconcile shows `mapping_mismatch`:** inspect both link rows; repair is a deliberate manual operation.
- Audit trails: Denver `audit_log` (actions `integrate_push`/`integrate_pull`), Nova `tenant_audit_events` (`denver.*` actions) — correlation IDs join the two sides.

## 11. Known limitations (v1)

- No SSO/account linking; deep links land on the partner login when unauthenticated.
- Single env-configured connection pair; multi-connection self-service provisioning is a later slice.
- Discipline-split percents are sparse until Denver EVM/KPI adoption fills them (rendered honestly as "Not reported").
- Contract schemas are duplicated copies in both repos (checksum-tested), not a shared package.
- Turnover evidence stays in Denver; Nova stores only package summaries + links (controlled archival is a possible later requirement).

## 12. Future phases

OIDC/shared IdP + account linking → multi-connection provisioning UI → turnover archival policy → extending the event vocabulary (deficiency detail drill-through, schedule forecast) → shared contract package if a third product joins the boundary.

## 13. Sequence diagram

```
Nova user (admin/ops)   Nova server              Denver server            Denver worker
      │ create link          │                        │                        │
      ├─────────────────────▶│ signed project.create  │                        │
      │                      ├───────────────────────▶│ verify HMAC+timestamp  │
      │                      │                        │ connection→tenant      │
      │                      │                        │ ledger check (idem.)   │
      │                      │                        │ TXN: project + link    │
      │                      │                        │  + ledger + outbox     │
      │                      │◀───────────────────────┤ 201 response snapshot  │
      │◀─────────────────────┤ TXN: link row + audit  │                        │
      │  panel: connected    │                        │   progress changes ───▶│ snapshot-diff → outbox
      │                      │◀━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┥ signed event POST (backoff retry)
      │                      │ verify, ledger,        │                        │
      │                      │ stale-guard, TXN:      │                        │
      │  panel: updated      │ summary + audit        │                        │
      │                      │                        │ turnover issued ──────▶│ turnover event → same path
```
