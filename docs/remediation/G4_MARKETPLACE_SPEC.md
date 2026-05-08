# G4 — Partner Marketplace v0 Spec

**Gap class:** LAG
**Release slot:** v4.33.0
**Competitive reference:** Procore Marketplace, Autodesk App Store
**Status:** DRAFT — awaiting owner approval

---

## Target end-state

Owner-scoped marketplace where third-party MCP skills + integrations can be enabled or disabled per tenant. All marketplace skills run under bounded, owner-approved capabilities — extending the Owner-First Audit governance philosophy to partner code.

**v0 is curated, not open** — only skills vetted by Rommel appear. No self-serve publisher flow yet.

---

## Design principles

1. **Owner-first.** Only `role=owner` can enable/disable skills. `role=exec` or below can view.
2. **Bounded capabilities.** Every marketplace skill declares a capability manifest; JARVIS enforces those bounds at runtime.
3. **Audited.** Every enable/disable writes to `audit_log` with user + timestamp + diff.
4. **Opt-in.** Marketplace skills default to disabled; must be explicitly enabled per tenant.
5. **Reversible.** One-click disable; data boundary is clear.
6. **Isolated.** Marketplace skills cannot call private APIs; they use the public API surface only.

---

## Data model extensions

### Extend `src/constants/mcpTools.ts`

Add fields to existing `MCPTool` type:

```typescript
interface MCPTool {
  name: string;
  description: string;
  category: MCPToolCategory;
  parameters: MCPToolParameter[];
  // New fields:
  source: 'builtin' | 'marketplace';
  publisher?: string;           // e.g., "Acme Drone Analytics"
  publisher_url?: string;
  version?: string;              // semver
  enabled?: boolean;             // per-tenant setting
  capability_scopes: string[];   // e.g., ['read:rfi', 'write:notes', 'read:files']
  icon_url?: string;
}
```

### Registry JSON schema

New file: `api/data/marketplace-registry.json`

```json
{
  "version": "1.0.0",
  "skills": [
    {
      "id": "cost-analytics-v1",
      "name": "Cost Analytics Copilot",
      "publisher": "Example Analytics Co",
      "publisher_url": "https://example-analytics.co",
      "version": "1.0.0",
      "description": "Surfaces cost variance insights across projects using embedded LLM analysis.",
      "category": "AI",
      "capability_scopes": ["read:projects", "read:budgets", "read:costs"],
      "mcp_endpoint": "https://partners.example-analytics.co/mcp",
      "icon_url": "https://cdn.denver-engineering.io/marketplace/cost-analytics.png",
      "vetted_by": "rommel",
      "vetted_at": "2026-07-01"
    }
  ]
}
```

### Database schema (migration 007)

File: `api/db/migrations/007_marketplace.sql`

```sql
CREATE TABLE tenant_marketplace_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  skill_id TEXT NOT NULL,              -- matches registry id
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  enabled_by UUID REFERENCES users(id),
  enabled_at TIMESTAMPTZ,
  disabled_by UUID REFERENCES users(id),
  disabled_at TIMESTAMPTZ,
  capability_grants JSONB NOT NULL DEFAULT '[]',
  UNIQUE(tenant_id, skill_id)
);
CREATE INDEX tms_tenant ON tenant_marketplace_settings(tenant_id);

ALTER TABLE tenant_marketplace_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tms ON tenant_marketplace_settings
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

---

## API surface

New file: `api/routes/marketplace.ts`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/marketplace/registry` | user | Full registry JSON (public info) |
| `GET` | `/api/v1/marketplace/installed` | user | Enabled skills for current tenant |
| `POST` | `/api/v1/marketplace/install` | owner only | Enable a skill; records capability grants |
| `DELETE` | `/api/v1/marketplace/install/:skill_id` | owner only | Disable a skill |
| `GET` | `/api/v1/marketplace/audit/:skill_id` | owner | Install/disable history + per-invocation audit log |

All mutations log to existing `audit_log` table.

---

## Frontend

### New component: `src/components/MarketplacePage.tsx`

- Catalog grid (card per skill: icon, name, publisher, scopes, version, enable toggle)
- Filter by category, enabled-only, publisher
- Detail modal on click: full description, scopes requested, data boundary doc link, publisher info
- Install action requires re-auth confirmation (owner PIN / 2FA) for high-scope grants

### Navigation

Add to `src/config/navigation.ts`:

```typescript
{ id: 'marketplace', label: 'Marketplace', icon: 'store',
  domain: 'System', component: MarketplacePage }
```

Owner-only by default; surface in `OwnerPanel.tsx` shortcuts.

---

## Capability-scope enforcement

When a marketplace skill invokes an MCP tool, the gateway middleware checks:

1. Skill is enabled for this tenant
2. Requested tool's required scopes ⊆ grants in `tenant_marketplace_settings.capability_grants`
3. Log the invocation to `audit_log` with skill id + tool name + user + timestamp + args-hash

**Gateway middleware location:** `api/middleware/marketplaceAuth.ts` (new). Applied to `/mcp/*` routes before the upstream proxy.

---

## Launch partner shortlist (proposed)

| Partner area | Candidate offering | Example scopes |
|---|---|---|
| Cost analytics | EVM variance + forecast copilot | `read:projects`, `read:budgets`, `read:costs` |
| Drone site imagery | Progress photo ingestion + AI progress scoring | `read:projects`, `write:daily_logs`, `write:files` |
| Contract redline | Clause extraction + playbook comparison | `read:contracts`, `write:notes` |

LOI template + data-handling agreement live alongside this spec (separate doc, see P3 SOC2 readiness).

---

## Acceptance criteria

- [ ] Registry JSON validates against JSON Schema (stored in `api/data/marketplace-registry.schema.json`)
- [ ] Owner can enable a skill; audit log shows entry with timestamp + user
- [ ] Non-owner user cannot enable/disable (403 returned, audit log shows denial)
- [ ] Enabled skill's tool calls succeed; scope-outside calls return 403 + log entry
- [ ] Disabled skill's tools are filtered out of the MCP tools list
- [ ] RLS test: tenant A's enablements invisible to tenant B
- [ ] `MarketplacePage` renders catalog; filter + detail modal work
- [ ] E2E test `marketplace-install.spec.ts` covers install → tool-call → disable
- [ ] `CHANGELOG.md` v4.33.0 entry

---

## Out of scope (v0)

- Self-serve publisher portal
- Payments / billing between owner and publisher
- User reviews / ratings
- Partner sandbox / staging environment
- Cross-tenant skill sharing
- Revenue share accounting

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Marketplace skill escape (calls outside granted scopes) | High | Middleware enforcement + audit-log + automatic disable on scope violation |
| Partner MCP endpoint outage | Medium | Per-skill circuit breaker; skill auto-disables after 5 consecutive failures |
| Data exfiltration via over-broad scope grants | High | Scope catalog is explicit; each scope documented; grant requires owner re-auth |
| Publisher disputes over capability boundary | Low | LOI + data-handling agreement signed pre-launch |

---

## Effort estimate

| Slice | Days |
|---|---|
| Schema + registry + API routes | 2 |
| MarketplacePage + navigation + OwnerPanel | 1.5 |
| Capability middleware + audit-log integration | 1 |
| E2E test + documentation | 0.5 |
| **Total engineering** | **5 days** |
| Partner outreach (parallel) | 15 days elapsed |

---

## Owner approval

- [ ] **Approved** — v0 marketplace as specified; launch with 3 vetted partners
- [ ] **Approved with adjustments:** __________
- [ ] **Rejected** — reason: __________
- [ ] **Deferred** — re-review at date: ______________

Signed: _________________________  Date: _______________
