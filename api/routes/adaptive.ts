// Denver Engineering — Adaptive Intelligence Routes (v7.0.0)
// Endpoints for learning feedback, forecast accuracy, and anomaly adaptation.

import { Router, Request, Response } from 'express'
import {
  recordFeedback, aggregateSignals, listFeedback,
  getFeedbackHistory, getLearningHealth,
} from '../services/adaptive/learningLoopEngine'
import {
  recordOutcome, updateOutcomeMeasurement,
  getAgentEffectiveness, getTopEffectiveOutcomes,
} from '../services/adaptive/recommendationFeedbackTracker'
import {
  recordPrediction, recordActual,
  getAccuracyStats, listAccuracyRecords,
} from '../services/adaptive/forecastAccuracyTracker'
import {
  calibratePrediction, getDriftSummary,
} from '../services/adaptive/forecastCalibrationEngine'
import {
  rankRecommendations, getTopRankedRecommendations,
} from '../services/adaptive/recommendationRankingEngine'
import {
  getAnomalyPattern, recordAnomalyFeedback, listAnomalyPatterns,
} from '../services/adaptive/adaptiveAnomalyEngine'
import {
  storeMemory, recallMemory, listMemories, applyMemoryDecay, reinforceMemory,
} from '../services/adaptive/operationalMemoryEngine'
import {
  listSimulationOutcomes, getScenarioAccuracyStats,
  recordSimulationOutcome,
} from '../services/adaptive/simulationLearningService'

const router = Router()
const tid = (req: Request): string => (req as unknown as { tenantId: string }).tenantId

// ─── Learning feedback ────────────────────────────────────────────────────────

router.post('/feedback', async (req: Request, res: Response) => {
  try {
    const feedback = await recordFeedback(tid(req), req.body)
    res.status(201).json(feedback)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.get('/feedback', async (req: Request, res: Response) => {
  try {
    const { feedbackType, signal, agentType, limit, windowDays } = req.query as Record<string, string>
    const items = await listFeedback(tid(req), {
      feedbackType: feedbackType as never,
      signal: signal as never,
      agentType,
      limit: limit != null ? Number(limit) : undefined,
      windowDays: windowDays != null ? Number(windowDays) : undefined,
    })
    res.json(items)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.get('/feedback/health', async (req: Request, res: Response) => {
  try {
    const health = await getLearningHealth(tid(req))
    res.json(health)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.get('/feedback/signals/:type', async (req: Request, res: Response) => {
  try {
    const windowDays = req.query.windowDays != null ? Number(req.query.windowDays) : 30
    const summary = await aggregateSignals(tid(req), req.params.type as never, windowDays)
    res.json(summary)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.get('/feedback/source/:sourceType/:sourceId', async (req: Request, res: Response) => {
  try {
    const history = await getFeedbackHistory(tid(req), req.params.sourceType, req.params.sourceId)
    res.json(history)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

// ─── Recommendation outcomes ──────────────────────────────────────────────────

router.post('/outcomes', async (req: Request, res: Response) => {
  try {
    const outcome = await recordOutcome(tid(req), req.body)
    res.status(201).json(outcome)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.patch('/outcomes/:id/measurement', async (req: Request, res: Response) => {
  try {
    const { effectivenessScore, afterState } = req.body
    const outcome = await updateOutcomeMeasurement(tid(req), req.params.id, effectivenessScore, afterState)
    res.json(outcome)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.get('/outcomes/effectiveness', async (req: Request, res: Response) => {
  try {
    const windowDays = req.query.windowDays != null ? Number(req.query.windowDays) : 30
    const reports = await getAgentEffectiveness(tid(req), windowDays)
    res.json(reports)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.get('/outcomes/top', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit != null ? Number(req.query.limit) : 10
    const top = await getTopEffectiveOutcomes(tid(req), limit)
    res.json(top)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

// ─── Forecast accuracy ────────────────────────────────────────────────────────

router.post('/forecast-accuracy', async (req: Request, res: Response) => {
  try {
    const record = await recordPrediction(tid(req), req.body)
    res.status(201).json(record)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.post('/forecast-accuracy/:id/actual', async (req: Request, res: Response) => {
  try {
    const { actualValue } = req.body
    const record = await recordActual(tid(req), req.params.id, actualValue)
    res.json(record)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.get('/forecast-accuracy/stats/:type', async (req: Request, res: Response) => {
  try {
    const horizon = req.query.horizon != null ? Number(req.query.horizon) : undefined
    const windowDays = req.query.windowDays != null ? Number(req.query.windowDays) : 90
    const stats = await getAccuracyStats(tid(req), req.params.type as never, horizon, windowDays)
    res.json(stats)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.get('/forecast-accuracy', async (req: Request, res: Response) => {
  try {
    const { forecastType, entityId, windowDays, limit, unmeasuredOnly } = req.query as Record<string, string>
    const records = await listAccuracyRecords(tid(req), {
      forecastType: forecastType as never,
      entityId,
      windowDays: windowDays != null ? Number(windowDays) : undefined,
      limit: limit != null ? Number(limit) : undefined,
      unmeasuredOnly: unmeasuredOnly === 'true',
    })
    res.json(records)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

// ─── Calibration ──────────────────────────────────────────────────────────────

router.post('/calibrate', async (req: Request, res: Response) => {
  try {
    const { forecastType, predictedValue, horizon, entityId } = req.body
    const result = await calibratePrediction(tid(req), forecastType, predictedValue, horizon, entityId)
    res.json(result)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.get('/calibrate/drift/:type', async (req: Request, res: Response) => {
  try {
    const summary = await getDriftSummary(tid(req), req.params.type as never)
    res.json(summary)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

// ─── Recommendation ranking ───────────────────────────────────────────────────

router.post('/rank', async (req: Request, res: Response) => {
  try {
    const { candidates } = req.body
    const ranked = await rankRecommendations(tid(req), candidates)
    res.json(ranked)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.get('/rank/top', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit != null ? Number(req.query.limit) : 10
    const { agentType } = req.query as Record<string, string>
    const top = await getTopRankedRecommendations(tid(req), limit, agentType)
    res.json(top)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

// ─── Adaptive anomaly patterns ────────────────────────────────────────────────

router.get('/anomaly-patterns', async (req: Request, res: Response) => {
  try {
    const patterns = await listAnomalyPatterns(tid(req))
    res.json(patterns)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.get('/anomaly-patterns/:type', async (req: Request, res: Response) => {
  try {
    const { entityType } = req.query as Record<string, string>
    const pattern = await getAnomalyPattern(tid(req), req.params.type, entityType)
    res.json(pattern)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.post('/anomaly-patterns/:anomalyId/feedback', async (req: Request, res: Response) => {
  try {
    const { anomalyType, entityType, isFalsePositive } = req.body
    await recordAnomalyFeedback(tid(req), req.params.anomalyId, anomalyType, entityType, isFalsePositive)
    res.status(204).end()
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

// ─── Operational memory ───────────────────────────────────────────────────────

router.post('/memory', async (req: Request, res: Response) => {
  try {
    await storeMemory(tid(req), req.body)
    res.status(204).end()
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.get('/memory', async (req: Request, res: Response) => {
  try {
    const { agentType, scopeType, scopeId, minConfidence, limit } = req.query as Record<string, string>
    const memories = await listMemories(tid(req), {
      agentType,
      scopeType,
      scopeId,
      minConfidence: minConfidence != null ? Number(minConfidence) : undefined,
      limit: limit != null ? Number(limit) : undefined,
    })
    res.json(memories)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.get('/memory/:agentType/:scopeType/:key', async (req: Request, res: Response) => {
  try {
    const { scopeId } = req.query as Record<string, string>
    const memory = await recallMemory(tid(req), {
      agentType: req.params.agentType,
      scopeType: req.params.scopeType,
      scopeId,
      key: req.params.key,
    })
    if (memory == null) { res.status(404).json({ error: 'Memory not found' }); return }
    res.json(memory)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.post('/memory/decay', async (req: Request, res: Response) => {
  try {
    const { agentType, scopeType, scopeId } = req.body
    const count = await applyMemoryDecay(tid(req), agentType, scopeType, scopeId)
    res.json({ decayed: count })
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.post('/memory/reinforce', async (req: Request, res: Response) => {
  try {
    const { agentType, scopeType, scopeId, key, confidenceBoost } = req.body
    await reinforceMemory(tid(req), agentType, scopeType, scopeId, key, confidenceBoost)
    res.status(204).end()
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

// ─── Simulation learning ──────────────────────────────────────────────────────

router.post('/simulation-outcomes', async (req: Request, res: Response) => {
  try {
    const outcome = await recordSimulationOutcome(tid(req), req.body)
    res.status(201).json(outcome)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.get('/simulation-outcomes', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit != null ? Number(req.query.limit) : 20
    const outcomes = await listSimulationOutcomes(tid(req), limit)
    res.json(outcomes)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.get('/simulation-outcomes/stats', async (req: Request, res: Response) => {
  try {
    const windowDays = req.query.windowDays != null ? Number(req.query.windowDays) : 90
    const stats = await getScenarioAccuracyStats(tid(req), windowDays)
    res.json(stats)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

export default router
