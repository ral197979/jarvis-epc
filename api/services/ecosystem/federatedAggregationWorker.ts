/**
 * Denver Engineering — Federated Aggregation Worker (v10.2.0)
 * ─────────────────────────────────────────────────────────────
 * Background worker that processes pending federated contributions:
 *
 *   1. PRIVACY_CHECKED: verify opt-in, k-anonymity, DP noise
 *   2. AGGREGATE: group by contribution_type, apply Laplace noise,
 *      compute pattern statistics
 *   3. PUBLISH: if k-anonymity met (≥5 tenants), write to federated_patterns
 *
 * Differential Privacy — Laplace Mechanism:
 *   noisy_value = true_value + Laplace(0, sensitivity/epsilon)
 *   epsilon = 1.0 (standard privacy budget per release)
 *   sensitivity = max possible change from one tenant's contribution
 *
 * K-Anonymity:
 *   A pattern is only published if ≥ K_ANONYMITY_MIN distinct tenants
 *   contributed to it. Individual contributions are never exposed.
 */
import { pool } from '../../db/pool'
import { K_ANONYMITY_MIN } from './ecosystemTypes'
import { log } from '../../lib/logger'

// ─── Laplace mechanism ────────────────────────────────────────────────────────

function laplaceSample(scale: number): number {
  // Inverse CDF sampling: X = -scale * sign(U) * ln(1 - 2|U|), U ~ Uniform(-0.5, 0.5)
  const u = Math.random() - 0.5
  const sign = u >= 0 ? 1 : -1
  return -scale * sign * Math.log(1 - 2 * Math.abs(u))
}

function addLaplaceNoise(value: number, sensitivity: number, epsilon = 1.0): number {
  const scale = sensitivity / epsilon
  return value + laplaceSample(scale)
}

function addDpNoiseToRecord(
  record: Record<string, unknown>,
  epsilon = 1.0,
): Record<string, unknown> {
  const noisy = { ...record }
  for (const [key, val] of Object.entries(noisy)) {
    if (typeof val === 'number') {
      // sensitivity = 1 for counts, proportional for rates
      const sensitivity = Math.max(1, Math.abs(val) * 0.1)
      noisy[key] = Math.max(0, addLaplaceNoise(val, sensitivity, epsilon))
    }
  }
  noisy['_dp_epsilon'] = epsilon
  noisy['_dp_noise_applied'] = true
  return noisy
}

// ─── K-anonymity check ────────────────────────────────────────────────────────

async function checkKAnonymity(
  contributionType: string,
  minK = K_ANONYMITY_MIN,
): Promise<{ met: boolean; distinctTenants: number }> {
  const res = await pool.query(
    `SELECT count(DISTINCT tenant_id)::int AS k
     FROM federated_contributions
     WHERE contribution_type = $1
       AND status IN ('pending','privacy_checked')
       AND opt_in_verified = true`,
    [contributionType],
  )
  const k = res.rows[0]?.k ?? 0
  return { met: k >= minK, distinctTenants: k }
}

// ─── Aggregate contributions into a pattern ───────────────────────────────────

async function aggregateContributions(contributionType: string): Promise<{
  patternData: Record<string, unknown>
  contributorCount: number
  confidenceScore: number
} | null> {
  const res = await pool.query(
    `SELECT anonymized_data, tenant_id
     FROM federated_contributions
     WHERE contribution_type = $1
       AND status IN ('pending','privacy_checked')
       AND opt_in_verified = true`,
    [contributionType],
  )

  if (!res.rows.length) return null

  const distinctTenants = new Set(res.rows.map(r => r.tenant_id as string)).size
  if (distinctTenants < K_ANONYMITY_MIN) return null

  // Aggregate numeric fields across contributions
  const allData = res.rows.map(r =>
    typeof r.anonymized_data === 'string'
      ? JSON.parse(r.anonymized_data) as Record<string, unknown>
      : r.anonymized_data as Record<string, unknown>
  )

  // Compute means for numeric fields
  const aggregated: Record<string, unknown> = {}
  const numericFields = new Set<string>()

  for (const d of allData) {
    for (const [k, v] of Object.entries(d)) {
      if (typeof v === 'number' && !k.startsWith('_')) numericFields.add(k)
    }
  }

  for (const field of numericFields) {
    const vals = allData
      .map(d => d[field])
      .filter((v): v is number => typeof v === 'number')
    if (!vals.length) continue
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length
    // Apply DP noise to aggregate
    aggregated[field] = Math.round(addDpNoiseToRecord({ v: mean }, 1.0)['v'] as number * 100) / 100
  }

  // Confidence score: more contributors → higher confidence (asymptotic toward 1.0)
  const confidenceScore = Math.min(0.99, 1 - 1 / (1 + distinctTenants / K_ANONYMITY_MIN))

  return {
    patternData:      { ...aggregated, _k: distinctTenants, _dp_epsilon: 1.0 },
    contributorCount: distinctTenants,
    confidenceScore,
  }
}

// ─── Privacy audit ────────────────────────────────────────────────────────────

async function recordAudit(
  contributionIds: string[],
  auditType:       string,
  passed:          boolean,
  details:         Record<string, unknown>,
): Promise<void> {
  for (const id of contributionIds) {
    await pool.query(
      `INSERT INTO federated_privacy_audits (contribution_id, audit_type, passed, details)
       VALUES ($1,$2,$3,$4)`,
      [id, auditType, passed, JSON.stringify(details)],
    ).catch(err => log.warn({ err, contributionId: id, auditType }, 'Failed to write federated privacy audit'))
  }
}

// ─── Main processing pass ─────────────────────────────────────────────────────

export async function runFederatedAggregation(): Promise<{
  processed:  number
  published:  number
  suppressed: number
}> {
  let processed = 0
  let published = 0
  let suppressed = 0

  // Find distinct contribution types with pending contributions
  const typesRes = await pool.query(
    `SELECT DISTINCT contribution_type
     FROM federated_contributions
     WHERE status = 'pending' AND opt_in_verified = true`,
  )

  for (const row of typesRes.rows) {
    const type = row.contribution_type as string
    const { met, distinctTenants } = await checkKAnonymity(type)

    // Get IDs for audit
    const idsRes = await pool.query(
      `SELECT id FROM federated_contributions
       WHERE contribution_type=$1 AND status='pending' AND opt_in_verified=true`,
      [type],
    )
    const ids = idsRes.rows.map(r => r.id as string)
    processed += ids.length

    if (!met) {
      // Not enough tenants yet — mark privacy_checked but don't publish
      await pool.query(
        `UPDATE federated_contributions
         SET status='privacy_checked', updated_at=now()
         WHERE id = ANY($1)`,
        [ids],
      )
      await recordAudit(ids, 'k_anonymity_check', false, { distinctTenants, required: K_ANONYMITY_MIN })
      suppressed++
      continue
    }

    // K-anonymity met — aggregate and publish
    const agg = await aggregateContributions(type)
    if (!agg) { suppressed++; continue }

    await recordAudit(ids, 'k_anonymity_check', true, { distinctTenants, required: K_ANONYMITY_MIN })
    await recordAudit(ids, 'dp_noise_check', true, { epsilon: 1.0, mechanism: 'laplace' })

    // Write to federated_patterns
    await pool.query(
      `INSERT INTO federated_patterns
         (pattern_type, pattern_data, confidence_score, contributor_count, k_anonymity_met)
       VALUES ($1,$2,$3,$4,true)`,
      [type, JSON.stringify(agg.patternData), agg.confidenceScore, agg.contributorCount],
    )

    // Mark contributions as published
    await pool.query(
      `UPDATE federated_contributions
       SET status='published', published_at=now(), k_count=$1, updated_at=now()
       WHERE id = ANY($2)`,
      [agg.contributorCount, ids],
    )

    published++
  }

  return { processed, published, suppressed }
}

// ─── Background worker registration ──────────────────────────────────────────

let _interval: ReturnType<typeof setInterval> | null = null

export function startFederatedAggregationWorker(intervalMs = 5 * 60_000): void {
  if (_interval) return
  _interval = setInterval(async () => {
    try { await runFederatedAggregation() } catch { /* swallow — never crash server */ }
  }, intervalMs)
}

export function stopFederatedAggregationWorker(): void {
  if (_interval) { clearInterval(_interval); _interval = null }
}
