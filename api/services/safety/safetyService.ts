/**
 * Denver Engineering — Safety (v4.53.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 10 — Safety. Captures observations (leading indicators) + incidents /
 * near-misses (lagging indicators) and runs a deterministic predictive engine:
 *   • highRiskAreas     — locations with the most severity-weighted activity
 *   • recurringHazards  — hazard patterns repeating across observations/incidents
 *   • leadingIndicators — observation-to-incident ratio, near-miss/recordable mix,
 *                         open high-severity exposure, and an overall risk index
 *
 * `analyzeSafety` is a PURE function over fetched rows — testable, explainable,
 * no LLM. CRUD helpers wrap the safety tables.
 */
import { tenantQuery } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ObsRow { type?: string; severity?: string; status?: string; location?: string | null; description?: string | null }
export interface IncRow { type?: string; severity?: string; status?: string; location?: string | null; description?: string | null; incident_date?: string | Date | null }

export interface HighRiskArea { location: string; observations: number; incidents: number; riskScore: number }
export interface RecurringHazard { hazard: string; count: number; examples: string[] }
export interface LeadingIndicators {
  observations: number; incidents: number; nearMisses: number; recordables: number
  openHighSeverity: number
  observationToIncidentRatio: number | null
  reportingCulture: 'strong' | 'fair' | 'weak'
  riskIndex: number   // 0–100, higher = more safety risk
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
}
export interface SafetyIntelligence {
  generatedAt: string
  headline: string
  leadingIndicators: LeadingIndicators
  highRiskAreas: HighRiskArea[]
  recurringHazards: RecurringHazard[]
}

const SEV_WEIGHT: Record<string, number> = { low: 1, medium: 2, high: 4, critical: 7 }
const RECORDABLE = new Set(['first_aid', 'injury'])
const NOT_CLOSED = (s?: string) => (s ?? '').toLowerCase() !== 'closed'
const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'near', 'was', 'were', 'has', 'had', 'while', 'when', 'worker', 'site', 'area'])

function sevW(s?: string): number { return SEV_WEIGHT[(s ?? 'low').toLowerCase()] ?? 1 }
function keyword(text: string | null | undefined): string {
  if (!text) return 'general'
  const w = text.toLowerCase().split(/[^a-z0-9]+/).find(t => t.length >= 4 && !STOPWORDS.has(t))
  return w ?? 'general'
}
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))
function riskLevelOf(n: number): LeadingIndicators['riskLevel'] { return n >= 75 ? 'critical' : n >= 55 ? 'high' : n >= 35 ? 'medium' : 'low' }

// ─── Pure analysis ────────────────────────────────────────────────────────────

export function analyzeSafety(observations: ObsRow[], incidents: IncRow[], now: Date = new Date()): SafetyIntelligence {
  // High-risk areas (incidents weight 3× observations, severity-weighted).
  const byLoc = new Map<string, { obs: number; inc: number; score: number }>()
  const ensureLoc = (l: string) => { const x = byLoc.get(l) ?? { obs: 0, inc: 0, score: 0 }; byLoc.set(l, x); return x }
  for (const o of observations) { const l = (o.location && o.location.trim()) || null; if (l) { const x = ensureLoc(l); x.obs++; x.score += sevW(o.severity) } }
  for (const i of incidents) { const l = (i.location && i.location.trim()) || null; if (l) { const x = ensureLoc(l); x.inc++; x.score += sevW(i.severity) * 3 } }
  const highRiskAreas: HighRiskArea[] = [...byLoc.entries()]
    .map(([location, x]) => ({ location, observations: x.obs, incidents: x.inc, riskScore: Math.round(x.score) }))
    .sort((a, b) => b.riskScore - a.riskScore).slice(0, 8)

  // Recurring hazards (cluster by keyword across observations + incidents).
  const clusters = new Map<string, { count: number; examples: string[] }>()
  const addHazard = (text: string | null | undefined) => {
    const k = keyword(text)
    const c = clusters.get(k) ?? { count: 0, examples: [] }
    c.count++; if (text && c.examples.length < 3 && !c.examples.includes(text)) c.examples.push(text)
    clusters.set(k, c)
  }
  for (const o of observations) addHazard(o.description)
  for (const i of incidents) addHazard(i.description)
  const recurringHazards: RecurringHazard[] = [...clusters.entries()]
    .filter(([k, c]) => k !== 'general' && c.count >= 2)
    .map(([hazard, c]) => ({ hazard, count: c.count, examples: c.examples }))
    .sort((a, b) => b.count - a.count).slice(0, 8)

  // Leading indicators.
  const nearMisses = incidents.filter(i => (i.type ?? '').toLowerCase() === 'near_miss').length
  const recordables = incidents.filter(i => RECORDABLE.has((i.type ?? '').toLowerCase())).length
  const openHighSeverity =
    observations.filter(o => ['high', 'critical'].includes((o.severity ?? '').toLowerCase()) && NOT_CLOSED(o.status)).length +
    incidents.filter(i => ['high', 'critical'].includes((i.severity ?? '').toLowerCase()) && NOT_CLOSED(i.status)).length
  const ratio = incidents.length > 0 ? Math.round((observations.length / incidents.length) * 10) / 10 : null
  const reportingCulture: LeadingIndicators['reportingCulture'] =
    ratio == null ? (observations.length >= 5 ? 'strong' : 'fair') : ratio >= 10 ? 'strong' : ratio >= 4 ? 'fair' : 'weak'

  // Risk index: recordables + open high-severity + recurring hazards drive it up;
  // a healthy observation-to-incident ratio pulls it down.
  let risk = 20
  risk += Math.min(30, recordables * 12)
  risk += Math.min(20, openHighSeverity * 5)
  risk += Math.min(15, recurringHazards.length * 4)
  if (reportingCulture === 'weak') risk += 10
  else if (reportingCulture === 'strong') risk -= 8
  const riskIndex = clamp(risk)

  const leadingIndicators: LeadingIndicators = {
    observations: observations.length, incidents: incidents.length, nearMisses, recordables, openHighSeverity,
    observationToIncidentRatio: ratio, reportingCulture, riskIndex, riskLevel: riskLevelOf(riskIndex),
  }

  const headline = (observations.length === 0 && incidents.length === 0)
    ? 'No safety records yet — log observations and incidents to activate the predictive engine.'
    : `Risk index ${riskIndex}/100 (${leadingIndicators.riskLevel}) — ${recordables} recordable${recordables === 1 ? '' : 's'}, ${nearMisses} near-miss${nearMisses === 1 ? '' : 'es'}, ${openHighSeverity} open high-severity item${openHighSeverity === 1 ? '' : 's'}.`

  return { generatedAt: now.toISOString(), headline, leadingIndicators, highRiskAreas, recurringHazards }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listObservations(tenantId: string, projectId: string) {
  const res = await tenantQuery(tenantId,
    `SELECT id, type, severity, status, location, discipline, description, observed_at, created_at
       FROM safety_observations WHERE tenant_id=$1 AND project_id=$2
      ORDER BY observed_at DESC, created_at DESC LIMIT 1000`, [tenantId, projectId])
  return res.rows
}
export async function createObservation(
  tenantId: string, projectId: string,
  b: { type?: string; severity?: string; location?: string; discipline?: string; description: string; observed_at?: string },
  userId: string | null,
) {
  const res = await tenantQuery(tenantId,
    `INSERT INTO safety_observations (tenant_id, project_id, type, severity, location, discipline, description, observed_at, reported_by)
     VALUES ($1,$2,COALESCE($3,'unsafe_condition')::safety_obs_type,COALESCE($4,'low')::safety_severity,$5,$6,$7,COALESCE($8::date,CURRENT_DATE),$9)
     RETURNING id, type, severity, status, location, discipline, description, observed_at, created_at`,
    [tenantId, projectId, b.type ?? null, b.severity ?? null, b.location ?? null, b.discipline ?? null, b.description, b.observed_at ?? null, userId])
  return res.rows[0]
}
export async function updateObservationStatus(tenantId: string, id: string, status: string) {
  const res = await tenantQuery(tenantId,
    `UPDATE safety_observations SET status=$3::safety_obs_status, updated_at=NOW()
      WHERE tenant_id=$1 AND id=$2 RETURNING id, status`, [tenantId, id, status])
  return res.rows[0] ?? null
}

export async function listIncidents(tenantId: string, projectId: string) {
  const res = await tenantQuery(tenantId,
    `SELECT id, type, severity, status, location, discipline, description, incident_date, root_cause, corrective_action, created_at
       FROM safety_incidents WHERE tenant_id=$1 AND project_id=$2
      ORDER BY incident_date DESC, created_at DESC LIMIT 1000`, [tenantId, projectId])
  return res.rows
}
export async function createIncident(
  tenantId: string, projectId: string,
  b: { type?: string; severity?: string; location?: string; discipline?: string; description: string; incident_date?: string; root_cause?: string; corrective_action?: string },
  userId: string | null,
) {
  const res = await tenantQuery(tenantId,
    `INSERT INTO safety_incidents (tenant_id, project_id, type, severity, location, discipline, description, incident_date, root_cause, corrective_action, reported_by)
     VALUES ($1,$2,COALESCE($3,'near_miss')::safety_incident_type,COALESCE($4,'medium')::safety_severity,$5,$6,$7,COALESCE($8::date,CURRENT_DATE),$9,$10,$11)
     RETURNING id, type, severity, status, location, discipline, description, incident_date, created_at`,
    [tenantId, projectId, b.type ?? null, b.severity ?? null, b.location ?? null, b.discipline ?? null, b.description, b.incident_date ?? null, b.root_cause ?? null, b.corrective_action ?? null, userId])
  return res.rows[0]
}
export async function updateIncidentStatus(tenantId: string, id: string, status: string) {
  const res = await tenantQuery(tenantId,
    `UPDATE safety_incidents SET status=$3::safety_incident_status, updated_at=NOW()
      WHERE tenant_id=$1 AND id=$2 RETURNING id, status`, [tenantId, id, status])
  return res.rows[0] ?? null
}

export async function buildSafetyIntelligence(tenantId: string, projectId: string, now: Date = new Date()): Promise<SafetyIntelligence | null> {
  const projRes = await tenantQuery(tenantId, `SELECT id FROM projects WHERE tenant_id=$1 AND id=$2`, [tenantId, projectId])
  if (!projRes.rows[0]) return null
  const [obs, inc] = await Promise.all([
    tenantQuery(tenantId, `SELECT type, severity, status, location, description FROM safety_observations WHERE tenant_id=$1 AND project_id=$2 LIMIT 5000`, [tenantId, projectId]),
    tenantQuery(tenantId, `SELECT type, severity, status, location, description, incident_date FROM safety_incidents WHERE tenant_id=$1 AND project_id=$2 LIMIT 5000`, [tenantId, projectId]),
  ])
  return analyzeSafety(obs.rows as ObsRow[], inc.rows as IncRow[], now)
}
