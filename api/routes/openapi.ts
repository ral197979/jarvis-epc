/**
 * Denver Engineering — OpenAPI route (R6b)
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET /openapi.json — serves the OpenAPI document (public, flag-gated).
 *
 * Public like /metrics so tooling can read it without auth. Additive: when
 * OPENAPI_ENABLED is unset it returns 404, so nothing is exposed by default.
 */
import { Router, Request, Response } from 'express'
import { buildDefaultSpec, isOpenApiEnabled } from '../services/openapi/openapiSpec'

const router = Router()

router.get('/openapi.json', (_req: Request, res: Response) => {
  if (!isOpenApiEnabled()) {
    res.status(404).json({ error: 'openapi spec not enabled' })
    return
  }
  res.json(buildDefaultSpec())
})

export const openapiRouter = router
