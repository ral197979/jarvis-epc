# 14 — INTEGRATION AUDIT
## QuickBooks, Slack, BACnet, SAP, Oracle — Reality Check

---

## Critical Finding Upfront

> **The integration layer is a framework with no connector implementations.**

The `connectorFramework.ts` defines types for `slack | teams | email | erp | cmms | bacnet | quickbooks | sap | oracle | webhook | custom` but there is **zero connector-specific code** in the entire codebase. Every integration listed in marketing materials is a placeholder awaiting implementation.

---

## Integration Architecture

**Implementation:** `api/services/integration/connectorFramework.ts` + `api/routes/integrations.ts`

### What Exists (Verified)

```typescript
// ConnectorType union (framework-only):
export type ConnectorType =
  | 'slack' | 'teams' | 'email' | 'erp' | 'cmms' | 'bacnet'
  | 'quickbooks' | 'sap' | 'oracle' | 'webhook' | 'custom'

// Connector registry — CRUD for integration records in DB
// createConnector() → INSERT INTO integrations
// listConnectors() → SELECT FROM integrations
// getConnectorHealth() → computes health score from sync history

// Health scoring (real):
// -15 per consecutive failure (up to -60)
// -20 if last sync > 24h ago
// -10 if last sync 6-24h ago
```

### What Does NOT Exist

No files found containing:
- QuickBooks API calls (`qbo.intuit.com`, `oauth2.intuit.com`)
- Slack Web API (`slack.com/api/`, `@slack/web-api`)
- BACnet protocol (`bacnet`, `node-bacstack`, `BACnet/IP`)
- SAP BAPI or RFC calls
- Oracle API endpoints
- Microsoft Teams webhook calls
- CMMS-specific sync logic (Maximo, Fiix, UpKeep)

### Webhook Dispatcher (Real)

The one integration that is fully implemented:

```typescript
// dispatchWebhookEvent() — confirmed working
// Finds active webhooks subscribed to an event
// Signs payload with HMAC-SHA256 (webhook secret)
// Stores delivery record with retry tracking
// Retry backoff: 30s → 60s → 5m → 15m → 1h
```

Outbound webhooks work. Inbound connectors do not exist.

---

## Integration-by-Integration Assessment

### QuickBooks Online

**Claimed capability:** Sync project budgets, POs, vendor payments

**Reality:**
- `quickbooks` is a type string in `ConnectorType`
- No OAuth flow to Intuit
- No QuickBooks API endpoint calls
- No field mapping (QB account codes ↔ cost codes)

**Status: ❌ NOT IMPLEMENTED**

**Estimated effort to implement:** 3-4 weeks (OAuth2 PKCE, QB API client, field mapping, sync job, error handling)

---

### Slack

**Claimed capability:** Channel notifications, action updates

**Reality:**
- `slack` is a type string in `ConnectorType`  
- No Slack Web API SDK (`@slack/web-api` not in package.json)
- No bot token management
- No channel webhook targets

**Status: ❌ NOT IMPLEMENTED**

**Note:** Outbound webhook dispatching (generic) could target a Slack incoming webhook URL — this is the only viable path today.

**Estimated effort:** 1-2 weeks for Slack incoming webhooks; 3-4 weeks for full bot integration

---

### BACnet/IP

**Claimed capability:** Direct OT device communication for PWTP/WWTP

**Reality:**
- `bacnet` is a type string in `ConnectorType`
- No `node-bacstack` or similar BACnet library in package.json
- No BACnet/IP polling scheduler
- IoT ingest accepts HTTP only — BACnet requires active polling of field devices

**Status: ❌ NOT IMPLEMENTED**

**Path forward:** Deploy Telegraf with BACnet plugin on-premises → HTTP output to `/api/v1/iot/ingest`. This is documented in IoT audit as the intended architecture.

---

### SAP / Oracle ERP

**Claimed capability:** Cost sync, vendor master, purchase orders

**Reality:**
- Type strings only
- No SAP BAPI, RFC, or OData client
- No Oracle EBS/Cloud API integration
- No field mapping between ERP account structures and Denver Eng cost codes

**Status: ❌ NOT IMPLEMENTED**

**These are 6-12 week integrations per ERP system.**

---

### Microsoft Teams

**Claimed capability:** Notifications, approval workflows

**Reality:**
- `teams` is a type string in `ConnectorType`
- No Teams Incoming Webhook targets
- No Adaptive Cards for approval workflow

**Status: ❌ NOT IMPLEMENTED**

---

### Email

**Claimed capability:** Notification delivery

**Reality:**
- `email` is in `ConnectorType`
- Notification system references email delivery
- No SMTP library found in package.json (`nodemailer` not present)
- Email delivery backend not confirmed from source

**Status: 🟡 PARTIALLY IMPLEMENTED** — schema exists, actual SMTP delivery unconfirmed

---

### Webhook (Generic)

**Status: ✅ FULLY IMPLEMENTED**

```typescript
// Features:
// - Webhook registry per tenant
// - Event subscription (e.g., project.created, action.completed)
// - HMAC-SHA256 signing
// - Retry with exponential backoff
// - Delivery log with status
// - Configurable timeout per webhook
```

This is the one real integration mechanism.

---

## IntegrationHub Route

**Implementation:** `api/routes/integrationHub.ts` (separate from `api/routes/integrations.ts`)

Additional hub routes for an ecosystem view of all integrations. Both files connect to the same `integrations` table.

---

## Integration Status Matrix

| Integration | Implemented | Framework Only | Not Started |
|-------------|------------|----------------|-------------|
| Outbound Webhooks | ✅ | | |
| Generic HTTP/REST | ✅ (via IoT) | | |
| Email notifications | 🟡 | | |
| Slack | | 🟡 | |
| Microsoft Teams | | 🟡 | |
| QuickBooks Online | | 🟡 | |
| SAP | | 🟡 | |
| Oracle ERP | | 🟡 | |
| BACnet/IP | | 🟡 | |
| Modbus | | 🟡 | |
| OPC-UA | | 🟡 | |
| Procore import | | | ❌ |
| P6 schedule import | | | ❌ |

---

## Integration Score: 28/100

**What works:** Outbound webhooks, IoT HTTP ingest, connector registry CRUD, health scoring framework.

**What doesn't:** Every named integration (QuickBooks, Slack, BACnet, SAP, Oracle) is a type constant with no implementation behind it.

**Honest assessment:** The integration layer provides the correct infrastructure pattern (registry, credential vault abstraction, health scoring, retry backoff) but requires 6-18 months of connector development to fulfill its stated capabilities.
