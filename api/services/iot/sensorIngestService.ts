/**
 * Denver Engineering — IoT Sensor Ingest Service (v10.5.0)
 * ──────────────────────────────────────────────────────────
 * Handles sensor registration, reading ingest (single + batch),
 * threshold-based alert evaluation, and dashboard queries.
 *
 * Ingest pipeline:
 *   1. Resolve sensor_uid → sensor record (auto-register if unknown)
 *   2. Write sensor_readings row
 *   3. Update sensors.last_value + last_reading_at
 *   4. Evaluate alert thresholds → open/close sensor_alerts
 */
import { createHash, randomBytes } from 'crypto'
import { pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SensorRecord {
  id:             string
  projectId:      string
  edgeNodeId:     string | null
  bimElementId:   string | null
  sensorUid:      string
  name:           string
  sensorType:     string
  unit:           string
  protocol:       string
  topic:          string | null
  warnLow:        number | null
  warnHigh:       number | null
  alertLow:       number | null
  alertHigh:      number | null
  lastValue:      number | null
  lastReadingAt:  string | null
  status:         string
  createdAt:      string
}

export interface SensorReading {
  id:         string
  sensorId:   string
  ts:         string
  value:      number
  quality:    string
  ingestedAt: string
}

export interface IngestItem {
  sensorUid:  string
  value:      number
  ts?:        string       // ISO timestamp; defaults to now
  quality?:   'good' | 'uncertain' | 'bad'
  raw?:       Record<string, unknown>
}

export interface IngestResult {
  accepted:  number
  rejected:  number
  errors:    string[]
  alerts:    number        // new alerts fired
}

// ─── Sensor CRUD ──────────────────────────────────────────────────────────────

export async function registerSensor(
  tenantId: string,
  input: {
    projectId:     string
    sensorUid:     string
    name:          string
    sensorType:    string
    unit:          string
    protocol?:     string
    topic?:        string
    edgeNodeId?:   string
    bimElementId?: string
    warnLow?:      number
    warnHigh?:     number
    alertLow?:     number
    alertHigh?:    number
    description?:  string
    metadata?:     Record<string, unknown>
  },
): Promise<SensorRecord> {
  const res = await tenantQuery(tenantId,
    `INSERT INTO sensors
       (tenant_id, project_id, sensor_uid, name, description, sensor_type, unit,
        protocol, topic, edge_node_id, bim_element_id,
        warn_low, warn_high, alert_low, alert_high, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (tenant_id, sensor_uid)
     DO UPDATE SET
       name=$4, description=$5, sensor_type=$6, unit=$7,
       protocol=$8, topic=$9, edge_node_id=$10, bim_element_id=$11,
       warn_low=$12, warn_high=$13, alert_low=$14, alert_high=$15,
       metadata=$16, updated_at=now()
     RETURNING *`,
    [tenantId, input.projectId, input.sensorUid, input.name,
     input.description ?? null, input.sensorType, input.unit,
     input.protocol ?? 'http', input.topic ?? null,
     input.edgeNodeId ?? null, input.bimElementId ?? null,
     input.warnLow ?? null, input.warnHigh ?? null,
     input.alertLow ?? null, input.alertHigh ?? null,
     JSON.stringify(input.metadata ?? {})],
  )
  return _mapSensor(res.rows[0])
}

export async function getSensor(tenantId: string, sensorId: string): Promise<SensorRecord | null> {
  const res = await tenantQuery(tenantId,
    `SELECT * FROM sensors WHERE id=$1 AND tenant_id=$2`,
    [sensorId, tenantId],
  )
  return res.rows[0] ? _mapSensor(res.rows[0]) : null
}

export async function listSensors(
  tenantId: string,
  projectId?: string,
): Promise<SensorRecord[]> {
  const res = await tenantQuery(tenantId,
    `SELECT * FROM sensors
     WHERE tenant_id=$1 AND ($2::uuid IS NULL OR project_id=$2)
     ORDER BY name`,
    [tenantId, projectId ?? null],
  )
  return res.rows.map(_mapSensor)
}

export async function updateSensorThresholds(
  tenantId: string,
  sensorId: string,
  thresholds: { warnLow?: number | null; warnHigh?: number | null; alertLow?: number | null; alertHigh?: number | null },
): Promise<SensorRecord | null> {
  const res = await tenantQuery(tenantId,
    `UPDATE sensors SET
       warn_low=$3, warn_high=$4, alert_low=$5, alert_high=$6, updated_at=now()
     WHERE id=$1 AND tenant_id=$2 RETURNING *`,
    [sensorId, tenantId,
     thresholds.warnLow ?? null, thresholds.warnHigh ?? null,
     thresholds.alertLow ?? null, thresholds.alertHigh ?? null],
  )
  return res.rows[0] ? _mapSensor(res.rows[0]) : null
}

// ─── Ingest pipeline ──────────────────────────────────────────────────────────

export async function ingestBatch(
  tenantId: string,
  projectId: string,
  items: IngestItem[],
): Promise<IngestResult> {
  let accepted = 0; let rejected = 0; let alertsFired = 0
  const errors: string[] = []

  // Load all known sensors for this tenant in one query
  const allRes = await tenantQuery(tenantId,
    `SELECT * FROM sensors WHERE tenant_id=$1`,
    [tenantId],
  )
  const sensorByUid = new Map<string, Record<string, unknown>>(
    allRes.rows.map(r => [r.sensor_uid as string, r])
  )

  for (const item of items) {
    try {
      let sensorRow = sensorByUid.get(item.sensorUid)

      // Auto-register unknown sensors as generic HTTP sensors
      if (!sensorRow) {
        const autoRes = await tenantQuery(tenantId,
          `INSERT INTO sensors
             (tenant_id, project_id, sensor_uid, name, sensor_type, unit, protocol)
           VALUES ($1,$2,$3,$4,'custom','raw','http')
           ON CONFLICT (tenant_id, sensor_uid) DO UPDATE SET updated_at=now()
           RETURNING *`,
          [tenantId, projectId, item.sensorUid, item.sensorUid],
        )
        sensorRow = autoRes.rows[0]!
        sensorByUid.set(item.sensorUid, sensorRow)
      }

      const sensorId = sensorRow['id'] as string
      const ts = item.ts ?? new Date().toISOString()

      // Write reading
      await tenantQuery(tenantId,
        `INSERT INTO sensor_readings (tenant_id, sensor_id, ts, value, quality, raw)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [tenantId, sensorId, ts, item.value,
         item.quality ?? 'good', item.raw ? JSON.stringify(item.raw) : null],
      )

      // Update latest value cache
      await tenantQuery(tenantId,
        `UPDATE sensors SET last_value=$3, last_reading_at=$4, updated_at=now()
         WHERE id=$1 AND tenant_id=$2`,
        [sensorId, tenantId, item.value, ts],
      )

      // Evaluate alerts
      alertsFired += await _evaluateAlerts(tenantId, sensorId, sensorRow, item.value)
      accepted++
    } catch (e) {
      rejected++
      errors.push(`${item.sensorUid}: ${(e as Error).message}`)
    }
  }

  return { accepted, rejected, errors, alerts: alertsFired }
}

export async function ingestSingle(
  tenantId: string,
  projectId: string,
  item: IngestItem,
): Promise<IngestResult> {
  return ingestBatch(tenantId, projectId, [item])
}

// ─── Alert evaluation ─────────────────────────────────────────────────────────

async function _evaluateAlerts(
  tenantId: string,
  sensorId: string,
  sensorRow: Record<string, unknown>,
  value: number,
): Promise<number> {
  let fired = 0
  const thresholds = [
    { key: 'alert_high', type: 'high', severity: 'critical' as const, triggered: (v: number, t: number) => v > t },
    { key: 'alert_low',  type: 'low',  severity: 'critical' as const, triggered: (v: number, t: number) => v < t },
    { key: 'warn_high',  type: 'high', severity: 'warning'  as const, triggered: (v: number, t: number) => v > t },
    { key: 'warn_low',   type: 'low',  severity: 'warning'  as const, triggered: (v: number, t: number) => v < t },
  ]

  for (const thr of thresholds) {
    const threshold = sensorRow[thr.key] != null ? Number(sensorRow[thr.key]) : null
    if (threshold == null) continue

    if (thr.triggered(value, threshold)) {
      // Open alert if none open for this sensor+type+severity
      const existing = await tenantQuery(tenantId,
        `SELECT id FROM sensor_alerts
         WHERE tenant_id=$1 AND sensor_id=$2 AND alert_type=$3 AND severity=$4 AND resolved_at IS NULL LIMIT 1`,
        [tenantId, sensorId, thr.type, thr.severity],
      )
      if (!existing.rows.length) {
        await tenantQuery(tenantId,
          `INSERT INTO sensor_alerts (tenant_id, sensor_id, alert_type, severity, triggered_value, threshold)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [tenantId, sensorId, thr.type, thr.severity, value, threshold],
        )
        fired++
      }
    } else {
      // Auto-resolve open alerts for this threshold if value back in range
      await tenantQuery(tenantId,
        `UPDATE sensor_alerts SET resolved_at=now()
         WHERE tenant_id=$1 AND sensor_id=$2 AND alert_type=$3 AND severity=$4 AND resolved_at IS NULL`,
        [tenantId, sensorId, thr.type, thr.severity],
      )
    }
  }
  return fired
}

// ─── Readings query ───────────────────────────────────────────────────────────

export async function getReadings(
  tenantId: string,
  sensorId: string,
  opts: { from?: string; to?: string; limit?: number } = {},
): Promise<SensorReading[]> {
  const limit = Math.min(opts.limit ?? 200, 1000)
  const res = await tenantQuery(tenantId,
    `SELECT * FROM sensor_readings
     WHERE tenant_id=$1 AND sensor_id=$2
       AND ($3::timestamptz IS NULL OR ts >= $3)
       AND ($4::timestamptz IS NULL OR ts <= $4)
     ORDER BY ts DESC LIMIT $5`,
    [tenantId, sensorId, opts.from ?? null, opts.to ?? null, limit],
  )
  return res.rows.map(_mapReading)
}

export async function getOpenAlerts(tenantId: string, projectId?: string) {
  const res = await tenantQuery(tenantId,
    `SELECT sa.*, s.name AS sensor_name, s.sensor_type, s.unit, s.project_id
     FROM sensor_alerts sa JOIN sensors s ON s.id = sa.sensor_id
     WHERE sa.tenant_id=$1 AND sa.resolved_at IS NULL
       AND ($2::uuid IS NULL OR s.project_id=$2)
     ORDER BY sa.triggered_at DESC`,
    [tenantId, projectId ?? null],
  )
  return res.rows
}

export async function acknowledgeAlert(tenantId: string, alertId: string, userId: string) {
  await tenantQuery(tenantId,
    `UPDATE sensor_alerts SET acknowledged_by=$3, acknowledged_at=now()
     WHERE id=$1 AND tenant_id=$2`,
    [alertId, tenantId, userId],
  )
}

// ─── Ingest token management ──────────────────────────────────────────────────

export async function createIngestToken(
  tenantId: string,
  label: string,
  edgeNodeId?: string,
  ttlDays = 90,
): Promise<{ token: string; id: string; expiresAt: string }> {
  const token = randomBytes(32).toString('hex')
  const hash  = createHash('sha256').update(token).digest('hex')
  const res = await tenantQuery(tenantId,
    `INSERT INTO sensor_ingest_tokens (tenant_id, edge_node_id, token_hash, label, expires_at)
     VALUES ($1,$2,$3,$4, now() + ($5 || ' days')::interval) RETURNING id, expires_at`,
    [tenantId, edgeNodeId ?? null, hash, label, ttlDays],
  )
  return { token, id: res.rows[0].id as string, expiresAt: res.rows[0].expires_at as string }
}

export async function resolveIngestToken(
  token: string,
): Promise<{ tenantId: string; edgeNodeId: string | null } | null> {
  const hash = createHash('sha256').update(token).digest('hex')
  const res = await pool.query(
    `UPDATE sensor_ingest_tokens
     SET last_used_at=now()
     WHERE token_hash=$1
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
     RETURNING tenant_id, edge_node_id`,
    [hash],
  )
  if (!res.rows[0]) return null
  return { tenantId: res.rows[0].tenant_id as string, edgeNodeId: res.rows[0].edge_node_id as string | null }
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function _mapSensor(r: Record<string, unknown>): SensorRecord {
  return {
    id:            r['id'] as string,
    projectId:     r['project_id'] as string,
    edgeNodeId:    (r['edge_node_id'] as string) ?? null,
    bimElementId:  (r['bim_element_id'] as string) ?? null,
    sensorUid:     r['sensor_uid'] as string,
    name:          r['name'] as string,
    sensorType:    r['sensor_type'] as string,
    unit:          r['unit'] as string,
    protocol:      r['protocol'] as string,
    topic:         (r['topic'] as string) ?? null,
    warnLow:       r['warn_low'] != null ? Number(r['warn_low']) : null,
    warnHigh:      r['warn_high'] != null ? Number(r['warn_high']) : null,
    alertLow:      r['alert_low'] != null ? Number(r['alert_low']) : null,
    alertHigh:     r['alert_high'] != null ? Number(r['alert_high']) : null,
    lastValue:     r['last_value'] != null ? Number(r['last_value']) : null,
    lastReadingAt: r['last_reading_at'] ? new Date(r['last_reading_at'] as string).toISOString() : null,
    status:        r['status'] as string,
    createdAt:     new Date(r['created_at'] as string).toISOString(),
  }
}

function _mapReading(r: Record<string, unknown>): SensorReading {
  return {
    id:         r['id'] as string,
    sensorId:   r['sensor_id'] as string,
    ts:         new Date(r['ts'] as string).toISOString(),
    value:      Number(r['value']),
    quality:    r['quality'] as string,
    ingestedAt: new Date(r['ingested_at'] as string).toISOString(),
  }
}
