// Denver Engineering — Incident Correlation Service (Phase 11)
// Group related incidents into clusters to surface systemic issues

import { pool } from '../../db/pool'
import {
  IncidentCluster,
  IncidentClusterType,
  INCIDENT_CLUSTER_MIN_COUNT,
} from './phase11Types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapIncidentCluster(row: Record<string, unknown>): IncidentCluster {
  return {
    id: row.id as string,
    clusterType: row.cluster_type as IncidentClusterType,
    incidentCount: Number(row.incident_count),
    affectedTenants: Number(row.affected_tenants),
    firstSeenAt: new Date(row.first_seen_at as string),
    lastSeenAt: new Date(row.last_seen_at as string),
    status: row.status as 'active' | 'resolved' | 'monitoring',
    rootCause: row.root_cause as string | null,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Get or Create Cluster ────────────────────────────────────────────────────

export async function getOrCreateCluster(
  clusterType: IncidentClusterType
): Promise<IncidentCluster> {
  const existing = await pool.query(
    `SELECT * FROM incident_clusters WHERE cluster_type = $1 AND status = 'active'`,
    [clusterType]
  )
  if (existing.rows.length > 0) return _mapIncidentCluster(existing.rows[0])

  const result = await pool.query(
    `INSERT INTO incident_clusters
       (cluster_type, incident_count, affected_tenants, first_seen_at, last_seen_at,
        status, root_cause, created_at)
     VALUES ($1, 0, 0, NOW(), NOW(), 'active', NULL, NOW())
     RETURNING *`,
    [clusterType]
  )
  return _mapIncidentCluster(result.rows[0])
}

// ─── Record Incident to Cluster ───────────────────────────────────────────────

export async function recordIncidentToCluster(
  clusterType: IncidentClusterType,
  tenantId: string
): Promise<IncidentCluster> {
  const cluster = await getOrCreateCluster(clusterType)

  // Check if this tenant is already counted
  const tenantCheck = await pool.query(
    `SELECT COUNT(DISTINCT tenant_id) as count FROM support_triage_records
     WHERE cluster_type = $1`,
    [clusterType]
  )
  const affectedTenants = Number(tenantCheck.rows[0]?.count ?? 0)

  const result = await pool.query(
    `UPDATE incident_clusters
     SET incident_count = incident_count + 1,
         affected_tenants = $1,
         last_seen_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [affectedTenants, cluster.id]
  )
  return _mapIncidentCluster(result.rows[0])
}

// ─── Get Active Clusters ──────────────────────────────────────────────────────

export async function getActiveClusters(): Promise<IncidentCluster[]> {
  const result = await pool.query(
    `SELECT * FROM incident_clusters WHERE status = 'active' ORDER BY last_seen_at DESC`
  )
  return result.rows.map(_mapIncidentCluster)
}

// ─── Get Cluster ─────────────────────────────────────────────────────────────

export async function getCluster(clusterId: string): Promise<IncidentCluster | null> {
  const result = await pool.query(
    `SELECT * FROM incident_clusters WHERE id = $1`,
    [clusterId]
  )
  return result.rows.length > 0 ? _mapIncidentCluster(result.rows[0]) : null
}

// ─── Resolve Cluster ──────────────────────────────────────────────────────────

export async function resolveCluster(
  clusterId: string,
  rootCause: string
): Promise<IncidentCluster> {
  const result = await pool.query(
    `UPDATE incident_clusters
     SET status = 'resolved', root_cause = $1
     WHERE id = $2
     RETURNING *`,
    [rootCause, clusterId]
  )
  if (result.rows.length === 0) {
    throw new Error(`Cluster ${clusterId} not found`)
  }
  return _mapIncidentCluster(result.rows[0])
}

// ─── Mark Cluster Monitoring ──────────────────────────────────────────────────

export async function markClusterMonitoring(clusterId: string): Promise<IncidentCluster> {
  const result = await pool.query(
    `UPDATE incident_clusters SET status = 'monitoring' WHERE id = $1 RETURNING *`,
    [clusterId]
  )
  if (result.rows.length === 0) {
    throw new Error(`Cluster ${clusterId} not found`)
  }
  return _mapIncidentCluster(result.rows[0])
}

// ─── Is Cluster Significant ───────────────────────────────────────────────────

export function isClusterSignificant(cluster: IncidentCluster): boolean {
  return cluster.incidentCount >= INCIDENT_CLUSTER_MIN_COUNT
}

// ─── Get Significant Active Clusters ─────────────────────────────────────────

export async function getSignificantActiveClusters(): Promise<IncidentCluster[]> {
  const result = await pool.query(
    `SELECT * FROM incident_clusters
     WHERE status = 'active' AND incident_count >= $1
     ORDER BY incident_count DESC`,
    [INCIDENT_CLUSTER_MIN_COUNT]
  )
  return result.rows.map(_mapIncidentCluster)
}

// ─── Compute Cluster Severity ─────────────────────────────────────────────────

export function computeClusterSeverity(
  cluster: IncidentCluster
): 'critical' | 'high' | 'medium' | 'low' {
  if (cluster.affectedTenants >= 10 || cluster.incidentCount >= 20) return 'critical'
  if (cluster.affectedTenants >= 5 || cluster.incidentCount >= 10) return 'high'
  if (cluster.incidentCount >= INCIDENT_CLUSTER_MIN_COUNT) return 'medium'
  return 'low'
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapIncidentCluster,
  isClusterSignificant,
  computeClusterSeverity,
}
