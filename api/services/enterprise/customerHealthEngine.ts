// Denver Engineering — Customer Health Engine (v8.0.0)
// Computes adoption scores, churn risk, support load, and overall health for each tenant.

import { tenantQuery } from '../../db/pool'
import { CustomerHealthScore } from './enterpriseTypes'

// ─── Compute health score ─────────────────────────────────────────────────────

export async function computeHealthScore(tenantId: string): Promise<CustomerHealthScore> {
  const [adoptionData, supportData, aiData, featureData] = await Promise.all([
    _getAdoptionData(tenantId),
    _getSupportData(tenantId),
    _getAiUsageData(tenantId),
    _getFeatureData(tenantId),
  ])

  const adoptionScore = _scoreAdoption(adoptionData)
  const supportLoad = _scoreSupportLoad(supportData.openCount)
  const aiUsageEfficiency = _scoreAiEfficiency(aiData.utilizationPct)
  const riskOfChurn = _scoreChurnRisk(adoptionScore, supportLoad, featureData.enabledCount)

  const tenantHealthScore = Math.round(
    adoptionScore * 0.40 +
    (100 - riskOfChurn) * 0.30 +
    (100 - supportLoad) * 0.20 +
    aiUsageEfficiency * 0.10,
  )

  return {
    tenantId,
    tenantHealthScore: Math.min(100, Math.max(0, tenantHealthScore)),
    adoptionScore: Math.min(100, Math.max(0, adoptionScore)),
    riskOfChurn: Math.min(100, Math.max(0, riskOfChurn)),
    supportLoad: Math.min(100, Math.max(0, supportLoad)),
    aiUsageEfficiency: Math.min(100, Math.max(0, aiUsageEfficiency)),
    activeUsers7Days: adoptionData.activeUsers7Days,
    featuresEnabled: featureData.enabledCount,
    openTicketCount: supportData.openCount,
    generatedAt: new Date(),
  }
}

// ─── Get health scores for multiple tenants (admin) ───────────────────────────

export async function computeHealthScores(tenantIds: string[]): Promise<CustomerHealthScore[]> {
  return Promise.all(tenantIds.map(id => computeHealthScore(id)))
}

// ─── Private data fetchers ────────────────────────────────────────────────────

async function _getAdoptionData(tenantId: string): Promise<{
  activeUsers7Days: number
  seatCount: number
  seatLimit: number
  loginCount30Days: number
}> {
  try {
    const [subRes, activityRes] = await Promise.all([
      tenantQuery(tenantId, `SELECT seat_count, seat_limit FROM tenant_subscriptions WHERE tenant_id = $1`, [tenantId]),
      // Count distinct active users from audit log if it exists
      tenantQuery(tenantId,
        `SELECT COUNT(DISTINCT user_id)::int AS active_users,
                COUNT(*)::int AS total_logins
         FROM audit_log
         WHERE tenant_id = $1
           AND action = 'user.login'
           AND created_at >= now() - INTERVAL '30 days'`,
        [tenantId]).catch(() => ({ rows: [] })),
    ])

    const sub = subRes.rows[0]
    const activity = activityRes.rows[0]

    // Active in last 7 days — separate query
    const active7Res = await tenantQuery(tenantId,
      `SELECT COUNT(DISTINCT user_id)::int AS count
       FROM audit_log
       WHERE tenant_id = $1
         AND action = 'user.login'
         AND created_at >= now() - INTERVAL '7 days'`,
      [tenantId],
    ).catch(() => ({ rows: [] }))

    return {
      activeUsers7Days: Number(active7Res.rows[0]?.count ?? 0),
      seatCount: Number(sub?.seat_count ?? 1),
      seatLimit: Number(sub?.seat_limit ?? 5),
      loginCount30Days: Number(activity?.total_logins ?? 0),
    }
  } catch {
    return { activeUsers7Days: 0, seatCount: 1, seatLimit: 5, loginCount30Days: 0 }
  }
}

async function _getSupportData(tenantId: string): Promise<{ openCount: number; criticalCount: number }> {
  try {
    const res = await tenantQuery(
      tenantId,
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('open','in_progress','waiting_customer'))::int AS open_count,
         COUNT(*) FILTER (WHERE priority = 'critical' AND status NOT IN ('resolved','closed'))::int AS critical_count
       FROM support_tickets WHERE tenant_id = $1`,
      [tenantId],
    )
    return {
      openCount: Number(res.rows[0]?.open_count ?? 0),
      criticalCount: Number(res.rows[0]?.critical_count ?? 0),
    }
  } catch {
    return { openCount: 0, criticalCount: 0 }
  }
}

async function _getAiUsageData(tenantId: string): Promise<{ utilizationPct: number }> {
  try {
    const res = await tenantQuery(
      tenantId,
      `SELECT ai_budget_monthly, ai_spend_current FROM tenant_subscriptions WHERE tenant_id = $1`,
      [tenantId],
    )
    const sub = res.rows[0]
    if (sub == null || sub.ai_budget_monthly == null) return { utilizationPct: 50 }
    const budget = Number(sub.ai_budget_monthly)
    const spend = Number(sub.ai_spend_current ?? 0)
    return { utilizationPct: budget > 0 ? Math.round((spend / budget) * 100) : 50 }
  } catch {
    return { utilizationPct: 0 }
  }
}

async function _getFeatureData(tenantId: string): Promise<{ enabledCount: number }> {
  try {
    const res = await tenantQuery(
      tenantId,
      `SELECT COUNT(*)::int AS cnt FROM tenant_feature_flags
       WHERE tenant_id = $1 AND enabled = true
         AND (expires_at IS NULL OR expires_at > now())`,
      [tenantId],
    )
    return { enabledCount: Number(res.rows[0]?.cnt ?? 0) }
  } catch {
    return { enabledCount: 0 }
  }
}

// ─── Scoring functions ────────────────────────────────────────────────────────

function _scoreAdoption(data: { activeUsers7Days: number; seatCount: number; seatLimit: number; loginCount30Days: number }): number {
  const utilization = data.seatLimit > 0 ? data.activeUsers7Days / data.seatLimit : 0
  const utilizationScore = Math.min(100, utilization * 100)
  const loginScore = Math.min(100, data.loginCount30Days * 2) // 50+ logins = 100
  return Math.round(utilizationScore * 0.6 + loginScore * 0.4)
}

function _scoreSupportLoad(openCount: number): number {
  // 0 tickets = 0 load; 10+ = 100 load
  return Math.min(100, openCount * 10)
}

function _scoreAiEfficiency(utilizationPct: number): number {
  // Sweet spot: 20–80% utilization = good efficiency
  // Under 20% = underusing (low score); over 90% = strained (medium)
  if (utilizationPct < 5) return 20
  if (utilizationPct <= 80) return Math.round(20 + (utilizationPct / 80) * 80)
  return Math.round(100 - (utilizationPct - 80) * 2) // penalize near-limit
}

function _scoreChurnRisk(adoptionScore: number, supportLoad: number, featuresEnabled: number): number {
  const featureScore = Math.min(100, featuresEnabled * 10) // 10 features = 100
  const risk = (100 - adoptionScore) * 0.50 + supportLoad * 0.30 + (100 - featureScore) * 0.20
  return Math.round(risk)
}

export const __testHooks = {
  _scoreAdoption,
  _scoreSupportLoad,
  _scoreAiEfficiency,
  _scoreChurnRisk,
}
