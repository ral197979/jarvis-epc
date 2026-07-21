# Nova ↔ Denver Integration Contracts — v1

Versioned JSON Schemas for the Nova↔Denver EPC integration. **Identical copies live in both repos** at `docs/integration/nova-denver/contracts/v1/`. Contract tests in each repo validate fixtures against these schemas; do not edit one copy without the other.

## Files

| File | Direction | Purpose |
|---|---|---|
| `create-project-request.schema.json` | Nova → Denver | `project.create` command |
| `create-project-response.schema.json` | Denver → Nova | Command response (`created` / `already_exists`) |
| `progress-event.schema.json` | Denver → Nova | Progress summary events |
| `turnover-event.schema.json` | Denver → Nova | Turnover package events |

## Transport

**Commands (Nova → Denver):** `POST {DENVER_BASE_URL}/api/nova/commands`, raw JSON body, headers:
- `X-Nova-Timestamp`: unix seconds. Reject if |now − ts| > 300s.
- `X-Nova-Signature`: `sha256=<hex hmac-sha256(secret, "{timestamp}.{rawBody}")>` using the shared command secret.
- `Content-Type: application/json`

**Events (Denver → Nova):** `POST {NOVA_BASE_URL}/api/integrations/denver/events`, raw JSON body, headers:
- `X-Denver-Delivery`: delivery UUID (idempotency at transport level; event-level dedup uses `eventId`).
- `X-Denver-Timestamp`: unix seconds, same ±300s window.
- `X-Denver-Signature`: `v1=<hex hmac-sha256(secret, "{timestamp}.{rawBody}")>` using the shared webhook secret.

Both receivers: verify with a timing-safe comparison over the **raw** body bytes; return 401 on signature mismatch, 401 on stale/absent timestamp, 503 when the secret is unconfigured (fail closed), 422 on schema-validation failure, 422 on unknown `schemaVersion`.

## Idempotency & ordering

- Commands: Denver keeps `(tenant_id, idempotency_key)` unique; a duplicate returns the original outcome with `status: "already_exists"`.
- Events: Nova keeps `(tenant_id, event_id)` unique; duplicates are acknowledged (200) and ignored. Projections only advance when `occurredAt` is newer than the stored `as_of` (stale events are recorded but never overwrite newer state).

## Status models

Integration status (both sides): `not_connected, provisioning, connected, sync_pending, sync_warning, sync_failed, authorization_required, disconnected`.

Denver `current_phase` → `summary.overallStatus` mapping:

| Denver phase | overallStatus |
|---|---|
| `feasibility`, `feed` | `planning` |
| `detailed_design` | `engineering` |
| `procurement` | `procurement` |
| `construction` | `construction` |
| `commissioning` | `commissioning` |
| `closeout` | `turnover` |
| project status `on_hold` | `on_hold` |
| project status `cancelled` | `cancelled` |
| project status `completed` | `closed` |

Fields Denver cannot compute honestly for a project are **omitted, never zero-filled**; Nova renders omitted fields as "not reported".

## Security requirements (binding, from ADR-001 security review 2026-07-20)

1. **Connection-scoped verification order** (both receivers): parse the raw body (size-limited) → read `connectionId` → load the connection row → verify the HMAC against **that connection's** secret (v1: resolver returns the shared env secret, but the code path takes the connection row) → require connection `status = 'connected'` → derive tenant **only** from the connection row. Never trust tenant IDs in the payload; a `novaTenantId`/tenant mismatch is a 401 + audited rejection. Any second connection REQUIRES a distinct secret.
2. **Atomicity**: ledger insert + state change + link write + outbox row happen in ONE database transaction on each receiver. The command ledger stores the full response snapshot; replays return the stored response.
3. **Idempotency conflicts**: the command ledger stores a SHA-256 digest of the raw request body. Same idempotency key + different digest → `409 {error:"idempotency_conflict"}`, never the original response.
4. **No commercial values cross the boundary**: `commercialSummary` was removed from the v1 contract. Receivers ignore-and-discard unknown project fields; contract value is never stored or logged by Denver.
5. **URL fields are relative paths only**: `projectUrl`, `novaProjectUrl`, `packageUrl` must match `^/[A-Za-z0-9/_-]+$` (no scheme, no leading `//`). Receivers reject or drop non-conforming values; UIs compose absolute links from their own `*_PUBLIC_URL` config.
6. **Secret rotation**: receivers verify against `*_SECRET` and, when set, `*_SECRET_PREVIOUS` (both timing-safe), so secrets rotate without breaking in-flight retries.
7. **Stale guard**: projections advance on `(occurredAt, sequence)` — `sequence` is the sender's monotonic outbox row id; ties on `occurredAt` are broken by `sequence`.
8. **Rate limiting**: both raw-body receivers apply a dedicated rate limit and a raw-body size limit (≤ 1 MB).

## Versioning

Breaking changes require a new `v2/` directory and a new `schemaVersion` const. Receivers reject unknown versions with 422; they never guess.
