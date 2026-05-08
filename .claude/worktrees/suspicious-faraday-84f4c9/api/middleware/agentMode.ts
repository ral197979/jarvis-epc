/**
 * JARVIS EPC — Agent Mode Middleware (v4.31.0)
 *
 * Gates agent-originated mutations based on projects.agent_mode:
 *   auto         → pass through
 *   review_all   → 202 Accepted, queue reference returned; no commit
 *   frozen       → 403 Forbidden, hard stop
 *
 * Agent identity is conveyed by the caller setting the X-Agent-Action
 * header; requests without that header are treated as human-initiated
 * and pass through unchanged.
 *
 * The project is located via req.body.project_id OR req.params.projectId
 * OR req.params.id when the route's subject IS a project. Routes that
 * handle multi-project mutations should wrap each write individually.
 *
 * Usage in a router:
 *     import { requireAgentMode } from '../middleware/agentMode'
 *     router.post('/commit', requireAgentMode(['auto']), handler)
 */

import type { Request, Response, NextFunction } from 'express'
import { tenantQuery } from '../db/pool'
import { record as recordAgentAction } from '../services/agentActions'
import type { TenantRequest } from './tenant'

export type AgentMode = 'auto' | 'review_all' | 'frozen'

function _resolveProjectId(req: Request): string | null {
  const body = (req.body ?? {}) as Record<string, unknown>
  if (typeof body['project_id'] === 'string') return body['project_id']
  const p = req.params as Record<string, string>
  if (p['projectId']) return p['projectId']
  if (p['id'])        return p['id']
  return null
}

function _agentName(req: Request): string | null {
  const raw = req.headers['x-agent-action']
  if (typeof raw === 'string' && raw.length > 0) return raw.slice(0, 64)
  if (Array.isArray(raw) && raw[0]) return String(raw[0]).slice(0, 64)
  return null
}

/**
 * Allow the request only if the project's agent_mode is in `allowed`.
 * Routes that require hard commit rights pass `['auto']`; routes that
 * accept drafts-only can pass `['auto','review_all']`.
 *
 * Non-agent requests (no X-Agent-Action header) always pass through —
 * humans aren't gated by this middleware.
 */
export function requireAgentMode(allowed: AgentMode[] = ['auto']) {
  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    const agent = _agentName(req)
    if (!agent) { next(); return }       // human-initiated — unchanged

    const tenantId = (req as Request & TenantRequest).tenantId
    if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

    const projectId = _resolveProjectId(req)
    // No project context → treat as tenant-wide agent write, always allow.
    // Project-less automations (digest, audit purge) fall here.
    if (!projectId) { next(); return }

    let mode: AgentMode = 'review_all'
    try {
      const r = await tenantQuery<{ agent_mode: AgentMode }>(tenantId, `
        SELECT agent_mode FROM projects
        WHERE id = $1
          AND tenant_id = current_setting('app.current_tenant_id', true)::uuid
      `, [projectId])
      if (r.rows[0]?.agent_mode) mode = r.rows[0].agent_mode
    } catch {
      // Fail closed: if we can't read the mode, queue rather than commit.
      mode = 'review_all'
    }

    if (mode === 'frozen') {
      // Hard stop. Record the suppressed attempt for audit.
      await recordAgentAction({
        tenantId,
        projectId,
        agentName:       agent,
        actionType:      `${req.method} ${req.path}`,
        decision:        'suppressed',
        rationale:       'project agent_mode=frozen; write blocked',
        humanReviewable: false,
      })
      res.status(403).json({
        error:   'project_frozen',
        message: 'Agent actions are frozen for this project.',
        agent, project_id: projectId,
      })
      return
    }

    if (!allowed.includes(mode)) {
      // review_all (or anything outside the allowed set): record as queued
      // and return 202. Caller's pipeline should not commit.
      const actionId = await recordAgentAction({
        tenantId,
        projectId,
        agentName:       agent,
        actionType:      `${req.method} ${req.path}`,
        decision:        'queued',
        rationale:       `project agent_mode=${mode}; requires human review before commit`,
        evidence:        { path: req.path, body: _sanitizeBody(req.body) },
        humanReviewable: true,
      })
      res.status(202).json({
        queued:     true,
        action_id:  actionId,
        message:    'Queued for human review (project agent_mode=' + mode + ')',
        agent, project_id: projectId,
      })
      return
    }

    next()
  }
}

/** Redact keys that are commonly sensitive before storing in evidence. */
function _sanitizeBody(v: unknown): unknown {
  const SENS = new Set(['password','token','refresh_token','secret','api_key','authorization'])
  if (!v || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(_sanitizeBody)
  const out: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = SENS.has(k.toLowerCase()) ? '[redacted]' : _sanitizeBody(val)
  }
  return out
}
