# API Gateway and Key Management

**Denver Engineering — Ava Phase 8 (v8.0.0)**

## Overview

The API Gateway Service manages the full lifecycle of API keys: creation, authentication, scope enforcement, quota tracking, and revocation. Secrets are never stored — only their SHA-256 hash is persisted.

## Key Creation

`createApiKey()` returns `ApiKeyWithSecret` containing:
- `key` — the full `ApiKey` record (hash, prefix, name, scopes, etc.)
- `secret` — the raw 64-character hex secret (32 random bytes). **Returned only once; cannot be retrieved later.**

The `key_prefix` stored in the database is the first 8 characters of the raw secret, used for display purposes (e.g., "Show last key: `abcd1234…`").

## Authentication Flow

```typescript
// Client sends raw secret in Authorization header
// Server hashes it and queries:
SELECT * FROM api_keys
WHERE tenant_id = $1
  AND key_hash = SHA256(rawSecret)
  AND status = 'active'
  AND (expires_at IS NULL OR expires_at > now())
```

On successful auth, `last_used_at` is updated fire-and-forget (non-blocking).

## Scope Enforcement

```typescript
hasScope(key: ApiKey, requiredScope: string): boolean
// Returns true if key.scopes includes requiredScope
// OR if key.scopes includes '*' (wildcard)
```

## Quota Tracking

Per-key quota (`quota_monthly`) is separate from the tenant's subscription API quota. Both are checked independently:
- Key-level quota: `usage_this_month` tracked in `api_keys`
- Tenant quota: `api_calls` usage events in `tenant_usage`

`resetMonthlyUsage()` resets `usage_this_month = 0` for all keys belonging to the tenant.

## Revocation

`revokeApiKey()` sets `status = 'revoked'`, records `revoked_at` and `revoked_by`. Revocation is immediate — subsequent auth calls for a revoked key return `null`.

During tenant archival, all active API keys are automatically revoked via:

```sql
UPDATE api_keys
SET status = 'revoked', revoked_at = now(), revoked_by = $actor
WHERE tenant_id = $1 AND status = 'active'
```

## Security Properties

- **No plaintext storage** — secrets are SHA-256 hashed before insert
- **Idempotent auth** — same secret always produces same hash; no statefulness
- **RLS isolation** — `api_keys` table has tenant_isolation policy; cross-tenant key lookup is impossible at the DB level
- **Expiry support** — keys can have an `expires_at` timestamp; expired keys fail auth even if `status = 'active'`
