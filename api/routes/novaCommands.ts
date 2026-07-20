/**
 * Denver Engineering — Nova inbound command endpoint (ADR-001, v1)
 * ─────────────────────────────────────────────────────────────────────────────
 *   POST /api/nova/commands    (Nova → Denver: project.create, connection.ping)
 *   POST /api/nova/reconcile   (Nova → Denver: link map + latest summaries)
 *
 * Mounted in server.ts BEFORE the global express.json() parser so it can read
 * the RAW body for HMAC verification. Intentionally OUTSIDE the /api/v1
 * auth+CSRF chain: authentication is the HMAC signature (service-to-service).
 *
 * CONNECTION-SCOPED VERIFICATION ORDER (binding — contracts/v1/README.md
 * security requirement 1; deliberately NOT the /api/cx/webhook flow, which
 * trusts a payload tenant_id):
 *   parse raw body (size-limited) → read connectionId → load the
 *   nova_connections row → verify HMAC against THAT connection's secret(s) →
 *   require status = 'connected' → tenant comes ONLY from the row.
 * Every pre-auth failure is a uniform 401 {error:'unauthorized'} — the response
 * never reveals which check failed. A novaTenantId mismatch is audited.
 *
 * Contract: docs/integration/nova-denver/contracts/v1/. Unknown schemaVersion
 * → 422; unknown project fields are ignored and discarded (commercial values
 * never cross this boundary — security requirement 4).
 */
import { Router, Request, Response, raw } from 'express'
import rateLimit from 'express-rate-limit'
import { createHmac, createHash, timingSafeEqual } from 'node:crypto'
import type { PoolClient } from 'pg'
import { query, tenantQuery, tenantTransaction } from '../db/pool'
import {
  isNovaExternalEnabled,
  novaCommandSecret,
  novaCommandSecretPrevious,
} from '../services/integration/novaConfig'
import { insertOutboxEvent, type NovaEventPayload } from '../services/integration/novaOutbox'
import { summaryHash, type ProgressSummary } from '../services/integration/novaProgressProjection'
import { slog } from '../../src/modules/observability/index'

const router = Router()

// Dedicated rate limit for the raw-body receiver (security requirement 8),
// constructed like the auth limiter in server.ts.
const _envInt = (k: string, def: number) => { const v = parseInt(process.env[k] ?? '', 10); return Number.isFinite(v) && v > 0 ? v : def }
router.use(rateLimit({ windowMs: 60_000, max: _envInt('RATE_LIMIT_NOVA_MAX', 60), standardHeaders: true, legacyHeaders: false }))

// ─── Constants ────────────────────────────────────────────────────────────────

const TIMESTAMP_SKEW_S = 300
// Relative-path-only URL fields (security requirement 5): no scheme, no '//'.
const RELATIVE_URL_RE = /^\/[A-Za-z0-9/_-]+$/
const SCHEMA_VERSION = '1.0'

// ─── Verification helpers ─────────────────────────────────────────────────────

/** Constant-time compare of two signature strings. */
function _safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

interface ConnectionRow {
  id:             string
  tenant_id:      string
  connection_id:  string
  nova_tenant_id: string
  status:         string
}

/**
 * Secrets valid for a given connection. v1: every connection shares the env
 * secret (plus the previous one during rotation — security requirement 6), but
 * the code path is per-connection so a later slice can give each connection a
 * distinct secret without touching the verification flow.
 */
function _connectionSecrets(_connection: ConnectionRow): string[] {
  const secrets = [novaCommandSecret()]
  const previous = novaCommandSecretPrevious()
  if (previous) secrets.push(previous)
  return secrets.filter(s => s.length > 0)
}

function _signatureMatches(secrets: string[], timestamp: string, body: Buffer, signature: string): boolean {
  let ok = false
  for (const secret of secrets) {
    const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body.toString('utf8')}`).digest('hex')}`
    if (_safeEqual(signature, expected)) ok = true
  }
  return ok
}

function _auditRejection(tenantId: string, data: Record<string, unknown>): void {
  query(`
    INSERT INTO audit_log (tenant_id, user_id, action, resource, new_data)
    VALUES ($1, NULL, 'integrate_pull', 'nova_command_rejected', $2::jsonb)
  `, [tenantId, JSON.stringify(data)]).catch(err => {
    slog('ERROR', 'novaCommands', '[audit] rejection write failed', {
      tenantId, message: err instanceof Error ? err.message : String(err),
    })
  })
}

interface VerifiedRequest {
  connection: ConnectionRow
  parsed:     Record<string, unknown>
  rawBody:    Buffer
}

/**
 * Shared verification for both endpoints. Sends the response and returns null
 * on any failure; every pre-auth rejection is a uniform 401.
 */
async function _verifyRequest(req: Request, res: Response): Promise<VerifiedRequest | null> {
  if (!isNovaExternalEnabled() || !novaCommandSecret()) {
    res.status(503).json({ error: 'nova integration not configured' })
    return null
  }

  const rawBody = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.from('')
  const timestamp = req.header('X-Nova-Timestamp') ?? ''
  const signature = req.header('X-Nova-Signature') ?? ''

  const unauthorized = (): null => { res.status(401).json({ error: 'unauthorized' }); return null }

  if (!/^\d{1,12}$/.test(timestamp)) return unauthorized()
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > TIMESTAMP_SKEW_S) return unauthorized()

  let parsed: Record<string, unknown>
  try {
    const value = JSON.parse(rawBody.toString('utf8')) as unknown
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return unauthorized()
    parsed = value as Record<string, unknown>
  } catch {
    return unauthorized()
  }

  const connectionId = typeof parsed['connectionId'] === 'string' ? parsed['connectionId'] : ''
  if (!connectionId || connectionId.length > 128) return unauthorized()

  const connRes = await query<ConnectionRow>(`
    SELECT id, tenant_id, connection_id, nova_tenant_id, status
    FROM nova_connections WHERE connection_id = $1
  `, [connectionId])
  const connection = connRes.rows[0]
  if (!connection) {
    // Burn an equivalent HMAC comparison so a missing connection is not
    // distinguishable from a bad signature by response timing.
    _signatureMatches([novaCommandSecret()], timestamp, rawBody, signature)
    return unauthorized()
  }

  if (!_signatureMatches(_connectionSecrets(connection), timestamp, rawBody, signature)) {
    return unauthorized()
  }
  if (connection.status !== 'connected') return unauthorized()

  if (parsed['novaTenantId'] !== connection.nova_tenant_id) {
    _auditRejection(connection.tenant_id, {
      reason: 'nova_tenant_mismatch',
      connectionId: connection.connection_id,
    })
    return unauthorized()
  }

  return { connection, parsed, rawBody }
}

// ─── project.create validation (manual, per repo convention — no zod) ────────

interface CreateProjectInput {
  idempotencyKey: string
  novaProjectId:  string
  novaProjectUrl: string | null
  name:           string
  projectNumber:  string
  contractNumber: string | null
  customerName:   string | null
  locationName:   string | null
  country:        string | null
  startDate:      string | null
  targetCompletionDate: string | null
  scope:          string[] | null
  systems:        string[] | null
  templateKey:    string | null
  notes:          string | null
}

function _optStr(v: unknown, maxLen: number): { ok: boolean; value: string | null } {
  if (v === undefined || v === null) return { ok: true, value: null }
  if (typeof v !== 'string' || v.length > maxLen) return { ok: false, value: null }
  return { ok: true, value: v }
}

function _optStrArray(v: unknown, maxItems: number, maxLen: number): { ok: boolean; value: string[] | null } {
  if (v === undefined || v === null) return { ok: true, value: null }
  if (!Array.isArray(v) || v.length > maxItems) return { ok: false, value: null }
  if (!v.every(item => typeof item === 'string' && item.length <= maxLen)) return { ok: false, value: null }
  return { ok: true, value: v as string[] }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Validate the create-project-request contract. Unknown fields are ignored and
 * discarded (only the fields below are ever read — commercial values are never
 * stored or logged). Returns a 422 message on failure.
 */
function _validateCreateProject(body: Record<string, unknown>):
  { ok: true; value: CreateProjectInput } | { ok: false; message: string } {
  const fail = (message: string) => ({ ok: false as const, message })

  const idempotencyKey = body['idempotencyKey']
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    return fail('idempotencyKey is required (string, 8-128 chars).')
  }
  const novaProjectId = body['novaProjectId']
  if (typeof novaProjectId !== 'string' || novaProjectId.length < 1 || novaProjectId.length > 128) {
    return fail('novaProjectId is required (string, 1-128 chars).')
  }
  const requestedBy = body['requestedBy']
  if (requestedBy === null || typeof requestedBy !== 'object' || Array.isArray(requestedBy)
      || typeof (requestedBy as Record<string, unknown>)['novaUserId'] !== 'string'
      || ((requestedBy as Record<string, unknown>)['novaUserId'] as string).length > 128) {
    return fail('requestedBy.novaUserId is required.')
  }
  const project = body['project']
  if (project === null || typeof project !== 'object' || Array.isArray(project)) {
    return fail('project is required.')
  }
  const p = project as Record<string, unknown>

  const name = p['name']
  if (typeof name !== 'string' || name.length < 1 || name.length > 255) {
    return fail('project.name is required (string, 1-255 chars).')
  }
  const projectNumber = p['projectNumber']
  if (typeof projectNumber !== 'string' || projectNumber.length < 1 || projectNumber.length > 64) {
    return fail('project.projectNumber is required (string, 1-64 chars).')
  }

  const contractNumber = _optStr(p['contractNumber'], 64)
  if (!contractNumber.ok) return fail('project.contractNumber must be a string (max 64 chars).')
  const customerName = _optStr(p['customerName'], 255)
  if (!customerName.ok) return fail('project.customerName must be a string (max 255 chars).')
  const templateKey = _optStr(p['templateKey'], 64)
  if (!templateKey.ok) return fail('project.templateKey must be a string (max 64 chars).')
  const notes = _optStr(p['notes'], 2000)
  if (!notes.ok) return fail('project.notes must be a string (max 2000 chars).')

  let locationName: string | null = null
  let country: string | null = null
  if (p['location'] !== undefined && p['location'] !== null) {
    if (typeof p['location'] !== 'object' || Array.isArray(p['location'])) return fail('project.location must be an object.')
    const loc = p['location'] as Record<string, unknown>
    const locName = _optStr(loc['name'], 255)
    if (!locName.ok) return fail('project.location.name must be a string (max 255 chars).')
    locationName = locName.value
    if (loc['country'] !== undefined && loc['country'] !== null) {
      if (typeof loc['country'] !== 'string' || loc['country'].length !== 2) return fail('project.location.country must be a 2-letter code.')
      country = loc['country']
    }
  }

  const startDate = _optStr(p['startDate'], 10)
  if (!startDate.ok || (startDate.value !== null && !DATE_RE.test(startDate.value))) {
    return fail('project.startDate must be a YYYY-MM-DD date.')
  }
  const targetCompletionDate = _optStr(p['targetCompletionDate'], 10)
  if (!targetCompletionDate.ok || (targetCompletionDate.value !== null && !DATE_RE.test(targetCompletionDate.value))) {
    return fail('project.targetCompletionDate must be a YYYY-MM-DD date.')
  }

  const scope = _optStrArray(p['scope'], 12, 32)
  if (!scope.ok) return fail('project.scope must be an array of strings (max 12 items, 32 chars each).')
  const systems = _optStrArray(p['systems'], 64, 64)
  if (!systems.ok) return fail('project.systems must be an array of strings (max 64 items, 64 chars each).')

  // Relative-path-only (security requirement 5): non-conforming values are
  // DROPPED (stored as NULL), never rejected — Nova composes absolute links.
  let novaProjectUrl: string | null = null
  if (typeof body['novaProjectUrl'] === 'string' && RELATIVE_URL_RE.test(body['novaProjectUrl'])) {
    novaProjectUrl = body['novaProjectUrl']
  }

  return {
    ok: true,
    value: {
      idempotencyKey, novaProjectId, novaProjectUrl,
      name, projectNumber,
      contractNumber: contractNumber.value,
      customerName:   customerName.value,
      locationName, country,
      startDate: startDate.value,
      targetCompletionDate: targetCompletionDate.value,
      scope: scope.value, systems: systems.value,
      templateKey: templateKey.value, notes: notes.value,
    },
  }
}

// ─── project.create execution (atomic — security requirement 2) ──────────────

/** Sentinel thrown inside the transaction to roll everything back on conflict. */
class _ConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'ConflictError' }
}

type CommandOutcome =
  | { kind: 'created' | 'replay'; response: Record<string, unknown> }
  | { kind: 'idempotency_conflict' }

async function _executeCreateProject(
  connection: ConnectionRow,
  input: CreateProjectInput,
  requestDigest: string,
): Promise<CommandOutcome> {
  const tenantId = connection.tenant_id

  return tenantTransaction(tenantId, async (client: PoolClient): Promise<CommandOutcome> => {
    // 1. Idempotency ledger — the UNIQUE(tenant_id, idempotency_key) insert is
    //    the claim; a conflict means this key was already processed.
    const ledgerIns = await client.query<{ id: string }>(`
      INSERT INTO nova_inbound_commands (tenant_id, idempotency_key, command, request_digest, status)
      VALUES (current_setting('app.current_tenant_id', true)::uuid, $1, 'project.create', $2, 'processing')
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      RETURNING id
    `, [input.idempotencyKey, requestDigest])

    if (!ledgerIns.rows.length) {
      const stored = await client.query<{ request_digest: string | null; response: Record<string, unknown> | null }>(`
        SELECT request_digest, response FROM nova_inbound_commands
        WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
          AND idempotency_key = $1
      `, [input.idempotencyKey])
      const row = stored.rows[0]
      // Same key + different body, or a key with no stored outcome, never
      // returns the original response (security requirement 3).
      if (!row || row.request_digest !== requestDigest || !row.response) {
        return { kind: 'idempotency_conflict' }
      }
      return { kind: 'replay', response: { ...row.response, status: 'already_exists' } }
    }

    // 2. Conflict pre-checks (throw → full rollback, incl. the ledger row, so a
    //    corrected retry is not poisoned by a stored failure).
    const dupCode = await client.query(`
      SELECT id FROM projects
      WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid AND code = $1
    `, [input.projectNumber])
    if (dupCode.rows.length) throw new _ConflictError(`A project with code '${input.projectNumber}' already exists.`)

    const dupLink = await client.query(`
      SELECT id FROM nova_project_links
      WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid AND nova_project_id = $1
    `, [input.novaProjectId])
    if (dupLink.rows.length) throw new _ConflictError('This Nova project is already linked to a Denver project.')

    // 3. Create the project. Nova-provided reference data rides in
    //    metadata.nova; commercial values are never stored (requirement 4).
    const novaMeta: Record<string, unknown> = { projectId: input.novaProjectId }
    if (input.novaProjectUrl) novaMeta['projectUrl'] = input.novaProjectUrl
    if (input.contractNumber) novaMeta['contractNumber'] = input.contractNumber
    if (input.scope)          novaMeta['scope'] = input.scope
    if (input.systems)        novaMeta['systems'] = input.systems
    if (input.templateKey)    novaMeta['templateKey'] = input.templateKey
    if (input.notes)          novaMeta['notes'] = input.notes

    const projRes = await client.query<{ id: string; code: string; created_at: Date | string }>(`
      INSERT INTO projects (
        tenant_id, code, name, client_name, location, country,
        status, current_phase, planned_start, planned_finish, metadata, created_by
      ) VALUES (
        current_setting('app.current_tenant_id', true)::uuid,
        $1, $2, $3, $4, $5, 'planning', 'feasibility', $6, $7, $8::jsonb, NULL
      )
      RETURNING id, code, created_at
    `, [
      input.projectNumber, input.name, input.customerName, input.locationName, input.country,
      input.startDate, input.targetCompletionDate, JSON.stringify({ nova: novaMeta }),
    ])
    const project = projRes.rows[0]!

    // 4. Initial progress summary — honest values for a freshly created project.
    const initialSummary: ProgressSummary = {
      overallStatus: 'planning',
      overallPercent: 0,
      turnoverStatus: 'not_started',
    }

    // 5. Link row (seeded with the summary hash so the snapshot-diff job does
    //    not immediately re-emit the same state).
    await client.query(`
      INSERT INTO nova_project_links (
        tenant_id, project_id, connection_id, nova_project_id, nova_project_number,
        nova_project_url, nova_customer_name, contract_number, last_summary_hash, last_event_at
      ) VALUES (
        current_setting('app.current_tenant_id', true)::uuid,
        $1, $2, $3, $4, $5, $6, $7, $8, NOW()
      )
    `, [
      project.id, connection.connection_id, input.novaProjectId, input.projectNumber,
      input.novaProjectUrl, input.customerName, input.contractNumber, summaryHash(initialSummary),
    ])

    // 6. Contract-shaped response + ledger snapshot (replays return this).
    const createdAt = project.created_at instanceof Date
      ? project.created_at.toISOString()
      : new Date(project.created_at).toISOString()
    const response: Record<string, unknown> = {
      schemaVersion:        SCHEMA_VERSION,
      status:               'created',
      denverOrganizationId: tenantId,
      denverProjectId:      project.id,
      denverProjectNumber:  project.code,
      projectUrl:           `/projects/${project.id}`,
      createdAt,
    }
    await client.query(`
      UPDATE nova_inbound_commands SET response = $1::jsonb, status = 'created' WHERE id = $2
    `, [JSON.stringify(response), ledgerIns.rows[0]!.id])

    // 7. Audit (redacted summary — no commercial values).
    await client.query(`
      INSERT INTO audit_log (tenant_id, user_id, action, resource, resource_id, new_data)
      VALUES (current_setting('app.current_tenant_id', true)::uuid, NULL, 'integrate_pull', 'nova_project_create', $1, $2::jsonb)
    `, [project.id, JSON.stringify({
      connectionId: connection.connection_id,
      novaProjectId: input.novaProjectId,
      code: project.code,
      name: input.name,
    })])

    // 8. Outbox event, same transaction (security requirement 2).
    const payload: NovaEventPayload = {
      connectionId:    connection.connection_id,
      novaTenantId:    connection.nova_tenant_id,
      novaProjectId:   input.novaProjectId,
      denverProjectId: project.id,
      summary:         initialSummary as unknown as Record<string, unknown>,
    }
    await insertOutboxEvent(client, tenantId, 'denver.project.created', payload)

    return { kind: 'created', response }
  })
}

// ─── POST /api/nova/commands ──────────────────────────────────────────────────

router.post('/commands', raw({ type: '*/*', limit: '1mb' }), async (req: Request, res: Response) => {
  const verified = await _verifyRequest(req, res)
  if (!verified) return
  const { connection, parsed, rawBody } = verified

  if (parsed['schemaVersion'] !== SCHEMA_VERSION) {
    return res.status(422).json({ error: 'validation', message: `Unsupported schemaVersion; expected '${SCHEMA_VERSION}'.` })
  }

  if (parsed['command'] === 'connection.ping') {
    return res.json({ schemaVersion: SCHEMA_VERSION, status: 'ok' })
  }
  if (parsed['command'] !== 'project.create') {
    return res.status(422).json({ error: 'validation', message: 'Unsupported command.' })
  }

  const validated = _validateCreateProject(parsed)
  if (!validated.ok) {
    return res.status(422).json({ error: 'validation', message: validated.message })
  }

  const requestDigest = createHash('sha256').update(rawBody).digest('hex')

  try {
    const outcome = await _executeCreateProject(connection, validated.value, requestDigest)
    if (outcome.kind === 'idempotency_conflict') {
      return res.status(409).json({ error: 'idempotency_conflict', message: 'Idempotency key was already used with a different request body.' })
    }
    if (outcome.kind === 'replay') {
      return res.json(outcome.response)
    }
    slog('INFO', 'novaCommands', '[commands] Project created from Nova command', {
      tenantId: connection.tenant_id,
      connectionId: connection.connection_id,
      denverProjectId: outcome.response['denverProjectId'],
    })
    return res.status(201).json(outcome.response)
  } catch (err) {
    if (err instanceof _ConflictError) {
      return res.status(409).json({ error: 'conflict', message: err.message })
    }
    // Unique-violation race lost to a concurrent insert → same outcome as the pre-check.
    if ((err as { code?: string }).code === '23505') {
      return res.status(409).json({ error: 'conflict', message: 'A conflicting project or link already exists.' })
    }
    slog('ERROR', 'novaCommands', '[commands] Failed to process command', {
      tenantId: connection.tenant_id,
      message: err instanceof Error ? err.message : String(err),
    })
    return res.status(500).json({ error: 'internal', message: 'Failed to process command.' })
  }
})

// ─── POST /api/nova/reconcile ─────────────────────────────────────────────────
// Signed body { schemaVersion, connectionId, novaTenantId } (same verification
// order as /commands — never an unsigned GET). Returns the link map + latest
// outbound summary for THIS connection's tenant only.

router.post('/reconcile', raw({ type: '*/*', limit: '1mb' }), async (req: Request, res: Response) => {
  const verified = await _verifyRequest(req, res)
  if (!verified) return
  const { connection, parsed } = verified

  if (parsed['schemaVersion'] !== SCHEMA_VERSION) {
    return res.status(422).json({ error: 'validation', message: `Unsupported schemaVersion; expected '${SCHEMA_VERSION}'.` })
  }

  try {
    const links = await tenantQuery(connection.tenant_id, `
      SELECT l.nova_project_id,
             l.project_id,
             p.code AS denver_project_number,
             l.last_event_at,
             latest.summary AS latest_summary
      FROM nova_project_links l
      JOIN projects p ON p.id = l.project_id
      LEFT JOIN LATERAL (
        SELECT o.payload->'summary' AS summary
        FROM nova_outbox o
        WHERE o.tenant_id = l.tenant_id
          AND o.payload->>'denverProjectId' = l.project_id::text
          AND o.event_type IN ('denver.project.created', 'denver.project.progress.updated')
        ORDER BY o.seq DESC
        LIMIT 1
      ) latest ON TRUE
      WHERE l.tenant_id = current_setting('app.current_tenant_id', true)::uuid
        AND l.connection_id = $1
      ORDER BY l.created_at ASC
    `, [connection.connection_id])

    return res.json({
      schemaVersion: SCHEMA_VERSION,
      connectionId:  connection.connection_id,
      links: links.rows.map(row => ({
        novaProjectId:          String(row['nova_project_id']),
        denverProjectId:        String(row['project_id']),
        denverProjectNumber:    String(row['denver_project_number']),
        integrationLastEventAt: row['last_event_at'] instanceof Date
          ? (row['last_event_at'] as Date).toISOString()
          : (row['last_event_at'] == null ? null : String(row['last_event_at'])),
        latestSummary:          (row['latest_summary'] as Record<string, unknown> | null) ?? null,
      })),
    })
  } catch (err) {
    slog('ERROR', 'novaCommands', '[reconcile] Failed', {
      tenantId: connection.tenant_id,
      message: err instanceof Error ? err.message : String(err),
    })
    return res.status(500).json({ error: 'internal', message: 'Failed to reconcile.' })
  }
})

export const novaCommandsRouter = router
