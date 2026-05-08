# Enterprise API Platform

**Denver Engineering — Ava Phase 8 (v8.0.0)**

## Overview

Phase 8 adds a comprehensive enterprise API layer at `/api/v1/enterprise/*`. All routes require authentication (`requireAuth`). Tenant-scoped routes additionally require `requireTenant` middleware.

## Route Groups

### Tenant Lifecycle
| Method | Path | Description |
|--------|------|-------------|
| POST | `/enterprise/tenants/:id/provision` | Provision or re-provision tenant |
| GET | `/enterprise/tenants/:id/subscription` | Get subscription details |
| POST | `/enterprise/tenants/:id/lifecycle` | Transition lifecycle status |
| GET | `/enterprise/tenants/:id/lifecycle/history` | Full lifecycle event log |
| POST | `/enterprise/tenants/:id/suspend` | Suspend tenant |
| POST | `/enterprise/tenants/:id/reactivate` | Reactivate suspended tenant |
| POST | `/enterprise/tenants/:id/archive` | Archive tenant |
| GET | `/enterprise/subscriptions` | Admin: list all subscriptions |

### Feature Gating
| Method | Path | Description |
|--------|------|-------------|
| GET | `/enterprise/features` | List all feature flags |
| GET | `/enterprise/features/:key` | Check specific feature |
| PUT | `/enterprise/features/:key` | Upsert feature flag |
| GET | `/enterprise/entitlements` | Full entitlement summary |
| GET | `/enterprise/quota/api` | API quota check |
| GET | `/enterprise/quota/seats` | Seat quota check |

### Usage Tracking
| Method | Path | Description |
|--------|------|-------------|
| POST | `/enterprise/usage` | Record usage event |
| GET | `/enterprise/usage` | List usage records |
| GET | `/enterprise/usage/summary` | Current month summary |

### AI Cost
| Method | Path | Description |
|--------|------|-------------|
| POST | `/enterprise/ai-usage` | Record AI usage |
| GET | `/enterprise/ai-usage` | List AI usage records |
| GET | `/enterprise/ai-usage/budget` | Budget status |
| GET | `/enterprise/ai-usage/by-agent` | Cost breakdown by agent |

### Support
| Method | Path | Description |
|--------|------|-------------|
| POST | `/enterprise/tickets` | Create ticket |
| GET | `/enterprise/tickets` | List tickets |
| GET | `/enterprise/tickets/sla-breaches` | SLA breach queue |
| GET | `/enterprise/tickets/:id` | Get ticket |
| PATCH | `/enterprise/tickets/:id/status` | Update status |
| POST | `/enterprise/tickets/:id/escalate` | Escalate ticket |

### Compliance Exports
| Method | Path | Description |
|--------|------|-------------|
| POST | `/enterprise/exports` | Request export |
| GET | `/enterprise/exports` | List exports |
| GET | `/enterprise/exports/:id` | Get export record |

### Deployment Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/enterprise/deployment/health` | Current health report |
| POST | `/enterprise/deployment/health/run` | Run platform checks |
| POST | `/enterprise/deployment/health/check` | Record external check |

### Demo Tenants
| Method | Path | Description |
|--------|------|-------------|
| POST | `/enterprise/demo` | Create demo tenant |
| GET | `/enterprise/demo` | List demo tenants |
| POST | `/enterprise/demo/:id/reset` | Reset demo tenant |

### API Keys
| Method | Path | Description |
|--------|------|-------------|
| POST | `/enterprise/api-keys` | Create API key |
| GET | `/enterprise/api-keys` | List API keys |
| DELETE | `/enterprise/api-keys/:id` | Revoke API key |

### Customer Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/enterprise/health-score` | Compute tenant health score |

## Error Conventions

- `422` — Validation error: missing required field
- `403` — Feature gate: `compliance_export` not enabled
- `404` — Resource not found
- `500` — Internal server error with `{ error: 'internal', message: string }`

## Tenant ID Resolution

Tenant-scoped routes read `tenantId` from the `TenantRequest` middleware (set from JWT or header). The pattern:

```typescript
const tenantId = (req as unknown as Req).tenantId
```

Admin routes (`/subscriptions`, `/demo`, `/deployment/health`) do not require tenant scope.
