// Denver Engineering — Privacy-Safe Benchmarking Service (v9.0.0)
// Cross-tenant benchmarks without data leakage: suppressed small cohorts,
// aggregate bands only, no identifiable tenant ranking.

import { default as pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import {
  BenchmarkMetric, BenchmarkCohort, TenantBenchmarkResult, MIN_BENCHMARK_COHORT,
} from './ecosystemTypes'

// ─── Cohort computation (admin) ───────────────────────────────────────────────

export interface ComputeCohortInput {
  metricName: BenchmarkMetric
  values: number[]               // anonymized metric values from contributing tenants
  industrySegment?: string
  region?: string
  projectType?: string
  periodStart?: Date
  periodEnd?: Date
}

export async function computeAndStoreCohort(
  input: ComputeCohortInput,
): Promise<BenchmarkCohort> {
  const { metricName, values, industrySegment, region, projectType } = input
  const cohortSize = values.length
  const suppressed = cohortSize < MIN_BENCHMARK_COHORT

  const sorted = suppressed ? [] : [...values].sort((a, b) => a - b)
  const p25 = suppressed ? null : _percentile(sorted, 25)
  const p50 = suppressed ? null : _percentile(sorted, 50)
  const p75 = suppressed ? null : _percentile(sorted, 75)
  const p90 = suppressed ? null : _percentile(sorted, 90)

  const res = await pool.query(
    `INSERT INTO benchmark_cohorts
      (metric_name, industry_segment, region, project_type, cohort_size,
       p25, p50, p75, p90, suppressed, period_start, period_end)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (metric_name, industry_segment, region, project_type)
       WHERE suppressed = FALSE
     DO UPDATE SET
       cohort_size = EXCLUDED.cohort_size,
       p25 = EXCLUDED.p25, p50 = EXCLUDED.p50,
       p75 = EXCLUDED.p75, p90 = EXCLUDED.p90,
       suppressed = EXCLUDED.suppressed,
       computed_at = now()
     RETURNING *`,
    [
      metricName, industrySegment ?? null, region ?? null, projectType ?? null,
      cohortSize, p25, p50, p75, p90, suppressed,
      input.periodStart ?? null, input.periodEnd ?? null,
    ],
  )
  return _mapCohort(res.rows[0])
}

// ─── Public cohort queries ────────────────────────────────────────────────────

export async function getIndustryBenchmarks(
  industrySegment?: string,
  region?: string,
): Promise<BenchmarkCohort[]> {
  const res = await pool.query(
    `SELECT * FROM benchmark_cohorts
     WHERE suppressed = FALSE
       AND ($1::text IS NULL OR industry_segment = $1)
       AND ($2::text IS NULL OR region = $2)
     ORDER BY metric_name, computed_at DESC`,
    [industrySegment ?? null, region ?? null],
  )
  return res.rows.map(_mapCohort)
}

export async function getBenchmarkForMetric(
  metricName: BenchmarkMetric,
): Promise<BenchmarkCohort | null> {
  const res = await pool.query(
    `SELECT * FROM benchmark_cohorts
     WHERE metric_name = $1 AND suppressed = FALSE
     ORDER BY computed_at DESC LIMIT 1`,
    [metricName],
  )
  return res.rows.length > 0 ? _mapCohort(res.rows[0]) : null
}

// ─── Tenant self-comparison (no ranking, percentile band only) ────────────────

export async function getTenantBenchmark(
  tenantId: string,
  metricName: BenchmarkMetric,
  tenantValue: number,
): Promise<TenantBenchmarkResult> {
  const cohort = await getBenchmarkForMetric(metricName)

  if (cohort == null || cohort.suppressed) {
    return {
      tenantId,
      metricName,
      tenantValue,
      cohortP50: null,
      cohortP75: null,
      percentileEstimate: 'insufficient_data',
      computedAt: new Date(),
    }
  }

  const band = _classifyBand(tenantValue, cohort.p25, cohort.p50, cohort.p75, cohort.p90)

  return {
    tenantId,
    metricName,
    tenantValue,
    cohortP50: cohort.p50,
    cohortP75: cohort.p75,
    percentileEstimate: band,
    computedAt: new Date(),
  }
}

export async function getReadinessBenchmarks(): Promise<BenchmarkCohort[]> {
  return getIndustryBenchmarks() // readiness metrics use the general cohort store
}

export async function getSlaBenchmarks(): Promise<BenchmarkCohort[]> {
  const res = await pool.query(
    `SELECT * FROM benchmark_cohorts
     WHERE metric_name IN ('sla_compliance', 'incident_closure_time')
       AND suppressed = FALSE
     ORDER BY computed_at DESC`,
  )
  return res.rows.map(_mapCohort)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.floor((pct / 100) * (sorted.length - 1))
  return sorted[idx]!
}

function _classifyBand(
  value: number,
  p25: number | null,
  p50: number | null,
  p75: number | null,
  _p90: number | null,
): TenantBenchmarkResult['percentileEstimate'] {
  if (p25 == null || p50 == null || p75 == null) return 'insufficient_data'
  if (value >= p75) return 'top_quartile'
  if (value >= p50) return 'above_median'
  if (value >= p25) return 'below_median'
  return 'bottom_quartile'
}

function _mapCohort(row: Record<string, unknown>): BenchmarkCohort {
  return {
    id: row['id'] as string,
    metricName: row['metric_name'] as BenchmarkMetric,
    industrySegment: (row['industry_segment'] as string) ?? null,
    region: (row['region'] as string) ?? null,
    projectType: (row['project_type'] as string) ?? null,
    cohortSize: Number(row['cohort_size']),
    p25: row['p25'] != null ? Number(row['p25']) : null,
    p50: row['p50'] != null ? Number(row['p50']) : null,
    p75: row['p75'] != null ? Number(row['p75']) : null,
    p90: row['p90'] != null ? Number(row['p90']) : null,
    suppressed: Boolean(row['suppressed']),
    computedAt: new Date(row['computed_at'] as string),
    periodStart: row['period_start'] != null ? new Date(row['period_start'] as string) : null,
    periodEnd: row['period_end'] != null ? new Date(row['period_end'] as string) : null,
  }
}

export const __testHooks = { _percentile, _classifyBand, _mapCohort }
