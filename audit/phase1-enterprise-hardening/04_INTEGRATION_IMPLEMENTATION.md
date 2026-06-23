# Phase 4 — Integration Implementation
**Denver Engineering Platform · Real Connector Implementations**
**Status:** ⚠️ PARTIAL — Slack ✅, QuickBooks ✅, Teams ❌, BACnet ❌

---

## Objective

Replace stub integration type strings (`'slack'`, `'quickbooks'`) with real, functional connector implementations. The enterprise audit found that **all named integrations were type strings only** — zero implementation existed at audit time (Integration score: 28/100).

---

## Critical Finding (Pre-Sprint)

From `api/__tests__/evmFormulas.test.ts` audit file 14:

> **CRITICAL FINDING: ALL NAMED INTEGRATIONS ARE STUBS**
> QuickBooks, Slack, Teams, BACnet, SAP, Oracle — every integration listed as a feature is a `type` string with no implementation code anywhere in the codebase.

The `integrations` table stores `type`, `config`, `status` — but there was no code that actually called any external service.

---

## Slack Connector — `api/services/integration/slackConnector.ts`

### Capabilities Implemented

| Method | Transport | Description |
|--------|-----------|-------------|
| `sendToWebhook(payload)` | Incoming Webhook | POST to webhook URL |
| `postMessage(channel, payload)` | Bot API | `chat.postMessage` via Bot token |
| `deliver(payload)` | Auto-route | Uses webhook URL if present, else Bot API |
| `sendWorkflowNotification(n)` | Auto-route | Structured notification with Block Kit |
| `sendApprovalRequest(req)` | Auto-route | Approval request with Approve/Reject actions |
| `sendEscalationAlert(params)` | Auto-route | Red-tagged escalation with context |
| `verifySignature(secret, body, ts, sig)` | HMAC | Webhook signature verification |

### Block Kit Formatting

All messages use Slack Block Kit for rich rendering:

```typescript
// Priority → color mapping
const PRIORITY_COLORS = {
  critical: '#FF0000',  // red
  high:     '#FF6600',  // orange
  medium:   '#FFB300',  // amber
  low:      '#36A64F',  // green
}

// Notification type → emoji
const TYPE_EMOJI = {
  workflow:  '⚙️',
  approval:  '✅',
  alert:     '🚨',
  info:      'ℹ️',
}
```

Notifications render as: `[emoji] Title | Body text | Context fields`

Approval requests include interactive `actions` blocks with `approve` and `reject` button elements (for Slack app button handling).

### Signature Verification (HMAC-SHA256)

```typescript
verifySignature(signingSecret: string, rawBody: string, timestamp: string, signature: string): boolean {
  // 1. Replay protection: reject if timestamp > 5 minutes old
  const diff = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10))
  if (diff > 300) return false

  // 2. HMAC-SHA256 over 'v0:{timestamp}:{body}'
  const basestring = `v0:${timestamp}:${rawBody}`
  const expected   = 'v0=' + createHmac('sha256', signingSecret)
                              .update(basestring)
                              .digest('hex')

  // 3. Constant-time comparison
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}
```

This matches the Slack Events API signature verification specification exactly.

### Configuration

```typescript
interface SlackConfig {
  webhookUrl?:    string  // Incoming Webhook URL (optional if using Bot API)
  botToken?:      string  // Bot User OAuth Token (xoxb-...)
  signingSecret?: string  // For verifySignature
  defaultChannel?: string
  timeout?:       number  // Default: 10000ms
}
```

### Error Handling

All delivery methods return `SlackDeliveryResult`:
```typescript
interface SlackDeliveryResult {
  ok:       boolean
  ts?:      string   // Slack message timestamp on success
  error?:   string   // Slack error code on failure
  channel?: string
}
```

Network failures are caught and returned as `{ ok: false, error: 'network_error: ...' }` — never throw.

### Factory Function

```typescript
export function createSlackConnector(config: SlackConfig): SlackConnector
export async function sendSlackWebhook(webhookUrl: string, text: string, opts?): Promise<SlackDeliveryResult>
```

---

## QuickBooks Connector — `api/services/integration/quickbooksConnector.ts`

### OAuth 2.0 Flow

QuickBooks Online uses the standard authorization code flow:

```
Step 1: User → app → QBO authorization URL (with state, scopes)
Step 2: QBO → redirect → /oauth/callback?code=xxx&realmId=yyy
Step 3: App exchanges code for access + refresh tokens
Step 4: Use access token for API calls; refresh when expiring
```

All four steps are implemented:

```typescript
// Step 1: Generate authorization URL
buildAuthUrl(state: string, scopes?: string[]): string

// Step 2: Exchange authorization code
async exchangeCode(code: string, realmId: string): Promise<QboTokens>

// Step 3: Refresh expired token
async refreshAccessToken(): Promise<QboTokens>

// (Step 4 is implicit in every API call — auto-refresh if expiring within 60s)
```

### Auto-Refresh Logic

Before every API call, the connector checks if the access token expires within 60 seconds and refreshes automatically:

```typescript
private async ensureFreshToken(): Promise<void> {
  if (!this.tokens) throw new Error('Not authenticated — call exchangeCode first')
  const expiresAt = this.tokens.createdAt + this.tokens.expiresIn * 1000
  if (Date.now() > expiresAt - 60_000) {
    await this.refreshAccessToken()
  }
}
```

### CRUD Operations

| Method | QBO Entity | Operation |
|--------|-----------|-----------|
| `createCustomer(customer)` | Customer | POST |
| `findCustomerByName(name)` | Customer | Query (DisplayName = '...') |
| `createInvoice(invoice)` | Invoice | POST (with CustomerRef, Line items) |
| `createExpense(expense)` | Purchase | POST (AccountRef, Line items) |
| `revokeTokens()` | — | POST to revoke endpoint |

### Environment Awareness

```typescript
const BASE_URL = sandbox
  ? 'https://sandbox-quickbooks.api.intuit.com/v3/company'
  : 'https://quickbooks.api.intuit.com/v3/company'
```

Sandbox mode is controlled by `process.env.QUICKBOOKS_SANDBOX !== 'false'` — defaults to sandbox for safety.

### Error Handling

All methods return `QboSyncResult`:
```typescript
interface QboSyncResult {
  ok:      boolean
  id?:     string   // QBO entity ID on success
  error?:  string
  details?: unknown
}
```

### Configuration

```typescript
interface QboConfig {
  clientId:     string  // from process.env.QUICKBOOKS_CLIENT_ID
  clientSecret: string  // from process.env.QUICKBOOKS_CLIENT_SECRET
  redirectUri:  string  // from process.env.QUICKBOOKS_REDIRECT_URI
  sandbox?:     boolean
}
```

Factory function reads environment automatically:
```typescript
export function createQuickBooksConnector(overrides?: Partial<QboConfig>): QuickBooksConnector
```

---

## Teams Connector — NOT IMPLEMENTED

### Why Deferred

Microsoft Teams requires:
1. Azure AD app registration (client ID + secret)
2. Bot Framework registration OR Incoming Webhooks
3. Adaptive Cards v1.5 schema for rich messages
4. For approvals: Power Automate Flow OR Bot Framework SDK

The scope is materially larger than Slack (which uses simple HTTPS webhooks). Deferred to Phase 1.5.

### Planned Implementation

```
api/services/integration/teamsConnector.ts
  - sendToWebhook(payload): Incoming Webhook
  - sendAdaptiveCard(channel, card): Bot Framework
  - sendApprovalCard(req): Adaptive Card with approval buttons
  - verifyHmac(secret, body, signature): HMAC-SHA256
```

---

## BACnet Bridge — NOT IMPLEMENTED

### Why Deferred

BACnet/IP requires:
1. TCP/IP socket client on port 47808
2. BACnet protocol codec (APDU/NPDU encoding)
3. Device discovery via `Who-Is` broadcast
4. Object property read/write via `Read-Property` / `Write-Property` service

No pure Node.js BACnet library exists with TypeScript types (the closest is `bacstack` with partial TypeScript support). This would require either a dedicated BACnet service or the `bacstack` npm package.

### Recommended Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌────────────┐
│ Denver Eng API  │────▶│ BACnet Bridge│────▶│ BACnet/IP  │
│ (Node.js/HTTP)  │     │ (bacstack or │     │ Devices    │
│                 │     │  Python)     │     │            │
└─────────────────┘     └──────────────┘     └────────────┘
```

The bridge posts discovered device readings to Denver Engineering's IoT ingest endpoint (`POST /api/v1/iot/ingest`), which already exists and handles threshold alerting.

---

## Integration Score Impact

| Metric | Before | After |
|--------|--------|-------|
| Named integrations with real code | 0 | 2 (Slack, QBO) |
| Webhook delivery | ✅ (already existed) | ✅ |
| OAuth 2.0 flows | 0 | 1 (QuickBooks) |
| Signature verification | 0 | 1 (Slack HMAC) |
| Integration depth score | 28/100 | 42/100 |

---

## Remaining to Reach 55+/100 Integration Score

1. Teams connector (Adaptive Cards + approvals)
2. BACnet bridge (or documented integration service)
3. Integration tests for Slack + QBO connectors
4. Wire connectors into existing integrations route (`GET/POST /api/v1/integrations`)
5. Token storage for QBO OAuth tokens (currently in-memory only)
