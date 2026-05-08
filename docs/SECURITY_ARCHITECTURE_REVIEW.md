# Security Architecture Review — Denver Engineering

**Prepared:** 2026-05-07  
**Review Type:** Internal pre-launch security review  
**Status:** APPROVED

---

## Architecture Overview

Denver Engineering is a multi-tenant AI workflow platform with the following security boundaries:

```
┌─────────────────────────────────────────────────────┐
│ API Gateway (TLS 1.3, JWT validation)                │
├─────────────────────────────────────────────────────┤
│ Application Layer (Node.js, tenant context middleware)│
├─────────────────────────────────────────────────────┤
│ Database Layer (Postgres + RLS policies per tenant)  │
├─────────────────────────────────────────────────────┤
│ Event Store (immutable append-only, signed ledger)   │
└─────────────────────────────────────────────────────┘
```

## Tenant Isolation

**Mechanism:** PostgreSQL Row-Level Security (RLS)

- All multi-tenant tables enforce `tenant_id` via `pg_policies`
- Minimum required: 10 RLS policies (validated by `runTenantIsolationCheck`)
- Cross-tenant queries are blocked at the database level
- The `tenantQuery(tenantId, sql, params)` function enforces tenant context on all scoped queries
- Admin operations use `pool.query` only where explicitly permitted

**Verification:** `productionGateValidator.runTenantIsolationCheck()` checks `pg_policies` count before every deployment.

## Authentication and Authorization

- JWT-based authentication with short expiry (15 min access, 7d refresh)
- RBAC roles: `admin`, `operator`, `viewer`, `edge_node`
- SSO via SAML/OIDC for enterprise tenants
- No shared secrets between tenants

## Data Encryption

- **At rest:** AES-256 for all database volumes
- **In transit:** TLS 1.3 mandatory; no TLS 1.1/1.2
- **Secrets:** Environment-scoped secrets; never stored in database rows

## Audit Trail

- All state-changing operations emit audit events to `audit_log`
- Audit events are immutable (append-only, no UPDATE/DELETE)
- Audit log completeness verified by `governanceValidationEngine.checkAuditLogCompleteness()`
- Target: >100 events/7-day window per tenant

## Replay Integrity

- Event replay is deterministic (MAX_REPLAY_DIVERGENCE_TOLERANCE = 0)
- All replays cryptographically fingerprinted via `computeReplayHash()`
- Divergence triggers immediate incident creation and alert

## Known Limitations

1. Edge nodes operate in reduced-trust mode; cryptographic attestation required for reconnection
2. Air-gapped deployments rely on signed bundle verification; bundle tamper detection is hash-based
3. AI provider API calls are logged but provider-side data handling is outside this scope

## Penetration Test Status

External penetration test scheduled for Q2 2026. Interim: internal security review by platform team completed 2026-04-30. No critical findings.
