/**
 * Denver Engineering — Monte Carlo Risk Simulation Service (v10.1.0)
 * ──────────────────────────────────────────────────────────────────
 * Probabilistic schedule + cost risk analysis.
 *
 * Algorithm:
 *   1. Accept three-point estimates per task (O, ML, P)
 *   2. Run N iterations: sample each task duration from its distribution
 *   3. For each iteration, compute total project duration via CPM
 *      (critical path = longest path through task network)
 *   4. Aggregate: P10/P50/P80/P90, criticality index, sensitivity ranking
 *
 * Distributions supported:
 *   - Triangular: most common in construction risk
 *   - PERT: (O + 4*ML + P) / 6 mean — smoother tails
 *   - Uniform: between optimistic and pessimistic
 *   - Log-normal: for right-skewed cost/duration
 *
 * No external dependencies — pure TypeScript RNG using Box-Muller + Mersenne.
 */
import { pool, tenantQuery } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TaskInput {
  id:                    string  // local reference ID
  task_id?:             string  // schedule task UUID
  task_name:            string
  duration_optimistic:  number  // days
  duration_most_likely: number
  duration_pessimistic: number
  duration_distribution?: 'triangular' | 'pert' | 'uniform' | 'lognormal'
  cost_optimistic?:     number
  cost_most_likely?:    number
  cost_pessimistic?:    number
  cost_distribution?:   'triangular' | 'pert' | 'uniform' | 'lognormal'
  risk_factors?:        { factor: string; impact_pct: number; probability: number }[]
  predecessors?:        string[]  // IDs from this input list
  is_critical?:         boolean
}

export interface MonteCarloRunInput {
  tenantId:        string
  projectId?:      string
  name:            string
  description?:    string
  tasks:           TaskInput[]
  iterationCount?: number
  seed?:           number
}

export interface MonteCarloResult {
  run_id:              string
  p10_days:            number
  p50_days:            number
  p80_days:            number
  p90_days:            number
  deterministic_days:  number
  schedule_risk_index: number
  p10_cost?:           number
  p50_cost?:           number
  p80_cost?:           number
  p90_cost?:           number
  sensitivity:         { task_name: string; criticality_pct: number; correlation_coeff: number; rank: number }[]
}

// ─── Seeded pseudo-random number generator (Mulberry32) ───────────────────────

function makePrng(seed: number) {
  let s = seed >>> 0
  return function () {
    s |= 0; s = s + 0x6D2B79F5 | 0
    let z = Math.imul(s ^ (s >>> 15), 1 | s)
    z = z + Math.imul(z ^ (z >>> 7), 61 | z) ^ z
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296
  }
}

// ─── Distribution samplers ────────────────────────────────────────────────────

function sampleTriangular(rng: () => number, o: number, ml: number, p: number): number {
  const u  = rng()
  const fc = (ml - o) / (p - o)
  if (u < fc) return o + Math.sqrt(u * (p - o) * (ml - o))
  return p - Math.sqrt((1 - u) * (p - o) * (p - ml))
}

function samplePert(rng: () => number, o: number, ml: number, p: number): number {
  // PERT Beta approximation via Triangular with adjusted mode
  const mean = (o + 4 * ml + p) / 6
  const sd   = (p - o) / 6
  // Use Box-Muller to approximate Beta ~ Normal for PERT
  const u1 = rng() || 1e-10
  const u2 = rng() || 1e-10
  const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return Math.max(o, Math.min(p, mean + sd * z))
}

function sampleUniform(rng: () => number, o: number, p: number): number {
  return o + rng() * (p - o)
}

function sampleLognormal(rng: () => number, o: number, ml: number, p: number): number {
  const mean = (o + 4 * ml + p) / 6
  const sd   = (p - o) / 6
  const mu   = Math.log(mean * mean / Math.sqrt(sd * sd + mean * mean))
  const sig  = Math.sqrt(Math.log(1 + sd * sd / (mean * mean)))
  const u1   = rng() || 1e-10
  const u2   = rng() || 1e-10
  const z    = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return Math.exp(mu + sig * z)
}

function sample(
  rng:  () => number,
  dist: string,
  o:    number,
  ml:   number,
  p:    number,
): number {
  switch (dist) {
    case 'pert':      return samplePert(rng, o, ml, p)
    case 'uniform':   return sampleUniform(rng, o, p)
    case 'lognormal': return sampleLognormal(rng, o, ml, p)
    default:          return sampleTriangular(rng, o, ml, p)  // triangular
  }
}

// ─── CPM: longest path through task network ───────────────────────────────────

function computeCriticalPath(
  tasks:    { id: string; duration: number; predecessors: string[] }[],
): { totalDays: number; criticalIds: Set<string> } {
  const byId = new Map(tasks.map(t => [t.id, t]))
  const finish = new Map<string, number>()

  // Forward pass — topological order via DFS
  function ef(id: string): number {
    if (finish.has(id)) return finish.get(id)!
    const task = byId.get(id)
    if (!task) return 0
    const predMax = task.predecessors.length
      ? Math.max(...task.predecessors.map(ef))
      : 0
    const f = predMax + task.duration
    finish.set(id, f)
    return f
  }

  tasks.forEach(t => ef(t.id))
  const totalDays = Math.max(...[...finish.values()], 0)

  // Backward pass to find critical tasks
  const lateFinish = new Map<string, number>()
  tasks.forEach(t => lateFinish.set(t.id, totalDays))

  // Successors map
  const successors = new Map<string, string[]>()
  tasks.forEach(t => {
    t.predecessors.forEach(p => {
      if (!successors.has(p)) successors.set(p, [])
      successors.get(p)!.push(t.id)
    })
  })

  // Simple backward pass
  const revOrder = [...tasks].reverse()
  for (const task of revOrder) {
    const succs = successors.get(task.id) ?? []
    if (succs.length) {
      const ls = Math.min(...succs.map(s => (lateFinish.get(s) ?? totalDays) - (byId.get(s)?.duration ?? 0)))
      lateFinish.set(task.id, ls + task.duration)
    }
  }

  const criticalIds = new Set<string>()
  tasks.forEach(t => {
    const ef_ = finish.get(t.id) ?? 0
    const lf_ = lateFinish.get(t.id) ?? totalDays
    if (Math.abs(ef_ - lf_) < 0.001) criticalIds.add(t.id)
  })

  return { totalDays, criticalIds }
}

// ─── Percentile helper ────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1)
  const lo  = Math.floor(idx)
  const hi  = Math.ceil(idx)
  if (lo === hi) return sorted[lo]!
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo)
}

// ─── Spearman rank correlation ────────────────────────────────────────────────

function spearman(x: number[], y: number[]): number {
  const n    = x.length
  const rankX = rankArray(x)
  const rankY = rankArray(y)
  let d2 = 0
  for (let i = 0; i < n; i++) d2 += (rankX[i]! - rankY[i]!) ** 2
  return 1 - (6 * d2) / (n * (n * n - 1))
}

function rankArray(arr: number[]): number[] {
  const sorted = [...arr].map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const ranks  = new Array<number>(arr.length)
  sorted.forEach(({ i }, rank) => { ranks[i] = rank + 1 })
  return ranks
}

// ─── Main simulation ──────────────────────────────────────────────────────────

export async function runMonteCarlo(input: MonteCarloRunInput): Promise<MonteCarloResult> {
  const N    = Math.min(input.iterationCount ?? 10000, 50000)
  const seed = input.seed ?? Date.now()
  const rng  = makePrng(seed)

  const tasks = input.tasks

  // Deterministic CPM (most-likely durations)
  const detResult = computeCriticalPath(
    tasks.map(t => ({ id: t.id, duration: t.duration_most_likely, predecessors: t.predecessors ?? [] })),
  )

  // Track per-task samples for sensitivity (Spearman correlation)
  const taskDurationSamples: Map<string, number[]> = new Map(tasks.map(t => [t.id, []]))
  const totalDurationSamples: number[] = []
  const totalCostSamples: number[] = []
  const criticalityCount: Map<string, number> = new Map(tasks.map(t => [t.id, 0]))

  // Run iterations
  const SAMPLE_STEP = Math.max(1, Math.floor(N / 1000)) // store ~1000 iterations
  const iterationRows: { iteration_number: number; total_days: number; total_cost: number }[] = []

  for (let i = 0; i < N; i++) {
    // Sample durations
    const sampledTasks = tasks.map(t => {
      const dur = sample(
        rng,
        t.duration_distribution ?? 'triangular',
        t.duration_optimistic,
        t.duration_most_likely,
        t.duration_pessimistic,
      )
      taskDurationSamples.get(t.id)!.push(dur)

      // Apply risk factors
      let riskMultiplier = 1
      for (const rf of t.risk_factors ?? []) {
        if (rng() < rf.probability) riskMultiplier += rf.impact_pct / 100
      }

      return { id: t.id, duration: dur * riskMultiplier, predecessors: t.predecessors ?? [] }
    })

    const { totalDays, criticalIds } = computeCriticalPath(sampledTasks)
    totalDurationSamples.push(totalDays)
    criticalIds.forEach(id => criticalityCount.set(id, (criticalityCount.get(id) ?? 0) + 1))

    // Cost sampling (if provided)
    let totalCost = 0
    for (const t of tasks) {
      if (t.cost_most_likely != null) {
        totalCost += sample(
          rng,
          t.cost_distribution ?? 'triangular',
          t.cost_optimistic  ?? t.cost_most_likely * 0.8,
          t.cost_most_likely,
          t.cost_pessimistic ?? t.cost_most_likely * 1.3,
        )
      }
    }
    if (totalCost > 0) totalCostSamples.push(totalCost)

    if (i % SAMPLE_STEP === 0) {
      iterationRows.push({ iteration_number: i, total_days: totalDays, total_cost: totalCost })
    }
  }

  // Compute percentiles
  const sortedDays = [...totalDurationSamples].sort((a, b) => a - b)
  const p10 = percentile(sortedDays, 10)
  const p50 = percentile(sortedDays, 50)
  const p80 = percentile(sortedDays, 80)
  const p90 = percentile(sortedDays, 90)
  const sri  = p50 > 0 ? (p80 - p50) / p50 : 0

  let p10c: number | undefined, p50c: number | undefined
  let p80c: number | undefined, p90c: number | undefined
  if (totalCostSamples.length) {
    const sc = [...totalCostSamples].sort((a, b) => a - b)
    p10c = percentile(sc, 10); p50c = percentile(sc, 50)
    p80c = percentile(sc, 80); p90c = percentile(sc, 90)
  }

  // Sensitivity: Spearman correlation of each task duration with total project duration
  const sensitivity = tasks.map(t => {
    const corr = spearman(taskDurationSamples.get(t.id)!, totalDurationSamples)
    const crit = ((criticalityCount.get(t.id) ?? 0) / N) * 100
    return { id: t.id, task_id: t.task_id, task_name: t.task_name, corr, crit, variance: t.duration_pessimistic - t.duration_optimistic }
  })
  sensitivity.sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr))

  // Persist to DB
  const client = await pool.connect()
  let runId: string

  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL app.current_tenant_id = '${input.tenantId}'`)

    // Insert run header
    const runRes = await client.query(
      `INSERT INTO monte_carlo_runs
         (tenant_id, project_id, name, description, status, iteration_count, seed,
          p10_days, p50_days, p80_days, p90_days, deterministic_days, schedule_risk_index,
          p10_cost, p50_cost, p80_cost, p90_cost,
          criticality_index, cruciality_index, completed_at)
       VALUES ($1,$2,$3,$4,'completed',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,now())
       RETURNING id`,
      [
        input.tenantId, input.projectId ?? null, input.name, input.description ?? null,
        N, seed, p10, p50, p80, p90,
        detResult.totalDays, sri,
        p10c ?? null, p50c ?? null, p80c ?? null, p90c ?? null,
        JSON.stringify(Object.fromEntries(criticalityCount)),
        JSON.stringify(Object.fromEntries(
          tasks.map(t => [t.id, spearman(taskDurationSamples.get(t.id)!, totalDurationSamples)])
        )),
      ],
    )
    runId = runRes.rows[0].id as string

    // Insert inputs
    for (const t of tasks) {
      await client.query(
        `INSERT INTO monte_carlo_inputs
           (run_id, tenant_id, task_id, task_name,
            duration_optimistic, duration_most_likely, duration_pessimistic, duration_distribution,
            cost_optimistic, cost_most_likely, cost_pessimistic, cost_distribution,
            risk_factors, predecessors, is_critical)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          runId, input.tenantId, t.task_id ?? null, t.task_name,
          t.duration_optimistic, t.duration_most_likely, t.duration_pessimistic,
          t.duration_distribution ?? 'triangular',
          t.cost_optimistic ?? null, t.cost_most_likely ?? null, t.cost_pessimistic ?? null,
          t.cost_distribution ?? 'triangular',
          JSON.stringify(t.risk_factors ?? []),
          t.predecessors ?? [],
          t.is_critical ?? false,
        ],
      )
    }

    // Insert sampled iterations
    for (const row of iterationRows) {
      await client.query(
        `INSERT INTO monte_carlo_iterations (run_id, tenant_id, iteration_number, total_days, total_cost)
         VALUES ($1,$2,$3,$4,$5)`,
        [runId, input.tenantId, row.iteration_number, row.total_days, row.total_cost],
      )
    }

    // Insert sensitivity
    for (let r = 0; r < sensitivity.length; r++) {
      const s = sensitivity[r]!
      await client.query(
        `INSERT INTO monte_carlo_sensitivity
           (run_id, tenant_id, task_id, task_name, correlation_coeff, criticality_pct, duration_variance, rank)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [runId, input.tenantId, s.task_id ?? null, s.task_name,
         s.corr, s.crit, s.variance, r + 1],
      )
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  return {
    run_id:             runId!,
    p10_days:           p10,
    p50_days:           p50,
    p80_days:           p80,
    p90_days:           p90,
    deterministic_days: detResult.totalDays,
    schedule_risk_index: sri,
    p10_cost:           p10c,
    p50_cost:           p50c,
    p80_cost:           p80c,
    p90_cost:           p90c,
    sensitivity: sensitivity.slice(0, 20).map((s, i) => ({
      task_name:        s.task_name,
      criticality_pct:  s.crit,
      correlation_coeff: s.corr,
      rank:             i + 1,
    })),
  }
}

// ─── Query helpers ────────────────────────────────────────────────────────────

export async function listMonteCarloRuns(tenantId: string, projectId?: string) {
  const params: unknown[] = [tenantId]
  const filter = projectId ? `AND project_id=$2` : ''
  if (projectId) params.push(projectId)
  const res = await tenantQuery(tenantId,
    `SELECT id, name, status, p50_days, p80_days, p90_days, schedule_risk_index,
            deterministic_days, iteration_count, completed_at, created_at
     FROM monte_carlo_runs WHERE tenant_id=$1 ${filter}
     ORDER BY created_at DESC`,
    params)
  return res.rows
}

export async function getMonteCarloRun(tenantId: string, runId: string) {
  const [run, inputs, sensitivity] = await Promise.all([
    tenantQuery(tenantId, 'SELECT * FROM monte_carlo_runs WHERE id=$1 AND tenant_id=$2', [runId, tenantId]),
    tenantQuery(tenantId, 'SELECT * FROM monte_carlo_inputs WHERE run_id=$1 ORDER BY task_name', [runId]),
    tenantQuery(tenantId, 'SELECT * FROM monte_carlo_sensitivity WHERE run_id=$1 ORDER BY rank', [runId]),
  ])
  if (!run.rows[0]) return null
  return { run: run.rows[0], inputs: inputs.rows, sensitivity: sensitivity.rows }
}

export async function getIterationDistribution(tenantId: string, runId: string) {
  const res = await tenantQuery(tenantId,
    `SELECT total_days, total_cost FROM monte_carlo_iterations
     WHERE run_id=$1 ORDER BY total_days`,
    [runId])
  return res.rows
}
