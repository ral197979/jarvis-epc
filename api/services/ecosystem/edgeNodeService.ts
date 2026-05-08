// Denver Engineering — Edge Node Service (v9.0.0)
// Site-local execution: signed node identity, offline operation, conflict detection,
// revocation support.

import { createHash } from 'crypto'
import { pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import { EdgeNode, EdgeSyncSession, EdgeNodeStatus, EdgeSyncStatus } from './ecosystemTypes'

// ─── Node registration ────────────────────────────────────────────────────────

export interface RegisterNodeInput {
  nodeName: string
  publicKey: string
  siteRef?: string
  version?: string
  capabilities?: string[]
}

export async function registerEdgeNode(
  tenantId: string,
  input: RegisterNodeInput,
): Promise<EdgeNode> {
  const res = await tenantQuery(
    tenantId,
    `INSERT INTO edge_nodes
      (tenant_id, node_name, public_key, site_ref, version, capabilities)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [
      tenantId, input.nodeName, input.publicKey,
      input.siteRef ?? null, input.version ?? '1.0.0',
      input.capabilities ?? [],
    ],
  )
  return _mapNode(res.rows[0])
}

export async function getEdgeNode(tenantId: string, nodeId: string): Promise<EdgeNode | null> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM edge_nodes WHERE id = $1 AND tenant_id = $2`,
    [nodeId, tenantId],
  )
  return res.rows.length > 0 ? _mapNode(res.rows[0]) : null
}

export async function listEdgeNodes(tenantId: string): Promise<EdgeNode[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM edge_nodes WHERE tenant_id = $1 AND revoked_at IS NULL
     ORDER BY created_at DESC`,
    [tenantId],
  )
  return res.rows.map(_mapNode)
}

export async function updateNodeStatus(
  tenantId: string,
  nodeId: string,
  status: EdgeNodeStatus,
): Promise<EdgeNode> {
  const res = await tenantQuery(
    tenantId,
    `UPDATE edge_nodes
     SET status = $3, last_seen_at = CASE WHEN $3 = 'active' THEN now() ELSE last_seen_at END,
         updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [nodeId, tenantId, status],
  )
  if (res.rows.length === 0) throw new Error(`Edge node ${nodeId} not found`)
  return _mapNode(res.rows[0])
}

export async function heartbeatNode(tenantId: string, nodeId: string): Promise<void> {
  await tenantQuery(
    tenantId,
    `UPDATE edge_nodes SET last_seen_at = now(), status = 'active', updated_at = now()
     WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL`,
    [nodeId, tenantId],
  )
}

export async function revokeEdgeNode(
  tenantId: string,
  nodeId: string,
): Promise<void> {
  await tenantQuery(
    tenantId,
    `UPDATE edge_nodes
     SET status = 'decommissioned', revoked_at = now(), updated_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [nodeId, tenantId],
  )
}

// ─── Sync sessions ────────────────────────────────────────────────────────────

export async function startSyncSession(
  tenantId: string,
  nodeId: string,
): Promise<EdgeSyncSession> {
  const res = await tenantQuery(
    tenantId,
    `INSERT INTO edge_sync_sessions (edge_node_id, tenant_id, status)
     VALUES ($1,$2,'syncing')
     RETURNING *`,
    [nodeId, tenantId],
  )
  return _mapSyncSession(res.rows[0])
}

export interface CompleteSyncInput {
  eventsSent?: number
  eventsReceived?: number
  conflictsDetected?: number
  conflictsResolved?: number
  status?: EdgeSyncStatus
}

export async function completeSyncSession(
  tenantId: string,
  sessionId: string,
  input: CompleteSyncInput = {},
): Promise<EdgeSyncSession> {
  const status = input.status ?? (
    (input.conflictsDetected ?? 0) > (input.conflictsResolved ?? 0) ? 'conflict' : 'completed'
  )

  const res = await tenantQuery(
    tenantId,
    `UPDATE edge_sync_sessions
     SET status = $3,
         events_sent = $4,
         events_received = $5,
         conflicts_detected = $6,
         conflicts_resolved = $7,
         completed_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [
      sessionId, tenantId, status,
      input.eventsSent ?? 0, input.eventsReceived ?? 0,
      input.conflictsDetected ?? 0, input.conflictsResolved ?? 0,
    ],
  )
  if (res.rows.length === 0) throw new Error(`Sync session ${sessionId} not found`)
  return _mapSyncSession(res.rows[0])
}

export async function getLatestSyncSession(
  tenantId: string,
  nodeId: string,
): Promise<EdgeSyncSession | null> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM edge_sync_sessions
     WHERE edge_node_id = $1 AND tenant_id = $2
     ORDER BY started_at DESC LIMIT 1`,
    [nodeId, tenantId],
  )
  return res.rows.length > 0 ? _mapSyncSession(res.rows[0]) : null
}

// ─── Command queue ────────────────────────────────────────────────────────────

export async function enqueueCommand(
  tenantId: string,
  nodeId: string,
  commandType: string,
  payload: Record<string, unknown>,
  priority: number = 5,
  expiresInMs?: number,
): Promise<void> {
  const expiresAt = expiresInMs != null
    ? new Date(Date.now() + expiresInMs).toISOString()
    : null

  await tenantQuery(
    tenantId,
    `INSERT INTO edge_command_queue
      (edge_node_id, tenant_id, command_type, payload, priority, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [nodeId, tenantId, commandType, JSON.stringify(payload), priority, expiresAt],
  )
}

export async function getPendingCommands(
  tenantId: string,
  nodeId: string,
): Promise<Array<{ id: string; commandType: string; payload: Record<string, unknown>; priority: number }>> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM edge_command_queue
     WHERE edge_node_id = $1 AND tenant_id = $2
       AND delivered = FALSE
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY priority ASC, created_at ASC`,
    [nodeId, tenantId],
  )
  return res.rows.map(r => ({
    id: r['id'] as string,
    commandType: r['command_type'] as string,
    payload: (typeof r['payload'] === 'string'
      ? JSON.parse(r['payload'])
      : r['payload']) as Record<string, unknown>,
    priority: Number(r['priority']),
  }))
}

export async function acknowledgeCommand(tenantId: string, commandId: string): Promise<void> {
  await tenantQuery(
    tenantId,
    `UPDATE edge_command_queue
     SET delivered = TRUE, delivered_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [commandId, tenantId],
  )
}

// ─── Audit buffer ─────────────────────────────────────────────────────────────

export async function bufferAuditEvent(
  tenantId: string,
  nodeId: string,
  eventType: string,
  eventData: Record<string, unknown>,
  localSequence: number,
): Promise<void> {
  await tenantQuery(
    tenantId,
    `INSERT INTO edge_audit_buffers
      (edge_node_id, tenant_id, event_type, event_data, local_sequence)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (edge_node_id, local_sequence) DO NOTHING`,
    [nodeId, tenantId, eventType, JSON.stringify(eventData), localSequence],
  )
}

export async function flushAuditBuffer(tenantId: string, nodeId: string): Promise<number> {
  const res = await tenantQuery(
    tenantId,
    `UPDATE edge_audit_buffers
     SET synced = TRUE, synced_at = now()
     WHERE edge_node_id = $1 AND tenant_id = $2 AND synced = FALSE
     RETURNING id`,
    [nodeId, tenantId],
  )
  return res.rows.length
}

// ─── Node identity verification ───────────────────────────────────────────────

export function computeNodeIdentityHash(publicKey: string, nodeName: string): string {
  return createHash('sha256').update(`${publicKey}:${nodeName}`).digest('hex')
}

export function isNodeRevoked(node: EdgeNode): boolean {
  return node.revokedAt != null
}

// ─── Admin: cross-tenant node health ─────────────────────────────────────────

export async function getAllEdgeNodeStatuses(): Promise<
  Array<{ tenantId: string; nodeId: string; status: EdgeNodeStatus; lastSeenAt: Date | null }>
> {
  const res = await pool.query(
    `SELECT tenant_id, id, status, last_seen_at FROM edge_nodes
     WHERE revoked_at IS NULL ORDER BY last_seen_at DESC NULLS LAST`,
  )
  return res.rows.map(r => ({
    tenantId: r['tenant_id'] as string,
    nodeId: r['id'] as string,
    status: r['status'] as EdgeNodeStatus,
    lastSeenAt: r['last_seen_at'] != null ? new Date(r['last_seen_at'] as string) : null,
  }))
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function _mapNode(row: Record<string, unknown>): EdgeNode {
  return {
    id: row['id'] as string,
    tenantId: row['tenant_id'] as string,
    nodeName: row['node_name'] as string,
    siteRef: (row['site_ref'] as string) ?? null,
    status: row['status'] as EdgeNodeStatus,
    publicKey: row['public_key'] as string,
    lastSeenAt: row['last_seen_at'] != null ? new Date(row['last_seen_at'] as string) : null,
    version: row['version'] as string,
    capabilities: (row['capabilities'] as string[]) ?? [],
    metadata: (typeof row['metadata'] === 'string'
      ? JSON.parse(row['metadata'])
      : row['metadata']) as Record<string, unknown>,
    revokedAt: row['revoked_at'] != null ? new Date(row['revoked_at'] as string) : null,
    createdAt: new Date(row['created_at'] as string),
    updatedAt: new Date(row['updated_at'] as string),
  }
}

function _mapSyncSession(row: Record<string, unknown>): EdgeSyncSession {
  return {
    id: row['id'] as string,
    edgeNodeId: row['edge_node_id'] as string,
    tenantId: row['tenant_id'] as string,
    status: row['status'] as EdgeSyncStatus,
    eventsSent: Number(row['events_sent'] ?? 0),
    eventsReceived: Number(row['events_received'] ?? 0),
    conflictsDetected: Number(row['conflicts_detected'] ?? 0),
    conflictsResolved: Number(row['conflicts_resolved'] ?? 0),
    startedAt: new Date(row['started_at'] as string),
    completedAt: row['completed_at'] != null ? new Date(row['completed_at'] as string) : null,
  }
}

export const __testHooks = {
  _mapNode, _mapSyncSession, computeNodeIdentityHash, isNodeRevoked,
}
