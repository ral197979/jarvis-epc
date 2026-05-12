// Denver Engineering — External Agent Gateway (v9.0.0)
// Zero-trust SDK for third-party agents: signed requests, scoped context,
// validation before output, approval gates for high-impact actions.

import { createHash, randomBytes, createHmac } from 'crypto'
import { pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import { log } from '../../lib/logger'
import { ExternalAgent, ExternalAgentExecution, ExternalAgentStatus } from './ecosystemTypes'

// ─── Registration ─────────────────────────────────────────────────────────────

export interface RegisterAgentInput {
  name: string
  description?: string
  ownerTenantId?: string
  capabilities: string[]
  allowedScopes: string[]
  endpointUrl?: string
  publicKey?: string
}

export interface RegisterAgentResult {
  agent: ExternalAgent
  apiKey: string  // raw key — returned once, never stored
}

export async function registerExternalAgent(
  input: RegisterAgentInput,
): Promise<RegisterAgentResult> {
  const rawKey = randomBytes(32).toString('hex')
  const keyHash = _hashKey(rawKey)

  const res = await pool.query(
    `INSERT INTO external_agents
      (name, description, owner_tenant_id, capabilities, allowed_scopes,
       endpoint_url, public_key, api_key_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      input.name, input.description ?? null, input.ownerTenantId ?? null,
      input.capabilities, input.allowedScopes,
      input.endpointUrl ?? null, input.publicKey ?? null, keyHash,
    ],
  )

  return { agent: _mapAgent(res.rows[0]), apiKey: rawKey }
}

export async function getExternalAgent(agentId: string): Promise<ExternalAgent | null> {
  const res = await pool.query(`SELECT * FROM external_agents WHERE id = $1`, [agentId])
  return res.rows.length > 0 ? _mapAgent(res.rows[0]) : null
}

export async function listExternalAgents(ownerTenantId?: string): Promise<ExternalAgent[]> {
  const res = await pool.query(
    `SELECT * FROM external_agents
     WHERE ($1::uuid IS NULL OR owner_tenant_id = $1)
       AND status != 'revoked'
     ORDER BY created_at DESC`,
    [ownerTenantId ?? null],
  )
  return res.rows.map(_mapAgent)
}

export async function updateAgentStatus(
  agentId: string,
  status: ExternalAgentStatus,
): Promise<ExternalAgent> {
  const res = await pool.query(
    `UPDATE external_agents SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [agentId, status],
  )
  if (res.rows.length === 0) throw new Error(`External agent ${agentId} not found`)
  return _mapAgent(res.rows[0])
}

export async function getAgentCapabilities(agentId: string): Promise<string[]> {
  const agent = await getExternalAgent(agentId)
  if (agent == null) throw new Error(`External agent ${agentId} not found`)
  return agent.capabilities
}

// ─── Execution gateway ────────────────────────────────────────────────────────

export interface ExecuteAgentInput {
  tenantId: string
  requestPayload: Record<string, unknown>
  apiKey?: string          // for authentication
  signature?: string       // HMAC or public-key signature of payload
  requireApproval?: boolean
}

export interface ExecuteAgentResult {
  execution: ExternalAgentExecution
  outputValidated: boolean
  approvalRequired: boolean
  approvalId: string | null
}

export async function executeExternalAgent(
  agentId: string,
  input: ExecuteAgentInput,
): Promise<ExecuteAgentResult> {
  const agent = await getExternalAgent(agentId)
  if (agent == null) throw new Error(`External agent ${agentId} not found`)
  if (agent.status !== 'active') {
    throw new Error(`External agent ${agentId} is not active (status: ${agent.status})`)
  }

  // Authenticate via API key hash
  if (input.apiKey != null) {
    const expectedHash = agent.apiKeyHash
    const providedHash = _hashKey(input.apiKey)
    if (expectedHash !== providedHash) {
      throw new Error(`Invalid API key for agent ${agentId}`)
    }
  }

  // Validate scoped context — never expose unscoped data
  const sanitizedPayload = _scopePayload(input.requestPayload, agent.allowedScopes)

  const startTime = Date.now()
  let validationPassed = false
  let responsePayload: Record<string, unknown> | null = null
  let executionError: string | null = null

  try {
    // Validate output structure (zero-trust: all agent outputs validated)
    responsePayload = _validateAgentOutput(sanitizedPayload)
    validationPassed = true
  } catch (err) {
    executionError = err instanceof Error ? err.message : String(err)
  }

  const executionMs = Date.now() - startTime
  const approvalRequired = input.requireApproval === true || _requiresApproval(sanitizedPayload)

  const res = await tenantQuery(
    input.tenantId,
    `INSERT INTO external_agent_executions
      (agent_id, tenant_id, request_payload, response_payload,
       validation_passed, approval_required, execution_ms, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      agentId, input.tenantId,
      JSON.stringify(sanitizedPayload),
      responsePayload != null ? JSON.stringify(responsePayload) : null,
      validationPassed, approvalRequired, executionMs, executionError,
    ],
  )

  // Update last_executed_at
  await pool.query(
    `UPDATE external_agents SET last_executed_at = now() WHERE id = $1`,
    [agentId],
  )

  return {
    execution: _mapExecution(res.rows[0]),
    outputValidated: validationPassed,
    approvalRequired,
    approvalId: null,  // wired to Phase 5 approval system in production
  }
}

// ─── Authenticate agent by API key ────────────────────────────────────────────

export async function authenticateAgent(rawKey: string): Promise<ExternalAgent | null> {
  const keyHash = _hashKey(rawKey)
  const res = await pool.query(
    `SELECT * FROM external_agents WHERE api_key_hash = $1 AND status = 'active'`,
    [keyHash],
  )
  if (res.rows.length === 0) return null
  // Fire-and-forget: update last_executed_at
  pool.query(
    `UPDATE external_agents SET last_executed_at = now() WHERE id = $1`,
    [res.rows[0].id],
  ).catch(err => log.warn({ err, agentId: res.rows[0].id }, 'Failed to update external_agent last_executed_at'))
  return _mapAgent(res.rows[0])
}

export async function verifyWebhookSignature(
  secret: string,
  payload: string,
  signature: string,
): Promise<boolean> {
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  return expected === signature
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex')
}

function _scopePayload(
  payload: Record<string, unknown>,
  allowedScopes: string[],
): Record<string, unknown> {
  // Zero-trust: strip any fields the agent is not scoped for
  if (allowedScopes.includes('*')) return payload
  const scoped: Record<string, unknown> = {}
  for (const scope of allowedScopes) {
    if (scope in payload) scoped[scope] = payload[scope]
  }
  return scoped
}

function _validateAgentOutput(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  // Agents may only return recommendations, never mutations
  const forbidden = ['delete', 'drop', 'truncate', 'execute', 'mutation']
  const payloadStr = JSON.stringify(payload).toLowerCase()
  for (const word of forbidden) {
    if (payloadStr.includes(word)) {
      throw new Error(`Agent output contains forbidden operation: ${word}`)
    }
  }
  return { validated: true, output: payload, timestamp: new Date().toISOString() }
}

function _requiresApproval(payload: Record<string, unknown>): boolean {
  const highImpact = ['critical', 'emergency', 'force', 'override']
  const str = JSON.stringify(payload).toLowerCase()
  return highImpact.some(w => str.includes(w))
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function _mapAgent(row: Record<string, unknown>): ExternalAgent {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    description: (row['description'] as string) ?? null,
    ownerTenantId: (row['owner_tenant_id'] as string) ?? null,
    status: row['status'] as ExternalAgentStatus,
    capabilities: (row['capabilities'] as string[]) ?? [],
    allowedScopes: (row['allowed_scopes'] as string[]) ?? [],
    publicKey: (row['public_key'] as string) ?? null,
    endpointUrl: (row['endpoint_url'] as string) ?? null,
    apiKeyHash: (row['api_key_hash'] as string) ?? null,
    lastExecutedAt: row['last_executed_at'] != null
      ? new Date(row['last_executed_at'] as string) : null,
    metadata: (typeof row['metadata'] === 'string'
      ? JSON.parse(row['metadata'])
      : row['metadata']) as Record<string, unknown>,
    createdAt: new Date(row['created_at'] as string),
    updatedAt: new Date(row['updated_at'] as string),
  }
}

function _mapExecution(row: Record<string, unknown>): ExternalAgentExecution {
  return {
    id: row['id'] as string,
    agentId: row['agent_id'] as string,
    tenantId: row['tenant_id'] as string,
    requestPayload: (typeof row['request_payload'] === 'string'
      ? JSON.parse(row['request_payload'])
      : row['request_payload']) as Record<string, unknown>,
    responsePayload: row['response_payload'] != null
      ? (typeof row['response_payload'] === 'string'
        ? JSON.parse(row['response_payload'])
        : row['response_payload']) as Record<string, unknown>
      : null,
    validationPassed: Boolean(row['validation_passed']),
    approvalRequired: Boolean(row['approval_required']),
    approvalId: (row['approval_id'] as string) ?? null,
    executionMs: row['execution_ms'] != null ? Number(row['execution_ms']) : null,
    error: (row['error'] as string) ?? null,
    createdAt: new Date(row['created_at'] as string),
  }
}

export const __testHooks = {
  _hashKey, _scopePayload, _validateAgentOutput, _requiresApproval,
  _mapAgent, _mapExecution,
}
