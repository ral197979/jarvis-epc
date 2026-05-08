# Edge Site Execution Nodes

## Overview

Edge Nodes are registered endpoints at remote or isolated sites that maintain connectivity with the Ava platform. They receive commands, execute local workflows, buffer audit events when offline, and sync state when reconnected. Each node has a cryptographic identity derived from its public key.

## Node Identity

Every node is identified by an `identity_hash` computed as:

```typescript
SHA-256(`${publicKey}:${nodeName}`)
```

`computeNodeIdentityHash(publicKey, nodeName)` is deterministic — the same inputs always produce the same hash. This makes node re-registration idempotent when recovering from a failure.

## Node Lifecycle

```
Register node
  → registerEdgeNode() creates node with status='provisioning'
  → identity_hash stored for future verification

Active operation
  → heartbeatNode() updates last_seen_at, sets status='active'
  → only works when revoked_at IS NULL (revoked nodes cannot heartbeat)

Status transitions
  → updateNodeStatus() transitions between operational states
  → last_seen_at updated via CASE WHEN $3 = 'active' THEN now() ELSE last_seen_at END

Revocation
  → revokeEdgeNode(tenantId, nodeId) returns void
  → sets status='decommissioned', revoked_at=now()
  → node is permanently decommissioned
```

## Revocation Check

```typescript
isNodeRevoked(node: EdgeNode): boolean
// Returns true when node.revokedAt != null
```

Revoked nodes are excluded from heartbeat updates and command delivery.

## Command Queue

Commands are queued for async delivery to edge nodes:

```typescript
await enqueueCommand(tenantId, nodeId, 'reload_config', { version: '2.1' }, priority=10)
```

`getPendingCommands()` returns undelivered commands ordered by `priority ASC, created_at ASC`. Once a node receives a command, it calls `acknowledgeCommand()` which sets `delivered = TRUE, delivered_at = now()`.

## Sync Sessions

When an edge node reconnects after offline operation, it initiates a sync session:

```typescript
const session = await startSyncSession(tenantId, nodeId)
// ... sync data ...
const result = await completeSyncSession(tenantId, session.id, {
  eventsSent: 42,
  conflictsDetected: 3,
  conflictsResolved: 3,
})
// If conflictsDetected > conflictsResolved → status='conflict'
// Otherwise → status='completed'
```

## Audit Buffer

Edge nodes buffer audit events locally during offline periods:

```typescript
// Buffer locally (5-param call)
await bufferAuditEvent(tenantId, nodeId, 'inspection.completed', { result: 'pass' }, localSequence)

// Flush when reconnected — returns count of events synced
const flushed = await flushAuditBuffer(tenantId, nodeId)
```

`ON CONFLICT (edge_node_id, local_sequence) DO NOTHING` prevents duplicate audit events during partial syncs.

## Admin Overview

`getAllEdgeNodeStatuses()` uses `pool` (bypassing RLS) to return a cross-tenant view of all node statuses. This admin-only function is for platform health dashboards.

## Related Services

- `knowledgeGraphService` — edge sites are modeled as KG entities
- `workflowComposerService` — edge workflows execute on remote nodes
- `certificationEvidenceService` — edge audit buffers feed compliance evidence
