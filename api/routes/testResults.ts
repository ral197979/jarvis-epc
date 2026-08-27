/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Denver Engineering — Test Results API (v4.32.0)
 * ──────────────────────────────────────────────────────────────────────────────
 * Per-step test result for a test_pack. Closes audit F01.
 *
 * Mount at '/api/v1' in server.ts.
 *
 * Endpoints:
 *   POST  /api/v1/test-results
 *   PATCH /api/v1/test-results/:resultId
 */

import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest }       from '../middleware/tenant'
import { requireCapability } from '../authz/requireCapability'
import { requireRecordScope } from '../authz/recordScope'
import {
  createTestResult, updateTestResult,
  NotFoundError, ValidationError,
} from '../services/cxExecution'

type Req = Request & AuthenticatedRequest & TenantRequest

export const testResultsRouter = Router()
testResultsRouter.use(requireAuth   as never)
testResultsRouter.use(requireTenant() as never)

function _handleErr(err: unknown, res: Response, where: string): void {
  if (err instanceof ValidationError) {
    res.status(err.status).json({ error: 'validation', message: err.message })
    return
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: 'not_found', message: err.message })
    return
  }
  const code = (err as { code?: string })?.code
  if (code === '23505') {
    res.status(409).json({ error: 'duplicate', message: 'step_no already exists for this pack' })
    return
  }
  console.error(`[testResults] ${where} error`, err)
  res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' })
}

testResultsRouter.post('/test-results', requireCapability('commissioning.write') as never, async (req: Request, res: Response) => {
  const r = req as Req
  const b = req.body ?? {}
  if (!b.projectId || !b.testPackId || !b.stepTitle) {
    res.status(400).json({ error: 'validation', message: 'projectId, testPackId, stepTitle are required' })
    return
  }
  const stepNoNum = typeof b.stepNo === 'number' ? b.stepNo : parseInt(String(b.stepNo), 10)
  if (!Number.isFinite(stepNoNum) || stepNoNum < 1) {
    res.status(400).json({ error: 'validation', message: 'stepNo must be a positive integer' })
    return
  }
  try {
    const item = await createTestResult(
      { tenantId: r.tenantId!, userId: r.auth?.sub ?? null },
      {
        projectId:      String(b.projectId),
        testPackId:     String(b.testPackId),
        stepNo:         stepNoNum,
        stepTitle:      String(b.stepTitle),
        expectedResult: b.expectedResult ?? null,
        actualResult:   b.actualResult   ?? null,
        resultStatus:   b.resultStatus,
        evidenceUri:    b.evidenceUri    ?? null,
        performedBy:    b.performedBy    ?? null,
        witnessedBy:    b.witnessedBy    ?? null,
        performedAt:    b.performedAt    ?? null,
        comments:       b.comments       ?? null,
      },
    )
    res.status(201).json({ item })
  } catch (err) { _handleErr(err, res, 'create') }
})

testResultsRouter.patch('/test-results/:resultId', requireCapability('commissioning.write') as never, requireRecordScope('test_results', 'resultId') as never, async (req: Request, res: Response) => {
  const r = req as Req
  const b = req.body ?? {}
  try {
    const item = await updateTestResult(
      { tenantId: r.tenantId!, userId: r.auth?.sub ?? null },
      String(req.params['resultId']),
      {
        actualResult: b.actualResult,
        resultStatus: b.resultStatus,
        evidenceUri:  b.evidenceUri,
        performedBy:  b.performedBy,
        witnessedBy:  b.witnessedBy,
        performedAt:  b.performedAt,
        comments:     b.comments,
      },
    )
    res.json({ item })
  } catch (err) { _handleErr(err, res, 'update') }
})

export default testResultsRouter
