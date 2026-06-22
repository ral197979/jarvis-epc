// Denver Engineering — Plugin Registry Service (v9.0.0)
// Secure extension system: explicit permissions, version pinning, rollback, kill switch.

import { createHash } from 'crypto'
import { pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import { Plugin, PluginVersion, TenantPluginInstall, PluginAuditEvent, PluginType, PluginStatus } from './ecosystemTypes'

// ─── Plugin registry CRUD ─────────────────────────────────────────────────────

export interface CreatePluginInput {
  slug: string
  name: string
  description?: string
  pluginType: PluginType
  author: string
  manifest?: Record<string, unknown>
  requiredScopes?: string[]
  bundleContent?: string  // for checksum computation
}

export async function registerPlugin(input: CreatePluginInput): Promise<Plugin> {
  const res = await pool.query(
    `INSERT INTO plugins (slug, name, description, plugin_type, author, manifest, required_scopes)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      input.slug, input.name, input.description ?? null,
      input.pluginType, input.author,
      JSON.stringify(input.manifest ?? {}),
      input.requiredScopes ?? [],
    ],
  )
  const plugin = _mapPlugin(res.rows[0])

  // Record audit event
  await _auditPlugin(plugin.id, null, 'plugin_registered', 'system', { slug: input.slug })

  return plugin
}

export async function getPlugin(pluginId: string): Promise<Plugin | null> {
  const res = await pool.query(`SELECT * FROM plugins WHERE id = $1`, [pluginId])
  return res.rows.length > 0 ? _mapPlugin(res.rows[0]) : null
}

export async function listPlugins(opts: {
  pluginType?: PluginType
  status?: PluginStatus
} = {}): Promise<Plugin[]> {
  const res = await pool.query(
    `SELECT * FROM plugins
     WHERE ($1::text IS NULL OR plugin_type = $1::plugin_type)
       AND ($2::text IS NULL OR status = $2::plugin_status)
       AND kill_switch = FALSE
     ORDER BY name`,
    [opts.pluginType ?? null, opts.status ?? null],
  )
  return res.rows.map(_mapPlugin)
}

export async function updatePluginStatus(
  pluginId: string,
  status: PluginStatus,
): Promise<Plugin> {
  const res = await pool.query(
    `UPDATE plugins SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [pluginId, status],
  )
  if (res.rows.length === 0) throw new Error(`Plugin ${pluginId} not found`)
  await _auditPlugin(pluginId, null, 'status_changed', 'system', { newStatus: status })
  return _mapPlugin(res.rows[0])
}

export async function triggerKillSwitch(pluginId: string, actor: string): Promise<void> {
  await pool.query(
    `UPDATE plugins SET kill_switch = TRUE, updated_at = now() WHERE id = $1`,
    [pluginId],
  )
  // Disable all tenant installs immediately
  await pool.query(
    `UPDATE tenant_plugin_installs
     SET is_active = FALSE, disabled_at = now()
     WHERE plugin_id = $1 AND is_active = TRUE`,
    [pluginId],
  )
  await _auditPlugin(pluginId, null, 'kill_switch_triggered', actor, {})
}

// ─── Version management ───────────────────────────────────────────────────────

export async function addPluginVersion(
  pluginId: string,
  version: string,
  manifest: Record<string, unknown>,
  bundleContent: string,
  changelog?: string,
): Promise<PluginVersion> {
  const checksum = createHash('sha256').update(bundleContent).digest('hex')
  const res = await pool.query(
    `INSERT INTO plugin_versions (plugin_id, version, bundle_checksum, manifest, changelog)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [pluginId, version, checksum, JSON.stringify(manifest), changelog ?? null],
  )
  return _mapPluginVersion(res.rows[0])
}

export async function releasePluginVersion(versionId: string): Promise<PluginVersion> {
  const res = await pool.query(
    `UPDATE plugin_versions SET is_active = TRUE, released_at = now() WHERE id = $1 RETURNING *`,
    [versionId],
  )
  if (res.rows.length === 0) throw new Error(`Plugin version ${versionId} not found`)
  return _mapPluginVersion(res.rows[0])
}

// ─── Tenant install/rollback ──────────────────────────────────────────────────

export interface InstallPluginInput {
  version: string
  grantedScopes?: string[]
  installedBy?: string
}

export async function installPlugin(
  tenantId: string,
  pluginId: string,
  input: InstallPluginInput,
): Promise<TenantPluginInstall> {
  const plugin = await getPlugin(pluginId)
  if (plugin == null) throw new Error(`Plugin ${pluginId} not found`)
  if (plugin.status !== 'published') {
    throw new Error(`Plugin ${pluginId} is not published (status: ${plugin.status})`)
  }
  if (plugin.killSwitch) throw new Error(`Plugin ${pluginId} has been disabled by kill switch`)

  // Validate requested scopes against declared required scopes
  const requestedScopes = input.grantedScopes ?? []
  const unauthorized = requestedScopes.filter(s => !plugin.requiredScopes.includes(s))
  if (unauthorized.length > 0) {
    throw new Error(`Unauthorized scopes requested: ${unauthorized.join(', ')}`)
  }

  // Find current install for rollback version capture
  const currentRes = await tenantQuery(
    tenantId,
    `SELECT version FROM tenant_plugin_installs
     WHERE tenant_id = $1 AND plugin_id = $2 AND is_active = TRUE`,
    [tenantId, pluginId],
  )
  const rollbackVersion = currentRes.rows[0]?.version as string ?? null

  // Deactivate existing
  if (rollbackVersion != null) {
    await tenantQuery(
      tenantId,
      `UPDATE tenant_plugin_installs
       SET is_active = FALSE, disabled_at = now()
       WHERE tenant_id = $1 AND plugin_id = $2 AND is_active = TRUE`,
      [tenantId, pluginId],
    )
  }

  const res = await tenantQuery(
    tenantId,
    `INSERT INTO tenant_plugin_installs
      (tenant_id, plugin_id, version, granted_scopes, installed_by, rollback_version)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [tenantId, pluginId, input.version, requestedScopes, input.installedBy ?? 'system', rollbackVersion],
  )

  // Record permissions
  for (const scope of requestedScopes) {
    await tenantQuery(
      tenantId,
      `INSERT INTO plugin_permissions (tenant_id, plugin_id, scope, granted, granted_by, granted_at)
       VALUES ($1,$2,$3,TRUE,$4,now())
       ON CONFLICT DO NOTHING`,
      [tenantId, pluginId, scope, input.installedBy ?? 'system'],
    )
  }

  await _auditPlugin(pluginId, tenantId, 'plugin_installed', input.installedBy ?? 'system', {
    version: input.version, grantedScopes: requestedScopes,
  })

  return _mapInstall(res.rows[0])
}

export async function rollbackPlugin(
  tenantId: string,
  pluginId: string,
): Promise<TenantPluginInstall> {
  const currentRes = await tenantQuery(
    tenantId,
    `SELECT * FROM tenant_plugin_installs
     WHERE tenant_id = $1 AND plugin_id = $2 AND is_active = TRUE`,
    [tenantId, pluginId],
  )
  if (currentRes.rows.length === 0) throw new Error(`No active install for plugin ${pluginId}`)
  const current = _mapInstall(currentRes.rows[0])
  if (current.rollbackVersion == null) throw new Error(`No rollback version available`)

  return installPlugin(tenantId, pluginId, {
    version: current.rollbackVersion,
    grantedScopes: current.grantedScopes,
    installedBy: 'rollback_system',
  })
}

export async function disablePlugin(tenantId: string, pluginId: string): Promise<void> {
  await tenantQuery(
    tenantId,
    `UPDATE tenant_plugin_installs
     SET is_active = FALSE, disabled_at = now()
     WHERE tenant_id = $1 AND plugin_id = $2 AND is_active = TRUE`,
    [tenantId, pluginId],
  )
  await _auditPlugin(pluginId, tenantId, 'plugin_disabled', 'tenant', {})
}

export async function checkPluginPermission(
  tenantId: string,
  pluginId: string,
  scope: string,
): Promise<boolean> {
  const res = await tenantQuery(
    tenantId,
    `SELECT granted FROM plugin_permissions
     WHERE tenant_id = $1 AND plugin_id = $2 AND scope = $3 AND revoked_at IS NULL`,
    [tenantId, pluginId, scope],
  )
  return res.rows[0]?.granted === true
}

export async function getPluginAuditEvents(
  pluginId: string,
  tenantId?: string,
): Promise<PluginAuditEvent[]> {
  const res = await pool.query(
    `SELECT * FROM plugin_audit_events
     WHERE plugin_id = $1 AND ($2::uuid IS NULL OR tenant_id = $2)
     ORDER BY created_at DESC`,
    [pluginId, tenantId ?? null],
  )
  return res.rows.map(_mapAuditEvent)
}

// ─── Internal audit helper ────────────────────────────────────────────────────

async function _auditPlugin(
  pluginId: string,
  tenantId: string | null,
  eventType: string,
  actor: string,
  details: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    `INSERT INTO plugin_audit_events (plugin_id, tenant_id, event_type, actor, details)
     VALUES ($1,$2,$3,$4,$5)`,
    [pluginId, tenantId, eventType, actor, JSON.stringify(details)],
  )
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function _mapPlugin(row: Record<string, unknown>): Plugin {
  return {
    id: row['id'] as string,
    slug: row['slug'] as string,
    name: row['name'] as string,
    description: (row['description'] as string) ?? null,
    pluginType: row['plugin_type'] as PluginType,
    author: row['author'] as string,
    status: row['status'] as PluginStatus,
    currentVersion: row['current_version'] as string,
    manifest: (typeof row['manifest'] === 'string'
      ? JSON.parse(row['manifest'])
      : row['manifest']) as Record<string, unknown>,
    requiredScopes: (row['required_scopes'] as string[]) ?? [],
    killSwitch: Boolean(row['kill_switch']),
    metadata: (typeof row['metadata'] === 'string'
      ? JSON.parse(row['metadata'])
      : row['metadata']) as Record<string, unknown>,
    createdAt: new Date(row['created_at'] as string),
    updatedAt: new Date(row['updated_at'] as string),
  }
}

function _mapPluginVersion(row: Record<string, unknown>): PluginVersion {
  return {
    id: row['id'] as string,
    pluginId: row['plugin_id'] as string,
    version: row['version'] as string,
    bundleChecksum: row['bundle_checksum'] as string,
    manifest: (typeof row['manifest'] === 'string'
      ? JSON.parse(row['manifest'])
      : row['manifest']) as Record<string, unknown>,
    changelog: (row['changelog'] as string) ?? null,
    isActive: Boolean(row['is_active']),
    releasedAt: row['released_at'] != null ? new Date(row['released_at'] as string) : null,
    createdAt: new Date(row['created_at'] as string),
  }
}

function _mapInstall(row: Record<string, unknown>): TenantPluginInstall {
  return {
    id: row['id'] as string,
    tenantId: row['tenant_id'] as string,
    pluginId: row['plugin_id'] as string,
    version: row['version'] as string,
    grantedScopes: (row['granted_scopes'] as string[]) ?? [],
    isActive: Boolean(row['is_active']),
    installedBy: row['installed_by'] as string,
    installedAt: new Date(row['installed_at'] as string),
    disabledAt: row['disabled_at'] != null ? new Date(row['disabled_at'] as string) : null,
    rollbackVersion: (row['rollback_version'] as string) ?? null,
  }
}

function _mapAuditEvent(row: Record<string, unknown>): PluginAuditEvent {
  return {
    id: row['id'] as string,
    tenantId: (row['tenant_id'] as string) ?? null,
    pluginId: row['plugin_id'] as string,
    eventType: row['event_type'] as string,
    actor: row['actor'] as string,
    details: (typeof row['details'] === 'string'
      ? JSON.parse(row['details'])
      : row['details']) as Record<string, unknown>,
    createdAt: new Date(row['created_at'] as string),
  }
}

export const __testHooks = { _mapPlugin, _mapPluginVersion, _mapInstall, _mapAuditEvent }
