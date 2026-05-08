# External Automation Adapters

## Overview

The Automation Adapter Service provides a bidirectional event bridge between Ava and external tools (Slack, PagerDuty, Jira, custom webhooks). Inbound events are ingested idempotently; outbound events are delivered with HMAC-signed payloads. A dead-letter queue captures events that exceed retry limits.

## Adapter Types

| Type | Direction | Description |
|---|---|---|
| `webhook_inbound` | → Ava | External systems push events to Ava |
| `webhook_outbound` | Ava → | Ava pushes events to external endpoints |
| `polling` | → Ava | Ava polls external systems on schedule |
| `bidirectional` | ↔ | Full two-way event exchange |

## Creating an Adapter

```typescript
const { adapter, signingSecret } = await createAdapter(tenantId, {
  name: 'Slack Notifier',
  adapterType: 'webhook_outbound',
  endpointUrl: 'https://hooks.slack.com/services/...',
  rateLimitRpm: 60,
  metadata: { channel: '#incidents' },
})
// signingSecret is returned ONCE — use it to sign outbound payloads
```

The `signingSecret` is a 64-character hex string generated per adapter. It is stored in the database but should be treated as a credential. The raw value is returned only at creation time.

## Inbound Event Ingestion

```typescript
const event = await ingestInboundEvent(tenantId, adapterId, {
  eventType: 'ticket.created',
  payload: { id: 'TKT-123', priority: 'high' },
  idempotencyKey: 'event-uuid-from-source',
  signature: 'hmac-sha256-from-source',
  rawBody: '...original-raw-body...',
})
```

Idempotency is enforced via `ON CONFLICT (adapter_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET updated_at = now()`. Duplicate events are safely ignored.

If `signature` and `rawBody` are provided, the adapter's stored signing secret is used to verify the HMAC before processing.

## Outbound Event Delivery

```typescript
const event = await sendOutboundEvent(
  tenantId,
  adapterId,
  'alert.triggered',
  { message: 'SLA breach detected', severity: 'high' },
  'idempotency-key-optional',
)
```

## Payload Signing

```typescript
const sig = signPayload(signingSecret, rawBodyString)
const valid = verifySignature(signingSecret, rawBodyString, sig)
```

Uses HMAC-SHA256. All outbound webhook deliveries should include the signature in the `X-Ava-Signature` header so receivers can verify authenticity.

## Dead-Letter Queue

Events with `retry_count >= 3` and `processed = FALSE` appear in the dead-letter queue:

```typescript
const stalled = await getDeadLetterEvents(tenantId)
// Returns events that failed to process after 3+ attempts
```

These events require manual inspection or replay.

## Rate Limiting

Each adapter has a `rate_limit_rpm` (requests per minute) field. The enforcement layer (not in this service) checks this limit before delivering outbound events.

## Related Services

- `knowledgeGraphService` — adapter events can create/update KG entities
- `workflowComposerService` — adapter events can trigger workflows
- `externalAgentGateway` — agents can be invoked in response to adapter events
