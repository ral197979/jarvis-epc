// Denver Engineering — Portfolio Routes (v6.0.0)
// Cross-project readiness, conflicts, and forecasting endpoints.

import { Router, Request, Response } from 'express'
import { computePortfolioReadiness, detectPortfolioConflicts, forecastBottlenecks } from '../services/twin/predictiveCoordinationEngine'
import { getOrComputeForecast } from '../services/twin/operationalForecastEngine'
import { detectAnomalies, listAnomalies, resolveAnomaly, markFalsePositive } from '../services/twin/anomalyDetectionEngine'
import { generateMaintenanceRecommendations, computeAssetHealth } from '../services/twin/maintenanceForecastEngine'
import { summarizeAnomalies } from '../services/twin/anomalyClassificationService'
import { requireCapability } from '../authz/requireCapability'
import { requirePolymorphicScope } from '../authz/recordScope'

const router = Router()

// ─── Portfolio readiness ───────────────────────────────────────────────────────

router.get('/readiness', requireCapability('portfolio.view') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const readiness = await computePortfolioReadiness(tenantId)
    res.json(readiness)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/readiness/:scopeType/:scopeId', requireCapability('portfolio.view') as never, requirePolymorphicScope('scopeType', 'scopeId') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const scopeType = req.params.scopeType as string
    const scopeId = req.params.scopeId as string
    const horizonDays = req.query.horizonDays ? Number(req.query.horizonDays) : 30
    const forecast = await getOrComputeForecast({
      tenantId, forecastType: 'readiness', scopeType, scopeId, horizonDays,
    })
    res.json(forecast)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ─── Conflicts ────────────────────────────────────────────────────────────────

router.get('/conflicts', requireCapability('portfolio.view') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const conflicts = await detectPortfolioConflicts(tenantId)
    res.json({ conflicts, count: conflicts.length })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ─── Bottleneck forecast ──────────────────────────────────────────────────────

router.get('/bottlenecks', requireCapability('portfolio.view') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const horizonDays = req.query.horizonDays ? Number(req.query.horizonDays) : 30
    const bottlenecks = await forecastBottlenecks(tenantId, horizonDays)
    res.json({ bottlenecks, count: bottlenecks.length })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ─── Forecast ─────────────────────────────────────────────────────────────────

router.get('/forecast', requireCapability('portfolio.view') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const { forecastType = 'portfolio', scopeType = 'tenant', scopeId, horizonDays } = req.query
    const forecast = await getOrComputeForecast({
      tenantId,
      forecastType: forecastType as string,
      scopeType: scopeType as string,
      scopeId: (scopeId as string) ?? tenantId,
      horizonDays: horizonDays ? Number(horizonDays) : 30,
    })
    res.json(forecast)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ─── Anomalies ────────────────────────────────────────────────────────────────

router.get('/anomalies', requireCapability('portfolio.view') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const { twinId, severity, resolved, limit, offset } = req.query
    const anomalies = await listAnomalies(tenantId, {
      twinId: twinId as string | undefined,
      severity: severity as string | undefined,
      resolved: resolved !== undefined ? resolved === 'true' : undefined,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    } as Parameters<typeof listAnomalies>[1])
    const summary = summarizeAnomalies(anomalies)
    res.json({ anomalies, summary })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.post('/anomalies/detect', requireCapability('portfolio.view') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const { twinId, windowDays } = req.body
    const anomalies = await detectAnomalies({ tenantId, twinId, windowDays })
    const summary = summarizeAnomalies(anomalies)
    res.json({ anomalies, summary })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.post('/anomalies/:anomalyId/resolve', requireCapability('portfolio.approve') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    await resolveAnomaly(req.params.anomalyId as string, tenantId)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.post('/anomalies/:anomalyId/false-positive', requireCapability('portfolio.approve') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    await markFalsePositive(req.params.anomalyId as string, tenantId)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ─── Maintenance ──────────────────────────────────────────────────────────────

router.get('/maintenance/recommendations', requireCapability('portfolio.view') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const entityType = (req.query.entityType as string | undefined) ?? 'equipment'
    const recommendations = await generateMaintenanceRecommendations(
      tenantId,
      entityType as Parameters<typeof generateMaintenanceRecommendations>[1]
    )
    res.json({ recommendations, count: recommendations.length })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/maintenance/health/:twinId', requireCapability('portfolio.view') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const health = await computeAssetHealth(req.params.twinId as string, tenantId)
    res.json(health)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router
