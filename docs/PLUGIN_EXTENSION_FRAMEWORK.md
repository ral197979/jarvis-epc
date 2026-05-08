# Plugin Extension Framework

## Overview

The Plugin Extension Framework provides a secure, permissioned system for extending Ava's platform capabilities. Plugins declare explicit required scopes; tenants grant a subset of those scopes at install time. A platform-level kill switch can instantly disable any plugin across all tenants.

## Permission Model

Every plugin declares `required_scopes` at registration time (e.g., `['read:tickets', 'write:tickets']`). When a tenant installs a plugin, they provide `grantedScopes` — a subset of the declared required scopes. If any requested scope is not in `required_scopes`, the install is rejected with `'Unauthorized scopes requested'`.

```
Plugin declares: ['read:tickets', 'write:tickets', 'read:sla']
Tenant requests: ['read:tickets', 'write:tickets']   ✓ OK
Tenant requests: ['read:tickets', 'admin:all']        ✗ Rejected
```

## Plugin Lifecycle

```
Developer registers plugin
  → registerPlugin() creates plugin with status='draft'
  → addPluginVersion() adds bundle with checksum

Testing & review
  → updatePluginStatus() transitions to 'published'

Tenant install
  → installPlugin(tenantId, pluginId, { version, grantedScopes })
  → plugin.status must be 'published' — draft/deprecated plugins cannot be installed
  → rollback_version captured from prior active install

Rollback
  → rollbackPlugin(tenantId, pluginId) restores previous version

Disable for tenant
  → disablePlugin(tenantId, pluginId) sets is_active=FALSE
```

## Kill Switch

`triggerKillSwitch(pluginId, actor)` is a platform-level emergency control that:
1. Sets `kill_switch = TRUE` on the plugin row
2. Sets `is_active = FALSE` on all `tenant_plugin_installs` immediately
3. Logs a `kill_switch_triggered` audit event

Once the kill switch is triggered, the plugin is excluded from `listPlugins()` results (`WHERE kill_switch = FALSE`).

## Version Management

Plugin versions track bundle checksums for integrity verification. Each version has:
- `bundle_checksum` — SHA-256 of the bundle content
- `manifest` — JSON capability declaration
- `changelog` — human-readable release notes
- `released_at` — set when the version is promoted via `releasePluginVersion()`

## Audit Trail

All significant events are logged to `plugin_audit_events`:
- `plugin_registered`
- `status_changed`
- `plugin_installed`
- `kill_switch_triggered`

`getPluginAuditEvents(pluginId)` retrieves the full event history for a plugin.

## Configuration

No environment variables required. All permissions are enforced at the database level via RLS on `tenant_plugin_installs`.

## Related Services

- `playbookMarketplaceService` — playbooks can embed plugin steps
- `externalAgentGateway` — agents can invoke permitted plugin actions
